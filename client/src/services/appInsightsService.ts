/**
 * Application Insights 服务
 * 处理遥测数据解析并发送到 Application Insights
 */

import * as vscode from "vscode"
import * as os from "os"
import * as crypto from "crypto"
import { log } from "../lib"

// 只在启用遥测时惰性导入 Application Insights SDK
let appInsights: any = null

interface ParsedTelemetry {
  type: "command" | "tool" | "code_change" | "unknown"
  name?: string
  linesChanged?: number
}

export class AppInsightsService {
  private static instance: AppInsightsService
  private isInitialized: boolean = false
  private sessionId: string
  private userId: string
  private version: string

  private constructor(context: vscode.ExtensionContext) {
    // 用加密安全的随机 UUID 生成会话 ID
    this.sessionId = `session-${Date.now()}-${crypto.randomUUID()}`

    // 生成匿名用户 ID（机器信息的哈希）
    const machineInfo = `${os.hostname()}-${os.userInfo().username}-${os.platform()}`
    this.userId = `user-${crypto.createHash("sha256").update(machineInfo).digest("hex").substring(0, 16)}`

    // 获取扩展版本
    this.version =
      vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")?.packageJSON?.version ||
      "unknown"

    // 延迟初始化，避免阻塞主扩展激活流程
    setImmediate(() => this.initialize())

    // 在扩展停用时注册清理（与本地遥测相同模式）
    context.subscriptions.push(
      new vscode.Disposable(() => {
        this.flush()
      })
    )
  }

  public static getInstance(context?: vscode.ExtensionContext): AppInsightsService {
    if (!AppInsightsService.instance) {
      if (!context) {
        throw new Error("AppInsightsService requires ExtensionContext for initialization")
      }
      AppInsightsService.instance = new AppInsightsService(context)
    }
    return AppInsightsService.instance
  }

  private initialize(): void {
    try {
      // 尊重 VS Code 遥测设置
      if (!vscode.env.isTelemetryEnabled) {
        log("AppInsights: Telemetry is disabled in VS Code settings, skipping initialization")
        return
      }

      const connectionString = "your-key-here"

      if (!connectionString || connectionString.includes("your-key-here")) {
        log("AppInsights: Connection string not configured, skipping initialization")
        return
      }

      // 只在确定要初始化时才惰性加载 SDK
      if (!appInsights) {
        log("AppInsights: Loading SDK...")
        appInsights = require("applicationinsights")
      }

      // 为云角色信息设置环境变量（新版 SDK 的推荐方式）
      process.env.WEBSITE_SITE_NAME = "abap-copilot-extension"
      process.env.WEBSITE_INSTANCE_ID = "anonymous"

      // 用最小自动收集设置 Application Insights
      appInsights
        .setup(connectionString)
        .setAutoCollectRequests(false) // Disable - we'll track manually
        .setAutoCollectPerformance(false, false) // Disable - we'll track manually
        .setAutoCollectExceptions(false) // 禁用 - 防止记录内部超时错误
        .setAutoCollectDependencies(false) // Disable - we'll track manually
        .setAutoCollectConsole(false) // Disable - we don't want console logs
        .setUseDiskRetryCaching(true) // 保留 - 有助于连接
        .setSendLiveMetrics(false) // Disable - we don't need live metrics
        .setAutoDependencyCorrelation(false) // 禁用 - 阻止 CorrelationIdManager 启动
        .setInternalLogging(false, false) // 禁用内部日志，避免阻塞和控制台刷屏

      // 启动 Application Insights
      appInsights.start()

      // 设置自定义刷新间隔为 30 秒
      appInsights.defaultClient.config.maxBatchIntervalMs = 30000 // 30 秒

      // 禁用附加自动收集功能和关联管理
      appInsights.defaultClient.config.enableAutoCollectConsole = false
      appInsights.defaultClient.config.enableAutoCollectDependencies = false
      appInsights.defaultClient.config.enableAutoCollectExceptions = false
      appInsights.defaultClient.config.enableAutoCollectPerformance = false
      appInsights.defaultClient.config.enableAutoCollectRequests = false
      appInsights.defaultClient.config.enableAutoDependencyCorrelation = false // 禁用关联以加速冷启动

      // 为所有遥测设置全局属性
      appInsights.defaultClient.commonProperties = {
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch(),
        userId: this.userId,
        sessionId: this.sessionId
      }

      this.isInitialized = true
    } catch (error) {
      console.error("AppInsights: Failed to initialize:", error)
    }
  }

  /**
   * 通过解析操作文本来跟踪遥测事件
   */
  public track(
    action: string,
    options?: {
      connectionId?: string
      activeEditor?: vscode.TextEditor
      username?: string
    }
  ): void {
    if (!this.isInitialized) return

    try {
      const parsed = this.parseTelemetryText(action)

      // 按优先级获取用户映射：username → connectionId → activeEditor → settings
      const userMapping = this.getUserMapping(options)

      switch (parsed.type) {
        case "command":
          this.trackCommand(parsed.name!, action, userMapping)
          break
        case "tool":
          this.trackTool(parsed.name!, action, userMapping)
          break
        case "code_change":
          this.trackCodeChange(parsed.linesChanged!, action, userMapping)
          break
        default:
          this.trackGeneric(action, userMapping)
          break
      }
    } catch (error) {
      console.error("AppInsights: Failed to track event:", error)
    }
  }

  /**
   * 按优先级获取用户映射：username → connectionId → activeEditor → settings
   */
  private getUserMapping(options?: {
    connectionId?: string
    activeEditor?: vscode.TextEditor
    username?: string
  }): { uniqueId: string; manager: string; sapSystem: string } | null {
    try {
      // 动态导入 SapSystemValidator 以避免循环依赖
      const { SapSystemValidator } = require("./sapSystemValidator")
      const validator = SapSystemValidator.getInstance()

      let username: string | null = null
      let connectionId: string | null = null

      // 优先级 1：直接用户名
      if (options?.username) {
        username = options.username
      }
      // 优先级 2：从 connectionId 获取用户名（转小写保持一致）
      else if (options?.connectionId) {
        const normalizedConnectionId = options.connectionId.toLowerCase()
        connectionId = normalizedConnectionId
        username = this.getUsernameFromConnectionId(normalizedConnectionId)
      }
      // 优先级 3：从 activeEditor 获取用户名（转小写保持一致）
      else if (options?.activeEditor && options.activeEditor.document.uri.scheme === "adt") {
        const editorConnectionId = options.activeEditor.document.uri.authority.toLowerCase()
        connectionId = editorConnectionId
        username = this.getUsernameFromConnectionId(editorConnectionId)
      }
      // 优先级 4：从 VS Code 设置获取（备份）
      else {
        username = this.getUsernameFromSettings()
      }

      if (!username) {
        log(`❌ getUserMapping: No username found, returning null`)
        return null
      }

      const mapping = validator.getUserMapping(username)
      const sapSystem = connectionId || "generic"
      return mapping ? { ...mapping, sapSystem } : null
    } catch (error) {
      log(`❌ getUserMapping: Error occurred: ${error}`)
      return null
    }
  }

  /**
   * 用 RemoteManager 从连接 ID 获取用户名
   */
  private getUsernameFromConnectionId(connectionId: string): string | null {
    try {
      const { RemoteManager } = require("../config")
      const manager = RemoteManager.get()
      const connection = manager.byId(connectionId)
      return connection?.username || null
    } catch (error) {
      return null
    }
  }

  /**
   * 从 VS Code 设置获取用户名（备份方法）
   */
  private getUsernameFromSettings(): string | null {
    try {
      const { RemoteManager } = require("../config")
      const manager = RemoteManager.get()
      const connections = manager.remoteList()
      return connections.length > 0 ? connections[0].username : null
    } catch (error) {
      return null
    }
  }

  /**
   * 解析遥测文本以提取结构化数据
   */
  private parseTelemetryText(action: string): ParsedTelemetry {
    // 命令："command_xxx_called"
    if (action.startsWith("command_") && action.endsWith("_called")) {
      const name = action.replace("command_", "").replace("_called", "")
      return { type: "command", name }
    }

    // 工具："tool_yyy_called"
    if (action.startsWith("tool_") && action.endsWith("_called")) {
      const name = action.replace("tool_", "").replace("_called", "")
      return { type: "tool", name }
    }

    // 代码更改："Number of code lines changed: xxx"
    if (action.startsWith("Number of code lines changed: ")) {
      const linesStr = action.replace("Number of code lines changed: ", "")
      const lines = parseInt(linesStr, 10)
      if (!isNaN(lines)) {
        return { type: "code_change", linesChanged: lines }
      }
    }

    return { type: "unknown" }
  }

  /**
   * 跟踪命令执行
   */
  private trackCommand(
    commandName: string,
    originalAction: string,
    userMapping: { uniqueId: string; manager: string; sapSystem: string } | null
  ): void {
    const userId = userMapping?.uniqueId || this.userId
    const manager = userMapping?.manager || "Unknown"
    const sapSystem = userMapping?.sapSystem || "generic"

    appInsights.defaultClient.trackEvent({
      name: "command_executed",
      properties: {
        commandName: commandName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        originalAction: originalAction,
        // 全局属性
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    })

    // 同时作为计数指标跟踪
    appInsights.defaultClient.trackMetric({
      name: "command_usage_count",
      value: 1,
      properties: {
        commandName: commandName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    })
  }

  /**
   * 跟踪工具执行
   */
  private trackTool(
    toolName: string,
    originalAction: string,
    userMapping: { uniqueId: string; manager: string; sapSystem: string } | null
  ): void {
    const userId = userMapping?.uniqueId || this.userId
    const manager = userMapping?.manager || "Unknown"
    const sapSystem = userMapping?.sapSystem || "generic"

    appInsights.defaultClient.trackEvent({
      name: "tool_executed",
      properties: {
        toolName: toolName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        originalAction: originalAction,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    })

    // 同时作为计数指标跟踪
    appInsights.defaultClient.trackMetric({
      name: "tool_usage_count",
      value: 1,
      properties: {
        toolName: toolName,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    })
  }

  /**
   * 跟踪代码更改
   */
  private trackCodeChange(
    linesChanged: number,
    originalAction: string,
    userMapping: { uniqueId: string; manager: string; sapSystem: string } | null
  ): void {
    const userId = userMapping?.uniqueId || this.userId
    const manager = userMapping?.manager || "Unknown"
    const sapSystem = userMapping?.sapSystem || "generic"

    appInsights.defaultClient.trackEvent({
      name: "code_changed",
      properties: {
        changeType: "copilot",
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        originalAction: originalAction,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      },
      measurements: {
        linesChanged: linesChanged
      }
    })

    // 同时作为计数指标跟踪
    appInsights.defaultClient.trackMetric({
      name: "code_changes_count",
      value: linesChanged,
      properties: {
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    })
  }

  /**
   * 跟踪通用/未知事件
   */
  private trackGeneric(
    action: string,
    userMapping: { uniqueId: string; manager: string; sapSystem: string } | null
  ): void {
    const userId = userMapping?.uniqueId || this.userId
    const manager = userMapping?.manager || "Unknown"
    const sapSystem = userMapping?.sapSystem || "generic"

    appInsights.defaultClient.trackEvent({
      name: "generic_event",
      properties: {
        action: action,
        userId: userId,
        manager: manager,
        sap_system: sapSystem,
        sessionId: this.sessionId,
        // Global properties
        extensionVersion: this.version,
        vscodeVersion: vscode.version,
        platform: os.platform(),
        architecture: os.arch()
      }
    })
  }

  /**
   * 刷新所有待处理的遥测
   */
  public flush(): void {
    if (!this.isInitialized) return

    try {
      appInsights.defaultClient.flush()
    } catch (error) {
      console.error("AppInsights: Failed to flush:", error)
    }
  }
}
