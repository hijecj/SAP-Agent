import { ViewColumn, workspace, WebviewPanel } from "vscode"
import { funWindow as window } from "../services/funMessenger"
import { connectedRoots } from "../config"
import { getOrCreateClient } from "../adt/conections"
import { toFeedMetadata } from "../services/feeds/feedParsers"
import { FeedSubscriptions, SystemFeedConfig } from "../services/feeds/feedTypes"
import { context } from "../extension"
import * as path from "path"
import * as fs from "fs"
import { logTelemetry } from "../services/telemetry"

let currentPanel: WebviewPanel | undefined

export async function configureFeedsCommand() {
  logTelemetry("command_configure_feeds_called")
  // 如果面板已存在且未销毁，显示它
  if (currentPanel) {
    try {
      currentPanel.reveal(ViewColumn.Active)
      return
    } catch {
      // 面板已销毁，创建新的
      currentPanel = undefined
    }
  }

  // 创建 Webview 面板
  currentPanel = window.createWebviewPanel(
    "feedConfiguration",
    "📡 Feed Configuration",
    ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: []
    }
  )

  // 从扩展 dist 文件夹加载 HTML 内容
  const htmlPath = path.join(
    context.extensionPath,
    "client",
    "dist",
    "media",
    "feedConfiguration.html"
  )
  let htmlContent = fs.readFileSync(htmlPath, "utf8")

  currentPanel.webview.html = htmlContent

  // 处理来自 Webview 的消息
  currentPanel.webview.onDidReceiveMessage(
    async message => {
      switch (message.command) {
        case "loadSystems":
          await handleLoadSystems()
          break

        case "loadFeeds":
          await handleLoadFeeds(message.data.systemId)
          break

        case "saveConfig":
          await handleSaveConfig(message.data.systemId, message.data.config)
          break

        case "bulkAction":
          // 批量操作在 Webview 中处理
          break
      }
    },
    undefined,
    []
  )

  // 面板销毁时清理
  currentPanel.onDidDispose(
    () => {
      currentPanel = undefined
    },
    null,
    []
  )
}

/**
 * 处理加载系统请求
 */
async function handleLoadSystems(): Promise<void> {
  try {
    const systems = Array.from(connectedRoots().keys())

    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: "systemsLoaded",
        data: systems
      })
    }
  } catch (error) {
    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: "error",
        data: `Failed to load systems: ${error}`
      })
    }
  }
}

/**
 * 处理加载 feed 请求
 */
async function handleLoadFeeds(systemId: string): Promise<void> {
  try {
    // 获取此系统的客户端
    const client = await getOrCreateClient(systemId)

    // 获取可用的 feed
    const feeds = await client.feeds()
    const feedMetadata = feeds.map(toFeedMetadata)

    // 从设置获取现有配置
    const config = workspace.getConfiguration()
    const subscriptions = config.get<FeedSubscriptions>("abapfs.feedSubscriptions", {})
    const systemConfig = subscriptions[systemId] || {}

    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: "feedsLoaded",
        data: {
          feeds: feedMetadata,
          config: systemConfig
        }
      })
    }
  } catch (error) {
    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: "error",
        data: `Failed to load feeds for ${systemId}: ${error}`
      })
    }
  }
}

/**
 * 处理保存配置请求
 */
async function handleSaveConfig(systemId: string, systemConfig: SystemFeedConfig): Promise<void> {
  try {
    // 获取现有订阅
    const config = workspace.getConfiguration()
    const subscriptions = config.get<FeedSubscriptions>("abapfs.feedSubscriptions", {})

    // 更新此系统的配置
    subscriptions[systemId] = systemConfig

    // 保存到工作区配置
    await config.update("abapfs.feedSubscriptions", subscriptions, true)

    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: "saveSuccess"
      })
    }

    window.showInformationMessage(
      `Feed configuration saved for ${systemId}. Polling service will restart automatically.`
    )
  } catch (error) {
    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: "saveError",
        data: String(error)
      })
    }
  }
}
