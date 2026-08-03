import { DebugMetaType } from "abap-adt-api"

/** 单个捕获的变量值 */
export interface CapturedVariable {
  id: string
  name: string
  value: string
  type: string
  metaType: DebugMetaType
  tableLines?: number
  children?: CapturedVariable[]
  /** 表太大且用户选择跳过时为 true */
  skipped?: boolean
  /** 解释捕获为何不完整的消息 */
  skipReason?: string
}

/** 带捕获变量的命名作用域 */
export interface CapturedScope {
  name: string
  variables: CapturedVariable[]
}

/** 快照中的单个栈帧 */
export interface CapturedStackFrame {
  name: string
  sourcePath: string
  /** 用于源码缓存的原始 ADT URI */
  adtUri: string
  line: number
  stackPosition: number
}

/** 一个录制的调试停止点 */
export interface DebugSnapshot {
  stepNumber: number
  timestamp: number
  threadId: number
  stack: CapturedStackFrame[]
  scopes: CapturedScope[]
  changedVars: string[]
}

/** 完整录制文件 */
export interface DebugRecording {
  version: 1
  recordedAt: string
  connectionId: string
  objectName?: string
  debugUser?: string
  totalSteps: number
  duration: number
  snapshots: DebugSnapshot[]
  /** uri -> 供离线回放的完整源码文本 */
  sources?: Record<string, string>
}

/** 控制变量捕获方式的选项 */
export interface CaptureOptions {
  /** 无需提示自动捕获的最大表行数（默认 10000） */
  tableRowThreshold: number
  /** 录制停止前的最大步数（默认 5000） */
  maxSteps: number
  /** 结构/表的最大展开深度（默认 4） */
  maxDepth: number
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  tableRowThreshold: 10000,
  maxSteps: 5000,
  maxDepth: 4
}

export const REPLAY_DEBUG_TYPE = "abap-replay"
