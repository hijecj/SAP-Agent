/**
 * 💓 心跳服务
 *
 * 用于后台监控的周期性 LLM 代理轮次。
 * 按可配置间隔运行 LLM，读取 heartbeat.json 监控列表，使用工具。
 */

import * as vscode from "vscode"
import { HeartbeatStateManager } from "./heartbeatStateManager"
import { runHeartbeatLM } from "./heartbeatLmClient"
import {
  HeartbeatConfig,
  HeartbeatEvent,
  HeartbeatEventListener,
  HeartbeatRunResult,
  HeartbeatRunRecord,
  parseDurationMs,
  isWithinActiveHours,
  formatDuration
} from "./heartbeatTypes"
import { log } from "../../lib"
import { funWindow as window } from "../funMessenger"

/**
 * 💓 心跳服务
 *
 * 管理用于后台监控的周期性 LLM 运行
 */
export class HeartbeatService {
  private context: vscode.ExtensionContext
  private stateManager: HeartbeatStateManager
  private timer: NodeJS.Timeout | null = null
  private isRunning = false
  private isPaused = false
  private currentRun: Promise<void> | null = null
  private cancellationTokenSource: vscode.CancellationTokenSource | null = null
  private eventListeners: HeartbeatEventListener[] = []

  // 状态栏动画
  private statusBarItem: vscode.StatusBarItem | null = null
  private heartbeatAnimationTimer: NodeJS.Timeout | null = null
  private heartbeatFrame = 0

  constructor(context: vscode.ExtensionContext, stateManager: HeartbeatStateManager) {
    this.context = context
    this.stateManager = stateManager
    this.initStatusBar()
    this.initGlobalConfigListener()
  }

  /**
   * 初始化全局配置监听器（始终激活，即使服务已停止）
   * 通过按需停止/重启服务处理所有配置变化
   */
  private initGlobalConfigListener(): void {
    const disposable = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("abapfs.heartbeat")) {
        const config = vscode.workspace.getConfiguration("abapfs.heartbeat")
        const enabled = config.get<boolean>("enabled", false)
        const model = config.get<string>("model", "")

        if (enabled && !this.isRunning) {
          // 启动前检查是否已配置模型
          if (!model || model.trim().length === 0) {
            // 未配置模型 - 禁用并通知用户
            config.update("enabled", false, vscode.ConfigurationTarget.Workspace)
            window
              .showWarningMessage(
                'Heartbeat requires a model to be configured. Please set "abapfs.heartbeat.model" first (workspace level), then enable heartbeat.',
                "Open Settings"
              )
              .then(selection => {
                if (selection === "Open Settings") {
                  vscode.commands.executeCommand(
                    "workbench.action.openWorkspaceSettings",
                    "abapfs.heartbeat.model"
                  )
                }
              })
            return
          }
          // 启用 - 启动服务
          this.start()
        } else if (!enabled && this.isRunning) {
          // 禁用 - 停止服务
          this.stop()
        } else if (enabled && this.isRunning) {
          // 运行中配置变化 - 重启以应用更改
          this.stop()
          this.start()
        }
      }
    })
    this.context.subscriptions.push(disposable)
  }

  /**
   * 初始化状态栏项
   */
  private initStatusBar(): void {
    this.statusBarItem = window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
    this.statusBarItem.command = "abapfs.openHeartbeatJson"
    this.statusBarItem.tooltip = "Heartbeat - Click to open watchlist"
    this.context.subscriptions.push(this.statusBarItem)
  }

  /**
   * 开始心跳动画
   */
  private startHeartAnimation(): void {
    if (this.heartbeatAnimationTimer) return

    // 心跳脉冲动画：♡ → ♥（空心到实心）
    const frames = ["$(heart)", "$(heart-filled)"]

    this.heartbeatFrame = 0
    this.updateStatusBar()
    this.statusBarItem?.show()

    // 每秒脉冲一次（像心跳一样）
    this.heartbeatAnimationTimer = setInterval(() => {
      this.heartbeatFrame = (this.heartbeatFrame + 1) % frames.length
      this.updateStatusBar()
    }, 1000)
  }

  /**
   * 停止心跳动画
   */
  private stopHeartAnimation(): void {
    if (this.heartbeatAnimationTimer) {
      clearInterval(this.heartbeatAnimationTimer)
      this.heartbeatAnimationTimer = null
    }
    this.statusBarItem?.hide()
  }

  /**
   * 更新状态栏文本
   */
  private updateStatusBar(): void {
    if (!this.statusBarItem) return

    const frames = ["$(heart)", "$(heart-filled)"]
    const heart = frames[this.heartbeatFrame]

    if (this.isPaused) {
      this.statusBarItem.text = "$(heart) zzz"
      this.statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground")
    } else if (this.currentRun) {
      // 正在运行检查 - 显示思考中
      this.statusBarItem.text = `${heart} beat...`
      this.statusBarItem.backgroundColor = undefined
    } else {
      this.statusBarItem.text = heart
      this.statusBarItem.backgroundColor = undefined
    }
  }

  /**
   * 启动心跳服务
   */
  async start(): Promise<void> {
    if (this.isRunning && !this.isPaused) {
      return
    }

    const config = this.stateManager.getConfig()

    if (!config.enabled) {
      return
    }

    // 必须配置模型
    if (!config.model || config.model.trim().length === 0) {
      return
    }

    const intervalMs = parseDurationMs(config.every)
    if (!intervalMs || intervalMs <= 0) {
      return
    }

    // 全新启动时重置错误计数
    this.stateManager.resetErrors()

    this.isRunning = true
    this.isPaused = false
    this.stateManager.setRunning(true)

    // 启动状态栏动画
    this.startHeartAnimation()

    // 发出事件
    this.emit({ type: "started" })

    // 安排第一次心跳
    this.scheduleNextBeat(intervalMs)
  }

  /**
   * 停止心跳服务
   */
  stop(): void {
    if (!this.isRunning) return

    this.isRunning = false
    this.isPaused = false
    this.stateManager.setRunning(false)
    this.stateManager.setNextRunTime(undefined)

    // 停止状态栏动画
    this.stopHeartAnimation()

    // 取消任何正在运行的心跳
    if (this.cancellationTokenSource) {
      this.cancellationTokenSource.cancel()
      this.cancellationTokenSource = null
    }

    // 清除定时器
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.emit({ type: "stopped" })
  }

  /**
   * 暂停心跳（保留定时器但跳过运行）
   */
  pause(): void {
    if (!this.isRunning || this.isPaused) return

    this.isPaused = true
    this.stateManager.setPaused(true)

    this.emit({ type: "paused" })
  }

  /**
   * 从暂停恢复心跳
   */
  resume(): void {
    if (!this.isRunning || !this.isPaused) return

    this.isPaused = false
    this.stateManager.setPaused(false)

    this.emit({ type: "resumed" })
  }

  /**
   * 触发立即心跳（手动唤醒）
   */
  async triggerNow(reason?: string): Promise<HeartbeatRunResult> {
    return await this.runBeat()
  }

  /**
   * 获取当前状态
   */
  getStatus(): {
    isRunning: boolean
    isPaused: boolean
    nextRunTime?: Date
    lastRunTime?: Date
    stats: ReturnType<HeartbeatStateManager["getStats"]>
  } {
    const state = this.stateManager.getState()
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      nextRunTime: state.nextRunTime,
      lastRunTime: state.lastRunTime,
      stats: this.stateManager.getStats()
    }
  }

  /**
   * 订阅心跳事件
   */
  onEvent(listener: HeartbeatEventListener): vscode.Disposable {
    this.eventListeners.push(listener)
    return {
      dispose: () => {
        const index = this.eventListeners.indexOf(listener)
        if (index >= 0) {
          this.eventListeners.splice(index, 1)
        }
      }
    }
  }

  /**
   * 向所有监听器发出事件
   */
  private emit(event: HeartbeatEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        log(`💓 Event listener error: ${error}`)
      }
    }
  }

  /**
   * 安排下一次心跳
   */
  private scheduleNextBeat(intervalMs: number): void {
    if (!this.isRunning) return

    // 先清除任何现有定时器以防止重复
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const nextRunTime = new Date(Date.now() + intervalMs)
    this.stateManager.setNextRunTime(nextRunTime)

    this.timer = setTimeout(async () => {
      // 立即清除定时器引用
      this.timer = null

      const result = await this.runBeat()

      // 只在以下情况安排下一次心跳：
      // 1. 仍在运行
      // 2. 心跳实际运行了（不是因为已在运行而跳过）
      if (this.isRunning && result.status !== "skipped") {
        const config = this.stateManager.getConfig()
        const newIntervalMs = parseDurationMs(config.every)
        if (newIntervalMs && newIntervalMs > 0) {
          this.scheduleNextBeat(newIntervalMs)
        }
      } else if (
        this.isRunning &&
        result.status === "skipped" &&
        result.reason === "already-running"
      ) {
        // 如果因已在运行而跳过，30 秒后重试
        this.scheduleNextBeat(30000)
      } else if (this.isRunning) {
        // 对其他跳过原因（暂停、非活跃时段），按正常间隔安排
        const config = this.stateManager.getConfig()
        const newIntervalMs = parseDurationMs(config.every)
        if (newIntervalMs && newIntervalMs > 0) {
          this.scheduleNextBeat(newIntervalMs)
        }
      }
    }, intervalMs)
  }

  /**
   * 运行一次心跳
   */
  private async runBeat(): Promise<HeartbeatRunResult> {
    if (this.currentRun) {
      return { status: "skipped", reason: "already-running" }
    }

    if (this.isPaused) {
      return { status: "skipped", reason: "paused" }
    }

    const config = this.stateManager.getConfig()

    // 检查活跃时段
    if (!isWithinActiveHours(config.activeHours)) {
      await this.recordRun({
        timestamp: new Date(),
        durationMs: 0,
        status: "skipped",
        response: "Outside active hours"
      })
      return { status: "skipped", reason: "outside-active-hours" }
    }

    // 检查连续错误
    const state = this.stateManager.getState()
    if (state.consecutiveErrors >= config.maxConsecutiveErrors) {
      log(`💓 Too many consecutive errors (${state.consecutiveErrors}), pausing`)
      this.pause()
      return { status: "skipped", reason: "too-many-errors" }
    }

    // 创建取消令牌
    this.cancellationTokenSource = new vscode.CancellationTokenSource()

    this.emit({ type: "beat_started" })
    this.updateStatusBar() // 显示“检查中...”状态

    const startTime = Date.now()

    try {
      this.currentRun = (async () => {
        const result = await runHeartbeatLM(config, this.cancellationTokenSource?.token)

        // 记录本次运行
        const record: HeartbeatRunRecord = {
          timestamp: new Date(),
          durationMs: result.durationMs,
          status: result.status,
          response: result.response,
          toolsUsed: result.toolsUsed,
          error: result.error
        }
        await this.recordRun(record)

        // 处理结果
        if (result.status === "alert") {
          this.emit({ type: "alert", message: result.response })

          if (config.notifyOnAlert) {
            this.showNotification(result.response, "alert")
          }
        } else if (result.status === "error") {
          log(`💓 ERROR: ${result.error}`)
          this.emit({ type: "error", error: result.error || "Unknown error" })

          if (config.notifyOnError) {
            this.showNotification(result.error || "Heartbeat error", "error")
          }
        }
      })()

      await this.currentRun

      const durationMs = Date.now() - startTime
      const runResult: HeartbeatRunResult = { status: "ran", durationMs }
      this.emit({ type: "beat_completed", result: runResult })

      return runResult
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage = error instanceof Error ? error.message : String(error)

      log(`💓 Heartbeat failed: ${errorMessage}`)

      await this.recordRun({
        timestamp: new Date(),
        durationMs,
        status: "error",
        error: errorMessage
      })

      return { status: "failed", reason: errorMessage }
    } finally {
      this.currentRun = null
      this.updateStatusBar() // Back to normal heart
      this.cancellationTokenSource = null
    }
  }

  /**
   * 把运行记录到历史
   */
  private async recordRun(record: HeartbeatRunRecord): Promise<void> {
    await this.stateManager.recordRun(record)
  }

  /**
   * 显示 VS Code 通知
   */
  private showNotification(message: string, type: "alert" | "error"): void {
    const truncated = message.length > 200 ? message.substring(0, 200) + "..." : message

    if (type === "error") {
      window.showErrorMessage(`💓 Heartbeat: ${truncated}`)
    } else {
      window
        .showInformationMessage(`💓 Heartbeat Alert: ${truncated}`, "View Details")
        .then(selection => {
          if (selection === "View Details") {
            // 打开输出通道或显示完整消息
            window.showInformationMessage(message, { modal: true })
          }
        })
    }
  }
}

// ============================================================================
// 单例实例
// ============================================================================

let heartbeatServiceInstance: HeartbeatService | undefined

/**
 * 初始化心跳服务
 */
export function initializeHeartbeatService(context: vscode.ExtensionContext): HeartbeatService {
  const stateManager = new HeartbeatStateManager(context)
  heartbeatServiceInstance = new HeartbeatService(context, stateManager)
  return heartbeatServiceInstance
}

/**
 * 获取心跳服务实例
 */
export function getHeartbeatService(): HeartbeatService | undefined {
  return heartbeatServiceInstance
}
