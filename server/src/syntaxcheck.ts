import { connection, log } from "./clientManager"
import { objectIsValid } from "vscode-abap-remote-fs-sharedapi"
import { TextDocument, Diagnostic } from "vscode-languageserver"
import { getObject, vscUrl } from "./objectManager"
import { documents } from "./server"
import { sourceRange, decodeSeverity, clientAndObjfromUrl } from "./utilities"
import { callThrottler, caughtToString } from "./functions"
import { memoize, debounce } from "lodash"

const oldDiagKeys = new Map<string, string[]>()

const throttler = callThrottler<void>()

// 每个文档的防抖定时器，避免快速输入时对 SAP 造成压力
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
const DEBOUNCE_DELAY = 500 // 最后一次击键后等待 500ms 再检查

// 规范化 URI 编码，避免 %24 与 $ 不匹配
const normalizeUri = (uri: string) => decodeURIComponent(uri)

// 防抖语法检查 - 等待用户停止输入后再发起 API 调用。
/**
 * 短暂停顿后触发语法校验请求，让快速输入不会淹没后端。
 */
export function syntaxCheck(document: TextDocument) {
  const { uri } = document

  // 清除此文档的任何现有定时器
  const existingTimer = debounceTimers.get(uri)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  // 设置新定时器 - 用户停止输入后执行
  const timer = setTimeout(() => {
    debounceTimers.delete(uri)
    // 重要：执行时获取当前文档，而不是过期的捕获引用
    // 自 syntaxCheck 被调用以来用户可能输入了更多
    const currentDoc = documents.get(uri)
    if (currentDoc) {
      throttler(uri, () => runSyntaxCheck(currentDoc))
    }
  }, DEBOUNCE_DELAY)

  debounceTimers.set(uri, timer)
}

async function runSyntaxCheck(document: TextDocument) {
  const normalizedDocUri = normalizeUri(document.uri)
  const diagmap = new Map<string, Diagnostic[]>()
  const oldKeys = oldDiagKeys.get(normalizedDocUri)
  if (oldKeys) {
    for (const k of oldKeys) diagmap.set(k, [])
  }
  diagmap.set(normalizedDocUri, [])
  try {
    const co = await clientAndObjfromUrl(normalizedDocUri, false)
    if (!co) return

    const obj = await getObject(normalizedDocUri)
    if (!obj) return

    // 如果这是没有主程序的 include，在校验前尝试发现一个
    if (obj.type === "PROG/I" && !obj.mainProgram) {
      try {
        const mainProgs = await co.client.statelessClone.mainPrograms(obj.url)
        if (mainProgs && mainProgs.length > 0) {
          obj.mainProgram = mainProgs[0]["adtcore:uri"]
        } else {
          return
        }
      } catch (error) {
        return
      }
    }

    // 现在在可能添加主程序后检查有效性
    if (!objectIsValid(obj)) return

    // 获取相关文件的未激活（工作）版本源码
    const getSource = memoize((c: string) =>
      co.client.statelessClone.getObjectSource(c, { version: "inactive" })
    )
    // 对次要 URI（include、相关对象），始终作为主处理以规范化上下文路径
    const getUri = memoize((uri: string) => vscUrl(co.confKey, uri, true))
    const getdiag = (key: string) => {
      let diag = diagmap.get(key)
      if (!diag) {
        diag = []
        diagmap.set(key, diag)
      }
      return diag
    }

    const source = document.getText()
    const checks = await co.client.statelessClone.syntaxCheck(
      obj.url,
      obj.mainUrl,
      source,
      obj.mainProgram
    )

    // 即使没有检查也继续 - 这意味着代码有效，我们应该清除旧诊断
    // 只在 checks 为 null/undefined 时中止（表示 API 调用出错）

    for (const c of checks || []) {
      let diagnostics
      let range
      if (c.uri === obj.mainUrl) {
        diagnostics = getdiag(normalizedDocUri)
        range = sourceRange(document, c.line, c.offset)
      } else {
        const uri = await getUri(c.uri)
        if (!uri) continue

        const normalizedUri = normalizeUri(uri)

        // 先尝试找到打开的文档（使用编辑器文本获得准确行号）
        const openDoc = documents.all().find(d => normalizeUri(d.uri) === normalizedUri)
        if (openDoc) {
          diagnostics = getdiag(normalizedUri)
          range = sourceRange(openDoc.getText(), c.line, c.offset)
        } else {
          const chsrc = await getSource(c.uri)
          diagnostics = getdiag(normalizedUri)
          range = sourceRange(chsrc, c.line, c.offset)
        }
      }
      diagnostics.push({
        message: c.text,
        range,
        source: "ABAPfs",
        severity: decodeSeverity(c.severity)
      })
    }
  } catch (e) {
    log("Exception in syntax check:", caughtToString(e))
    return
  }

  for (const diag of diagmap) {
    connection.sendDiagnostics({ uri: diag[0], diagnostics: diag[1] })
  }

  // 存储由此 URL 生成诊断的源码列表，
  // 以便稍后清理它们
  const newKeys = [...diagmap].filter(e => e[1].length).map(e => e[0])
  if (newKeys.length) {
    oldDiagKeys.set(normalizedDocUri, newKeys)
  } else {
    oldDiagKeys.delete(normalizedDocUri)
  }
}
