/**
 * 💓 心跳类型
 *
 * 用于后台监控的周期性 LLM 代理轮次。
 * LLM 读取 heartbeat.json 监控列表并使用可用工具检查任务。
 */

// ============================================================================
// 核心类型
// ============================================================================

/**
 * 心跳运行结果
 */
export type HeartbeatRunResult =
  | { status: "ran"; durationMs: number; response?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string }

/**
 * 单次心跳运行记录
 */
export interface HeartbeatRunRecord {
  timestamp: Date
  durationMs: number
  status: "ok" | "alert" | "error" | "skipped"
  response?: string
  toolsUsed?: string[]
  error?: string
}

/**
 * 心跳服务状态
 */
export interface HeartbeatServiceState {
  isRunning: boolean
  isPaused: boolean
  lastRunTime?: Date
  nextRunTime?: Date
  runHistory: HeartbeatRunRecord[]
  consecutiveErrors: number
}

// ============================================================================
// 配置
// ============================================================================

/**
 * 活跃时段配置
 */
export interface ActiveHoursConfig {
  /** 开始时间，24 小时制（例如 "08:00"） */
  start: string
  /** 结束时间，24 小时制（例如 "22:00"）。一天结束时用 "24:00" */
  end: string
  /** 时区："local"、"utc" 或 IANA 时区（例如 "America/New_York"） */
  timezone?: string
}

/**
 * 来自 settings.json 的心跳配置
 */
export interface HeartbeatConfig {
  /** 心跳功能是否启用？ */
  enabled: boolean

  /** 心跳间隔（例如 "5m"、"30m"、"1h"） */
  every: string

  /** 要使用的语言模型（例如 "Claude Sonnet 4"、"GPT-4o"） */
  model: string

  /** 自定义提示（覆盖基于监控列表的提示） */
  prompt?: string

  /** HEARTBEAT_OK 之后在投递前允许的最大字符数 */
  ackMaxChars: number

  /** 保留的最大历史条数 */
  maxHistory: number

  /** 自动暂停前允许的最大连续错误数 */
  maxConsecutiveErrors: number

  /** 活跃时段窗口（可选） */
  activeHours?: ActiveHoursConfig

  /** 对告警显示通知 */
  notifyOnAlert: boolean

  /** 对错误显示通知 */
  notifyOnError: boolean
}

/**
 * 默认配置值
 */
export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: false, // 选择加入的功能
  every: "30m",
  model: "", // 运行时选择
  ackMaxChars: 300,
  maxHistory: 100,
  maxConsecutiveErrors: 5,
  notifyOnAlert: true,
  notifyOnError: true
}

/**
 * 表示“无需关注”的魔法 token
 */
export const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK"

// ============================================================================
// 持久化
// ============================================================================

/**
 * 可序列化的存储状态
 */
export interface HeartbeatStorageData {
  version: number
  lastRunTime?: string
  runHistory: Array<{
    timestamp: string
    durationMs: number
    status: "ok" | "alert" | "error" | "skipped"
    response?: string
    toolsUsed?: string[]
    error?: string
  }>
  consecutiveErrors: number
}

// ============================================================================
// 事件
// ============================================================================

/**
 * 心跳服务发出的事件
 */
export type HeartbeatEvent =
  | { type: "started" }
  | { type: "stopped" }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "beat_started" }
  | { type: "beat_completed"; result: HeartbeatRunResult }
  | { type: "alert"; message: string }
  | { type: "error"; error: string }

export type HeartbeatEventListener = (event: HeartbeatEvent) => void

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 把时长字符串解析为毫秒
 * 支持：5m、30m、1h、2h 等
 */
export function parseDurationMs(duration: string): number | null {
  const match = duration
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours|s|sec|secs|seconds)?$/i)
  if (!match) return null

  const value = parseFloat(match[1])
  const unit = (match[2] || "m").toLowerCase()

  switch (unit) {
    case "s":
    case "sec":
    case "secs":
    case "seconds":
      return value * 1000
    case "m":
    case "min":
    case "mins":
    case "minutes":
      return value * 60 * 1000
    case "h":
    case "hr":
    case "hrs":
    case "hours":
      return value * 60 * 60 * 1000
    default:
      return value * 60 * 1000 // 默认按分钟
  }
}

/**
 * 把毫秒格式化为人类可读的时长
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  return `${(ms / 3600000).toFixed(1)}h`
}

/**
 * 检查当前时间是否在活跃时段内
 */
export function isWithinActiveHours(config?: ActiveHoursConfig): boolean {
  if (!config) return true

  const now = new Date()
  let hours: number
  let minutes: number

  // 暂时使用本地时间。TODO：添加时区支持
  hours = now.getHours()
  minutes = now.getMinutes()

  const currentMinutes = hours * 60 + minutes

  const [startH, startM] = config.start.split(":").map(Number)
  const [endH, endM] = config.end.split(":").map(Number)

  const startMinutes = startH * 60 + startM
  let endMinutes = endH * 60 + endM

  // 把 "24:00" 当作一天结束
  if (endH === 24) endMinutes = 24 * 60

  return currentMinutes >= startMinutes && currentMinutes < endMinutes
}

/**
 * 从响应中提取 HEARTBEAT_OK 并判断是否为确认
 */
export function parseHeartbeatResponse(
  response: string,
  _ackMaxChars: number
): {
  isAck: boolean
  cleanedResponse: string
  hasAlert: boolean
} {
  const trimmed = response.trim()

  // 简单检查：如果响应包含 HEARTBEAT_OK，即为确认
  const containsToken = trimmed.toUpperCase().includes(HEARTBEAT_OK_TOKEN)

  if (containsToken) {
    return { isAck: true, cleanedResponse: "", hasAlert: false }
  }

  // 无 token = 告警
  return { isAck: false, cleanedResponse: trimmed, hasAlert: true }
}
