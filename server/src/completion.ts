import {
  CompletionParams,
  CompletionItem,
  CompletionList,
  Position,
  InsertTextFormat,
  SignatureHelpParams,
  SignatureHelp,
  SignatureInformation,
  ParameterInformation
} from "vscode-languageserver"
import { clientAndObjfromUrl, ClientAndObject } from "./utilities"
import { log } from "./clientManager"
import { isAbap, callThrottler, isCdsView, caughtToString } from "./functions"
import { CompletionProposal, ADTClient, CompletionElementInfo } from "abap-adt-api"
import { cdsCompletionExtractor, cdsDataSources } from "./cdsSyntax"
import { formatItem } from "./completionutils"

// ── 补全 ──────────────────────────────────────────────────────────────

const completionKey = (url: string, p: Position) => `${url} ${p.line} ${p.character}`
const throttler = callThrottler<CompletionProposal[]>()
const proposals = (client: ADTClient, url: string, p: Position, source: string) => {
  const key = completionKey(url, p)
  return throttler(key, () =>
    client.codeCompletion(url, source, p.line + 1, p.character).catch(e => {
      log(`Completion error: ${caughtToString(e)}`)
      return []
    })
  )
}
const isSupported = (x: string) => isAbap(x) || isCdsView(x)

// 缓存上次补全上下文，让 onCompletionResolve 可以调用 codeCompletionFull
let lastCompletionContext:
  | {
      uri: string
      mainUrl: string
      source: string
      position: Position
    }
  | undefined

async function abapCompletion(co: ClientAndObject, pos: Position, docUri: string) {
  const { client, obj, source } = co
  const rawItems = await proposals(client, obj.mainUrl, pos, source)
  const line = source.split(/\n/)[pos.line] || ""
  const items: CompletionItem[] = rawItems.map(formatItem(line, pos))

  // 存储上下文供解析使用 - 必须使用 adt:// 文档 URI，而不是 obj.url
  lastCompletionContext = {
    uri: docUri,
    mainUrl: obj.mainUrl,
    source,
    position: pos
  }

  return items
}

async function cdsCompletion(co: ClientAndObject, pos: Position) {
  const { client, source } = co
  const items: CompletionItem[] = []
  const { matched, prefix, sources } = cdsCompletionExtractor(source, pos)
  const add = (label: string) => {
    if (!items.find(i => i.label === label)) items.push({ label })
  }
  if (matched === "NONE") {
    // 光标可能在 { } 内的空行上 — 提供来自数据源的所有字段
    const line = source.split("\n")[pos.line] || ""
    if (line.trim() === "" || line.trim() === "," || line.trim() === "KEY") {
      const dataSources = cdsDataSources(source)
      if (dataSources.length) {
        const elements = await client.ddicRepositoryAccess(dataSources.map(s => `${s}.`))
        for (const element of elements) add(element.name)
      }
    }
    return items
  }
  if (matched === "SOURCE") {
    const elements = await client.ddicRepositoryAccess(`${prefix}*`)
    for (const element of elements) add(element.name)
  } else if (sources.length) {
    const elements = await client.ddicRepositoryAccess(sources.map(s => `${s}.`))
    for (const element of elements) {
      if (element.name.startsWith(prefix)) add(element.name)
      else {
        const label = `${element.path}.${element.name}`
        if (label.startsWith(prefix)) add(label)
      }
    }
  }
  return items
}

/**
 * 基于当前光标上下文为 ABAP 和 CDS 文档提供补全项。
 */
export async function completion(params: CompletionParams) {
  try {
    if (!isSupported(params.textDocument.uri)) return
    let items: CompletionItem[] = []
    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co) return items

    if (isAbap(params.textDocument.uri))
      items = await abapCompletion(co, params.position, params.textDocument.uri)
    if (isCdsView(params.textDocument.uri)) items = await cdsCompletion(co, params.position)
    const isInComplete = (compl: CompletionItem[]) => {
      if (compl.length > 10) return true
      if (compl.length === 0) return false
      // 对 "type table of" 的特殊处理
      let found = false

      compl.some(c => {
        const match = (typeof c.label === "string" ? c.label : "").match(/type( table of)?/i)
        if (match && match[1]) found = true
        return found || !match
      })

      return !found
    }
    return CompletionList.create(items, isInComplete(items))
  } catch (e) {
    log("Exception in completion:", caughtToString(e)) // 忽略
  }
}

// ── 补全解析 ──────────────────────────────────────────────────────
// 用户选择补全项时，尝试从 ADT codeCompletionFull 端点
// 获取完整插入文本（带方法参数）。

/**
 * 当 ADT 后端可以提供时，把补全项解析为其完整片段文本。
 */
export async function completionResolve(item: CompletionItem): Promise<CompletionItem> {
  try {
    log(
      "[completionResolve] called for:",
      typeof item.label === "string" ? item.label : item.label.label
    )
    const proposal: CompletionProposal | undefined = item.data
    if (!proposal) {
      log("[completionResolve] no proposal data on item")
      return item
    }
    if (!lastCompletionContext) {
      log("[completionResolve] no lastCompletionContext")
      return item
    }

    log(
      "[completionResolve] uri:",
      lastCompletionContext.uri,
      "mainUrl:",
      lastCompletionContext.mainUrl
    )
    const co = await clientAndObjfromUrl(lastCompletionContext.uri, true)
    if (!co?.client) {
      log("[completionResolve] clientAndObjfromUrl returned nothing")
      return item
    }

    const { mainUrl, source, position } = lastCompletionContext
    log(
      "[completionResolve] calling codeCompletionFull for",
      proposal.IDENTIFIER,
      "at",
      position.line + 1,
      position.character
    )
    const fullText = await co.client.statelessClone.codeCompletionFull(
      mainUrl,
      source,
      position.line + 1,
      position.character,
      proposal.IDENTIFIER
    )

    log("[completionResolve] fullText:", JSON.stringify(fullText?.substring(0, 200)))
    if (fullText && typeof fullText === "string" && fullText.length > proposal.IDENTIFIER.length) {
      // 转换为片段：把空赋值位置替换为制表位
      const snippet = convertToSnippet(fullText, proposal.IDENTIFIER)
      log("[completionResolve] snippet:", JSON.stringify(snippet?.substring(0, 200)))
      if (snippet) {
        item.insertText = snippet
        item.insertTextFormat = InsertTextFormat.Snippet
      }
    } else {
      log(
        "[completionResolve] fullText not usable (length:",
        fullText?.length,
        "vs identifier:",
        proposal.IDENTIFIER.length,
        ")"
      )
    }
  } catch (e) {
    log("Exception in completionResolve:", caughtToString(e))
  }
  return item
}

/**
 * 把 ADT 的完整插入文本转换为带制表位的 VS Code 片段。
 * ADT 根据系统/方法以三种已知格式返回文本：
 *   格式 A：多行，下一行回显："param = \necho_value\n"
 *   格式 B：多行，内联 ABAP 注释："param =                  " comment"
 *   格式 C：单行："method( param =  )."
 * 我们把所有格式规范化为 "param = " 并添加制表位。
 */
function convertToSnippet(fullText: string, identifier: string): string | undefined {
  // 如果完整文本不包含括号，则不是方法调用
  if (!fullText.includes("(")) return undefined

  log("[convertToSnippet] raw fullText:", JSON.stringify(fullText))

  // 规范化行尾
  let text = fullText.replace(/\r\n/g, "\n")

  // 格式 A：剥离下一行回显的参数值："= \n<echo>" → "= \n"
  text = text.replace(/(=[ \t]*\n)[^\n]*/g, "$1")

  // 格式 B：剥离 "=" 之后的内联 ABAP 注释："= <spaces>" comment" → "= "
  text = text.replace(/(=)\s*"[^\n]*/g, "$1 ")

  log("[convertToSnippet] cleanedText:", JSON.stringify(text))

  let tabIndex = 0
  // 替换所有空赋值槽位（值在 ")"、"," 或行尾之前只有空白）
  // 对多行（格式 A/B）和单行（格式 C）都有效
  const snippet = text.replace(
    /(\b\w+)([ \t]*=[ \t]*)(?=[ \t]*[),\n]|[ \t]*$)/gm,
    (match, paramName, equals, offset, str) => {
      // 跳过注释行上的赋值（行以可选空格后跟 * 开头）
      const lineStart = str.lastIndexOf("\n", offset - 1) + 1
      if (/^\s*\*/.test(str.substring(lineStart, offset + paramName.length))) return match
      tabIndex++
      return `${paramName}${equals}\${${tabIndex}}`
    }
  )

  log(
    "[convertToSnippet] tabIndex:",
    tabIndex,
    "snippet:",
    JSON.stringify(snippet?.substring(0, 300))
  )

  if (tabIndex === 0) return undefined

  return snippet + `\$0`
}

// ── 签名帮助 ──────────────────────────────────────────────────────────
// 在括号内输入时显示方法参数提示。

/**
 * 基于当前光标位置为 ABAP 方法调用提供签名帮助。
 */
export async function signatureHelp(
  params: SignatureHelpParams
): Promise<SignatureHelp | undefined> {
  try {
    if (!isAbap(params.textDocument.uri)) return undefined

    const co = await clientAndObjfromUrl(params.textDocument.uri)
    if (!co?.client) return undefined

    const { source, obj } = co
    const lines = source.split(/\n/)

    // 查找方法调用上下文：向后查找 CLASS=>METHOD( 或 OBJECT->METHOD(
    const callMatch = findMethodCall(lines, params.position)
    if (!callMatch) return undefined

    // 使用方法调用位置的 codeCompletionElement 获取参数信息
    const elementInfo = await co.client.statelessClone.codeCompletionElement(
      obj.mainUrl,
      source,
      callMatch.line + 1,
      callMatch.column
    )

    if (!elementInfo || typeof elementInfo === "string") return undefined

    const sigInfo = buildSignatureFromElementInfo(elementInfo, callMatch.methodName)
    if (!sigInfo) return undefined

    // 基于逗号数确定活动参数
    const activeParam = countCommasBeforeCursor(lines, params.position, callMatch)

    return {
      signatures: [sigInfo],
      activeSignature: 0,
      activeParameter: activeParam
    }
  } catch (e) {
    log("Exception in signatureHelp:", caughtToString(e))
    return undefined
  }
}

interface MethodCallContext {
  line: number
  column: number
  methodName: string
  parenLine: number
  parenColumn: number
}

/**
 * 从光标向后扫描，找到方法调用的左括号 (。
 * 处理多行调用。
 */
function findMethodCall(lines: string[], pos: Position): MethodCallContext | undefined {
  let depth = 0
  let l = pos.line
  let c = pos.character - 1

  // 向后遍历找到匹配的左括号
  while (l >= 0) {
    const line = lines[l] || ""
    if (c < 0) c = line.length - 1

    while (c >= 0) {
      const ch = line[c]
      if (ch === ")") depth++
      else if (ch === "(") {
        if (depth === 0) {
          // 找到左括号。现在查找它之前的方法名。
          const textBefore = line.substring(0, c).trimEnd()
          // 匹配如：CLASS=>METHOD、obj->method、FUNCTION_NAME 的模式
          const nameMatch = textBefore.match(/([\w\/]+(?:[=-]>[\w\/]+)?)\s*$/)
          if (nameMatch) {
            const fullName = nameMatch[1]
            const methodName =
              fullName.includes("=>") || fullName.includes("->")
                ? fullName.split(/[=-]>/)[1] || fullName
                : fullName
            const nameStart = textBefore.length - nameMatch[0].trimStart().length
            return {
              line: l,
              column: nameStart + 1, // ADT 从 1 开始
              methodName,
              parenLine: l,
              parenColumn: c
            }
          }
          return undefined
        }
        depth--
      }
      c--
    }
    l--
    c = -1
  }
  return undefined
}

/**
 * 从 CompletionElementInfo 构建 SignatureInformation
 */
function buildSignatureFromElementInfo(
  info: CompletionElementInfo,
  methodName: string
): SignatureInformation | undefined {
  if (!info.components || info.components.length === 0) return undefined

  const params: ParameterInformation[] = []
  const paramLabels: string[] = []

  for (const comp of info.components) {
    // 每个组件表示一个参数组或单个参数
    if (comp.entries && comp.entries.length > 0) {
      const paramType = comp.entries.find(e => e.key === "type")?.value || ""
      const paramDir = comp["adtcore:type"] || ""
      const label = `${comp["adtcore:name"]}${paramType ? " TYPE " + paramType : ""}`
      paramLabels.push(label)
      params.push(ParameterInformation.create(comp["adtcore:name"], paramDir))
    }
  }

  if (params.length === 0) return undefined

  const sigLabel = `${methodName}( ${paramLabels.join(", ")} )`
  const sig = SignatureInformation.create(sigLabel, info.doc || undefined, ...params)
  return sig
}

/**
 * 统计左括号与光标之间的逗号数以确定活动参数
 */
function countCommasBeforeCursor(
  lines: string[],
  cursorPos: Position,
  callCtx: MethodCallContext
): number {
  let commas = 0
  let depth = 0

  for (let l = callCtx.parenLine; l <= cursorPos.line; l++) {
    const line = lines[l] || ""
    const startCol = l === callCtx.parenLine ? callCtx.parenColumn + 1 : 0
    const endCol = l === cursorPos.line ? cursorPos.character : line.length

    for (let c = startCol; c < endCol; c++) {
      const ch = line[c]
      if (ch === "(") depth++
      else if (ch === ")") depth--
      else if (ch === "," && depth === 0) commas++
    }
  }
  return commas
}
