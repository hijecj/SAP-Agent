/**
 * 💓 心跳工具
 *
 * 管理心跳服务和监控列表的语言模型工具。
 *
 * 两种使用场景：
 * 1. 用户通过 Copilot 聊天（代理模式）- 添加/移除监控任务
 * 2. 心跳 LLM 运行 - 更新任务状态、标记完成、添加新发现
 *
 * 监控列表以结构化格式存储在 heartbeat.json 中，
 * 便于 LLM 读取和维护。
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "../lm-tools/toolRegistry"
import { logTelemetry } from "../telemetry"
import { getHeartbeatService } from "./heartbeatService"
import { formatDuration } from "./heartbeatTypes"
import { HeartbeatWatchlist } from "./heartbeatWatchlist"
import { assertToolInvocationAuthorized } from "../lm-tools/toolGuard"

// ============================================================================
// 工具参数
// ============================================================================

export interface HeartbeatToolParams {
  /** 要执行的操作 */
  action: // 服务控制
    | "status"
    | "start"
    | "stop"
    | "pause"
    | "resume"
    | "trigger"
    | "history"
    // 监控列表管理（对用户和心跳 LLM 都可用）
    | "add_task"
    | "remove_task"
    | "update_task"
    | "enable_task"
    | "disable_task"
    | "list_tasks"
    | "get_watchlist" // 返回 JSON 供 LLM 解析

  /** 对 'history' - 要显示的条目数 */
  count?: number

  // 任务管理参数
  /** 对 'add_task' - 任务描述 */
  description?: string

  /** 对 'add_task' - 可选的要检查条件 */
  condition?: string

  /** 对 'add_task' - SAP 连接 ID */
  connectionId?: string

  /** 对 'add_task' - 条件满足时自动移除 */
  removeWhenDone?: boolean

  // 来自主代理的智能上下文
  /** 对 'add_task' - 为心跳模型预构建的 SQL 查询 */
  sampleQuery?: string

  /** 对 'add_task' - 供心跳模型遵循的分步指令 */
  checkInstructions?: string[]

  /** 对 'add_task' - 任务优先级 */
  priority?: "high" | "medium" | "low"

  /** 对 'add_task' - 任务类别 */
  category?: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"

  /** 对 'add_task' - 只有计数超过此值才提醒 */
  alertThreshold?: number

  /** 对 'add_task' - 此分钟数内不重复通知 */
  cooldownMinutes?: number

  /** 对 'add_task' - 在此 ISO 时间戳之后自动移除 */
  expiresAt?: string

  /** 对 'add_task' - 检查这么多次后自动移除 */
  maxChecks?: number

  // 调度
  /** 对 'add_task' - 在此 ISO 时间戳之前不检查 */
  startAt?: string

  /** 对 'add_task' - 简单提醒，通知一次并移除 */
  reminderOnly?: boolean

  /** 对 'trigger' 或 'add_task' - 为什么执行此操作/任务 */
  reason?: string

  /** 对 'remove_task'、'update_task' 等 - 任务 ID 或描述 */
  taskId?: string

  /** 对 'update_task' - 要记录的新结果 */
  result?: string

  /** 对 'update_task' - 用户上次被通知的时间 */
  lastNotifiedAt?: string

  /** 对 'update_task' - 上次通知包含的内容 */
  lastNotifiedFindings?: string

  /** 对 'update_task' - 谁在做更新 */
  modifiedBy?: "user" | "heartbeat" | "agent"
}

// ============================================================================
// 工具类
// ============================================================================

/**
 * 💓 心跳管理工具
 */
export class HeartbeatTool implements vscode.LanguageModelTool<HeartbeatToolParams> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<HeartbeatToolParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    const { action } = options.input

    const actionMessages: Record<string, string> = {
      status: "Checking heartbeat status...",
      start: "Starting heartbeat service...",
      stop: "Stopping heartbeat service...",
      pause: "Pausing heartbeat...",
      resume: "Resuming heartbeat...",
      trigger: "Triggering heartbeat now...",
      history: "Getting heartbeat history...",
      add_task: "Adding monitoring task...",
      remove_task: "Removing monitoring task...",
      update_task: "Updating task status...",
      enable_task: "Enabling task...",
      disable_task: "Disabling task...",
      list_tasks: "Listing monitoring tasks...",
      get_watchlist: "Getting watchlist..."
    }

    return {
      invocationMessage: actionMessages[action] || `Heartbeat ${action}...`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<HeartbeatToolParams>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_manage_heartbeat_called")
    const params = options.input
    const service = getHeartbeatService()

    try {
      switch (params.action) {
        // === 服务控制 ===
        case "status":
          return this.handleStatus(service)

        case "start":
          return this.handleStart(service)

        case "stop":
          if (!service) return this.noServiceError()
          service.stop()
          return this.text("⏹️ Heartbeat service stopped.")

        case "trigger":
          if (!service) return this.noServiceError()
          return await this.handleTrigger(service, params.reason)

        case "history":
          return this.handleHistory(service, params.count || 10)

        // === 监控列表管理 ===
        case "add_task":
          return this.handleAddTask(params)

        case "remove_task":
          return this.handleRemoveTask(params.taskId)

        case "update_task":
          return this.handleUpdateTask(params)

        case "enable_task":
          return this.handleToggleTask(params.taskId, true)

        case "disable_task":
          return this.handleToggleTask(params.taskId, false)

        case "list_tasks":
          return this.handleListTasks()

        case "get_watchlist":
          return this.handleGetWatchlist()

        default:
          return this.text(`Unknown action: ${params.action}`)
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return this.text(`❌ Error: ${msg}`)
    }
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  private text(message: string): vscode.LanguageModelToolResult {
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(message)])
  }

  private noServiceError(): vscode.LanguageModelToolResult {
    return this.text("Heartbeat service not initialized. Restart VS Code.")
  }

  // ============================================================================
  // 服务控制处理程序
  // ============================================================================

  private handleStatus(
    service: ReturnType<typeof getHeartbeatService>
  ): vscode.LanguageModelToolResult {
    if (!service) {
      return this.text("❌ Heartbeat service not initialized. Extension may not be fully loaded.")
    }

    // 获取设置信息
    const config = vscode.workspace.getConfiguration("abapfs.heartbeat")
    const enabledInSettings = config.get<boolean>("enabled", false)
    const configuredModel = config.get<string>("model", "")
    const interval = config.get<string>("every", "5m")

    const status = service.getStatus()
    const tasks = HeartbeatWatchlist.getAllTasks()
    const enabledTasks = tasks.filter(t => t.enabled).length

    const lines = ["💓 **Heartbeat Status**", ""]

    // 配置部分
    lines.push("**Configuration:**")
    lines.push(`- Enabled in settings: ${enabledInSettings ? "✅ Yes" : "❌ No"}`)
    lines.push(`- Model: ${configuredModel || "⚠️ NOT CONFIGURED"}`)
    lines.push(`- Interval: ${interval}`)
    lines.push("")

    // 未正确配置时的警告
    if (!configuredModel) {
      lines.push(
        '⚠️ **No model configured!** Set abapfs.heartbeat.model to a cheap model like "GPT-4o mini (copilot)" or "Claude Haiku 4 (copilot)" before starting.'
      )
      lines.push("")
    }

    // 服务状态
    lines.push(
      `**Service:** ${status.isRunning ? "✅ Running" : "❌ Stopped"}${status.isPaused ? " (Paused)" : ""}`
    )
    lines.push(`**Tasks:** ${enabledTasks} enabled / ${tasks.length} total`)

    if (status.lastRunTime) {
      const ago = Date.now() - status.lastRunTime.getTime()
      lines.push(`**Last Run:** ${formatDuration(ago)} ago`)
    }

    if (status.nextRunTime && status.isRunning && !status.isPaused) {
      const inMs = status.nextRunTime.getTime() - Date.now()
      if (inMs > 0) {
        lines.push(`**Next Run:** in ${formatDuration(inMs)}`)
      }
    }

    lines.push("")
    lines.push("**Statistics:**")
    lines.push(`- Total Runs: ${status.stats.totalRuns}`)
    lines.push(`- Alerts: ${status.stats.alerts}`)
    lines.push(`- Errors: ${status.stats.errors}`)

    if (status.stats.averageDurationMs > 0) {
      lines.push(`- Avg Duration: ${formatDuration(status.stats.averageDurationMs)}`)
    }

    return this.text(lines.join("\n"))
  }

  private async handleStart(
    service: ReturnType<typeof getHeartbeatService>
  ): Promise<vscode.LanguageModelToolResult> {
    if (!service) {
      return this.text("❌ Heartbeat service not initialized. Extension may not be fully loaded.")
    }

    // 检查是否配置了模型
    const config = vscode.workspace.getConfiguration("abapfs.heartbeat")
    const configuredModel = config.get<string>("model", "")

    if (!configuredModel) {
      return this.text(
        "❌ Cannot start heartbeat: No model configured.\n\n" +
          "Set abapfs.heartbeat.model in VS Code settings to a cost-effective model like:\n" +
          '- "GPT-4o mini (copilot)"\n' +
          '- "Claude Haiku 4 (copilot)"\n' +
          '- "GPT-4o (copilot)"\n\n' +
          "Then call start again."
      )
    }

    // 设置中禁用时自动启用
    const enabledInSettings = config.get<boolean>("enabled", false)
    if (!enabledInSettings) {
      await config.update("enabled", true, vscode.ConfigurationTarget.Workspace)
    }

    // 启动服务
    await service.start()

    const status = service.getStatus()
    if (status.isRunning) {
      return this.text(
        `✅ Heartbeat started!\n- Model: ${configuredModel}\n- Interval: ${config.get<string>("every", "5m")}`
      )
    } else {
      return this.text("❌ Failed to start heartbeat. Check the logs for details.")
    }
  }

  private async handleTrigger(
    service: NonNullable<ReturnType<typeof getHeartbeatService>>,
    reason?: string
  ): Promise<vscode.LanguageModelToolResult> {
    const result = await service.triggerNow(reason)

    if (result.status === "ran") {
      return this.text(`✅ Heartbeat completed in ${formatDuration(result.durationMs)}`)
    } else if (result.status === "skipped") {
      return this.text(`⏭️ Skipped: ${result.reason}`)
    } else {
      return this.text(`❌ Failed: ${result.reason}`)
    }
  }

  private handleHistory(
    service: ReturnType<typeof getHeartbeatService>,
    _count: number
  ): vscode.LanguageModelToolResult {
    if (!service) {
      return this.text("Heartbeat service not available")
    }

    const status = service.getStatus()

    if (status.stats.totalRuns === 0) {
      return this.text("No heartbeat history yet.")
    }

    const lines = [
      `💓 **Heartbeat History**`,
      "",
      `Total: ${status.stats.totalRuns} | OK: ${status.stats.successfulRuns} | Alerts: ${status.stats.alerts} | Errors: ${status.stats.errors}`
    ]

    return this.text(lines.join("\n"))
  }

  // ============================================================================
  // 监控列表处理程序
  // ============================================================================

  private handleAddTask(params: HeartbeatToolParams): vscode.LanguageModelToolResult {
    if (!params.description || params.description.trim().length === 0) {
      return this.text("❌ No task description provided.")
    }

    const result = HeartbeatWatchlist.addTask(
      params.description,
      {
        condition: params.condition,
        connectionId: params.connectionId,
        removeWhenDone: params.removeWhenDone || params.reminderOnly, // 提醒自动移除
        // 来自主代理的智能上下文
        sampleQuery: params.sampleQuery,
        checkInstructions: params.checkInstructions,
        priority: params.priority,
        category: params.reminderOnly ? "reminder" : params.category,
        alertThreshold: params.alertThreshold,
        cooldownMinutes: params.cooldownMinutes,
        expiresAt: params.expiresAt,
        maxChecks: params.maxChecks,
        // 调度
        startAt: params.startAt,
        reminderOnly: params.reminderOnly,
        reason: params.reason
      },
      params.modifiedBy || "user"
    )

    if (result.success && result.task) {
      const lines = [
        params.reminderOnly ? `🔔 Reminder scheduled:` : `✅ Added monitoring task:`,
        `- **ID:** ${result.task.id}`,
        `- **Description:** ${result.task.description}`
      ]

      // 显示提醒的预定时间
      if (result.task.startAt) {
        const startTime = new Date(result.task.startAt)
        lines.push(`- **Scheduled for:** ${startTime.toLocaleString()}`)
      }
      if (result.task.reminderOnly) {
        lines.push(`- **Type:** One-time reminder (will auto-remove after notification)`)
      }
      if (result.task.condition) {
        lines.push(`- **Condition:** ${result.task.condition}`)
      }
      if (result.task.sampleQuery) {
        lines.push(`- **SQL Query:** Provided ✓`)
      }
      if (result.task.checkInstructions?.length) {
        lines.push(`- **Instructions:** ${result.task.checkInstructions.length} steps`)
      }
      if (result.task.priority) {
        lines.push(`- **Priority:** ${result.task.priority}`)
      }
      if (result.task.cooldownMinutes) {
        lines.push(`- **Cooldown:** ${result.task.cooldownMinutes} min`)
      }
      if (result.task.removeWhenDone && !result.task.reminderOnly) {
        lines.push(`- **Auto-remove:** Yes (when condition is met)`)
      }

      // 未运行时提示启动心跳
      const service = getHeartbeatService()
      if (service && !service.getStatus().isRunning) {
        lines.push("")
        lines.push('_Heartbeat is not running. Use action "start" to begin monitoring._')
      }

      return this.text(lines.join("\n"))
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleRemoveTask(taskId?: string): vscode.LanguageModelToolResult {
    if (!taskId) {
      return this.text("❌ No task ID or description provided.")
    }

    const result = HeartbeatWatchlist.removeTask(taskId)

    if (result.success && result.removedTask) {
      return this.text(`✅ Removed task: "${result.removedTask.description}"`)
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleUpdateTask(params: HeartbeatToolParams): vscode.LanguageModelToolResult {
    if (!params.taskId) {
      return this.text("❌ No task ID provided.")
    }

    const updates: Parameters<typeof HeartbeatWatchlist.updateTask>[1] = {}

    if (params.result !== undefined) {
      updates.lastResult = params.result
      updates.lastCheckedAt = new Date().toISOString()
    }

    // 通知跟踪更新
    if (params.lastNotifiedAt !== undefined) {
      updates.lastNotifiedAt = params.lastNotifiedAt
    }
    if (params.lastNotifiedFindings !== undefined) {
      updates.lastNotifiedFindings = params.lastNotifiedFindings
    }

    const result = HeartbeatWatchlist.updateTask(
      params.taskId,
      updates,
      params.modifiedBy || "heartbeat"
    )

    if (result.success && result.task) {
      return this.text(`✅ Updated task "${result.task.description}"`)
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleToggleTask(
    taskId: string | undefined,
    enabled: boolean
  ): vscode.LanguageModelToolResult {
    if (!taskId) {
      return this.text("❌ No task ID provided.")
    }

    const result = HeartbeatWatchlist.updateTask(taskId, { enabled }, "user")

    if (result.success && result.task) {
      const status = enabled ? "enabled" : "disabled"
      return this.text(`✅ Task "${result.task.description}" ${status}`)
    } else {
      return this.text(`❌ ${result.error}`)
    }
  }

  private handleListTasks(): vscode.LanguageModelToolResult {
    const tasks = HeartbeatWatchlist.getAllTasks()
    const filePath = HeartbeatWatchlist.getFilePath()

    if (tasks.length === 0) {
      const lines = [
        "📋 **No monitoring tasks configured**",
        "",
        'Use action "add_task" with description to add a task.',
        "",
        `File: ${filePath || "No workspace folder"}`
      ]
      return this.text(lines.join("\n"))
    }

    const lines = [`📋 **Monitoring Tasks** (${tasks.length})`, ""]

    for (const task of tasks) {
      const status = task.enabled ? "✅" : "❌"
      lines.push(`${status} **${task.id}**`)
      lines.push(`   ${task.description}`)
      if (task.condition) {
        lines.push(`   _Condition: ${task.condition}_`)
      }
      if (task.lastResult) {
        lines.push(`   _Last: ${task.lastResult}_`)
      }
      lines.push("")
    }

    return this.text(lines.join("\n"))
  }

  /**
   * 返回原始 JSON 供心跳运行期间的 LLM 解析
   */
  private handleGetWatchlist(): vscode.LanguageModelToolResult {
    const watchlist = HeartbeatWatchlist.read()

    if (!watchlist) {
      return this.text(
        JSON.stringify(
          {
            version: 1,
            tasks: [],
            message: "No watchlist file found"
          },
          null,
          2
        )
      )
    }

    return this.text(JSON.stringify(watchlist, null, 2))
  }
}

// ============================================================================
// 注册
// ============================================================================

/**
 * 注册心跳工具
 */
export function registerHeartbeatTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("manage_heartbeat", new HeartbeatTool()))
}
