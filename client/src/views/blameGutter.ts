/**
 * 实时对象 Blame 侧边注释
 *
 * ABAP 对象的全文件 blame 注释。
 * 支持原始内联视图和 GitLens 风格的 blame 通道。
 * 使用 SAP 版本历史和客户端 diff。
 */

import * as vscode from "vscode"
import { diffArrays } from "diff"
import { Revision } from "abap-adt-api"
import { AbapRevisionService } from "../scm/abaprevisions/abaprevisionservice"
import { abapUri, getClient, ADTSCHEME } from "../adt/conections"
import { setContext } from "../context"
import { log } from "../lib"
import { logTelemetry } from "../services/telemetry"
import { funWindow as window } from "../services/funMessenger"

// ============================================================================
// 类型
// ============================================================================

export interface BlameInfo {
  author: string
  date: string
  version: string // 传输编号
  versionTitle: string // 传输描述
  lineNumber: number // 当前源码中从 0 开始的行号
}

type BlameRenderMode = "classic" | "gitlens"

interface BlameState {
  blame: BlameInfo[]
  uri: string
  latestRevisionDate: string
}

interface ComputedHeatmap {
  coldThresholdTimestamp: number
  colors: { hot: string[]; cold: string[] }
  computeRelativeAge(date: Date): number
}

// ============================================================================
// 模块状态
// ============================================================================

const BLAME_RENDER_MODE_SETTING = "blame.renderMode"
const DEFAULT_BLAME_RENDER_MODE: BlameRenderMode = "gitlens"

const GITLENS_MESSAGE_WIDTH = 58
const GITLENS_AGE_WIDTH = 8
const GITLENS_GUTTER_WIDTH = `calc(${GITLENS_MESSAGE_WIDTH + GITLENS_AGE_WIDTH + 3}ch + 13px)`
const DEFAULT_HEATMAP_AGE_THRESHOLD_DAYS = 90
const NBSP = "\u00A0"
const ZERO_WIDTH_SPACE = "\u200B"

const GITLENS_GUTTER_BACKGROUND_COLOR = "abapfs.blameGutterBackgroundColor"
const GITLENS_GUTTER_FOREGROUND_COLOR = "abapfs.blameGutterForegroundColor"
const GITLENS_LINE_HIGHLIGHT_BACKGROUND_COLOR = "abapfs.blameLineHighlightBackgroundColor"
const GITLENS_LINE_HIGHLIGHT_OVERVIEW_COLOR = "abapfs.blameLineHighlightOverviewRulerColor"
const GITLENS_TRAILING_LINE_BACKGROUND_COLOR = "abapfs.blameTrailingLineBackgroundColor"
const GITLENS_TRAILING_LINE_FOREGROUND_COLOR = "abapfs.blameTrailingLineForegroundColor"
const MAX_EDITOR_COLUMN = 2 ** 30 - 1
const REVISION_FETCH_BATCH_SIZE = 5
const REVISION_FETCH_CONCURRENCY = 3

const DEFAULT_HEATMAP_COLORS = [
  "#f66a0a",
  "#ef6939",
  "#e96950",
  "#e26862",
  "#db6871",
  "#d3677e",
  "#cc678a",
  "#c46696",
  "#bb66a0",
  "#b365a9",
  "#a965b3",
  "#a064bb",
  "#9664c4",
  "#8a63cc",
  "#7e63d3",
  "#7162db",
  "#6262e2",
  "#5061e9",
  "#3961ef",
  "#0a60f6"
]

const AUTHOR_COLORS = [
  "#4a9eff",
  "#ff6b6b",
  "#51cf66",
  "#ffd93d",
  "#c084fc",
  "#ff9f43",
  "#67e8f9",
  "#f472b6"
]

let blameActiveUris = new Set<string>()
const blameCache = new Map<string, BlameState>()

let blameStatusBarItem: vscode.StatusBarItem | undefined

let classicBlameDecorationType: vscode.TextEditorDecorationType | undefined
let classicSelectedLineDecorationType: vscode.TextEditorDecorationType | undefined
let gitlensLeaderDecorationType: vscode.TextEditorDecorationType | undefined
let gitlensCompactDecorationType: vscode.TextEditorDecorationType | undefined
let blameHighlightDecorationType: vscode.TextEditorDecorationType | undefined
let gitlensSelectedLineDecorationType: vscode.TextEditorDecorationType | undefined

// ============================================================================
// BLAME 算法
// ============================================================================

/**
 * 计算当前（最新）版本每一行的 blame 归属。
 *
 * 算法 - 从最新到最旧遍历版本历史：
 * 1. 把所有当前行标记为“待定”（未归属）。
 * 2. 对每对连续版本（较新、较旧）：
 *    - diff 较旧 -> 较新（基于 `diffArrays` 的 LCS）
 *    - 较新版本中“新增”的行（较旧没有）-> 归属到较新版本
 *    - “相同”的行 -> 把它们在较新版本中的位置映射到较旧版本的位置，
 *      并继续作为待定行携带
 * 3. 遍历完所有版本后仍待定的行 -> 归属到最旧版本。
 */
function computeBlame(revisions: Revision[], sources: string[]): BlameInfo[] {
  const currentLines = sources[0].split("\n")
  const blame: (BlameInfo | null)[] = new Array(currentLines.length).fill(null)

  // 映射：currentLineIndex -> 正在处理的“较新”版本中的行索引
  let pendingLines = new Map<number, number>()
  for (let i = 0; i < currentLines.length; i++) {
    pendingLines.set(i, i)
  }

  for (let v = 0; v < revisions.length - 1 && pendingLines.size > 0; v++) {
    const newerLines = sources[v].split("\n")
    const olderLines = sources[v + 1].split("\n")

    // diff(old, new) - added = 只在 new 中，removed = 只在 old 中
    const changes = diffArrays(olderLines, newerLines)

    // 从该 diff 构建映射
    const addedInNewer = new Set<number>()
    const newerToOlder = new Map<number, number>()

    let newerIdx = 0
    let olderIdx = 0
    for (const change of changes) {
      const count = change.count ?? change.value.length
      if (!change.added && !change.removed) {
        // 相同块 - 行在两个版本中都存在
        for (let i = 0; i < count; i++) {
          newerToOlder.set(newerIdx + i, olderIdx + i)
        }
        newerIdx += count
        olderIdx += count
      } else if (change.added) {
        // 只在新版本中的行
        for (let i = 0; i < count; i++) {
          addedInNewer.add(newerIdx + i)
        }
        newerIdx += count
      } else {
        // 只在旧版本中的行（已移除）
        olderIdx += count
      }
    }

    // 处理待定行
    const newPending = new Map<number, number>()
    for (const [currentLine, versionLine] of pendingLines) {
      if (addedInNewer.has(versionLine)) {
        // 该行在此版本中引入
        blame[currentLine] = makeBlameInfo(revisions[v], currentLine)
      } else if (newerToOlder.has(versionLine)) {
        // 该行在旧版本中也存在 - 继续携带
        newPending.set(currentLine, newerToOlder.get(versionLine)!)
      } else {
        // 回退：映射有歧义时归属到较新版本
        blame[currentLine] = makeBlameInfo(revisions[v], currentLine)
      }
    }

    pendingLines = newPending
  }

  // 剩余未归属的行 -> 归属到最旧版本
  if (pendingLines.size > 0) {
    const oldest = revisions[revisions.length - 1]
    for (const [currentLine] of pendingLines) {
      blame[currentLine] = makeBlameInfo(oldest, currentLine)
    }
  }

  // 安全：填充任何 null（不应发生）
  for (let i = 0; i < blame.length; i++) {
    if (!blame[i]) {
      blame[i] = {
        author: "Unknown",
        date: "",
        version: "",
        versionTitle: "",
        lineNumber: i
      }
    }
  }

  return blame as BlameInfo[]
}

function makeBlameInfo(rev: Revision, lineNumber: number): BlameInfo {
  return {
    author: rev.author || "Unknown",
    date: rev.date || "",
    version: rev.version || "",
    versionTitle: rev.versionTitle || "",
    lineNumber
  }
}

// ============================================================================
// 装饰渲染
// ============================================================================

function getBlameRenderMode(): BlameRenderMode {
  const mode = vscode.workspace
    .getConfiguration("abapfs")
    .get<string>(BLAME_RENDER_MODE_SETTING, DEFAULT_BLAME_RENDER_MODE)

  return mode === "classic" ? "classic" : "gitlens"
}

function toCssInjection(styles: Record<string, string | number | undefined | null>): string {
  const textDecoration = styles["text-decoration"] ?? "none"
  return `text-decoration:${textDecoration};${Object.entries(styles)
    .filter(([key, value]) => key !== "text-decoration" && value != null && value !== "")
    .map(([key, value]) => `${key}:${value}`)
    .join(";")};`
}

function ensureClassicDecorationType(): vscode.TextEditorDecorationType {
  if (!classicBlameDecorationType) {
    classicBlameDecorationType = window.createTextEditorDecorationType({
      isWholeLine: true,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    })
  }
  return classicBlameDecorationType
}

function ensureClassicSelectedLineDecorationType(): vscode.TextEditorDecorationType {
  if (!classicSelectedLineDecorationType) {
    classicSelectedLineDecorationType = window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor("editorCodeLens.foreground"),
        fontStyle: "italic",
        textDecoration: toCssInjection({
          "white-space": "pre",
          "font-variant-numeric": "tabular-nums"
        })
      }
    })
  }
  return classicSelectedLineDecorationType
}

function getGitLensBaseOptions(
  separator: boolean
): vscode.ThemableDecorationAttachmentRenderOptions {
  return {
    backgroundColor: new vscode.ThemeColor(GITLENS_GUTTER_BACKGROUND_COLOR),
    color: new vscode.ThemeColor(GITLENS_GUTTER_FOREGROUND_COLOR),
    fontWeight: "normal",
    fontStyle: "normal",
    height: "100%",
    margin: "0 26px -1px 0",
    width: GITLENS_GUTTER_WIDTH,
    textDecoration: toCssInjection({
      "text-decoration": separator ? "overline solid rgba(0, 0, 0, .2)" : undefined,
      "box-sizing": "border-box",
      padding: "0 0 0 18px",
      "border-style": "solid",
      "border-width": "0 2px 0 0",
      "white-space": "pre",
      "font-variant-numeric": "tabular-nums"
    })
  }
}

function ensureGitLensLeaderDecorationType(): vscode.TextEditorDecorationType {
  if (!gitlensLeaderDecorationType) {
    gitlensLeaderDecorationType = window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
      before: getGitLensBaseOptions(false)
    })
  }
  return gitlensLeaderDecorationType
}

function ensureGitLensCompactDecorationType(): vscode.TextEditorDecorationType {
  if (!gitlensCompactDecorationType) {
    gitlensCompactDecorationType = window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
      before: getGitLensBaseOptions(false)
    })
  }
  return gitlensCompactDecorationType
}

function ensureBlameHighlightDecorationType(): vscode.TextEditorDecorationType {
  if (!blameHighlightDecorationType) {
    blameHighlightDecorationType = window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      backgroundColor: new vscode.ThemeColor(GITLENS_LINE_HIGHLIGHT_BACKGROUND_COLOR),
      overviewRulerColor: new vscode.ThemeColor(GITLENS_LINE_HIGHLIGHT_OVERVIEW_COLOR)
    })
  }
  return blameHighlightDecorationType
}

function ensureGitLensSelectedLineDecorationType(): vscode.TextEditorDecorationType {
  if (!gitlensSelectedLineDecorationType) {
    gitlensSelectedLineDecorationType = window.createTextEditorDecorationType({
      after: {
        backgroundColor: new vscode.ThemeColor(GITLENS_TRAILING_LINE_BACKGROUND_COLOR),
        color: new vscode.ThemeColor(GITLENS_TRAILING_LINE_FOREGROUND_COLOR),
        textDecoration: toCssInjection({
          "white-space": "pre",
          "font-variant-numeric": "tabular-nums"
        })
      }
    })
  }
  return gitlensSelectedLineDecorationType
}

function accentColorForAuthor(author: string): string {
  let hash = 0
  for (const c of author) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0
  return AUTHOR_COLORS[Math.abs(hash) % AUTHOR_COLORS.length]
}

function translucentColor(color: string, alphaHex: string): string {
  return `${color}${alphaHex}`
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "")
  const parsed = Number.parseInt(normalized, 16)
  const r = (parsed >> 16) & 255
  const g = (parsed >> 8) & 255
  const b = parsed & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function getHeatmapColors(): { hot: string[]; cold: string[] } {
  return {
    hot: DEFAULT_HEATMAP_COLORS.slice(0, 10),
    cold: DEFAULT_HEATMAP_COLORS.slice(10, 20)
  }
}

function getRelativeAgeLookupTable(dates: Date[]): number[] {
  if (dates.length === 0) return []

  // 镜像 GitLens 的查找表方法，让热力图步长围绕中位年龄聚集。
  const lookup: number[] = []
  const half = Math.floor(dates.length / 2)
  const median =
    dates.length % 2
      ? dates[half].getTime()
      : (dates[half - 1].getTime() + dates[half].getTime()) / 2

  const newest = dates[dates.length - 1].getTime()
  let step = (newest - median) / 5
  for (let i = 5; i > 0; i--) {
    lookup.push(median + step * i)
  }

  lookup.push(median)

  const oldest = dates[0].getTime()
  step = (median - oldest) / 4
  for (let i = 1; i <= 4; i++) {
    lookup.push(median - step * i)
  }

  return lookup
}

function getComputedHeatmap(blame: BlameInfo[]): ComputedHeatmap | undefined {
  const dates = blame
    .map(line => new Date(line.date))
    .filter(date => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())

  if (dates.length === 0) return undefined

  const coldThresholdDate = new Date()
  coldThresholdDate.setDate(coldThresholdDate.getDate() - DEFAULT_HEATMAP_AGE_THRESHOLD_DAYS)
  const coldThresholdTimestamp = coldThresholdDate.getTime()

  const hotDates: Date[] = []
  const coldDates: Date[] = []

  for (const date of dates) {
    if (date.getTime() < coldThresholdTimestamp) {
      coldDates.push(date)
    } else {
      hotDates.push(date)
    }
  }

  const unifiedLookup = getRelativeAgeLookupTable(dates)
  const hotLookup = hotDates.length > 0 ? getRelativeAgeLookupTable(hotDates) : unifiedLookup
  const coldLookup = coldDates.length > 0 ? getRelativeAgeLookupTable(coldDates) : unifiedLookup

  const computeRelativeAge = (date: Date, lookup: number[]) => {
    if (lookup.length === 0) return 0

    const time = date.getTime()
    let index = 0
    for (let i = 0; i < lookup.length; i++) {
      index = i
      if (time >= lookup[i]) break
    }
    return index
  }

  return {
    coldThresholdTimestamp,
    colors: getHeatmapColors(),
    computeRelativeAge: (date: Date) =>
      computeRelativeAge(date, date.getTime() < coldThresholdTimestamp ? coldLookup : hotLookup)
  }
}

function applyHeatmap(
  before: vscode.ThemableDecorationAttachmentRenderOptions,
  dateStr: string,
  heatmap?: ComputedHeatmap
) {
  if (!heatmap) return

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return

  const age = heatmap.computeRelativeAge(date)
  const colors =
    date.getTime() < heatmap.coldThresholdTimestamp ? heatmap.colors.cold : heatmap.colors.hot
  const color = colors[Math.min(age, colors.length - 1)]
  const alpha = age === 0 ? 1 : age <= 5 ? 0.8 : 0.6

  before.borderColor = hexToRgba(color, alpha)
}

function formatShortDate(dateStr: string): string {
  if (!dateStr) return ""
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return dateStr
  }
}

function formatFullDate(dateStr: string): string {
  if (!dateStr) return "Unknown"
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  } catch {
    return dateStr
  }
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return "unknown"

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "unknown"

  const deltaMs = Date.now() - date.getTime()
  const isFuture = deltaMs < 0
  const absMs = Math.abs(deltaMs)
  const units = [
    { label: "year", ms: 365 * 24 * 60 * 60 * 1000 },
    { label: "month", ms: 30 * 24 * 60 * 60 * 1000 },
    { label: "week", ms: 7 * 24 * 60 * 60 * 1000 },
    { label: "day", ms: 24 * 60 * 60 * 1000 },
    { label: "hour", ms: 60 * 60 * 1000 },
    { label: "minute", ms: 60 * 1000 }
  ]

  if (absMs < 60 * 1000) return "just now"

  for (const unit of units) {
    if (absMs >= unit.ms || unit.label === "minute") {
      const value = Math.max(1, Math.round(absMs / unit.ms))
      const suffix = value === 1 ? "" : "s"
      return isFuture ? `in ${value} ${unit.label}${suffix}` : `${value} ${unit.label}${suffix} ago`
    }
  }

  return "unknown"
}

function formatCompactRelativeDate(dateStr: string): string {
  if (!dateStr) return "?"

  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "?"

  const deltaMs = Math.abs(Date.now() - date.getTime())
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day

  if (deltaMs < hour) return `${Math.max(1, Math.round(deltaMs / minute))}m ago`
  if (deltaMs < day) return `${Math.max(1, Math.round(deltaMs / hour))}h ago`
  if (deltaMs < week) return `${Math.max(1, Math.round(deltaMs / day))}d ago`
  if (deltaMs < month) return `${Math.max(1, Math.round(deltaMs / week))}w ago`
  if (deltaMs < year) return `${Math.max(1, Math.round(deltaMs / month))}mo ago`
  return `${Math.max(1, Math.round(deltaMs / year))}y ago`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 3) return value.slice(0, maxLength)
  return `${value.slice(0, maxLength - 3).trimEnd()}...`
}

function buildHoverMessage(info: BlameInfo): vscode.MarkdownString {
  const relativeAge = formatRelativeDate(info.date)
  const transportText = info.version || "Unknown"
  const detailText = info.versionTitle ? ` - *\"${info.versionTitle}\"*` : ""

  const hover = new vscode.MarkdownString(
    `**${info.author}** - ${formatFullDate(info.date)}` +
      `\n\nAge: ${relativeAge}` +
      `\n\nTransport: \`${transportText}\`${detailText}`
  )
  hover.isTrusted = true
  return hover
}

function buildGitLensSummary(info: BlameInfo): string {
  const summary =
    normalizeWhitespace(
      info.version
        ? `${info.version}${info.versionTitle ? `, ${info.versionTitle}` : ""}`
        : info.versionTitle || info.author
    ) || "Unknown change"

  return truncateText(summary, GITLENS_MESSAGE_WIDTH)
}

function getBlameGroupKey(info: BlameInfo): string {
  return `${info.author}:${info.version}`
}

function getWholeLineRange(editor: vscode.TextEditor, line: number): vscode.Range {
  const range = new vscode.Range(line, 0, line, MAX_EDITOR_COLUMN)
  if (typeof editor.document.validateRange === "function") {
    return editor.document.validateRange(range)
  }

  return new vscode.Range(line, 0, line, editor.document.lineAt(line).text.length)
}

function clearBlameHighlights(editor?: vscode.TextEditor) {
  if (!editor || !blameHighlightDecorationType) return
  editor.setDecorations(blameHighlightDecorationType, [])
}

function clearSelectedLineAnnotation(editor?: vscode.TextEditor) {
  if (!editor) return
  if (classicSelectedLineDecorationType)
    editor.setDecorations(classicSelectedLineDecorationType, [])
  if (gitlensSelectedLineDecorationType)
    editor.setDecorations(gitlensSelectedLineDecorationType, [])
}

function updateBlameHighlights(editor: vscode.TextEditor, blame: BlameInfo[], line?: number) {
  const decorationType = ensureBlameHighlightDecorationType()
  if (line == null || line < 0 || line >= blame.length) {
    editor.setDecorations(decorationType, [])
    return
  }

  const selected = blame[line]
  if (!selected) {
    editor.setDecorations(decorationType, [])
    return
  }

  const selectedKey = getBlameGroupKey(selected)
  const ranges: vscode.Range[] = []
  const lineCount = Math.min(blame.length, editor.document.lineCount)

  for (let index = 0; index < lineCount; index++) {
    if (getBlameGroupKey(blame[index]) !== selectedKey) continue
    ranges.push(getWholeLineRange(editor, index))
  }

  editor.setDecorations(decorationType, ranges)
}

function buildGitLensLaneText(info: BlameInfo): string {
  const summary = buildGitLensSummary(info).padEnd(GITLENS_MESSAGE_WIDTH, " ")
  const age = truncateText(formatCompactRelativeDate(info.date), GITLENS_AGE_WIDTH).padStart(
    GITLENS_AGE_WIDTH,
    " "
  )

  return ` ${summary} ${age} `
}

function buildSelectedLineText(info: BlameInfo): string {
  const change = info.version
    ? `${info.version}${info.versionTitle ? ` - ${info.versionTitle}` : ""}`
    : info.versionTitle || "Unknown change"
  return `${info.author}, ${formatRelativeDate(info.date)} • ${change}`
}

function getAvatarInitials(author: string): string {
  const parts = author
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)

  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function buildAvatarRenderOptions(
  author: string
): vscode.ThemableDecorationAttachmentRenderOptions {
  const initials = getAvatarInitials(author)
  const accent = accentColorForAuthor(author)
  const svg = encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'>` +
      `<circle cx='8' cy='8' r='8' fill='${accent}'/>` +
      `<text x='8' y='8' fill='#ffffff' font-family='Segoe UI, sans-serif' font-size='7' font-weight='700' text-anchor='middle' dominant-baseline='central'>${initials}</text>` +
      `</svg>`
  )

  return {
    contentText: "",
    height: "16px",
    width: "16px",
    textDecoration: toCssInjection({
      position: "absolute",
      top: "1px",
      left: "5px",
      background: `url("data:image/svg+xml;utf8,${svg}")`,
      "background-repeat": "no-repeat",
      "background-size": "16px 16px",
      "border-radius": "50%",
      "margin-left": "0 !important"
    })
  }
}

function updateSelectedLineAnnotation(
  editor: vscode.TextEditor,
  blame: BlameInfo[],
  line?: number
) {
  if (line == null || line < 0 || line >= blame.length) {
    clearSelectedLineAnnotation(editor)
    return
  }

  if (getBlameRenderMode() === "classic") {
    const decorationType = ensureClassicSelectedLineDecorationType()
    const lineText = editor.document.lineAt(line).text
    editor.setDecorations(decorationType, [
      {
        range: new vscode.Range(line, lineText.length, line, lineText.length),
        renderOptions: {
          after: {
            contentText: `  ${buildSelectedLineText(blame[line])}  `
          }
        }
      }
    ])
    if (gitlensSelectedLineDecorationType) {
      editor.setDecorations(gitlensSelectedLineDecorationType, [])
    }
    return
  }

  const decorationType = ensureGitLensSelectedLineDecorationType()
  const lineText = editor.document.lineAt(line).text
  editor.setDecorations(decorationType, [
    {
      range: new vscode.Range(line, lineText.length, line, lineText.length),
      renderOptions: {
        after: {
          contentText: buildSelectedLineText(blame[line])
        }
      }
    }
  ])
}

function renderClassicBlameDecorations(editor: vscode.TextEditor, blame: BlameInfo[]) {
  ensureClassicSelectedLineDecorationType()
  const decType = ensureClassicDecorationType()
  const decorations: vscode.DecorationOptions[] = []

  // 找到最长行，让所有注释从同一列开始。
  let maxLineLen = 0
  const lineCount = Math.min(blame.length, editor.document.lineCount)
  for (let i = 0; i < lineCount; i++) {
    const len = editor.document.lineAt(i).text.length
    if (len > maxLineLen) maxLineLen = len
  }
  const targetCol = maxLineLen + 10

  for (let i = 0; i < lineCount; i++) {
    const info = blame[i]

    // 连续行分组：只在块的第一行显示完整注释。
    const isFirstInGroup =
      i === 0 || blame[i - 1].author !== info.author || blame[i - 1].version !== info.version

    const annotationText = isFirstInGroup
      ? `${info.author} - ${formatShortDate(info.date)} - ${info.version}${info.versionTitle ? ` - ${info.versionTitle}` : ""}`
      : "|"

    // 用 `ch` 单位设置边距，让注释跟随编辑器字体宽度。
    const lineLen = editor.document.lineAt(i).text.length
    const gapCh = Math.max(4, targetCol - lineLen)

    decorations.push({
      range: new vscode.Range(i, 0, i, 0),
      renderOptions: {
        before: {
          contentText: ZERO_WIDTH_SPACE,
          backgroundColor: translucentColor(accentColorForAuthor(info.author), "40"),
          width: "3px",
          height: "100%",
          margin: "0 6px 0 0"
        },
        after: {
          contentText: annotationText,
          color: new vscode.ThemeColor("editorCodeLens.foreground"),
          fontStyle: "italic",
          margin: `0 0 0 ${gapCh}ch`
        }
      },
      hoverMessage: buildHoverMessage(info)
    })
  }

  editor.setDecorations(decType, decorations)
}

function renderGitLensBlameDecorations(editor: vscode.TextEditor, blame: BlameInfo[]) {
  const leaderType = ensureGitLensLeaderDecorationType()
  const compactType = ensureGitLensCompactDecorationType()
  const leaderDecorations: vscode.DecorationOptions[] = []
  const compactDecorations: vscode.DecorationOptions[] = []
  const heatmap = getComputedHeatmap(blame)
  const lineCount = Math.min(blame.length, editor.document.lineCount)

  let previousKey: string | undefined
  for (let i = 0; i < lineCount; i++) {
    const info = blame[i]
    const key = `${info.author}:${info.version}`
    const range = new vscode.Range(i, 0, i, 0)
    const hoverMessage = buildHoverMessage(info)

    // 紧凑的后续行复用 blame 通道样式，但省略摘要文本。
    if (previousKey === key) {
      const before: vscode.ThemableDecorationAttachmentRenderOptions = { contentText: NBSP }
      applyHeatmap(before, info.date, heatmap)

      compactDecorations.push({
        range,
        renderOptions: { before },
        hoverMessage
      })
      continue
    }

    previousKey = key

    // 引导行携带摘要文本、年龄和小头像标记。
    const before: vscode.ThemableDecorationAttachmentRenderOptions = {
      contentText: buildGitLensLaneText(info)
    }
    if (i > 0) {
      before.textDecoration = "overline solid rgba(0, 0, 0, .2)"
    }
    applyHeatmap(before, info.date, heatmap)

    leaderDecorations.push({
      range,
      renderOptions: {
        before,
        after: buildAvatarRenderOptions(info.author)
      },
      hoverMessage
    })
  }

  editor.setDecorations(leaderType, leaderDecorations)
  editor.setDecorations(compactType, compactDecorations)
}

function renderBlameDecorations(editor: vscode.TextEditor, blame: BlameInfo[]) {
  clearBlameDecorations(editor)

  // 按配置切换渲染策略，同时保持相同的 blame 数据/缓存。
  if (getBlameRenderMode() === "gitlens") {
    renderGitLensBlameDecorations(editor, blame)
    return
  }

  renderClassicBlameDecorations(editor, blame)
}

function clearBlameDecorations(editor?: vscode.TextEditor) {
  if (!editor) return
  if (classicBlameDecorationType) editor.setDecorations(classicBlameDecorationType, [])
  if (gitlensLeaderDecorationType) editor.setDecorations(gitlensLeaderDecorationType, [])
  if (gitlensCompactDecorationType) editor.setDecorations(gitlensCompactDecorationType, [])
  clearSelectedLineAnnotation(editor)
}

function disposeBlameDecorationTypes() {
  classicBlameDecorationType?.dispose()
  classicSelectedLineDecorationType?.dispose()
  gitlensLeaderDecorationType?.dispose()
  gitlensCompactDecorationType?.dispose()
  blameHighlightDecorationType?.dispose()
  gitlensSelectedLineDecorationType?.dispose()
  classicBlameDecorationType = undefined
  classicSelectedLineDecorationType = undefined
  gitlensLeaderDecorationType = undefined
  gitlensCompactDecorationType = undefined
  blameHighlightDecorationType = undefined
  gitlensSelectedLineDecorationType = undefined
}

function rerenderVisibleBlameEditors() {
  for (const editor of window.visibleTextEditors) {
    if (editor.document.uri.scheme !== ADTSCHEME || editor.document.languageId !== "abap") continue

    const cacheKey = editor.document.uri.toString()
    if (!blameActiveUris.has(cacheKey)) continue

    const cached = blameCache.get(cacheKey)
    if (cached) {
      renderBlameDecorations(editor, cached.blame)
      updateSelectedLineAnnotation(editor, cached.blame, editor.selection.active.line)
    }
  }
}

async function fetchRevisionSources(
  client: ReturnType<typeof getClient>,
  revisions: Revision[],
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<string[] | undefined> {
  const totalBatches = Math.ceil(revisions.length / REVISION_FETCH_BATCH_SIZE)
  const batchResults: string[][] = new Array(totalBatches)
  const workerCount = Math.min(REVISION_FETCH_CONCURRENCY, totalBatches)

  let nextBatchIndex = 0
  let completedVersions = 0

  const runWorker = async () => {
    while (!token.isCancellationRequested) {
      const batchIndex = nextBatchIndex++
      // nextBatchIndex 从 0 开始且后递增，所以相等意味着没有剩余批次。
      if (batchIndex >= totalBatches) return

      const start = batchIndex * REVISION_FETCH_BATCH_SIZE
      const batch = revisions.slice(start, start + REVISION_FETCH_BATCH_SIZE)
      const batchSources = await Promise.all(
        batch.map(revision => client.getObjectSource(revision.uri))
      )

      if (token.isCancellationRequested) return

      batchResults[batchIndex] = batchSources
      completedVersions += batch.length

      progress.report({
        increment: (batch.length / revisions.length) * 100,
        message: `Fetched ${completedVersions} of ${revisions.length} versions...`
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()))

  if (token.isCancellationRequested) return undefined

  return batchResults.flat()
}

// ============================================================================
// 公共 API
// ============================================================================

/**
 * 打开 blame -> 显示注释。
 * 从 “Show Blame” 编辑器/标题按钮调用。
 */
export async function showBlame() {
  logTelemetry("command_show_blame_called")
  const editor = window.activeTextEditor
  if (!editor || editor.document.uri.scheme !== ADTSCHEME) return
  if (!abapUri(editor.document.uri)) return

  if (editor.document.isDirty) {
    window.showWarningMessage("Cannot show blame while the document has unsaved changes.")
    return
  }

  const uri = editor.document.uri
  const cacheKey = uri.toString()

  await window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Computing blame...",
      cancellable: true
    },
    async (progress, token) => {
      try {
        const connId = uri.authority

        // 先检查缓存，让重新打开 blame 立即生效。
        const cached = blameCache.get(cacheKey)
        if (cached) {
          blameActiveUris.add(cacheKey)
          updateBlameContext(editor)
          renderBlameDecorations(editor, cached.blame)
          updateSelectedLineAnnotation(editor, cached.blame, editor.selection.active.line)
          return
        }

        // 获取对象的版本历史。
        progress.report({ message: "Fetching version history..." })
        const service = AbapRevisionService.get(connId)
        const revisions = await service.uriRevisions(uri, true)

        if (token.isCancellationRequested) return

        if (!revisions || revisions.length === 0) {
          window.showInformationMessage(
            "No version history available for this object. Objects in $TMP that were never transported have no versions."
          )
          return
        }

        // 单版本：把每一行都归属到该版本。
        if (revisions.length === 1) {
          const lines = editor.document.getText().split("\n")
          const blame: BlameInfo[] = lines.map((_, i) => makeBlameInfo(revisions[0], i))

          blameCache.set(cacheKey, {
            blame,
            uri: cacheKey,
            latestRevisionDate: revisions[0].date
          })

          blameActiveUris.add(cacheKey)
          updateBlameContext(editor)
          renderBlameDecorations(editor, blame)
          updateBlameHighlights(editor, blame, editor.selection.active.line)
          updateSelectedLineAnnotation(editor, blame, editor.selection.active.line)
          return
        }

        // 以小并行批次获取每个版本的源码。
        const client = getClient(connId)
        const sources = await fetchRevisionSources(client, revisions, progress, token)

        if (token.isCancellationRequested || sources == null) return

        // 计算最终行归属并缓存，供未来切换使用。
        progress.report({ message: "Computing line attributions..." })
        const blame = computeBlame(revisions, sources)

        blameCache.set(cacheKey, {
          blame,
          uri: cacheKey,
          latestRevisionDate: revisions[0].date
        })

        // blame 加载期间活动编辑器可能已变化。
        if (window.activeTextEditor !== editor) return

        blameActiveUris.add(cacheKey)
        updateBlameContext(editor)
        renderBlameDecorations(editor, blame)
        updateBlameHighlights(editor, blame, editor.selection.active.line)
        updateSelectedLineAnnotation(editor, blame, editor.selection.active.line)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`Blame computation failed: ${msg}`)
        window.showErrorMessage(`Failed to compute blame: ${msg}`)
      }
    }
  )
}

/**
 * 关闭 blame -> 隐藏注释。
 * 从 “Hide Blame” 编辑器/标题按钮调用。
 */
export async function hideBlame() {
  logTelemetry("command_hide_blame_called")
  const editor = window.activeTextEditor
  if (editor) {
    const cacheKey = editor.document.uri.toString()
    blameActiveUris.delete(cacheKey)
    clearBlameDecorations(editor)
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
  }
  updateBlameContext(editor)
}

/**
 * 活动文本编辑器变化时调用。
 * 如果新编辑器有 blame 数据则重新渲染缓存，否则清除。
 */
export function onBlameActiveEditorChanged(editor?: vscode.TextEditor) {
  if (!editor || editor.document.uri.scheme !== ADTSCHEME) {
    updateBlameContext(editor)
    return
  }

  const cacheKey = editor.document.uri.toString()
  if (blameActiveUris.has(cacheKey)) {
    const cached = blameCache.get(cacheKey)
    if (cached) {
      renderBlameDecorations(editor, cached.blame)
      updateBlameHighlights(editor, cached.blame, editor.selection.active.line)
      updateSelectedLineAnnotation(editor, cached.blame, editor.selection.active.line)
    }
  } else {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
  }

  updateBlameContext(editor)
}

/**
 * 在可能启用了 blame 的编辑器中选择变化时调用。
 * 高亮与选中行属于同一 blame 分组的每一行。
 */
export function onBlameTextEditorSelectionChanged(event: vscode.TextEditorSelectionChangeEvent) {
  const editor = event.textEditor
  if (editor.document.uri.scheme !== ADTSCHEME || editor.document.languageId !== "abap") {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
    return
  }

  const cacheKey = editor.document.uri.toString()
  if (!blameActiveUris.has(cacheKey)) {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
    return
  }

  const cached = blameCache.get(cacheKey)
  if (!cached) {
    clearBlameHighlights(editor)
    clearSelectedLineAnnotation(editor)
    return
  }

  updateBlameHighlights(editor, cached.blame, event.selections[0]?.active.line)
  updateSelectedLineAnnotation(editor, cached.blame, event.selections[0]?.active.line)
}

/**
 * blame 渲染模式配置变化时调用。
 * 重新渲染已启用 blame 的可见编辑器。
 */
export function onBlameConfigurationChanged(event: vscode.ConfigurationChangeEvent) {
  if (!event.affectsConfiguration(`abapfs.${BLAME_RENDER_MODE_SETTING}`)) return
  disposeBlameDecorationTypes()
  rerenderVisibleBlameEditors()
}

/**
 * 文档内容变化时调用。
 * 如果 blame 已激活且文档变脏，自动隐藏 blame。
 */
export function onBlameDocumentChanged(event: vscode.TextDocumentChangeEvent) {
  if (event.document.uri.scheme !== ADTSCHEME) return

  const cacheKey = event.document.uri.toString()

  // 如果此文件的 blame 已激活且有实际内容变化，自动隐藏它。
  if (blameActiveUris.has(cacheKey) && event.contentChanges.length > 0) {
    blameActiveUris.delete(cacheKey)
    const editor = window.activeTextEditor
    if (editor && editor.document === event.document) {
      clearBlameDecorations(editor)
      clearBlameHighlights(editor)
      updateBlameContext(editor)
    }
  }

  // 始终更新 “Show Blame” 按钮的可用性。
  updateBlameAvailableForDocument(event.document)
}

/**
 * 文档保存/激活后调用。
 * 使该对象的 blame 缓存失效，让下一次 blame 是新鲜的。
 */
export function onBlameDocumentSaved(document: vscode.TextDocument) {
  if (document.uri.scheme !== ADTSCHEME) return

  // 使缓存失效 - 版本历史可能已变化。
  blameCache.delete(document.uri.toString())
  const editor = window.activeTextEditor
  if (editor && editor.document === document) {
    updateBlameContext(editor)
  }
}

/**
 * 更新当前编辑器的两个上下文键。
 * blameActive = 此文件当前是否显示 blame？
 * blameAvailable = 此文件能否显示 blame？
 */
function updateBlameContext(editor?: vscode.TextEditor) {
  const isAbap =
    !!editor && editor.document.uri.scheme === ADTSCHEME && editor.document.languageId === "abap"

  const cacheKey = editor?.document.uri.toString() ?? ""
  const isBlameOn = isAbap && blameActiveUris.has(cacheKey)
  const canShowBlame = isAbap && !editor?.document.isDirty && !isBlameOn

  setContext("abapfs:blameActive", isBlameOn)
  setContext("abapfs:blameAvailable", canShowBlame)

  // 更新状态栏项
  if (!blameStatusBarItem) return
  if (!isAbap) {
    blameStatusBarItem.hide()
  } else if (isBlameOn) {
    blameStatusBarItem.text = "$(eye-closed) Blame"
    blameStatusBarItem.tooltip = "Hide Blame"
    blameStatusBarItem.command = "abapfs.hideBlame"
    blameStatusBarItem.show()
  } else {
    blameStatusBarItem.text = "$(eye) Blame"
    blameStatusBarItem.tooltip = editor?.document.isDirty
      ? "Save the document first to enable blame"
      : "Show Blame"
    blameStatusBarItem.command = editor?.document.isDirty ? undefined : "abapfs.showBlame"
    blameStatusBarItem.show()
  }
}

function updateBlameAvailableForDocument(document: vscode.TextDocument) {
  const editor = window.activeTextEditor
  if (editor && editor.document === document) {
    updateBlameContext(editor)
  }
}

// ============================================================================
// 初始化与销毁
// ============================================================================

/**
 * 初始化 blame 侧边注释功能。
 * 从 extension.ts 的 activate() 调用。
 */
export function initializeBlameGutter(context: vscode.ExtensionContext) {
  // 注册命令。
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.showBlame", showBlame),
    vscode.commands.registerCommand("abapfs.hideBlame", hideBlame)
  )

  // 状态栏项：右下角，高优先级 = 右侧组最左。
  blameStatusBarItem = window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000)
  blameStatusBarItem.name = "ABAP FS Blame"
  context.subscriptions.push(blameStatusBarItem)

  // 文档保存时使 blame 缓存失效，模式变化时重新渲染。
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onBlameDocumentSaved))
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onBlameConfigurationChanged))
  context.subscriptions.push(
    window.onDidChangeTextEditorSelection(onBlameTextEditorSelectionChanged)
  )

  // 停用时清理装饰类型和缓存状态。
  context.subscriptions.push({
    dispose: () => {
      disposeBlameDecorationTypes()
      blameCache.clear()
      blameActiveUris.clear()
      blameStatusBarItem = undefined
    }
  })

  // 初始化工具栏/菜单可见性规则使用的上下文键。
  updateBlameContext(window.activeTextEditor)
}
