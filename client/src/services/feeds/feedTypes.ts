import { Feed } from "abap-adt-api"

/**
 * 每个系统每个 feed 的订阅配置
 */
export interface FeedSubscriptionConfig {
  enabled: boolean
  pollingInterval: number // 秒（120 - 86400）
  notifications: boolean
  query?: string // 自定义查询字符串
  useDefaultQuery: boolean
}

/**
 * 每个系统的所有 feed 订阅
 */
export interface SystemFeedConfig {
  [feedTitle: string]: FeedSubscriptionConfig
}

/**
 * 所有系统的 VS Code 设置结构
 */
export interface FeedSubscriptions {
  [systemId: string]: SystemFeedConfig
}

/**
 * Feed 状态跟踪（持久化在 globalState 中）
 */
export interface FeedState {
  systemId: string
  feedTitle: string
  feedPath: string
  lastPollTime: number // 时间戳
  lastSeenEntryId: string
  errorCount: number
  lastError?: string
  isAvailable: boolean // 如果系统升级后 feed 消失则为 false
}

/**
 * 所有 feed 状态（持久化）
 */
export interface FeedStates {
  [key: string]: FeedState // key: systemId|feedTitle
}

/**
 * 通用 feed 条目（所有 feed 类型的公共字段）
 */
export interface FeedEntry {
  id: string
  systemId: string
  feedTitle: string
  feedPath: string
  feedType: FeedType
  timestamp: Date
  title: string
  summary: string
  author?: string
  category?: string
  severity?: "error" | "warning" | "info"
  isNew: boolean
  isRead: boolean
  rawData: any // 原始 feed 条目数据
}

/**
 * Feed 类型枚举
 */
export enum FeedType {
  DUMPS = "dumps",
  ATC = "atc",
  GATEWAY_ERROR = "gateway_error",
  SYSTEM_MESSAGES = "system_messages",
  URI_ERRORS = "uri_errors",
  RAP_CONTRACT = "rap_contract",
  EEE_ERROR = "eee_error",
  UNKNOWN = "unknown"
}

/**
 * 带发现信息的 Feed 元数据
 */
export interface FeedMetadata extends Feed {
  feedType: FeedType
  defaultQuery?: string
}

/**
 * 轮询任务跟踪
 */
export interface PollingTask {
  systemId: string
  feedTitle: string
  feedPath: string
  config: FeedSubscriptionConfig
  nextPollTime: number // 时间戳
  isPolling: boolean
  timeoutHandle?: NodeJS.Timeout
}

/**
 * 用于批量通知的通知组
 */
export interface FeedNotificationGroup {
  systemId: string
  feedTitle: string
  count: number
  entries: FeedEntry[]
  severity: "error" | "warning" | "info"
}

/**
 * 供 UI 显示的 Feed 统计
 */
export interface FeedStatistics {
  totalFeeds: number
  enabledFeeds: number
  totalEntries: number
  unreadEntries: number
  erroredFeeds: number
}

/**
 * 用于 Webview 通信的消息类型
 */
export interface WebviewMessage {
  command: string
  data?: any
}

export interface LoadSystemsMessage extends WebviewMessage {
  command: "loadSystems"
}

export interface LoadFeedsMessage extends WebviewMessage {
  command: "loadFeeds"
  data: {
    systemId: string
  }
}

export interface SaveConfigMessage extends WebviewMessage {
  command: "saveConfig"
  data: {
    systemId: string
    config: SystemFeedConfig
  }
}

export interface BulkActionMessage extends WebviewMessage {
  command: "bulkAction"
  data: {
    systemId: string
    action: "enableAll" | "disableAll" | "resetDefaults"
  }
}

/**
 * Webview 状态
 */
export interface WebviewState {
  systems: string[]
  selectedSystem?: string
  feeds: FeedMetadata[]
  config: SystemFeedConfig
  loading: boolean
  error?: string
}
