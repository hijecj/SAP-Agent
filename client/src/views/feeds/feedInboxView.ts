import {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  EventEmitter,
  Event,
  ViewColumn,
  WebviewPanel,
  Uri,
  commands,
  ThemeIcon
} from "vscode"
import { FeedStateManager } from "../../services/feeds/feedStateManager"
import { FeedEntry, FeedType } from "../../services/feeds/feedTypes"
import { getFeedTypeIcon, getSeverityIcon } from "../../services/feeds/feedParsers"
import { AbapFsCommands, command } from "../../commands"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { log } from "../../lib"
import { funWindow as window } from "../../services/funMessenger"

/**
 * Feed 树中的系统节点
 */
class SystemFeedNode extends TreeItem {
  readonly tag = "system" as const

  constructor(
    public readonly systemId: string,
    private stateManager: FeedStateManager
  ) {
    const baseLabel = systemId || "Unknown System"

    // 在 super() 调用前计算统计
    const allEntries = stateManager.getAllFeedEntries()
    const systemEntries = allEntries.filter(e => e.systemId === systemId)
    const unreadCount = systemEntries.filter(e => !e.isRead).length

    // 未读时添加圆点指示
    const label = unreadCount > 0 ? `● ${baseLabel}` : baseLabel

    super(label, TreeItemCollapsibleState.Expanded)

    this.contextValue = "systemFeed"
    this.tooltip = `System: ${baseLabel}`

    if (unreadCount > 0) {
      this.description = `${unreadCount} new`
      this.tooltip = `${baseLabel}: ${unreadCount} unread, ${systemEntries.length} total`
    }
  }

  async children(): Promise<FeedFolderNode[]> {
    try {
      // 获取此系统的所有 feed 标题
      const allEntries = this.stateManager.getAllFeedEntries()
      const systemEntries = allEntries.filter(e => e?.systemId === this.systemId && e?.feedTitle)

      if (systemEntries.length === 0) {
        return []
      }

      // 按 feed 标题分组
      const feedGroups = new Map<string, FeedEntry[]>()
      for (const entry of systemEntries) {
        const existing = feedGroups.get(entry.feedTitle) || []
        existing.push(entry)
        feedGroups.set(entry.feedTitle, existing)
      }

      // 创建 feed 节点
      const feedNodes: FeedFolderNode[] = []
      for (const [feedTitle, entries] of feedGroups.entries()) {
        if (feedTitle) {
          // 只有 feedTitle 非空时才创建节点
          feedNodes.push(new FeedFolderNode(this.systemId, feedTitle, entries, this.stateManager))
        }
      }

      // 按未读数排序（最高在前）
      feedNodes.sort((a, b) => b.getUnreadCount() - a.getUnreadCount())

      return feedNodes
    } catch (error) {
      return []
    }
  }
}

/**
 * Feed 文件夹节点
 */
class FeedFolderNode extends TreeItem {
  readonly tag = "feedFolder" as const

  constructor(
    public readonly systemId: string,
    public readonly feedTitle: string,
    public readonly entries: FeedEntry[],
    private stateManager: FeedStateManager
  ) {
    const baseLabel = feedTitle || "Unknown Feed"

    // 在 super() 调用前计算未读数
    const unreadCount = entries.filter(e => !e.isRead).length

    // 未读时添加圆点指示
    const label = unreadCount > 0 ? `● ${baseLabel}` : baseLabel

    super(label, TreeItemCollapsibleState.Collapsed)

    this.contextValue = "feedFolder"

    if (unreadCount > 0) {
      this.description = `${unreadCount} new`
      this.tooltip = `${baseLabel} on ${systemId}: ${unreadCount} unread, ${entries.length} total`
    } else {
      this.description = `${entries.length} total`
      this.tooltip = `${baseLabel} on ${systemId}: ${entries.length} entries`
    }
  }

  getUnreadCount(): number {
    return this.entries.filter(e => !e.isRead).length
  }

  children(): FeedEntryNode[] {
    try {
      // 按时间戳排序（新的在前）
      const sortedEntries = [...this.entries].sort((a, b) => {
        const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : 0
        const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : 0
        return timeB - timeA
      })

      return sortedEntries.map(entry => new FeedEntryNode(entry, this.stateManager))
    } catch (error) {
      return []
    }
  }
}

/**
 * Feed 条目节点
 */
class FeedEntryNode extends TreeItem {
  readonly tag = "feedEntry" as const

  constructor(
    public readonly entry: FeedEntry,
    private stateManager: FeedStateManager
  ) {
    // 为未读条目添加可视指示
    const label = entry?.title || "Untitled"
    const displayLabel = entry?.isRead ? label : `● ${label}`

    super(displayLabel, TreeItemCollapsibleState.None)
    this.contextValue = "feedEntry"

    try {
      // 显示时间戳
      this.description =
        entry?.timestamp instanceof Date
          ? entry.timestamp.toLocaleString()
          : String(entry?.timestamp || "")

      // 带完整摘要的提示
      const timeStr =
        entry?.timestamp instanceof Date
          ? entry.timestamp.toLocaleString()
          : String(entry?.timestamp || "Unknown")
      this.tooltip = `${entry?.title || "Untitled"}\n\n${entry?.summary || ""}\n\nSystem: ${entry?.systemId || "Unknown"}\nFeed: ${entry?.feedTitle || "Unknown"}\nTime: ${timeStr}`

      // 查看条目的命令
      this.command = {
        title: "View Feed Entry",
        command: AbapFsCommands.viewFeedEntry,
        arguments: [this]
      }
    } catch (error) {
      this.description = "Error loading entry"
    }
  }

  children(): FeedEntryNode[] {
    return []
  }
}

// 所有树项目的类型联合
type FeedItem = SystemFeedNode | FeedFolderNode | FeedEntryNode

/**
 * Feed 收件箱树数据提供器
 */
export class FeedInboxProvider implements TreeDataProvider<FeedItem> {
  private _onDidChangeTreeData = new EventEmitter<FeedItem | undefined | null | void>()
  readonly onDidChangeTreeData: Event<FeedItem | undefined | null | void> =
    this._onDidChangeTreeData.event

  private stateManager: FeedStateManager
  private webviewPanels: Map<string, WebviewPanel> = new Map()

  constructor(stateManager: FeedStateManager) {
    this.stateManager = stateManager
  }

  /**
   * 刷新树视图
   */
  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  /**
   * 获取树项目
   */
  getTreeItem(element: FeedItem): TreeItem {
    if (!element) {
      return new TreeItem("Error: undefined element")
    }
    return element
  }

  /**
   * 获取子节点 - VS Code 调用它获取子节点
   */
  async getChildren(element?: FeedItem): Promise<FeedItem[]> {
    try {
      switch (element?.tag) {
        case undefined:
          const rootNodes = this.getRootNodes()
          if (rootNodes.length > 0) {
          }
          return rootNodes

        case "system":
          const systemChildren = await element.children()
          if (systemChildren.length > 0) {
          }
          return systemChildren

        case "feedFolder":
          const folderChildren = element.children()
          if (folderChildren.length > 0) {
          }
          return folderChildren

        case "feedEntry":
          return []

        default:
          return []
      }
    } catch (error) {
      if (error instanceof Error && error.stack) {
      }
      return []
    }
  }

  /**
   * 获取根节点（有 feed 条目的系统）
   */
  private getRootNodes(): FeedItem[] {
    const allEntries = this.stateManager.getAllFeedEntries()

    if (allEntries.length === 0) {
      return []
    }

    // 过滤掉 systemId 未定义的条目
    const validEntries = allEntries.filter(e => e?.systemId)
    if (validEntries.length < allEntries.length) {
    }

    if (validEntries.length === 0) {
      return []
    }

    // 按系统分组
    const systems = new Set(validEntries.map(e => e.systemId))

    // 创建系统节点
    const systemNodes = Array.from(systems).map(
      systemId => new SystemFeedNode(systemId, this.stateManager)
    )

    // 按系统名排序
    systemNodes.sort((a, b) => a.systemId.localeCompare(b.systemId))

    return systemNodes
  }

  /**
   * 在 Webview 中显示 feed 条目
   */
  async viewFeedEntry(node: any): Promise<void> {
    // 同时处理 FeedEntryNode 和普通对象
    const entry = node.entry || node

    // 标记为已读
    await this.stateManager.markAsRead(entry.systemId, entry.feedTitle, entry.id)
    this.refresh()

    // 获取或创建 Webview 面板
    const panelKey = `${entry.systemId}-${entry.feedTitle}-${entry.id}`
    let panel = this.webviewPanels.get(panelKey)

    if (!panel) {
      panel = window.createWebviewPanel("feedEntry", entry.title, ViewColumn.Active, {
        enableScripts: true,
        enableCommandUris: true,
        enableFindWidget: true,
        retainContextWhenHidden: true
      })

      this.webviewPanels.set(panelKey, panel)

      panel.onDidDispose(() => {
        this.webviewPanels.delete(panelKey)
      })

      // 处理对 ADT URI 的点击
      panel.webview.onDidReceiveMessage(async message => {
        if (message.command === "click" && message.uri) {
          return new AdtObjectFinder(entry.systemId).displayAdtUri(message.uri)
        }
      })
    }

    // 按 feed 类型渲染内容
    panel.webview.html = this.renderFeedEntry(entry)
    panel.reveal()
  }

  /**
   * 把 feed 条目渲染为 HTML
   */
  private renderFeedEntry(entry: FeedEntry): string {
    const jsFooter = `<script type="text/javascript">
const vscode = acquireVsCodeApi();
const as = document.querySelectorAll("a")
as.forEach(
    a=>a.addEventListener('click',e=>{
        const uri = e.currentTarget.attributes.href.value
        if(!uri.match(/^#/)){
            e.preventDefault();
            vscode.postMessage({
                command: 'click',
                uri
            });
        }
    })
)</script>`

    // 对 Dump，使用 text 字段中的原始 HTML 内容
    if (entry.rawData.text) {
      return `${entry.rawData.text}${jsFooter}`
    }

    // 对 URI 错误和其他带 HTML 摘要的 feed，提取并渲染 HTML
    let htmlContent = null
    if (entry.rawData.summary) {
      // 检查摘要是否包含带 @_type: "html" 的 #text
      if (entry.rawData.summary["#text"] && entry.rawData.summary["@_type"] === "html") {
        htmlContent = entry.rawData.summary["#text"]
      } else if (
        typeof entry.rawData.summary === "string" &&
        entry.rawData.summary.includes("<table")
      ) {
        htmlContent = entry.rawData.summary
      }
    }

    // 如果找到 HTML 内容，渲染它
    if (htmlContent) {
      return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
        }
        h1 {
            font-size: 1.3em;
            margin-top: 20px;
            margin-bottom: 10px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 10px 0;
        }
        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: var(--vscode-editor-background);
            font-weight: bold;
        }
        .meta {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 15px;
        }
    </style>
</head>
<body>
    <div class="meta">
        <strong>${this.escapeHtml(entry.title)}</strong><br>
        System: ${this.escapeHtml(entry.systemId)} | Time: ${this.escapeHtml(entry.timestamp?.toLocaleString?.() || "")}
        ${entry.author ? ` | Author: ${this.escapeHtml(entry.author)}` : ""}
    </div>
    ${htmlContent}
    ${jsFooter}
</body>
</html>`
    }

    // 对其他类型，创建格式化 HTML 视图
    const severityColor =
      entry.severity === "error" ? "#f48771" : entry.severity === "warning" ? "#cca700" : "#75beff"

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            line-height: 1.6;
        }
        .header {
            border-left: 4px solid ${severityColor};
            padding-left: 15px;
            margin-bottom: 20px;
        }
        .title {
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .meta {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            margin-bottom: 5px;
        }
        .summary {
            margin: 20px 0;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
        }
        .raw-data {
            margin-top: 20px;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.85em;
            white-space: pre-wrap;
            overflow-x: auto;
        }
        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">${this.escapeHtml(entry.title)}</div>
        <div class="meta">System: ${this.escapeHtml(entry.systemId)}</div>
        <div class="meta">Feed: ${this.escapeHtml(entry.feedTitle)}</div>
        <div class="meta">Time: ${this.escapeHtml(entry.timestamp?.toLocaleString?.() || "")}</div>
        ${entry.author ? `<div class="meta">Author: ${this.escapeHtml(entry.author)}</div>` : ""}
        ${entry.category ? `<div class="meta">Category: ${this.escapeHtml(entry.category)}</div>` : ""}
    </div>
    
    <div class="summary">
        ${this.escapeHtml(entry.summary)}
    </div>
    
    ${entry.rawData ? `<div class="raw-data">${this.escapeHtml(JSON.stringify(entry.rawData, null, 2))}</div>` : ""}
    
    ${jsFooter}
</body>
</html>`
  }

  /**
   * 转义 HTML
   */
  private escapeHtml(text: string | undefined | null): string {
    if (text === undefined || text === null) return ""
    const str = String(text)
    if (str === undefined || typeof str !== "string") return ""
    return str.replace(/[&<>"']/g, m => {
      const map: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }
      return map[m]
    })
  }

  /**
   * 全部标记为已读
   */
  async markAllAsRead(): Promise<void> {
    await this.stateManager.markAllEntriesAsRead()
    this.refresh()
    // window.showInformationMessage('All feed entries marked as read');
  }

  /**
   * 把 feed 文件夹标记为已读
   */
  async markFeedFolderAsRead(node: any): Promise<void> {
    await this.stateManager.markAllAsRead(node.systemId, node.feedTitle)
    this.refresh()
  }

  /**
   * 删除 feed 条目
   */
  async deleteFeedEntry(node: any): Promise<void> {
    // 同时处理 FeedEntryNode 和普通对象
    const entry = node.entry || node
    await this.stateManager.removeEntry(entry.systemId, entry.feedTitle, entry.id)
    this.refresh()
  }

  /**
   * 清空 feed 文件夹
   */
  async clearFeedFolder(node: any): Promise<void> {
    // 从状态管理器获取条目数
    const entries = this.stateManager.getFeedEntries(node.systemId, node.feedTitle)

    const result = await window.showWarningMessage(
      `Clear all ${entries.length} entries from "${node.feedTitle}"?`,
      "Clear",
      "Cancel"
    )

    if (result === "Clear") {
      await this.stateManager.clearFeedEntries(node.systemId, node.feedTitle)
      this.refresh()
    }
  }

  /**
   * 显示 feed 收件箱，可选导航到特定 feed
   */
  async showFeedInbox(options?: { systemId?: string; feedTitle?: string }): Promise<void> {
    // 刷新树以显示最新数据
    this.refresh()

    // 聚焦 feed 收件箱视图
    try {
      await commands.executeCommand("abapfs.feedInbox.focus")
    } catch {
      // 回退：只显示 ABAP 视图容器
      await commands.executeCommand("workbench.view.extension.abapfs")
    }
  }
}

// 导出单例实例
export let feedInboxProvider: FeedInboxProvider | undefined

export function initializeFeedInboxProvider(stateManager: FeedStateManager): FeedInboxProvider {
  feedInboxProvider = new FeedInboxProvider(stateManager)
  return feedInboxProvider
}
