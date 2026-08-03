import { ExtensionContext, Uri } from "vscode"
import { FeedState, FeedStates, FeedEntry } from "./feedTypes"
import { log } from "../../lib"
import * as fs from "fs"
import * as path from "path"

const FEED_STATES_KEY = "abapfs.feedStates"
const FEED_ENTRIES_FILENAME = "feedEntries.json"

/**
 * 管理 feed 的持久状态（上次看到的条目、错误计数等）
 */
export class FeedStateManager {
  private context: ExtensionContext
  private feedStates: FeedStates = {}
  private feedEntries: Map<string, FeedEntry[]> = new Map() // key: systemId|feedTitle
  private storageUri: Uri

  constructor(context: ExtensionContext) {
    this.context = context
    this.storageUri = context.globalStorageUri
    this.ensureStorageExists()
    this.loadStates()
    this.loadEntries()
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
   * 获取 feed 条目存储的文件路径
   */
  private getEntriesFilePath(): string {
    return path.join(this.storageUri.fsPath, FEED_ENTRIES_FILENAME)
  }

  /**
   * 从 globalState 加载 feed 状态
   */
  private loadStates(): void {
    const stored = this.context.globalState.get<FeedStates>(FEED_STATES_KEY)
    if (stored) {
      this.feedStates = stored
    }
  }

  /**
   * 从文件存储加载 feed 条目
   */
  private loadEntries(): void {
    try {
      const filePath = this.getEntriesFilePath()

      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, "utf8")
        const stored = JSON.parse(data) as Record<string, FeedEntry[]>

        // 把时间戳字符串转回 Date 对象并校验
        const entries = Object.entries(stored).map(([key, entryList]) => {
          const fixedEntries = entryList.map(entry => {
            // 确保时间戳是有效的 Date
            const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date()

            // 校验日期有效
            if (isNaN(timestamp.getTime())) {
            }

            return {
              ...entry,
              timestamp,
              // 确保必填字段存在
              title: entry.title || "Untitled",
              summary: entry.summary || "",
              systemId: entry.systemId || "",
              feedTitle: entry.feedTitle || ""
            }
          })
          return [key, fixedEntries] as [string, FeedEntry[]]
        })
        this.feedEntries = new Map(entries)

        const totalEntries = Array.from(this.feedEntries.values()).reduce(
          (sum, list) => sum + list.length,
          0
        )
      } else {
      }
    } catch (error) {
      this.feedEntries = new Map()
    }
  }

  /**
   * 把 feed 状态保存到 globalState
   */
  private async saveStates(): Promise<void> {
    await this.context.globalState.update(FEED_STATES_KEY, this.feedStates)
  }

  /**
   * 把 feed 条目保存到文件存储
   */
  private async saveEntries(): Promise<void> {
    try {
      const filePath = this.getEntriesFilePath()
      const obj = Object.fromEntries(this.feedEntries)
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8")
    } catch (error) {}
  }

  /**
   * 获取 feed 状态键
   */
  private getStateKey(systemId: string, feedTitle: string): string {
    return `${systemId}|${feedTitle}`
  }

  /**
   * 获取 feed 状态
   */
  getFeedState(systemId: string, feedTitle: string): FeedState | undefined {
    const key = this.getStateKey(systemId, feedTitle)
    return this.feedStates[key]
  }

  /**
   * 更新 feed 状态
   */
  async updateFeedState(
    state: Partial<FeedState> & { systemId: string; feedTitle: string }
  ): Promise<void> {
    const key = this.getStateKey(state.systemId, state.feedTitle)
    const existing = this.feedStates[key] || {
      systemId: state.systemId,
      feedTitle: state.feedTitle,
      feedPath: "",
      lastPollTime: 0,
      lastSeenEntryId: "",
      errorCount: 0,
      isAvailable: true
    }

    this.feedStates[key] = { ...existing, ...state }
    await this.saveStates()
  }

  /**
   * 更新上次轮询时间
   */
  async updateLastPoll(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      lastPollTime: Date.now()
    })
  }

  /**
   * 更新上次看到的条目
   */
  async updateLastSeen(systemId: string, feedTitle: string, entryId: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      lastSeenEntryId: entryId
    })
  }

  /**
   * 递增错误计数
   */
  async incrementErrorCount(systemId: string, feedTitle: string, error: string): Promise<void> {
    const state = this.getFeedState(systemId, feedTitle)
    const errorCount = (state?.errorCount || 0) + 1
    await this.updateFeedState({
      systemId,
      feedTitle,
      errorCount,
      lastError: error
    })
  }

  /**
   * 重置错误计数
   */
  async resetErrorCount(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      errorCount: 0,
      lastError: undefined
    })
  }

  /**
   * 把 feed 标记为不可用
   */
  async markFeedUnavailable(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      isAvailable: false
    })
  }

  /**
   * 把 feed 标记为可用
   */
  async markFeedAvailable(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      isAvailable: true
    })
  }

  /**
   * 获取某个系统/feed 的所有条目
   */
  getFeedEntries(systemId: string, feedTitle: string): FeedEntry[] {
    const key = this.getStateKey(systemId, feedTitle)
    return this.feedEntries.get(key) || []
  }

  /**
   * 获取所有系统/feed 的所有条目
   */
  getAllFeedEntries(): FeedEntry[] {
    const allEntries: FeedEntry[] = []
    for (const entries of this.feedEntries.values()) {
      allEntries.push(...entries)
    }
    const sorted = allEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())

    return sorted
  }

  /**
   * 获取某个系统/feed 的未读条目
   */
  getUnreadEntries(systemId: string, feedTitle: string): FeedEntry[] {
    return this.getFeedEntries(systemId, feedTitle).filter(e => !e.isRead)
  }

  /**
   * 获取所有未读条目
   */
  getAllUnreadEntries(): FeedEntry[] {
    return this.getAllFeedEntries().filter(e => !e.isRead)
  }

  /**
   * 添加新的 feed 条目
   */
  async addFeedEntries(systemId: string, feedTitle: string, entries: FeedEntry[]): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle)
    const existing = this.feedEntries.get(key) || []

    // 把新条目与现有条目合并（避免重复）
    const entryMap = new Map<string, FeedEntry>()
    for (const entry of existing) {
      entryMap.set(entry.id, entry)
    }
    for (const entry of entries) {
      if (!entryMap.has(entry.id)) {
        entryMap.set(entry.id, entry)
      }
    }

    // 按时间戳排序（新的在前）
    const allEntries = Array.from(entryMap.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    )

    this.feedEntries.set(key, allEntries)

    await this.saveEntries()
  }

  /**
   * 把条目标记为已读
   */
  async markAsRead(systemId: string, feedTitle: string, entryId: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle)
    const entries = this.feedEntries.get(key)
    if (!entries) return

    const entry = entries.find(e => e.id === entryId)
    if (entry) {
      entry.isRead = true
      entry.isNew = false
      await this.saveEntries()
    }
  }

  /**
   * 把某个 feed 的所有条目标记为已读
   */
  async markAllAsRead(systemId: string, feedTitle: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle)
    const entries = this.feedEntries.get(key)
    if (!entries) return

    for (const entry of entries) {
      entry.isRead = true
      entry.isNew = false
    }
    await this.saveEntries()
  }

  /**
   * 把所有条目标记为已读（所有系统、所有 feed）
   */
  async markAllEntriesAsRead(): Promise<void> {
    for (const entries of this.feedEntries.values()) {
      for (const entry of entries) {
        entry.isRead = true
        entry.isNew = false
      }
    }
    await this.saveEntries()
  }

  /**
   * 移除条目
   */
  async removeEntry(systemId: string, feedTitle: string, entryId: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle)
    const entries = this.feedEntries.get(key)
    if (!entries) return

    const filtered = entries.filter(e => e.id !== entryId)
    this.feedEntries.set(key, filtered)
    await this.saveEntries()
  }

  /**
   * 清除某个 feed 的所有条目
   */
  async clearFeedEntries(systemId: string, feedTitle: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle)
    this.feedEntries.delete(key)
    await this.saveEntries()
  }

  /**
   * 清除所有条目（所有系统、所有 feed）
   */
  async clearAllEntries(): Promise<void> {
    this.feedEntries.clear()
    await this.saveEntries()
  }

  /**
   * 获取 feed 统计
   */
  getStatistics(): { totalEntries: number; unreadEntries: number; newEntries: number } {
    const allEntries = this.getAllFeedEntries()
    return {
      totalEntries: allEntries.length,
      unreadEntries: allEntries.filter(e => !e.isRead).length,
      newEntries: allEntries.filter(e => e.isNew).length
    }
  }

  /**
   * 获取特定 feed 的统计
   */
  getFeedStatistics(
    systemId: string,
    feedTitle: string
  ): { total: number; unread: number; new: number } {
    const entries = this.getFeedEntries(systemId, feedTitle)
    return {
      total: entries.length,
      unread: entries.filter(e => !e.isRead).length,
      new: entries.filter(e => e.isNew).length
    }
  }

  /**
   * 检查条目是否为新条目（之前未见过）
   */
  isNewEntry(systemId: string, feedTitle: string, entryId: string): boolean {
    const state = this.getFeedState(systemId, feedTitle)
    if (!state) return true

    // 如果之前未见过该条目，则它是新条目
    return state.lastSeenEntryId !== entryId
  }
}
