import { caughtToString, isAbap, parts } from "./functions"
import { DocumentSymbolParams, DocumentSymbol, SymbolKind } from "vscode-languageserver"
import { clientAndObjfromUrl, rangeFromUri } from "./utilities"
import { ClassComponent, Link } from "abap-adt-api"
import { log } from "./clientManager"

const typeMap: Map<string, SymbolKind> = new Map([
  ["CLAS/I", SymbolKind.File],
  ["CLAS/OA", SymbolKind.Field],
  ["CLAS/OB", SymbolKind.Null], // 别名
  ["CLAS/OC", SymbolKind.Class],
  ["CLAS/OCL", SymbolKind.Class],
  ["CLAS/OF", SymbolKind.Null], // 友元
  ["CLAS/OLA", SymbolKind.Field],
  ["CLAS/OLD", SymbolKind.Method],
  ["CLAS/OND", SymbolKind.Method],
  ["CLAS/ON", SymbolKind.Method],
  ["CLAS/OO", SymbolKind.Method],
  ["CLAS/OLF", SymbolKind.TypeParameter],
  ["CLAS/OLN", SymbolKind.Interface],
  ["CLAS/OLT", SymbolKind.TypeParameter], // 实现、本地
  ["CLAS/OK", SymbolKind.Null],
  ["CLAS/OM", SymbolKind.Method],
  ["CLAS/OR", SymbolKind.Interface], // 实现
  ["CLAS/OT", SymbolKind.TypeParameter],
  ["INTF/OI", SymbolKind.Interface],
  ["INTF/IO", SymbolKind.Method],
  ["INTF/IA", SymbolKind.Field],
  ["INTF/IT", SymbolKind.TypeParameter]
])

function decodeType(comp: ClassComponent) {
  const adtType = comp["adtcore:type"]
  const mapped = typeMap.get(adtType)
  if (mapped === SymbolKind.Field && comp.constant) return SymbolKind.Constant
  if (mapped) return mapped

  log(
    "Unknown symbol type for",
    comp["adtcore:type"],
    comp["adtcore:name"],
    comp.links.length && comp.links[0].href
  )

  return SymbolKind.Null
}
function convertComponent(comp: ClassComponent, definition: boolean) {
  const dIdLink = comp.links.find(l => !!l.rel.match(/definitionIdentifier/i))
  const iIdLink = comp.links.find(l => !!l.rel.match(/implementationIdentifier/i))
  const dBlockLink = comp.links.find(l => !!l.rel.match(/definitionBlock/i))
  const iBlockLink = comp.links.find(l => !!l.rel.match(/implementationBlock/i))

  const idLink = definition ? dIdLink : iIdLink
  const blockLink = definition ? dBlockLink : iBlockLink
  const suffix =
    (definition && iIdLink && " definition") || (!definition && dIdLink && " implementation") || ""

  const selectionRange = idLink && rangeFromUri(idLink.href)
  if (selectionRange) {
    const range = (blockLink && rangeFromUri(blockLink.href)) || selectionRange
    const name = comp["adtcore:name"] + suffix
    const kind = decodeType(comp)
    const children = comp.components
      .map(x => convertComponent(x, definition))
      .filter(x => x) as DocumentSymbol[]
    const symbol: DocumentSymbol = {
      range,
      name,
      kind,
      selectionRange,
      children
    }
    return symbol
  }
}

function filterComp(comp: ClassComponent, part: string): ClassComponent[] {
  const components: ClassComponent[] = []
  const linkfilter = (p: string) => (l: Link) => l.href.indexOf(p) >= 0
  const hasPart = (c: ClassComponent, p: string) => !!c.links.find(linkfilter(p))
  const filterPart = (c: ClassComponent, p: string) => {
    const newc = { ...c }
    newc.links = c.links.filter(linkfilter(p))
    newc.components = c.components.reduce((acc, cur) => {
      acc.push(...filterComp(cur, p))
      return acc
    }, new Array<ClassComponent>())
    return newc
  }
  // 如果在 comp 中找到部分，返回 comp 但过滤掉所有不匹配的链接
  if (hasPart(comp, part)) components.push(filterPart(comp, part))
  else for (const c of comp.components) components.push(...filterComp(c, part))
  return components
}

/**
 * 为当前 ABAP 对象构建文档符号树，包括类和接口成员。
 */
export async function documentSymbols(params: DocumentSymbolParams) {
  const symbols: DocumentSymbol[] = []
  try {
    if (!isAbap(params.textDocument.uri)) return
    const co = await clientAndObjfromUrl(params.textDocument.uri, false)
    if (!co) return
    // 类和接口有自己的服务/格式
    if (co.obj.type.match("(CLAS)|(INTF)")) {
      const pattern = /((?:(?:\/source\/)|(?:\/includes\/)).*)/
      const [part] = parts(co.obj.url, pattern)
      const classUri = co.obj.url.replace(pattern, "")

      const component = await co.client.statelessClone.classComponents(classUri)
      const localComp = filterComp(component, part)

      for (const sym of localComp.map(c => convertComponent(c, true))) if (sym) symbols.push(sym)
      for (const sym of localComp.map(c => convertComponent(c, false))) if (sym) symbols.push(sym)
    }
  } catch (e) {
    log("Exception in document symbol:", caughtToString(e)) // 忽略
  }
  return symbols
}
