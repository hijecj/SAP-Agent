import { ABAPCDSLexer, ABAPCDSParser } from "abapcdsgrammar"
import {
  ANTLRInputStream,
  CommonTokenStream,
  ParserRuleContext,
  Token,
  ANTLRErrorListener,
  TokenSource
} from "antlr4ts"
import { ParseTree, ParseTreeListener, TerminalNode } from "antlr4ts/tree"
import { Position } from "vscode-languageserver"

/**
 * 当解析树节点表示 ANTLR 规则上下文时返回 true。
 */
export const isRuleContext = (tree: ParseTree): tree is ParserRuleContext => !!(tree as any).start

/**
 * 当解析树节点是终结符 token 时返回 true。
 */
export const isTerminal = (tree: ParseTree): tree is TerminalNode => !!(tree as any).symbol

/**
 * 当存在时返回终结节点的 ANTLR token 类型。
 */
export const terminalType = (t: ParseTree) => isTerminal(t) && t.symbol.type

/**
 * 把 ANTLR 行和字符位置转换为服务器使用的 LSP Position 形状。
 */
export const vscPosition = (line: number, character: number): Position => ({
  line: line - 1,
  character
})

const tokenStartPosition = (t: Token): Position => vscPosition(t.line, t.charPositionInLine)

const tokenStopPosition = (t: Token): Position =>
  vscPosition(t.line, t.stopIndex - t.startIndex + t.charPositionInLine)

/**
 * 确定给定光标位置是否落在 token 的可见范围内。
 */
export const positionInToken = (p: Position, t: Token) => {
  const start = tokenStartPosition(t)
  const stop = tokenStopPosition(t)
  return (
    p.line === stop.line &&
    p.line === start.line &&
    p.character >= start.character &&
    p.character <= stop.character
  )
}

/**
 * 找到包含请求光标位置的最近解析器规则。
 */
export function positionInContext(ctx: ParserRuleContext, position: Position) {
  const start = tokenStartPosition(ctx.start)
  const stop = tokenStopPosition(ctx.stop || ctx.start)

  if (start.line === stop.line)
    return (
      position.line === start.line &&
      position.character >= start.character &&
      position.character <= stop.character
    )
  if (start.line === position.line) return position.character >= start.character
  if (stop.line === position.line) return position.character <= stop.character
  return start.line < position.line && stop.line > position.line
}

/**
 * 遍历解析树到仍包含光标的最深节点。
 */
export function findNode(ctx: ParserRuleContext, pos: Position): ParserRuleContext | undefined {
  if (positionInContext(ctx, pos))
    if (ctx.children) {
      const child = ctx.children.filter(isRuleContext).find(c => positionInContext(c, pos))
      const leaf = child && findNode(child, pos)
      return leaf || ctx
    } else return ctx
}

interface ParserConfig {
  tokenMiddleware?: (s: TokenSource) => TokenSource
  errorListener?: ANTLRErrorListener<Token>
  parserListener?: ParseTreeListener
}
export function parseCDS(source: string, config: ParserConfig = {}) {
  const { tokenMiddleware: mid, errorListener, parserListener } = config
  const inputStream = new ANTLRInputStream(source)
  const lexer = new ABAPCDSLexer(inputStream)
  lexer.removeErrorListeners()

  const tokenStream = new CommonTokenStream(mid ? mid(lexer) : lexer)
  const parser = new ABAPCDSParser(tokenStream)
  parser.removeErrorListeners()
  if (errorListener) parser.addErrorListener(errorListener)
  if (parserListener) parser.addParseListener(parserListener)
  return parser.cdsddl()
}

const completionItemDetector = (
  notify: (ctx: ParserRuleContext, sources: string[]) => void
): ParseTreeListener => {
  const completionRules = new Set([
    ABAPCDSParser.RULE_data_source,
    ABAPCDSParser.RULE_field,
    ABAPCDSParser.RULE_case_operand
  ])
  let sources: string[] = []
  return {
    exitEveryRule: ctx => {
      if (completionRules.has(ctx.ruleIndex)) {
        if (ctx.start.type === ABAPCDSLexer.IDENTIFIER) {
          notify(ctx, sources)
          if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source && ctx.start.text)
            sources = [...sources, ctx.start.text]
        }
      }
      if (ctx.ruleIndex === ABAPCDSParser.RULE_view) sources = []
    }
  }
}

const sourceOrFieldCompletion = (
  cursor: Position,
  completeSource: (prefix: string) => void,
  completeField: (prefix: string, sources: string[]) => void
) => {
  const last = { line: cursor.line, character: cursor.character - 1 }
  return completionItemDetector((ctx, sources) => {
    if (positionInContext(ctx, last)) {
      const len = cursor.character - ctx.start.charPositionInLine
      if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source) {
        if (len && ctx.start.text && positionInToken(last, ctx.start))
          completeSource(ctx.start.text.substr(0, len))
      } else if (len > 0) completeField(ctx.text.substr(0, len), sources)
    }
  })
}

/**
 * 描述从当前光标解析出的 CDS 导航目标类型。
 */
export type MatchType = "NONE" | "FIELD" | "SOURCE"

/**
 * 从光标位置的 CDS 表达式解析出的语义目标。
 */
export type CdsNavTarget =
  | { kind: "source"; name: string } // 表/视图名（数据源）
  | { kind: "field"; source: string; field: string } // alias.field → 已解析的 source.field
  | { kind: "association"; name: string } // 关联目标
  | { kind: "dataElement"; name: string } // CAST 中的数据元素
  | { kind: "unknown"; word: string } // 回退 - 只有单词

interface AliasMap {
  [alias: string]: string
}

function buildAliasMap(tree: ParserRuleContext): AliasMap {
  const map: AliasMap = {}
  const walk = (ctx: ParserRuleContext) => {
    if (ctx.ruleIndex === ABAPCDSParser.RULE_data_source) {
      // data_source: IDENTIFIER data_source_parameters? (AS? alias)? join*
      const children = ctx.children || []
      const ids = children.filter(isTerminal).filter(t => t.symbol.type === ABAPCDSLexer.IDENTIFIER)
      if (ids.length > 0) {
        const tableName = ids[0].text
        // 查找别名子规则
        const aliasCtx = (ctx.children || [])
          .filter(isRuleContext)
          .find(c => c.ruleIndex === ABAPCDSParser.RULE_alias)
        const aliasName = aliasCtx ? aliasCtx.text : tableName
        map[aliasName.toLowerCase()] = tableName
      }
    }
    for (const child of ctx.children || []) {
      if (isRuleContext(child)) walk(child)
    }
  }
  walk(tree)
  return map
}

function getWordAtPosition(source: string, pos: Position): string {
  const lines = source.split("\n")
  const line = lines[pos.line] || ""
  const before = line.substring(0, pos.character).match(/([\w\/]+)$/)
  const after = line.substring(pos.character).match(/^([\w\/]+)/)
  return (before ? before[1] : "") + (after ? after[1] : "")
}

function findParentRule(ctx: ParserRuleContext, pos: Position): ParserRuleContext | undefined {
  if (!positionInContext(ctx, pos)) return
  for (const child of ctx.children || []) {
    if (isRuleContext(child)) {
      const found = findParentRule(child, pos)
      if (found) return found
    }
  }
  return ctx
}

export function cdsNavigationTarget(source: string, pos: Position): CdsNavTarget | undefined {
  const word = getWordAtPosition(source, pos)
  if (!word) return

  try {
    const tree = parseCDS(source)
    const aliasMap = buildAliasMap(tree)

    // 找到包含光标的最深规则
    const node = findParentRule(tree, pos)
    if (!node) return { kind: "unknown", word }

    // 从节点向上遍历以找到语义上下文
    let current: ParserRuleContext | undefined = node
    while (current) {
      switch (current.ruleIndex) {
        case ABAPCDSParser.RULE_data_source: {
          // 光标在数据源名（表/视图）上
          const children = current.children || []
          const firstId = children
            .filter(isTerminal)
            .find(t => t.symbol.type === ABAPCDSLexer.IDENTIFIER)
          if (firstId && positionInToken(pos, firstId.symbol)) {
            return { kind: "source", name: firstId.text }
          }
          break
        }
        case ABAPCDSParser.RULE_target: {
          // 关联目标
          return { kind: "association", name: word }
        }
        case ABAPCDSParser.RULE_data_element: {
          return { kind: "dataElement", name: word }
        }
        case ABAPCDSParser.RULE_path_expr: {
          // path_expr: IDENTIFIER? path_association ('.' path_association)* ('.' IDENTIFIER)?
          // 例如 a071.matnr → alias=a071、field=matnr
          const text = current.text
          const parts = text.split(".")
          if (parts.length >= 2) {
            const alias = parts[0].toLowerCase()
            const resolvedSource = aliasMap[alias] || parts[0]
            // 如果光标在别名部分，导航到源
            const firstChild = (current.children || [])[0]
            if (isTerminal(firstChild) && positionInToken(pos, firstChild.symbol)) {
              return { kind: "source", name: resolvedSource }
            }
            // 光标在字段部分
            return { kind: "field", source: resolvedSource, field: parts.slice(1).join(".") }
          }
          break
        }
        case ABAPCDSParser.RULE_alias: {
          // field_rename 或 data_source 中 AS 之后的别名 — 不是可导航对象
          return undefined
        }
        case ABAPCDSParser.RULE_field:
        case ABAPCDSParser.RULE_case_operand:
        case ABAPCDSParser.RULE_arg: {
          // 简单字段引用 - 可能是 alias.field 或只是 field
          // 检查该单词是否为别名
          if (aliasMap[word.toLowerCase()]) {
            return { kind: "source", name: aliasMap[word.toLowerCase()] }
          }
          // 它是裸字段名 - 尝试所有源
          const allSources = Object.values(aliasMap)
          if (allSources.length > 0) {
            return { kind: "field", source: allSources[0], field: word }
          }
          return { kind: "unknown", word }
        }
      }
      current = current.parent as ParserRuleContext | undefined
    }
  } catch (e) {
    // 解析错误 - 回退到基于单词的查找
  }

  return { kind: "unknown", word }
}

/**
 * 检查光标处的 CDS 源码，确定补全应针对数据源还是字段。
 */
export const cdsCompletionExtractor = (source: string, cursor: Position) => {
  const result = {
    prefix: "",
    sources: [] as string[],
    matched: "NONE" as MatchType
  }
  const parserListener = sourceOrFieldCompletion(
    cursor,
    prefix => {
      result.prefix = prefix
      result.matched = "SOURCE"
    },
    (prefix, src) => {
      result.prefix = prefix
      result.matched = "FIELD"
      result.sources = src
    }
  )
  parseCDS(source, { parserListener })
  return result
}

/**
 * 收集 CDS 视图引用的数据源，以便补全可以查询它们的字段。
 */
export function cdsDataSources(source: string): string[] {
  try {
    const tree = parseCDS(source)
    const map = buildAliasMap(tree)
    return [...new Set(Object.values(map))]
  } catch (e) {
    return []
  }
}
