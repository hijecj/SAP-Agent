import { workspace, ExtensionContext, commands } from "vscode"
import { funWindow as window } from "../funMessenger"
import { getOrCreateClient } from "../../adt/conections"
import { connectedRoots } from "../../config"
import { FeedStateManager } from "./feedStateManager"
import { parseFeedResponse, toFeedMetadata } from "./feedParsers"
import { FeedSubscriptions, PollingTask, FeedEntry, FeedMetadata } from "./feedTypes"
import { fullParse, xmlArray } from "abap-adt-api/build/utilities"

const MIN_POLL_INTERVAL = 120 // 2 分钟（秒）
const MAX_POLL_INTERVAL = 86400 // 24 小时（秒）
const MAX_CONCURRENT_POLLS = 5
const EXPONENTIAL_BACKOFF_BASE = 2
const MAX_BACKOFF_MULTIPLIER = 8
const STAGGER_DELAY = 5000 // 轮询启动之间间隔 5 秒
const ERROR_NOTIFICATION_COOLDOWN = 3600000 // 1 小时（毫秒）

/**
 * Feed 轮询服务 - 管理所有已订阅 feed 的后台轮询
 */
export class FeedPollingService {
  private context: ExtensionContext
  private stateManager: FeedStateManager
  private pollingTasks: Map<string, PollingTask> = new Map()
  private isRunning: boolean = false
  private isPaused: boolean = false
  private currentPolls: number = 0
  private onEntriesChanged?: () => void
  private restartDebounceTimer?: NodeJS.Timeout
  private configListenerDisposable?: { dispose: () => void }
  private lastErrorNotificationTime: Map<string, number> = new Map() // systemId -> 时间戳

  constructor(context: ExtensionContext, stateManager: FeedStateManager) {
    this.context = context
    this.stateManager = stateManager
  }

  /**
   * 设置条目变化时的回调
   */
  setOnEntriesChanged(callback: () => void): void {
    this.onEntriesChanged = callback
  }

  /**
   * 启动轮询服务
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    this.isRunning = true
    this.isPaused = false

    // 从设置加载 feed 订阅
    await this.loadAndSchedulePolls()

    // 监听设置变化（防抖以处理快速保存）
    // 只注册一次监听器
    if (!this.configListenerDisposable) {
      this.configListenerDisposable = workspace.onDidChangeConfiguration(async e => {
        if (e.affectsConfiguration("abapfs.feedSubscriptions")) {
          // 立即取消所有活动的轮询任务以停止当前轮询
          for (const task of this.pollingTasks.values()) {
            if (task.timeoutHandle) {
              clearTimeout(task.timeoutHandle)
              task.timeoutHandle = undefined
            }
          }

          // 清除现有重启定时器
          if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer)
          }

          // 防抖 2 秒重启，避免保存多个配置时多次重启
          this.restartDebounceTimer = setTimeout(async () => {
            await this.restart()
          }, 2000)
        }
      })

      // 加入订阅，在扩展停用时清理
      this.context.subscriptions.push(this.configListenerDisposable)
    }

    // 检查离线/在线状态
    this.setupOfflineDetection()
  }

  /**
   * 停止轮询服务
   */
  stop(): void {
    if (!this.isRunning) return

    this.isRunning = false

    // 清除重启防抖定时器
    if (this.restartDebounceTimer) {
      clearTimeout(this.restartDebounceTimer)
      this.restartDebounceTimer = undefined
    }

    // 释放配置监听器
    if (this.configListenerDisposable) {
      this.configListenerDisposable.dispose()
      this.configListenerDisposable = undefined
    }

    // 取消所有轮询任务
    for (const task of this.pollingTasks.values()) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle)
      }
    }

    this.pollingTasks.clear()
  }

  /**
   * 重启轮询服务
   */
  async restart(): Promise<void> {
    this.stop()
    await this.start()
  }

  /**
   * 暂停轮询（例如离线时）
   */
  pause(): void {
    if (!this.isRunning) return

    this.isPaused = true

    // 取消所有活动超时但保留任务信息
    for (const task of this.pollingTasks.values()) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle)
        task.timeoutHandle = undefined
      }
    }
  }

  /**
   * 恢复轮询
   */
  async resume(): Promise<void> {
    if (!this.isRunning || !this.isPaused) return

    this.isPaused = false

    // 重新安排所有轮询
    await this.loadAndSchedulePolls()
  }

  /**
   * 加载 feed 订阅并安排轮询
   */
  private async loadAndSchedulePolls(): Promise<void> {
    // 清除现有任务
    for (const task of this.pollingTasks.values()) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle)
      }
    }
    this.pollingTasks.clear()

    // 从设置获取 feed 订阅
    const config = workspace.getConfiguration()
    const subscriptions = config.get<FeedSubscriptions>("abapfs.feedSubscriptions", {})

    // 获取已连接的系统
    const systems = Array.from(connectedRoots().keys())

    let staggerIndex = 0
    for (const systemId of systems) {
      const systemConfig = subscriptions[systemId]
      if (!systemConfig) {
        continue
      }

      // 获取此系统的可用 feed
      const availableFeeds = await this.getAvailableFeeds(systemId)
      if (!availableFeeds) continue

      for (const [feedTitle, feedConfig] of Object.entries(systemConfig)) {
        if (!feedConfig.enabled) {
          continue
        }

        // 查找 feed 元数据
        const feedMeta = availableFeeds.find(f => f.title === feedTitle)
        if (!feedMeta) {
          // feed 不再可用
          await this.handleUnavailableFeed(systemId, feedTitle)
          continue
        }

        // 校验轮询间隔
        const pollingInterval = this.validatePollingInterval(feedConfig.pollingInterval)

        // 创建轮询任务
        const taskKey = `${systemId}|${feedTitle}`
        const task: PollingTask = {
          systemId,
          feedTitle,
          feedPath: feedMeta.href,
          config: { ...feedConfig, pollingInterval },
          nextPollTime: Date.now() + staggerIndex * STAGGER_DELAY, // 错开初始轮询
          isPolling: false
        }

        this.pollingTasks.set(taskKey, task)

        // 带错开安排轮询
        this.schedulePoll(task, staggerIndex * STAGGER_DELAY)
        staggerIndex++
      }
    }

    // 如果没有安排任何任务，明确记录
    if (this.pollingTasks.size === 0) {
    }
  }

  /**
   * 获取系统的可用 feed
   */
  private async getAvailableFeeds(systemId: string): Promise<FeedMetadata[] | null> {
    try {
      const client = await getOrCreateClient(systemId)
      const feeds = await client.feeds()
      return feeds.map(toFeedMetadata)
    } catch (error) {
      return null
    }
  }

  /**
   * 处理不可用的 feed
   */
  private async handleUnavailableFeed(systemId: string, feedTitle: string): Promise<void> {
    const state = this.stateManager.getFeedState(systemId, feedTitle)

    // 只有第一次发现不可用时才通知
    if (!state || state.isAvailable) {
      await this.stateManager.markFeedUnavailable(systemId, feedTitle)

      void window
        .showWarningMessage(
          `Feed "${feedTitle}" is no longer available on ${systemId}. It may have been removed after a system upgrade. Please review your feed subscriptions.`,
          "Configure Feeds"
        )
        .then(action => {
          if (action === "Configure Feeds") {
            void commands.executeCommand("abapfs.configureFeeds")
          }
        })
    }
  }

  /**
   * 校验并规范化轮询间隔
   */
  private validatePollingInterval(interval: number): number {
    if (interval < MIN_POLL_INTERVAL) return MIN_POLL_INTERVAL
    if (interval > MAX_POLL_INTERVAL) return MAX_POLL_INTERVAL
    return interval
  }

  /**
   * 为任务安排轮询
   */
  private schedulePoll(task: PollingTask, delay: number = 0): void {
    if (!this.isRunning || this.isPaused) return

    const actualDelay = delay || Math.max(0, task.nextPollTime - Date.now())

    task.timeoutHandle = setTimeout(async () => {
      await this.executePoll(task)
    }, actualDelay)
  }

  /**
   * 为任务执行轮询
   */
  private async executePoll(task: PollingTask): Promise<void> {
    if (!this.isRunning || this.isPaused || task.isPolling) return

    // 并发轮询过多时等待
    while (this.currentPolls >= MAX_CONCURRENT_POLLS) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    task.isPolling = true
    this.currentPolls++

    try {
      // 获取客户端
      const client = await getOrCreateClient(task.systemId)

      // 构建查询
      const query = task.config.useDefaultQuery ? undefined : task.config.query

      // 按类型轮询 feed
      let feedData: any
      if (task.feedPath.includes("/runtime/dumps")) {
        feedData = await client.dumps(query)
      } else {
        // 对其他 feed 类型，需要使用通用 HTTP 请求
        // 因为 ADT API 没有覆盖所有 feed 类型的专用方法
        feedData = await this.pollGenericFeed(client, task.feedPath, query)
      }

      // 解析 feed 响应
      const feedMeta = await this.getAvailableFeeds(task.systemId)
      const feed = feedMeta?.find(f => f.title === task.feedTitle)
      if (!feed) {
        throw new Error("Feed metadata not found")
      }

      const entries = parseFeedResponse(
        feedData,
        task.systemId,
        task.feedTitle,
        task.feedPath,
        feed.feedType
      )

      // 先过滤新条目（在加入状态之前）
      const newEntries = this.filterNewEntries(task, entries)

      // 始终把所有条目加入状态管理器（这样它们会出现在收件箱中）
      if (entries.length > 0) {
        await this.stateManager.addFeedEntries(task.systemId, task.feedTitle, entries)

        // 更新上次看到的 ID
        await this.stateManager.updateLastSeen(task.systemId, task.feedTitle, entries[0].id)

        // 通知树视图刷新
        if (this.onEntriesChanged) {
          this.onEntriesChanged()
        }
      }

      // 只对新条目显示通知
      if (newEntries.length > 0) {
        if (task.config.notifications) {
          await this.showNotifications(task, newEntries)
        }
      }

      // 更新上次轮询时间
      await this.stateManager.updateLastPoll(task.systemId, task.feedTitle)

      // 成功时重置错误计数
      await this.stateManager.resetErrorCount(task.systemId, task.feedTitle)

      // 标记 feed 可用
      await this.stateManager.markFeedAvailable(task.systemId, task.feedTitle)
    } catch (error) {
      // 递增错误计数
      await this.stateManager.incrementErrorCount(task.systemId, task.feedTitle, String(error))

      // 获取当前错误计数
      const state = this.stateManager.getFeedState(task.systemId, task.feedTitle)
      const errorCount = state?.errorCount || 0

      // 错误持续时应用指数退避
      if (errorCount > 3) {
        const backoffMultiplier = Math.min(
          EXPONENTIAL_BACKOFF_BASE ** (errorCount - 3),
          MAX_BACKOFF_MULTIPLIER
        )
        task.config.pollingInterval *= backoffMultiplier
      }

      // 对持续失败显示错误通知（每个系统 1 小时冷却）
      if (errorCount >= 5) {
        const lastNotification = this.lastErrorNotificationTime.get(task.systemId) || 0
        const now = Date.now()

        if (now - lastNotification > ERROR_NOTIFICATION_COOLDOWN) {
          this.lastErrorNotificationTime.set(task.systemId, now)
          void window
            .showErrorMessage(
              `Unable to reach SAP system "${task.systemId}". Feed polling will continue in the background.`,
              "Configure Feeds"
            )
            .then(action => {
              if (action === "Configure Feeds") {
                void commands.executeCommand("abapfs.configureFeeds")
              }
            })
        }
      }
    } finally {
      task.isPolling = false
      this.currentPolls--

      // 安排下次轮询
      task.nextPollTime = Date.now() + task.config.pollingInterval * 1000
      this.schedulePoll(task)
    }
  }

  /**
   * 使用 HTTP 请求轮询通用 feed
   */
  private async pollGenericFeed(client: any, feedPath: string, query?: string): Promise<any> {
    // 构建查询字符串
    const qs: any = {}
    if (query) {
      qs["$query"] = query
    }

    // 使用底层 httpClient 发起 HTTP 请求
    const response = await client.httpClient.request(feedPath, {
      method: "GET",
      qs,
      headers: { Accept: "application/atom+xml;type=feed" }
    })

    // 使用 abap-adt-api 工具解析 XML feed 响应
    const raw = fullParse(response.body, { removeNSPrefix: true })
    const feed = raw?.feed || raw

    // 从 feed 提取原始条目（parseFeedResponse 会把它们转换为 FeedEntry 对象）
    let entries = xmlArray(feed, "entry")

    // 确保 entries 始终是数组（xmlArray 有时返回函数或其他非数组类型）
    let entriesArray: any[] = []
    if (Array.isArray(entries)) {
      entriesArray = entries
    } else if (entries && typeof entries === "object" && "length" in entries) {
      // 类数组对象，转换为数组
      entriesArray = Array.from(entries as any)
    } else {
      // 不是数组也不是类数组，返回空数组
      entriesArray = []
    }

    // 返回原始条目供 parseFeedResponse 处理
    return entriesArray
  }

  /**
   * 过滤新条目
   */
  private filterNewEntries(task: PollingTask, entries: FeedEntry[]): FeedEntry[] {
    // 如果是首次轮询（无现有条目），全部视为新条目
    const hasExistingEntries =
      this.stateManager.getFeedEntries(task.systemId, task.feedTitle).length > 0
    if (!hasExistingEntries) {
      return entries
    }

    const state = this.stateManager.getFeedState(task.systemId, task.feedTitle)
    if (!state) return entries // 无状态时所有条目都是新的

    const lastSeenId = state.lastSeenEntryId
    if (!lastSeenId) return entries

    // 查找上次看到条目的索引
    const lastSeenIndex = entries.findIndex(e => e.id === lastSeenId)
    if (lastSeenIndex === -1) return entries // 未找到上次看到的条目，返回全部

    // 只返回上次看到之前的条目
    return entries.slice(0, lastSeenIndex)
  }

  /**
   * 为新条目显示通知
   */
  private async showNotifications(task: PollingTask, entries: FeedEntry[]): Promise<void> {
    if (entries.length === 0) return

    // 分组通知
    const severity = this.getGroupSeverity(entries)
    const severityEmoji = severity === "error" ? "🔴" : severity === "warning" ? "⚠️" : "ℹ️"

    const message = `${severityEmoji} ${entries.length} new ${task.feedTitle} on ${task.systemId}`

    const action = await window.showInformationMessage(message, "View", "Dismiss")
    if (action === "View") {
      // 导航到 feed 收件箱并选择此 feed
      await commands.executeCommand("abapfs.showFeedInbox", {
        systemId: task.systemId,
        feedTitle: task.feedTitle
      })
    }
  }

  /**
   * 获取分组严重级别（组内最高严重级别）
   */
  private getGroupSeverity(entries: FeedEntry[]): "error" | "warning" | "info" {
    if (entries.some(e => e.severity === "error")) return "error"
    if (entries.some(e => e.severity === "warning")) return "warning"
    return "info"
  }

  /**
   * 设置离线检测
   */
  private setupOfflineDetection(): void {
    // 使用 workspace.fs 监控网络连接
    // 如果多个系统的请求持续失败，暂停轮询

    let consecutiveFailures = 0
    const checkInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(checkInterval)
        return
      }

      // 统计近期有错误的轮询任务
      let recentErrors = 0
      for (const task of this.pollingTasks.values()) {
        const state = this.stateManager.getFeedState(task.systemId, task.feedTitle)
        if (state && state.errorCount > 0 && Date.now() - state.lastPollTime < 300000) {
          recentErrors++
        }
      }

      // 如果大多数 feed 都在失败，假定离线
      const errorRate = recentErrors / Math.max(this.pollingTasks.size, 1)
      if (errorRate > 0.7) {
        consecutiveFailures++

        if (consecutiveFailures >= 3 && !this.isPaused) {
          this.pause()

          window
            .showWarningMessage(
              "Feed polling paused due to connectivity issues. Polling will resume automatically when connection is restored.",
              "Resume Now"
            )
            .then(action => {
              if (action === "Resume Now") {
                this.resume()
              }
            })
        }
      } else {
        consecutiveFailures = 0

        // 如果已暂停且错误已清除，恢复轮询
        if (this.isPaused && errorRate < 0.2) {
          this.resume()
        }
      }
    }, 60000) // 每分钟检查一次

    this.context.subscriptions.push({ dispose: () => clearInterval(checkInterval) })
  }

  /**
   * 获取轮询统计
   */
  getStatistics(): {
    totalTasks: number
    activeTasks: number
    pausedTasks: number
    erroredTasks: number
  } {
    let activeTasks = 0
    let pausedTasks = 0
    let erroredTasks = 0

    for (const task of this.pollingTasks.values()) {
      if (task.isPolling) {
        activeTasks++
      }

      const state = this.stateManager.getFeedState(task.systemId, task.feedTitle)
      if (state) {
        if (state.errorCount > 0) {
          erroredTasks++
        }
      }
    }

    if (this.isPaused) {
      pausedTasks = this.pollingTasks.size - activeTasks
    }

    return {
      totalTasks: this.pollingTasks.size,
      activeTasks,
      pausedTasks,
      erroredTasks
    }
  }
}
