import { FeedEntry, FeedType, FeedMetadata } from "./feedTypes"
import { Feed } from "abap-adt-api"
import { log } from "../../lib"

/**
 * 从 feed 元数据确定 feed 类型
 */
export function determineFeedType(feed: Feed): FeedType {
  const path = feed.href.toLowerCase()

  if (path.includes("/runtime/dumps")) {
    return FeedType.DUMPS
  } else if (path.includes("/atc/feeds/verdicts")) {
    return FeedType.ATC
  } else if (path.includes("/gw/errorlog")) {
    return FeedType.GATEWAY_ERROR
  } else if (path.includes("/runtime/systemmessages")) {
    return FeedType.SYSTEM_MESSAGES
  } else if (path.includes("/error/urimapper")) {
    return FeedType.URI_ERRORS
  } else if (path.includes("/bo/feeds/ccviolations")) {
    return FeedType.RAP_CONTRACT
  } else if (path.includes("/eee/errorlog")) {
    return FeedType.EEE_ERROR
  }

  return FeedType.UNKNOWN
}

/**
 * 获取 feed 的默认查询
 */
export function getDefaultQuery(feed: Feed): string | undefined {
  if (feed.queryVariants && feed.queryVariants.length > 0) {
    const defaultVariant = feed.queryVariants.find(qv => qv.isDefault)
    return defaultVariant?.queryString || feed.queryVariants[0]?.queryString
  }
  return undefined
}

/**
 * 把 Feed 转换为 FeedMetadata
 */
export function toFeedMetadata(feed: Feed): FeedMetadata {
  return {
    ...feed,
    feedType: determineFeedType(feed),
    defaultQuery: getDefaultQuery(feed)
  }
}

/**
 * 把原始 feed 条目解析为 FeedEntry
 */
export function parseFeedEntry(
  rawEntry: any,
  systemId: string,
  feedTitle: string,
  feedPath: string,
  feedType: FeedType
): FeedEntry {
  // 提取标题（对 Dump，使用类别术语）
  let title = rawEntry.title || "Untitled"

  // 对 Dump，始终尝试从类别获取运行时错误名
  if (
    feedType === FeedType.DUMPS &&
    rawEntry.categories &&
    Array.isArray(rawEntry.categories) &&
    rawEntry.categories.length > 0
  ) {
    // 找到标签为 "ABAP runtime error" 的类别并使用其术语
    const runtimeError = rawEntry.categories.find((c: any) => c.label === "ABAP runtime error")
    if (runtimeError?.term) {
      title = runtimeError.term
    } else {
      // 回退到第一个类别的术语
      title = rawEntry.categories[0].term || rawEntry.categories[0].label || title
    }
  }

  const entry: FeedEntry = {
    id: rawEntry.id || `${systemId}-${feedTitle}-${Date.now()}`,
    systemId,
    feedTitle,
    feedPath,
    feedType,
    timestamp: parseDate(rawEntry.updated || rawEntry.published),
    title,
    summary: extractSummary(rawEntry),
    author: rawEntry.author?.name || rawEntry.author,
    category: extractCategory(rawEntry),
    severity: determineSeverity(rawEntry, feedType),
    isNew: true,
    isRead: false,
    rawData: rawEntry
  }

  return entry
}

/**
 * 从各种格式解析日期
 */
function parseDate(dateStr: any): Date {
  if (!dateStr) return new Date()
  if (dateStr instanceof Date) return dateStr

  try {
    return new Date(dateStr)
  } catch {
    return new Date()
  }
}

/**
 * 从 feed 条目提取摘要文本
 */
function extractSummary(rawEntry: any): string {
  // 先尝试 summary 字段
  if (rawEntry.summary) {
    if (typeof rawEntry.summary === "string") {
      return rawEntry.summary
    } else if (rawEntry.summary["#text"]) {
      return rawEntry.summary["#text"]
    } else if (rawEntry.summary.text) {
      return rawEntry.summary.text
    }
  }

  // 尝试 content 字段
  if (rawEntry.content !== undefined && typeof rawEntry.content === "string") {
    const str = String(rawEntry.content)
    if (str !== undefined && typeof str === "string") {
      return str.replace(/<[^>]*>/g, "").substring(0, 200)
    }
  }

  // 对 Dump：从 text 字段提取（包含 HTML）
  if (rawEntry.text !== undefined && typeof rawEntry.text === "string") {
    const str = String(rawEntry.text)
    if (str !== undefined && typeof str === "string") {
      const plainText = str.replace(/<[^>]*>/g, "").trim()
      return plainText.substring(0, 200)
    }
  }

  return ""
}

/**
 * 从 feed 条目提取类别
 */
function extractCategory(rawEntry: any): string | undefined {
  if (rawEntry.category) {
    if (Array.isArray(rawEntry.category)) {
      return rawEntry.category[0]?.term || rawEntry.category[0]?.label
    } else if (typeof rawEntry.category === "object") {
      return rawEntry.category.term || rawEntry.category.label
    } else if (typeof rawEntry.category === "string") {
      return rawEntry.category
    }
  }
  return undefined
}

/**
 * 从条目和 feed 类型确定严重级别
 */
function determineSeverity(rawEntry: any, feedType: FeedType): "error" | "warning" | "info" {
  // 对 Dump - 始终是错误
  if (feedType === FeedType.DUMPS) {
    return "error"
  }

  // 对 ATC - 检查优先级
  if (feedType === FeedType.ATC) {
    const priority = rawEntry.priority || 3
    if (priority === 1) return "error"
    if (priority === 2) return "warning"
    return "info"
  }

  // 对 gateway/EEE 错误 - 始终是错误
  if (feedType === FeedType.GATEWAY_ERROR || feedType === FeedType.EEE_ERROR) {
    return "error"
  }

  // 对系统消息 - 检查内容中的严重级别
  if (feedType === FeedType.SYSTEM_MESSAGES) {
    const summary = extractSummary(rawEntry).toLowerCase()
    if (summary.includes("error") || summary.includes("failed")) {
      return "error"
    }
    if (summary.includes("warning") || summary.includes("warn")) {
      return "warning"
    }
  }

  // 默认为 info
  return "info"
}

/**
 * 按 feed 类型解析 feed 响应
 */
export function parseFeedResponse(
  feedData: any,
  systemId: string,
  feedTitle: string,
  feedPath: string,
  feedType: FeedType
): FeedEntry[] {
  const entries: FeedEntry[] = []

  try {
    // 处理不同的响应结构
    let rawEntries: any[] = []

    // 先检查直接数组（在检查 .entries 属性之前，因为数组上也有该属性！）
    if (Array.isArray(feedData)) {
      rawEntries = feedData
    } else if (feedData.dumps) {
      rawEntries = feedData.dumps
    } else if (feedData.entries) {
      rawEntries = feedData.entries
    } else if (feedData.entry) {
      rawEntries = Array.isArray(feedData.entry) ? feedData.entry : [feedData.entry]
    } else {
      // 未知结构
      return entries
    }

    // 确保 rawEntries 可迭代
    if (!Array.isArray(rawEntries)) {
      return entries
    }

    for (let i = 0; i < rawEntries.length; i++) {
      try {
        const rawEntry = rawEntries[i]
        const entry = parseFeedEntry(rawEntry, systemId, feedTitle, feedPath, feedType)
        entries.push(entry)
      } catch (entryError) {}
    }
  } catch (error) {}

  return entries
}

/**
 * 获取 feed 类型的图标
 */
export function getFeedTypeIcon(feedType: FeedType): string {
  switch (feedType) {
    case FeedType.DUMPS:
      return "$(error)"
    case FeedType.ATC:
      return "$(check)"
    case FeedType.GATEWAY_ERROR:
      return "$(globe)"
    case FeedType.SYSTEM_MESSAGES:
      return "$(info)"
    case FeedType.URI_ERRORS:
      return "$(link)"
    case FeedType.RAP_CONTRACT:
      return "$(shield)"
    case FeedType.EEE_ERROR:
      return "$(pulse)"
    default:
      return "$(rss)"
  }
}

/**
 * 获取严重级别图标
 */
export function getSeverityIcon(severity: "error" | "warning" | "info"): string {
  switch (severity) {
    case "error":
      return "$(error)"
    case "warning":
      return "$(warning)"
    case "info":
      return "$(info)"
  }
}

/**
 * 获取人类可读的 feed 类型名
 */
export function getFeedTypeName(feedType: FeedType): string {
  switch (feedType) {
    case FeedType.DUMPS:
      return "Runtime Errors"
    case FeedType.ATC:
      return "ATC Findings"
    case FeedType.GATEWAY_ERROR:
      return "Gateway Errors"
    case FeedType.SYSTEM_MESSAGES:
      return "System Messages"
    case FeedType.URI_ERRORS:
      return "URI Errors"
    case FeedType.RAP_CONTRACT:
      return "RAP Contract Violations"
    case FeedType.EEE_ERROR:
      return "EEE Errors"
    default:
      return "Unknown"
  }
}
