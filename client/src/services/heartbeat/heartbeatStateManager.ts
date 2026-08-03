/**
 * 💓 心跳状态管理器
 *
 * 处理心跳状态和历史记录的持久化。
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import {
  HeartbeatServiceState,
  HeartbeatStorageData,
  HeartbeatRunRecord,
  HeartbeatConfig,
  DEFAULT_HEARTBEAT_CONFIG
} from "./heartbeatTypes"
import { log } from "../../lib"

const HEARTBEAT_HISTORY_FILENAME = "heartbeatHistory.json"
const STORAGE_VERSION = 1

/**
 * 管理心跳服务的持久状态
 */
export class HeartbeatStateManager {
  private context: vscode.ExtensionContext
  private state: HeartbeatServiceState
  private storageUri: vscode.Uri

  constructor(context: vscode.ExtensionContext) {
    this.context = context
    this.storageUri = context.globalStorageUri
    this.state = {
      isRunning: false,
      isPaused: false,
      runHistory: [],
      consecutiveErrors: 0
    }
    this.ensureStorageExists()
    this.loadState()
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageExists(): void {
    const storagePath = this.storageUri.fsPath
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true })
    }
  }

  /**
   * 获取历史记录存储的文件路径
   */
  private getHistoryFilePath(): string {
    return path.join(this.storageUri.fsPath, HEARTBEAT_HISTORY_FILENAME)
  }

  /**
   * 从存储加载状态
   */
  private loadState(): void {
    try {
      const filePath = this.getHistoryFilePath()

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8")
        const stored = JSON.parse(data) as HeartbeatStorageData

        // 把存储数据转换为运行时状态
        this.state = {
          isRunning: false, // 始终以停止状态启动
          isPaused: false,
          lastRunTime: stored.lastRunTime ? new Date(stored.lastRunTime) : undefined,
          runHistory: stored.runHistory.map(r => ({
            ...r,
            timestamp: new Date(r.timestamp)
          })),
          consecutiveErrors: stored.consecutiveErrors || 0
        }

        log(`💓 Heartbeat state loaded: ${this.state.runHistory.length} history entries`)
      }
    } catch (error) {
      log(`💓 Error loading heartbeat state: ${error}`)
      // 以全新状态启动
    }
  }

  /**
   * 把状态保存到存储
   */
  async saveState(): Promise<void> {
    try {
      const config = this.getConfig()

      // 把历史记录裁剪到最大大小
      while (this.state.runHistory.length > config.maxHistory) {
        this.state.runHistory.shift()
      }

      const stored: HeartbeatStorageData = {
        version: STORAGE_VERSION,
        lastRunTime: this.state.lastRunTime?.toISOString(),
        runHistory: this.state.runHistory.map(r => ({
          ...r,
          timestamp: r.timestamp.toISOString()
        })),
        consecutiveErrors: this.state.consecutiveErrors
      }

      const filePath = this.getHistoryFilePath()
      fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf8")
    } catch (error) {
      log(`💓 Error saving heartbeat state: ${error}`)
    }
  }

  /**
   * 从设置获取当前心跳配置
   */
  getConfig(): HeartbeatConfig {
    const config = vscode.workspace.getConfiguration("abapfs.heartbeat")

    return {
      enabled: config.get("enabled", DEFAULT_HEARTBEAT_CONFIG.enabled),
      every: config.get("every", DEFAULT_HEARTBEAT_CONFIG.every),
      model: config.get("model", DEFAULT_HEARTBEAT_CONFIG.model),
      prompt: config.get("prompt", DEFAULT_HEARTBEAT_CONFIG.prompt),
      ackMaxChars: config.get("ackMaxChars", DEFAULT_HEARTBEAT_CONFIG.ackMaxChars),
      maxHistory: config.get("maxHistory", DEFAULT_HEARTBEAT_CONFIG.maxHistory),
      maxConsecutiveErrors: config.get(
        "maxConsecutiveErrors",
        DEFAULT_HEARTBEAT_CONFIG.maxConsecutiveErrors
      ),
      activeHours: config.get("activeHours", DEFAULT_HEARTBEAT_CONFIG.activeHours),
      notifyOnAlert: config.get("notifyOnAlert", DEFAULT_HEARTBEAT_CONFIG.notifyOnAlert),
      notifyOnError: config.get("notifyOnError", DEFAULT_HEARTBEAT_CONFIG.notifyOnError)
    }
  }

  /**
   * 获取当前状态
   */
  getState(): HeartbeatServiceState {
    return { ...this.state }
  }

  /**
   * 更新运行状态
   */
  setRunning(isRunning: boolean): void {
    this.state.isRunning = isRunning
  }

  /**
   * 更新暂停状态
   */
  setPaused(isPaused: boolean): void {
    this.state.isPaused = isPaused
  }

  /**
   * 设置下次运行时间
   */
  setNextRunTime(time: Date | undefined): void {
    this.state.nextRunTime = time
  }

  /**
   * 记录一次心跳运行
   */
  async recordRun(record: HeartbeatRunRecord): Promise<void> {
    this.state.lastRunTime = record.timestamp
    this.state.runHistory.push(record)

    // 跟踪连续错误
    if (record.status === "error") {
      this.state.consecutiveErrors++
    } else {
      this.state.consecutiveErrors = 0
    }

    await this.saveState()
  }

  /**
   * 重置连续错误计数
   */
  resetErrors(): void {
    this.state.consecutiveErrors = 0
  }

  /**
   * 获取最近的历史记录
   */
  getRecentHistory(count: number = 10): HeartbeatRunRecord[] {
    return this.state.runHistory.slice(-count)
  }

  /**
   * 清除所有历史记录
   */
  async clearHistory(): Promise<void> {
    this.state.runHistory = []
    this.state.consecutiveErrors = 0
    await this.saveState()
  }

  /**
   * 获取统计
   */
  getStats(): {
    totalRuns: number
    successfulRuns: number
    alerts: number
    errors: number
    skipped: number
    lastRunTime?: Date
    averageDurationMs: number
  } {
    const history = this.state.runHistory
    const successful = history.filter(r => r.status === "ok").length
    const alerts = history.filter(r => r.status === "alert").length
    const errors = history.filter(r => r.status === "error").length
    const skipped = history.filter(r => r.status === "skipped").length

    const durations = history.filter(r => r.durationMs > 0).map(r => r.durationMs)
    const avgDuration =
      durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0

    return {
      totalRuns: history.length,
      successfulRuns: successful,
      alerts,
      errors,
      skipped,
      lastRunTime: this.state.lastRunTime,
      averageDurationMs: Math.round(avgDuration)
    }
  }
}
