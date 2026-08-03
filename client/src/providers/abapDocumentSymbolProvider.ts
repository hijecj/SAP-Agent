import * as vscode from "vscode"
import { ADTSCHEME } from "../adt/conections"

// 在第一个 " 处剥离 ABAP 内联注释。
function stripComment(line: string): string {
  const idx = line.indexOf('"')
  return idx >= 0 ? line.slice(0, idx) : line
}

type ChainKeyword =
  | "DATA"
  | "CLASS-DATA"
  | "STATICS"
  | "TYPES"
  | "CONSTANTS"
  | "FIELD-SYMBOLS"
  | "METHODS"
  | "CLASS-METHODS"

// 出现在方法参数规范中的关键字 – 不是方法名
const METHOD_SPEC_KEYWORDS = new Set([
  "IMPORTING",
  "EXPORTING",
  "CHANGING",
  "RAISING",
  "EXCEPTIONS",
  "RETURNING",
  "TYPE",
  "LIKE",
  "OPTIONAL",
  "DEFAULT",
  "VALUE",
  "PREFERRED",
  "PARAMETER",
  "ABSTRACT",
  "FINAL",
  "REDEFINITION",
  "FOR",
  "TESTING",
  "AMDP",
  "BY",
  "DATABASE",
  "PROCEDURE"
])

function kindForChain(kw: ChainKeyword): vscode.SymbolKind {
  switch (kw) {
    case "TYPES":
      return vscode.SymbolKind.TypeParameter
    case "CONSTANTS":
      return vscode.SymbolKind.Constant
    case "CLASS-DATA":
      return vscode.SymbolKind.Field
    case "METHODS":
    case "CLASS-METHODS":
      return vscode.SymbolKind.Method
    default:
      return vscode.SymbolKind.Variable
  }
}

function addToScope(
  sym: vscode.DocumentSymbol,
  stack: vscode.DocumentSymbol[],
  root: vscode.DocumentSymbol[]
): void {
  if (stack.length > 0) stack[stack.length - 1].children.push(sym)
  else root.push(sym)
}

// 用于标识类内部分区子作用域的详情
const SECTION_DETAILS = new Set(["public section", "private section", "protected section"])

export function parseAbapDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const root: vscode.DocumentSymbol[] = []
  const scopeStack: vscode.DocumentSymbol[] = []
  let chainKind: ChainKeyword | null = null
  let structDepth = 0
  // 在 METHODS/CLASS-METHODS 链中时：true 表示下一个标识符是方法名
  let methodNameNext = false
  let activeMethodDeclaration: vscode.DocumentSymbol | undefined
  const lineCount = document.lineCount

  function closeDeclaration(symbol: vscode.DocumentSymbol | undefined, lineIdx: number) {
    if (!symbol) return
    const lineText = document.lineAt(lineIdx).text
    symbol.range = new vscode.Range(
      symbol.range.start,
      new vscode.Position(lineIdx, lineText.length)
    )
  }

  // 在 METHODS/CLASS-METHODS 链中时处理一行文本。
  // 返回更新后的 methodNameNext 标志（下一行是否预期名称）。
  function processMethodsChunk(text: string, expectName: boolean, lineIdx: number): boolean {
    let remaining = text.trimStart()
    let expect = expectName
    while (remaining.length > 0) {
      const ci = remaining.indexOf(",")
      const segment = (ci >= 0 ? remaining.slice(0, ci) : remaining).trimStart()
      remaining = ci >= 0 ? remaining.slice(ci + 1).trimStart() : ""
      if (expect) {
        const nm = /^([\w\/~$]+)/.exec(segment)
        if (nm && !METHOD_SPEC_KEYWORDS.has(nm[1].toUpperCase())) {
          closeDeclaration(activeMethodDeclaration, lineIdx)
          activeMethodDeclaration = addDeclaration(
            nm[1],
            vscode.SymbolKind.Method,
            chainKind!,
            lineIdx
          )
          expect = false
        }
        // 期望名称时的规范关键字：保持 expect=true（例如名称前的 ABSTRACT）
      }
      if (ci >= 0) expect = true // 找到逗号 → 下一段开始新方法名
    }
    return expect
  }
  // 跟踪合并的类作用域：名称（小写）→ 符号
  const classScopes = new Map<string, vscode.DocumentSymbol>()
  // DEFINITION 已关闭但 IMPLEMENTATION 尚未打开的类
  const awaitingImpl = new Set<string>()

  function openScope(name: string, kind: vscode.SymbolKind, detail: string, lineIdx: number) {
    const lineText = document.lineAt(lineIdx).text
    const pos = new vscode.Position(lineIdx, 0)
    const range = new vscode.Range(lineIdx, 0, lineIdx, lineText.length)
    const sym = new vscode.DocumentSymbol(name, detail, kind, range, range)
    addToScope(sym, scopeStack, root)
    scopeStack.push(sym)
    chainKind = null
  }

  function closeScope(lineIdx: number) {
    const sym = scopeStack.pop()
    if (sym) {
      const lineText = document.lineAt(lineIdx).text
      sym.range = new vscode.Range(sym.range.start, new vscode.Position(lineIdx, lineText.length))
    }
  }

  function addDeclaration(name: string, kind: vscode.SymbolKind, detail: string, lineIdx: number) {
    if (structDepth > 0) return
    const lineText = document.lineAt(lineIdx).text
    const range = new vscode.Range(lineIdx, 0, lineIdx, lineText.length)
    const sym = new vscode.DocumentSymbol(name, detail, kind, range, range)
    addToScope(sym, scopeStack, root)
    return sym
  }

  for (let i = 0; i < lineCount; i++) {
    const rawLine = document.lineAt(i).text

    // 跳过整行注释（* 在第一列或前导空白之后）
    if (/^\s*\*/.test(rawLine)) continue

    const trimmed = stripComment(rawLine).trim()
    if (!trimmed) continue

    // 作用域关闭关键字总是先退出链模式，让它们的作用域处理程序可以运行
    if (
      chainKind !== null &&
      /^(ENDFORM|ENDFUNCTION|ENDMODULE|ENDCLASS|ENDMETHOD|ENDINTERFACE)\b/i.test(trimmed)
    ) {
      chainKind = null
      methodNameNext = false
      structDepth = 0
    }

    // ── 链模式中 ──────────────────────────────────────────────────────
    if (chainKind !== null) {
      const endsWithDot = trimmed.endsWith(".")

      // ── METHODS / CLASS-METHODS 链 ──
      if (chainKind === "METHODS" || chainKind === "CLASS-METHODS") {
        methodNameNext = processMethodsChunk(trimmed, methodNameNext, i)
        if (endsWithDot) {
          closeDeclaration(activeMethodDeclaration, i)
          activeMethodDeclaration = undefined
          chainKind = null
          methodNameNext = false
        }
        continue
      }

      // ── DATA / TYPES / CONSTANTS / FIELD-SYMBOLS 链 ──
      if (/\bBEGIN\s+OF\b/i.test(trimmed)) {
        if (structDepth === 0) {
          const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(trimmed)
          if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "structure", i)
        }
        structDepth++
      } else if (/\bEND\s+OF\b/i.test(trimmed)) {
        if (structDepth > 0) structDepth--
      } else if (structDepth === 0) {
        // 提取链续接变量名
        const contFS = /^<([\w\/]+)>\s+(?:TYPE\b|LIKE\b)/i.exec(trimmed)
        const contMain = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b|VALUE\b)/i.exec(trimmed)
        if (contFS) {
          addDeclaration(contFS[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
        } else if (contMain) {
          addDeclaration(contMain[1], kindForChain(chainKind), chainKind, i)
        }
      }

      if (endsWithDot && structDepth === 0) {
        chainKind = null
      }
      continue
    }

    // ── 正常解析 ─────────────────────────────────────────────────────
    let m: RegExpExecArray | null

    // --- 作用域关闭
    if (/^ENDFORM\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDFUNCTION\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDMODULE\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDCLASS\b/i.test(trimmed)) {
      // 先关闭任何打开的分区子作用域
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      // 类作用域现在在顶部
      const classTop = scopeStack[scopeStack.length - 1]
      const classKey = classTop ? classTop.name.toLowerCase() : ""
      if (awaitingImpl.has(classKey)) {
        // 关闭 IMPLEMENTATION – 完全完成
        classScopes.delete(classKey)
        awaitingImpl.delete(classKey)
        closeScope(i)
      } else {
        // 关闭 DEFINITION – 保持作用域打开，供 IMPLEMENTATION 复用
        closeScope(i)
        awaitingImpl.add(classKey)
      }
      continue
    }
    if (/^ENDMETHOD\b/i.test(trimmed)) {
      closeScope(i)
      continue
    }
    if (/^ENDINTERFACE\b/i.test(trimmed)) {
      // 先关闭任何打开的分区子作用域
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      closeScope(i)
      continue
    }

    // --- 作用域打开
    if ((m = /^\s*FORM\s+([\w$\/]+)/i.exec(rawLine))) {
      openScope(m[1].toUpperCase(), vscode.SymbolKind.Function, "FORM", i)
      continue
    }
    if ((m = /^\s*FUNCTION\s+([\w$\/]+)/i.exec(rawLine))) {
      openScope(m[1].toUpperCase(), vscode.SymbolKind.Function, "FUNCTION MODULE", i)
      continue
    }
    if ((m = /^\s*MODULE\s+([\w$\/]+)/i.exec(rawLine))) {
      openScope(m[1].toUpperCase(), vscode.SymbolKind.Function, "MODULE", i)
      continue
    }
    if ((m = /^\s*CLASS\s+([\w$\/]+)\s+DEFINITION/i.exec(rawLine))) {
      const key = m[1].toLowerCase()
      openScope(m[1], vscode.SymbolKind.Class, "CLASS", i)
      classScopes.set(key, scopeStack[scopeStack.length - 1])
      continue
    }
    if ((m = /^\s*CLASS\s+([\w$\/]+)\s+IMPLEMENTATION/i.exec(rawLine))) {
      const key = m[1].toLowerCase()
      const existing = awaitingImpl.has(key) ? classScopes.get(key) : undefined
      if (existing) {
        // 复用定义作用域
        scopeStack.push(existing)
        chainKind = null
      } else {
        openScope(m[1], vscode.SymbolKind.Class, "CLASS", i)
        classScopes.set(key, scopeStack[scopeStack.length - 1])
      }
      continue
    }
    // PUBLIC / PRIVATE / PROTECTED SECTION（类内部）
    if (/^\s*PUBLIC\s+SECTION\b/i.test(rawLine)) {
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      openScope("Public", vscode.SymbolKind.Namespace, "public section", i)
      continue
    }
    if (/^\s*PRIVATE\s+SECTION\b/i.test(rawLine)) {
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      openScope("Private", vscode.SymbolKind.Namespace, "private section", i)
      continue
    }
    if (/^\s*PROTECTED\s+SECTION\b/i.test(rawLine)) {
      if (scopeStack.length > 0 && SECTION_DETAILS.has(scopeStack[scopeStack.length - 1].detail)) {
        closeScope(i)
      }
      openScope("Protected", vscode.SymbolKind.Namespace, "protected section", i)
      continue
    }
    // METHOD 实现开启符 – 绝不能匹配 METHODS（声明关键字）
    if ((m = /^\s*METHOD\s+((?!S\b)[\w$\/~]+)/i.exec(rawLine))) {
      openScope(m[1], vscode.SymbolKind.Method, "METHOD", i)
      continue
    }
    // INTERFACE（仅独立定义 – 作为类语句的 INTERFACES 带尾随 S）
    if ((m = /^\s*INTERFACE\s+([\w$\/]+)/i.exec(rawLine)) && !/^\s*INTERFACES\s+/i.test(rawLine)) {
      openScope(m[1], vscode.SymbolKind.Interface, "INTERFACE", i)
      continue
    }

    // --- METHODS / CLASS-METHODS 链或单一声明
    if ((m = /^\s*(CLASS-METHODS|METHODS)\s*:/i.exec(rawLine))) {
      const kw = m[1].toUpperCase() as ChainKeyword
      chainKind = kw
      // 使用剥离注释后的修剪文本找到冒号位置
      const colonIdx = trimmed.indexOf(":")
      const rest = colonIdx >= 0 ? trimmed.slice(colonIdx + 1) : ""
      methodNameNext = processMethodsChunk(rest, true, i)
      if (trimmed.endsWith(".")) {
        closeDeclaration(activeMethodDeclaration, i)
        activeMethodDeclaration = undefined
        chainKind = null
        methodNameNext = false
      }
      continue
    }
    if (
      (m = /^\s*(CLASS-METHODS|METHODS)\s+([\w\/]+)/i.exec(rawLine)) &&
      !/^\s*(CLASS-METHODS|METHODS)\s*:/i.test(rawLine)
    ) {
      const kw = m[1].toUpperCase() as ChainKeyword
      activeMethodDeclaration = addDeclaration(m[2], vscode.SymbolKind.Method, kw, i)
      if (!trimmed.endsWith(".")) {
        chainKind = kw
        methodNameNext = false
      } else {
        closeDeclaration(activeMethodDeclaration, i)
        activeMethodDeclaration = undefined
      }
      continue
    }

    // --- 冒号链声明：DATA: / CLASS-DATA: / STATICS: / TYPES: / CONSTANTS: / FIELD-SYMBOLS:
    if ((m = /^\s*(DATA|CLASS-DATA|STATICS)\s*:/i.exec(rawLine))) {
      const kw = m[1].toUpperCase() as ChainKeyword
      const rest = rawLine.slice(m[0].length).trim()
      chainKind = kw
      if (/^\s*BEGIN\s+OF\b/i.test(rest)) {
        const sm = /^\s*BEGIN\s+OF\s+([\w\/]+)/i.exec(rest)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "structure", i)
        structDepth++
      } else {
        const ffv = /^<([\w\/]+)>\s+(?:TYPE\b|LIKE\b)/i.exec(rest)
        const fv = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b|VALUE\b)/i.exec(rest)
        if (ffv) addDeclaration(ffv[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
        else if (fv) addDeclaration(fv[1], kindForChain(kw), kw, i)
      }
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    if ((m = /^\s*TYPES\s*:/i.exec(rawLine))) {
      chainKind = "TYPES"
      const rest = rawLine.slice(m[0].length).trim()
      if (/^\s*BEGIN\s+OF\b/i.test(rest)) {
        const sm = /^\s*BEGIN\s+OF\s+([\w\/]+)/i.exec(rest)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "type structure", i)
        structDepth++
      } else {
        const fv = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b)/i.exec(rest)
        if (fv) addDeclaration(fv[1], vscode.SymbolKind.TypeParameter, "TYPES", i)
      }
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    if ((m = /^\s*CONSTANTS\s*:/i.exec(rawLine))) {
      chainKind = "CONSTANTS"
      const rest = rawLine.slice(m[0].length).trim()
      const fv = /^([\w\/]+)\s+(?:TYPE\b|LIKE\b|VALUE\b)/i.exec(rest)
      if (fv) addDeclaration(fv[1], vscode.SymbolKind.Constant, "CONSTANTS", i)
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    if ((m = /^\s*FIELD-SYMBOLS\s*:/i.exec(rawLine))) {
      chainKind = "FIELD-SYMBOLS"
      const rest = rawLine.slice(m[0].length).trim()
      const fv = /^<([\w\/]+)>\s+(?:TYPE\b|LIKE\b)/i.exec(rest)
      if (fv) addDeclaration(fv[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
      if (trimmed.endsWith(".") && structDepth === 0) chainKind = null
      continue
    }

    // --- 单名称声明（无冒号链）
    if ((m = /^\s*(DATA|STATICS)\s+([\w\/]+)\s*/i.exec(rawLine))) {
      if (/\bBEGIN\s+OF\b/i.test(rawLine)) {
        const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(rawLine)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "structure", i)
      } else {
        addDeclaration(m[2], vscode.SymbolKind.Variable, m[1].toUpperCase(), i)
      }
      continue
    }

    if ((m = /^\s*CLASS-DATA\s+([\w\/]+)\s*/i.exec(rawLine))) {
      if (/\bBEGIN\s+OF\b/i.test(rawLine)) {
        const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(rawLine)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "CLASS-DATA structure", i)
      } else {
        addDeclaration(m[1], vscode.SymbolKind.Field, "CLASS-DATA", i)
      }
      continue
    }

    if ((m = /^\s*TYPES\s+([\w\/]+)\s*/i.exec(rawLine))) {
      if (/\bBEGIN\s+OF\b/i.test(rawLine)) {
        const sm = /\bBEGIN\s+OF\s+([\w\/]+)/i.exec(rawLine)
        if (sm) addDeclaration(sm[1], vscode.SymbolKind.Struct, "type structure", i)
      } else {
        addDeclaration(m[1], vscode.SymbolKind.TypeParameter, "TYPES", i)
      }
      continue
    }

    if ((m = /^\s*CONSTANTS\s+([\w\/]+)\s+/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Constant, "CONSTANTS", i)
      continue
    }

    if ((m = /^\s*FIELD-SYMBOLS\s+<([\w\/]+)>/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Field, "FIELD-SYMBOLS", i)
      continue
    }

    // --- 选择屏幕声明
    if ((m = /^\s*PARAMETERS\s+([\w\/]+)\b/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Variable, "PARAMETERS", i)
      continue
    }
    if ((m = /^\s*SELECT-OPTIONS\s+([\w\/]+)\b/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Variable, "SELECT-OPTIONS", i)
      continue
    }
    if ((m = /^\s*TABLES\s+([\w\/]+)\b/i.exec(rawLine))) {
      addDeclaration(m[1], vscode.SymbolKind.Variable, "TABLES", i)
      continue
    }

    // --- 内联 DATA(var) 声明（ABAP 7.4+）
    // 只在上面没有匹配到关键字时运行（未命中 `continue`）
    const inlineRe = /\bDATA\s*\(\s*([\w\/]+)\s*\)/gi
    let inlineMatch: RegExpExecArray | null
    while ((inlineMatch = inlineRe.exec(rawLine)) !== null) {
      addDeclaration(inlineMatch[1], vscode.SymbolKind.Variable, "inline data", i)
    }
  }

  // 关闭任何未关闭的作用域（例如不完整/截断的文件）
  while (scopeStack.length > 0) closeScope(lineCount - 1)

  return root
}

export class AbapDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
    if (document.uri.scheme !== ADTSCHEME) return []
    if (document.languageId !== "abap") return []

    return parseAbapDocumentSymbols(document)
  }
}
