/**
 * 💓 心跳模块
 *
 * 用于后台监控的周期性 LLM 代理轮次。
 * LLM 读取 heartbeat.json 监控列表并使用可用工具检查任务。
 */

// 类型
export {
  HeartbeatConfig,
  HeartbeatRunResult,
  HeartbeatRunRecord,
  HeartbeatServiceState,
  HeartbeatEvent,
  HeartbeatEventListener,
  ActiveHoursConfig,
  HEARTBEAT_OK_TOKEN,
  DEFAULT_HEARTBEAT_CONFIG,
  parseDurationMs,
  formatDuration,
  isWithinActiveHours,
  parseHeartbeatResponse
} from "./heartbeatTypes"

// 监控列表
export { HeartbeatWatchlist, WatchlistTask, HeartbeatWatchlistFile } from "./heartbeatWatchlist"

// 状态管理器
export { HeartbeatStateManager } from "./heartbeatStateManager"

// LM 客户端
export { runHeartbeatLM, HeartbeatLMResult } from "./heartbeatLmClient"

// 服务
export {
  HeartbeatService,
  initializeHeartbeatService,
  getHeartbeatService
} from "./heartbeatService"

// 工具
export { HeartbeatTool, registerHeartbeatTool, HeartbeatToolParams } from "./heartbeatTool"
