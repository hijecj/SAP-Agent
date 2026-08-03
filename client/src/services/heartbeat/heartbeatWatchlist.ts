/**
 * 💓 心跳监控列表
 *
 * 管理 heartbeat.json 文件 - 结构化监控任务列表。
 * 用户（通过 Copilot 聊天）和心跳 LLM 都可以添加/移除任务。
 */

import * as vscode from "vscode"
import * as fs from "fs"
import * as path from "path"
import { log } from "../../lib"

// ============================================================================
// 类型
// ============================================================================

/**
 * 监控列表中的单个监控任务
 */
export interface WatchlistTask {
  /** 唯一任务 ID（自动生成） */
  id: string

  /** 要监控内容的可读描述 */
  description: string

  /** 可选：要检查的特定条件或查询 */
  condition?: string

  /** 可选：此任务的 SAP 连接 ID */
  connectionId?: string

  /** 此任务当前是否激活？ */
  enabled: boolean

  /** 此任务何时添加 */
  addedAt: string

  /** 心跳上次检查此任务的时间 */
  lastCheckedAt?: string

  /** 上次检查结果（为下次运行提供上下文） */
  lastResult?: string

  /** 可选：条件满足后自动移除 */
  removeWhenDone?: boolean

  // ========== 来自主代理的智能上下文 ==========

  /** 预构建的 SQL 查询，供心跳模型直接执行 */
  sampleQuery?: string

  /** 供心跳模型遵循的分步指令 */
  checkInstructions?: string[]

  /** 任务优先级：高立即提醒，低可以批量 */
  priority?: "high" | "medium" | "low"

  /** 用于分组/过滤的类别 */
  category?: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"

  // ========== 调度 ==========

  /** 在此 ISO 时间戳之前不检查此任务（用于“明天上午 10 点提醒我”） */
  startAt?: string

  /** 这只是简单提醒吗？（通知一次并自动移除） */
  reminderOnly?: boolean

  /** 谁添加了此任务 - 用于上下文 */
  addedBy?: "user" | "agent" | "heartbeat"

  /** 为什么添加此任务 - 给心跳模型提供上下文 */
  reason?: string

  // ========== 通知跟踪 ==========

  /** 用户上次被通知此任务的时间 */
  lastNotifiedAt?: string

  /** 上次通知包含的内容（ID、哈希、计数） */
  lastNotifiedFindings?: string

  /** 提醒前的最小计数（例如只有错误 > 5 才提醒） */
  alertThreshold?: number

  /** 此分钟数内不重复通知 */
  cooldownMinutes?: number

  // ========== 任务生命周期 ==========

  /** 在此 ISO 时间戳之后自动移除任务 */
  expiresAt?: string

  /** 自动移除前最大检查次数 */
  maxChecks?: number

  /** 此任务已被检查多少次 */
  checkCount?: number
}

/**
 * heartbeat.json 文件结构
 */
export interface HeartbeatWatchlistFile {
  /** 供未来迁移使用的 schema 版本 */
  version: number

  /** 最后修改时间戳 */
  lastModified: string

  /** 谁最后修改（用户或心跳） */
  lastModifiedBy: "user" | "heartbeat"

  /** 监控任务 */
  tasks: WatchlistTask[]
}

/**
 * 当前 schema 版本
 */
const WATCHLIST_VERSION = 1

/**
 * 监控列表的文件名
 */
const WATCHLIST_FILENAME = "heartbeat.json"

// ============================================================================
// 监控列表管理器
// ============================================================================

/**
 * 管理 heartbeat.json 监控列表文件
 */
export class HeartbeatWatchlist {
  /**
   * 获取 heartbeat.json 的路径（在第一个基于文件的工作区文件夹中）
   */
  static getFilePath(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders) return null

    // 查找第一个基于文件的工作区文件夹（不是 adt://）
    for (const folder of workspaceFolders) {
      if (folder.uri.scheme === "file") {
        return path.join(folder.uri.fsPath, WATCHLIST_FILENAME)
      }
    }

    return null
  }

  /**
   * 读取监控列表文件
   */
  static read(): HeartbeatWatchlistFile | null {
    const filePath = this.getFilePath()
    if (!filePath) return null

    if (!fs.existsSync(filePath)) {
      return null
    }

    try {
      const content = fs.readFileSync(filePath, "utf8")
      const data = JSON.parse(content) as HeartbeatWatchlistFile

      // 校验版本
      if (data.version !== WATCHLIST_VERSION) {
        log(`💓 Watchlist version mismatch: ${data.version} vs ${WATCHLIST_VERSION}`)
        // 未来：需要时迁移 schema
      }

      return data
    } catch (error) {
      log(`💓 Error reading watchlist: ${error}`)
      return null
    }
  }

  /**
   * 写入监控列表文件
   */
  static write(data: HeartbeatWatchlistFile, modifiedBy: "user" | "heartbeat" | "agent"): boolean {
    const filePath = this.getFilePath()
    if (!filePath) return false

    try {
      // 确保目录存在
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // 更新元数据（对文件元数据而言，agent 算作用户）
      data.version = WATCHLIST_VERSION
      data.lastModified = new Date().toISOString()
      data.lastModifiedBy = modifiedBy === "agent" ? "user" : modifiedBy

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8")
      return true
    } catch (error) {
      log(`💓 Error writing watchlist: ${error}`)
      return false
    }
  }

  /**
   * 获取或创建监控列表
   */
  static getOrCreate(): HeartbeatWatchlistFile {
    const existing = this.read()
    if (existing) return existing

    return {
      version: WATCHLIST_VERSION,
      lastModified: new Date().toISOString(),
      lastModifiedBy: "user",
      tasks: []
    }
  }

  /**
   * 生成唯一任务 ID
   */
  static generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  }

  /**
   * 向监控列表添加新任务
   */
  static addTask(
    description: string,
    options?: {
      condition?: string
      connectionId?: string
      removeWhenDone?: boolean
      // Smart context fields
      sampleQuery?: string
      checkInstructions?: string[]
      priority?: "high" | "medium" | "low"
      category?: "transport" | "dump" | "job" | "idoc" | "performance" | "reminder" | "custom"
      alertThreshold?: number
      cooldownMinutes?: number
      expiresAt?: string
      maxChecks?: number
      // Scheduling
      startAt?: string
      reminderOnly?: boolean
      reason?: string
    },
    modifiedBy: "user" | "heartbeat" | "agent" = "user"
  ): { success: boolean; task?: WatchlistTask; error?: string } {
    const filePath = this.getFilePath()
    if (!filePath) {
      return { success: false, error: "No file-based workspace folder found" }
    }

    const watchlist = this.getOrCreate()

    // 检查重复描述（但提醒除外 - 它们按时间唯一）
    const normalized = description.trim().toLowerCase()
    if (
      !options?.reminderOnly &&
      watchlist.tasks.some(t => t.description.toLowerCase() === normalized)
    ) {
      return { success: false, error: `Task already exists: "${description}"` }
    }

    const task: WatchlistTask = {
      id: this.generateTaskId(),
      description: description.trim(),
      condition: options?.condition,
      connectionId: options?.connectionId,
      enabled: true,
      addedAt: new Date().toISOString(),
      addedBy: modifiedBy === "heartbeat" ? "heartbeat" : modifiedBy === "agent" ? "agent" : "user",
      removeWhenDone: options?.removeWhenDone,
      // 智能上下文字段
      sampleQuery: options?.sampleQuery,
      checkInstructions: options?.checkInstructions,
      priority: options?.priority,
      category: options?.category,
      alertThreshold: options?.alertThreshold,
      cooldownMinutes: options?.cooldownMinutes,
      expiresAt: options?.expiresAt,
      maxChecks: options?.maxChecks,
      checkCount: 0,
      // 调度
      startAt: options?.startAt,
      reminderOnly: options?.reminderOnly,
      reason: options?.reason
    }

    watchlist.tasks.push(task)

    if (this.write(watchlist, modifiedBy === "agent" ? "user" : modifiedBy)) {
      return { success: true, task }
    } else {
      return { success: false, error: "Failed to write watchlist file" }
    }
  }

  /**
   * 按 ID 或描述移除任务
   */
  static removeTask(
    idOrDescription: string,
    modifiedBy: "user" | "heartbeat" = "user"
  ): { success: boolean; removedTask?: WatchlistTask; error?: string } {
    const watchlist = this.read()
    if (!watchlist) {
      return { success: false, error: "No watchlist file found" }
    }

    const normalized = idOrDescription.trim().toLowerCase()
    const taskIndex = watchlist.tasks.findIndex(
      t => t.id === idOrDescription || t.description.toLowerCase() === normalized
    )

    if (taskIndex === -1) {
      return { success: false, error: `Task not found: "${idOrDescription}"` }
    }

    const [removedTask] = watchlist.tasks.splice(taskIndex, 1)

    if (this.write(watchlist, modifiedBy)) {
      return { success: true, removedTask }
    } else {
      return { success: false, error: "Failed to write watchlist file" }
    }
  }

  /**
   * 更新任务（例如记录上次检查结果、通知跟踪）
   */
  static updateTask(
    taskId: string,
    updates: Partial<
      Pick<
        WatchlistTask,
        | "enabled"
        | "lastCheckedAt"
        | "lastResult"
        | "description"
        | "condition"
        | "lastNotifiedAt"
        | "lastNotifiedFindings"
        | "checkCount"
      >
    >,
    modifiedBy: "user" | "heartbeat" | "agent" = "heartbeat"
  ): { success: boolean; task?: WatchlistTask; error?: string } {
    const watchlist = this.read()
    if (!watchlist) {
      return { success: false, error: "No watchlist file found" }
    }

    const task = watchlist.tasks.find(t => t.id === taskId)
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` }
    }

    // 应用更新
    if (updates.enabled !== undefined) task.enabled = updates.enabled
    if (updates.lastCheckedAt !== undefined) task.lastCheckedAt = updates.lastCheckedAt
    if (updates.lastResult !== undefined) task.lastResult = updates.lastResult
    if (updates.description !== undefined) task.description = updates.description
    if (updates.condition !== undefined) task.condition = updates.condition

    // 通知跟踪
    if (updates.lastNotifiedAt !== undefined) task.lastNotifiedAt = updates.lastNotifiedAt
    if (updates.lastNotifiedFindings !== undefined)
      task.lastNotifiedFindings = updates.lastNotifiedFindings

    // 检查次数（检查时自动递增）
    if (updates.checkCount !== undefined) task.checkCount = updates.checkCount

    if (this.write(watchlist, modifiedBy)) {
      return { success: true, task }
    } else {
      return { success: false, error: "Failed to write watchlist file" }
    }
  }

  /**
   * 获取所有已启用的任务
   */
  static getEnabledTasks(): WatchlistTask[] {
    const watchlist = this.read()
    if (!watchlist) return []
    return watchlist.tasks.filter(t => t.enabled)
  }

  /**
   * 获取所有任务（用于列出）
   */
  static getAllTasks(): WatchlistTask[] {
    const watchlist = this.read()
    if (!watchlist) return []
    return watchlist.tasks
  }

  /**
   * 获取到期需要检查的任务（过滤掉未来调度的任务）
   */
  static getDueTasks(): WatchlistTask[] {
    const tasks = this.getEnabledTasks()
    const now = new Date()

    return tasks.filter(task => {
      // 检查任务是否有 startAt 且在未来
      if (task.startAt) {
        const startTime = new Date(task.startAt)
        if (now < startTime) {
          return false // 尚未到期
        }
      }

      // 检查任务是否已过期
      if (task.expiresAt) {
        const expireTime = new Date(task.expiresAt)
        if (now > expireTime) {
          return false // 已过期
        }
      }

      return true
    })
  }

  /**
   * 获取调度到未来的任务（用于显示）
   */
  static getScheduledTasks(): WatchlistTask[] {
    const tasks = this.getEnabledTasks()
    const now = new Date()

    return tasks.filter(task => {
      if (task.startAt) {
        const startTime = new Date(task.startAt)
        return now < startTime
      }
      return false
    })
  }

  /**
   * 把任务格式化为供 LLM 使用的提示部分
   */
  static formatForPrompt(): string {
    const dueTasks = this.getDueTasks()
    const scheduledTasks = this.getScheduledTasks()

    if (dueTasks.length === 0 && scheduledTasks.length === 0) {
      return "No monitoring tasks configured."
    }

    if (dueTasks.length === 0) {
      return `No tasks due right now. ${scheduledTasks.length} task(s) scheduled for later.`
    }

    const lines = ["## Tasks to Check Now", ""]

    for (const task of dueTasks) {
      lines.push(`### ${task.id}`)

      // 显示它是提醒还是监控任务
      if (task.reminderOnly) {
        lines.push(`🔔 **REMINDER:** ${task.description}`)
        lines.push(`**Action:** Notify the user with this message, then REMOVE this task.`)
        if (task.reason) {
          lines.push(`**Context:** ${task.reason}`)
        }
      } else {
        lines.push(`**Task:** ${task.description}`)
      }

      if (task.addedBy === "agent") {
        lines.push(`_(Added proactively by assistant)_`)
      }

      if (task.priority) {
        lines.push(`**Priority:** ${task.priority}`)
      }
      if (task.category && task.category !== "reminder") {
        lines.push(`**Category:** ${task.category}`)
      }
      if (task.connectionId) {
        lines.push(`**System:** ${task.connectionId}`)
      }
      if (task.condition) {
        lines.push(`**Condition:** ${task.condition}`)
      }

      // 来自主代理的智能上下文
      if (task.sampleQuery) {
        lines.push(`**SQL Query to Execute:**`)
        lines.push("```sql")
        lines.push(task.sampleQuery)
        lines.push("```")
      }
      if (task.checkInstructions?.length) {
        lines.push(`**Step-by-step Instructions:**`)
        task.checkInstructions.forEach((step, i) => {
          lines.push(`${i + 1}. ${step}`)
        })
      }

      // 阈值和冷却时间
      if (task.alertThreshold !== undefined) {
        lines.push(`**Alert Threshold:** Only alert if count > ${task.alertThreshold}`)
      }
      if (task.cooldownMinutes !== undefined && task.lastNotifiedAt) {
        const lastNotified = new Date(task.lastNotifiedAt)
        const cooldownEnd = new Date(lastNotified.getTime() + task.cooldownMinutes * 60 * 1000)
        const now = new Date()
        if (now < cooldownEnd) {
          const minsRemaining = Math.ceil((cooldownEnd.getTime() - now.getTime()) / 60000)
          lines.push(`**⏸️ Cooldown Active:** ${minsRemaining} min remaining (do NOT notify again)`)
        }
      }

      // 供比较的先前发现
      if (task.lastCheckedAt) {
        lines.push(`**Last Checked:** ${task.lastCheckedAt}`)
      }
      if (task.lastNotifiedAt) {
        lines.push(`**Last Notified:** ${task.lastNotifiedAt}`)
      }
      if (task.lastNotifiedFindings) {
        lines.push(`**Already Notified (do NOT re-notify for these):**`)
        lines.push(`> ${task.lastNotifiedFindings}`)
      }
      if (task.lastResult) {
        lines.push(`**Previous Check Result:**`)
        lines.push(`> ${task.lastResult}`)
      } else if (!task.reminderOnly) {
        lines.push(`**Previous Check:** None (first check)`)
      }

      if (task.removeWhenDone) {
        lines.push(`**Auto-remove:** Yes, when condition is met`)
      }
      if (task.maxChecks && task.checkCount !== undefined) {
        lines.push(`**Check Limit:** ${task.checkCount}/${task.maxChecks}`)
      }

      lines.push("")
    }

    return lines.join("\n")
  }
}
