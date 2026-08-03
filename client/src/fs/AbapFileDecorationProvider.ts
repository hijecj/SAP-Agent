import {
  CancellationToken,
  Disposable,
  EventEmitter,
  FileDecoration,
  FileDecorationProvider,
  ProviderResult,
  Uri,
  window,
  workspace
} from "vscode"
import { isAbapStat } from "abapfs"
import { AbapObject } from "abapobject"
import { abapUri, uriRoot } from "../adt/conections"

const NAMESPACE = /^[a-z][a-z0-9]*:/i
const TIMESTAMP_KEY = /At$/

// 已在精选标题中显示的、重复的或只是噪音的字段
const SKIP_META = new Set([
  "adtcore:type",
  "adtcore:name",
  "adtcore:description",
  "adtcore:descriptionTextLimit",
  "abapsource:sourceUri",
  "abapsource:fixPointArithmetic",
  "abapsource:activeUnicodeCheck",
  "abapsource:abapLanguageVersion"
])

const humanize = (key: string) =>
  key
    .replace(NAMESPACE, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, c => c.toUpperCase())

const formatValue = (key: string, value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    if (TIMESTAMP_KEY.test(key) && value > 0) return new Date(value).toLocaleString()
    return String(value)
  }
  if (typeof value === "string") return value
  return
}

const push = (lines: string[], label: string, value: string | undefined) => {
  if (value !== undefined && value !== "") lines.push(`${label}: ${value}`)
}

export const buildTooltip = (obj: AbapObject): string | undefined => {
  // 前导空行把我们的块与 VS Code 默认路径提示分开
  const lines: string[] = [""]
  const meta = obj.structure?.metaData as Record<string, unknown> | undefined

  // 精选引导
  push(lines, "Name", obj.name)
  const desc = meta?.["adtcore:description"]
  if (typeof desc === "string") push(lines, "Description", desc)

  // 转储元数据（对象打开后加载）— 新的按类型字段
  // （class:*、program:*、abapoo:*、fmodule:*……）会自动出现。
  if (meta) {
    for (const key of Object.keys(meta)) {
      if (SKIP_META.has(key)) continue
      const val = formatValue(key, meta[key])
      if (val !== undefined) push(lines, humanize(key), val)
    }
  }

  // > 1 因为索引 0 始终是前导空行
  return lines.length > 1 ? lines.join("\n") : undefined
}

export class AbapFileDecorationProvider implements FileDecorationProvider, Disposable {
  private readonly emitter = new EventEmitter<Uri | Uri[] | undefined>()
  readonly onDidChangeFileDecorations = this.emitter.event
  private readonly subs: Disposable[]

  constructor() {
    // 结构是惰性加载的（FsProvider.stat → node.stat → loadStructure）。
    // 文件成为活动编辑器后，结构被填充：刷新装饰，
    // 让更完整的提示出现。
    const refresh = (uri: Uri | undefined) => {
      if (uri && abapUri(uri)) this.emitter.fire(uri)
    }
    this.subs = [
      window.onDidChangeActiveTextEditor(e => refresh(e?.document.uri)),
      // 保存会在服务端更新 changedAt/changedBy；只重新触发此 URI。
      workspace.onDidSaveTextDocument(d => refresh(d.uri))
    ]
  }

  dispose() {
    for (const s of this.subs) s.dispose()
    this.emitter.dispose()
  }

  provideFileDecoration(uri: Uri, _token: CancellationToken): ProviderResult<FileDecoration> {
    if (!abapUri(uri)) return
    try {
      const root = uriRoot(uri)
      // 同步查找 — 无网络。结构是已加载的任何内容。
      const node = root.getNode(uri.path)
      if (!isAbapStat(node)) return
      const tooltip = buildTooltip(node.object)
      return tooltip ? { tooltip } : undefined
    } catch {
      return
    }
  }
}
