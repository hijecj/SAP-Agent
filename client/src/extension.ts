import { TransportsProvider } from "./views/transports"
import { FavouritesProvider } from "./views/favourites"
import { atcProvider, registerSCIDecorator } from "./views/abaptestcockpit"
import { FsProvider } from "./fs/FsProvider"
import { AbapFileDecorationProvider } from "./fs/AbapFileDecorationProvider"
import { workspace, ExtensionContext, languages, commands } from "vscode"
import {
  activeTextEditorChangedListener,
  documentChangedListener,
  documentClosedListener,
  documentWillSave,
  restoreLocks
} from "./listeners"
import { PasswordVault, log } from "./lib"
import { LanguageCommands } from "./langClient"
import { registerRevisionModel, AbapRevisionLens } from "./scm/abaprevisions"
import { ClassHierarchyLensProvider } from "./adt/classhierarchy"
import { abapGitProvider } from "./views/abapgit"
import { loadTokens, clearTokens } from "./oauth"
import { registerAbapGit } from "./scm/abapGit"
import { AbapFsApi, api } from "./api"
import { ADTSCHEME, disconnect, hasLocks } from "./adt/conections"
import { MessagesProvider } from "./editors/messages"
import { IncludeProvider } from "./adt/includes"
import { registerCommands } from "./commands/register"
import { HttpProvider } from "./editors/httpprovider"
import { dumpProvider } from "./views/dumps/dumps"
import { registerAbapDebugger } from "./adt/debugger"
import { ATCDocumentation } from "./views/abaptestcockpit/documentation"
import { CommLogPanel } from "./adt/adtCommLog"
import { tracesProvider } from "./views/traces"
import { s4hProvider } from "./views/s4hanaReadiness"
import { FeedStateManager } from "./services/feeds/feedStateManager"
import { FeedPollingService } from "./services/feeds/feedPollingService"
import { initializeFeedInboxProvider } from "./views/feeds/feedInboxView"
import { setContext } from "./context"
import { AbapHoverProviderV2 } from "./providers/hoverProvider"
import { AbapDocumentSymbolProvider } from "./providers/abapDocumentSymbolProvider"
import { registerAllTools } from "./services/lm-tools"
import { registerCleanerCommands, setupCleanerContextMonitoring } from "./services/cleanerCommands"
import { TelemetryService, logTelemetry } from "./services/telemetry"
import { AppInsightsService } from "./services/appInsightsService"
import { MermaidWebviewManager } from "./services/MermaidWebviewManager"
import { DiagramWebviewManager } from "./services/DiagramWebviewManager"
import { SapSystemValidator } from "./services/sapSystemValidator"
import { listAdtFeedsCommand } from "./commands/listAdtFeeds"
import { validateSubagentsOnStartup } from "./services/lm-tools/subagentConfigTool"
import { initializeMcpServer, startMcpServerCommand } from "./services/mcpServer"
import { registerChatTools } from "./adt/ai/tools"
import { initializeEnhancementDecorations } from "./views/enhancementDecorations"
import { initializeBlameGutter } from "./views/blameGutter"
import { clearSystemInfoCache } from "./services/sapSystemInfo"
import { HeartbeatWatchlist } from "./services/heartbeat/heartbeatWatchlist"
import { RapGeneratorPanel } from "./views/rapGenerator/rapGeneratorView"
import { visualizeDependencyGraph } from "./services/dependencyGraph"
import { checkUpgradeNotification } from "./services/upgradeNotification"
import { registerAbapRepl } from "./repl"
import { registerAbapNotebooks } from "./notebooks"
import { showWelcomeWalkthrough } from "./services/walkthroughService"
import { registerVirtualToolsFixOnConnect } from "./services/virtualToolsFix"
import { ObjectPropertyProvider } from "./views/objectProperties"
import { ObjectSearchViewProvider } from "./views/objectSearchView"
import { funWindow as window } from "./services/funMessenger"
import { initializeReviewPrompt } from "./services/reviewPrompt"
import { registerBdefType } from "./adt/operations/BdefCreator"

// 导入命令，确保 @command 装饰器被执行
import "./commands"

export let context: ExtensionContext

// Feed 轮询服务实例（模块级，供停用时引用）
let feedPollingServiceInstance: FeedPollingService | undefined

function checkPasswordsInSettings() {
  setTimeout(
    () => {
      const remotes = workspace.getConfiguration("abapfs")?.get<Record<string, any>>("remote")
      if (!remotes) return
      const systemsWithPasswords = Object.entries(remotes)
        .filter(([_, cfg]) => typeof cfg?.password === "string" && cfg.password.trim().length > 0)
        .map(([name]) => name)
      if (systemsWithPasswords.length > 0) {
        window.showWarningMessage(
          `Security risk: ${systemsWithPasswords.length} SAP connection(s) have passwords stored in plain text settings (${systemsWithPasswords.join(", ")}). ` +
            `Remove them from your settings JSON — ABAP FS will prompt for your password securely when connecting.`
        )
      }
    },
    10 * 60 * 1000
  )
}

export async function activate(ctx: ExtensionContext): Promise<AbapFsApi> {
  context = ctx
  const startTime = new Date().getTime()
  log("🚀 Buckle up buttercup, ABAP FS is waking up from its slumber...")

  // 注册额外的可创建类型
  registerBdefType()

  // 📊 在后台初始化遥测服务，避免阻塞激活
  setImmediate(() => {
    try {
      TelemetryService.initialize(ctx)
      log("📊 Local Telemetry Service initialized")

      // 初始化 App Insights
      AppInsightsService.getInstance(ctx)
      log("📊 App Insights initialization started in background")
    } catch (error) {
      log(`❌ Telemetry Services initialization failed: ${error}`)
    }
  })

  // 🔐 首先初始化 SAP 系统校验器（在任何客户端连接之前）
  try {
    log("🔐 SAP System Validator entering the chat... *cracks knuckles*")
    const validator = SapSystemValidator.getInstance()
    await validator.initialize()
    log("✅ SAP System Validator ready to judge your systems mercilessly")
  } catch (error) {
    log(`❌ SAP System Validator threw a tantrum: ${error} (it's fine, everything is fine 🔥)`)
    // 即使校验器失败也继续激活 - 如果配置了备份白名单，将阻止除备份白名单外的所有连接
  }

  new PasswordVault(ctx)
  loadTokens()
  clearTokens()
  checkPasswordsInSettings()
  const sub = context.subscriptions

  // 🧠 ABAP 智能集成 - 开始
  try {
    log("🧠 ABAP Intelligence features booting up... *elevator music plays*")

    // 初始化悬停提供器
    const hoverProvider = new AbapHoverProviderV2(log)

    // 为 ABAP 注册语言提供器
    const abapSelector = { language: "abap", scheme: "file" }
    const adtSelector = { language: "abap", scheme: ADTSCHEME }
    const cdsSelector = { language: "abap_cds", scheme: ADTSCHEME }

    sub.push(
      languages.registerHoverProvider([abapSelector, adtSelector, cdsSelector], hoverProvider)
    )
    sub.push(
      languages.registerDocumentSymbolProvider([adtSelector], new AbapDocumentSymbolProvider())
    )

    log("✅ ABAP Hover Provider ready to whisper sweet nothings about your code")

    // 注册 ADT Feed 列表命令
    context.subscriptions.push(commands.registerCommand("abapfs.listAdtFeeds", listAdtFeedsCommand))

    const { copilotLogger } = require("./services/abapCopilotLogger")
    copilotLogger.info(
      "Extension",
      "ABAP FS logging initialized - Ready to document your debugging adventures 🗺️"
    )

    // 初始化 MermaidWebviewManager 单例
    MermaidWebviewManager.initialize(context.extensionUri)

    // 初始化 DiagramWebviewManager 单例
    DiagramWebviewManager.initialize(context.extensionUri)
    log("🧜‍♀️ Mermaid Webview Manager ready to make your diagrams prettier than your code")

    // 注册语言模型工具
    await registerAllTools(context)

    // 注册 ABAP Cleaner 功能
    registerCleanerCommands(context)
    setupCleanerContextMonitoring(context)

    // 初始化 ABAP REPL
    registerAbapRepl(context)

    // 初始化 SAP 数据工作簿（.sapwb）
    registerAbapNotebooks(context)

    sub.push(
      commands.registerCommand("abapfs.startMcpServer", () => startMcpServerCommand(context))
    )
    // 延迟校验，让 Copilot 的聊天模型完成加载；否则
    // `selectChatModels({})` 返回空列表并触发误报的 AUTO-DISABLED。
    setTimeout(() => validateSubagentsOnStartup(context), 10000)
    log("🚀 ABAP FS services are GO! Houston, we have liftoff! 🌙")
    // ABAP FS 集成 - 结束
  } catch (error) {
    log(`❌ ABAP Intelligence features had an existential crisis: ${error}`)
    console.error("❌ Failed to activate ABAP Intelligence features:", error)
    window.showErrorMessage(`Failed to activate ABAP Intelligence features: ${error}`)
  }
  // ABAP 智能集成 - 结束

  // 注册文件系统类型
  sub.push(
    workspace.registerFileSystemProvider(ADTSCHEME, FsProvider.get(ctx), {
      isCaseSensitive: true
    })
  )

  // adt:// 树项目的动态提示（使用已加载的任何元数据）
  const abapFileDecorationProvider = new AbapFileDecorationProvider()
  sub.push(abapFileDecorationProvider)
  sub.push(window.registerFileDecorationProvider(abapFileDecorationProvider))

  // 文档变更监听器，用于锁定
  sub.push(workspace.onDidChangeTextDocument(documentChangedListener))
  sub.push(workspace.onWillSaveTextDocument(documentWillSave))
  // 文档关闭监听器，用于锁定
  sub.push(workspace.onDidCloseTextDocument(documentClosedListener))
  // 编辑器变更监听器，更新上下文和图标
  sub.push(window.onDidChangeActiveTextEditor(activeTextEditorChangedListener))

  registerRevisionModel(context)

  const fav = FavouritesProvider.get()
  fav.storagePath = context.globalStoragePath
  const objectPropertyProvider = ObjectPropertyProvider.get()
  sub.push(window.registerTreeDataProvider("abapfs.favorites", fav))
  sub.push(window.registerTreeDataProvider("abapfs.transports", TransportsProvider.get()))
  sub.push(window.registerTreeDataProvider("abapfs.abapgit", abapGitProvider))
  sub.push(window.registerTreeDataProvider("abapfs.dumps", dumpProvider))
  sub.push(window.registerTreeDataProvider("abapfs.atcFinds", atcProvider))
  sub.push(window.registerTreeDataProvider("abapfs.traces", tracesProvider))
  sub.push(window.registerTreeDataProvider("abapfs.s4hReadiness", s4hProvider))
  sub.push(window.registerWebviewViewProvider(RapGeneratorPanel.viewType, RapGeneratorPanel.get()))
  const objectPropertyView = window.createTreeView("abapfs.objectProperty", {
    treeDataProvider: objectPropertyProvider,
    showCollapseAll: false,
    canSelectMany: false
  })
  objectPropertyProvider.bindView(objectPropertyView)
  sub.push(objectPropertyProvider)
  sub.push(objectPropertyView)

  // 初始化 Feed 状态管理器和轮询服务
  const feedStateManager = new FeedStateManager(context)
  feedPollingServiceInstance = new FeedPollingService(context, feedStateManager)
  const feedInboxProvider = initializeFeedInboxProvider(feedStateManager)
  sub.push(window.registerTreeDataProvider("abapfs.feedInbox", feedInboxProvider))

  // 把轮询服务连接到树视图以便刷新
  feedPollingServiceInstance.setOnEntriesChanged(() => {
    feedInboxProvider.refresh()
  })

  // 启动 Feed 轮询服务
  await feedPollingServiceInstance.start()

  // 注册 Feed 收件箱命令
  sub.push(
    commands.registerCommand("abapfs.refreshFeedInbox", () => {
      feedInboxProvider.refresh()
    })
  )

  sub.push(
    commands.registerCommand(
      "abapfs.showFeedInbox",
      (options?: { systemId?: string; feedTitle?: string }) => {
        feedInboxProvider.showFeedInbox(options)
      }
    )
  )

  sub.push(
    commands.registerCommand("abapfs.markAllFeedsRead", () => {
      feedInboxProvider.markAllAsRead()
    })
  )

  sub.push(
    commands.registerCommand("abapfs.markFeedFolderRead", (node: any) => {
      feedInboxProvider.markFeedFolderAsRead(node)
    })
  )

  sub.push(
    commands.registerCommand("abapfs.deleteFeedEntry", (node: any) => {
      feedInboxProvider.deleteFeedEntry(node)
    })
  )

  sub.push(
    commands.registerCommand("abapfs.clearFeedFolder", (node: any) => {
      feedInboxProvider.clearFeedFolder(node)
    })
  )

  sub.push(
    commands.registerCommand("abapfs.viewFeedEntry", (node: any) => {
      feedInboxProvider.viewFeedEntry(node)
    })
  )
  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      ClassHierarchyLensProvider.get()
    )
  )
  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      AbapRevisionLens.get()
    )
  )

  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      IncludeProvider.get()
    )
  )

  sub.push(window.registerWebviewViewProvider(ATCDocumentation.viewType, ATCDocumentation.get()))
  sub.push(window.registerWebviewViewProvider(CommLogPanel.viewType, CommLogPanel.get()))
  sub.push(
    window.registerWebviewViewProvider(
      ObjectSearchViewProvider.viewType,
      ObjectSearchViewProvider.get()
    )
  )

  sub.push(MessagesProvider.register(context))
  sub.push(HttpProvider.register(context))
  registerAbapDebugger(context)

  LanguageCommands.start(context)

  setContext("abapfs:extensionActive", true)
  setContext(
    "abapfs:noSapConnected",
    !(workspace.workspaceFolders?.some(f => f.uri.scheme === ADTSCHEME) ?? false)
  )
  sub.push(
    workspace.onDidChangeWorkspaceFolders(() => {
      setContext(
        "abapfs:noSapConnected",
        !(workspace.workspaceFolders?.some(f => f.uri.scheme === ADTSCHEME) ?? false)
      )
    })
  )
  restoreLocks()
  registerAbapGit(context)

  registerCommands(context)

  // 📊 注册依赖关系图命令
  try {
    context.subscriptions.push(
      commands.registerCommand("abapfs.visualizeDependencyGraph", () => {
        logTelemetry("command_dependency_graph_called")
        return visualizeDependencyGraph()
      })
    )
    log("📊 Dependency graph ready to expose your spaghetti architecture 🍝")
  } catch (error) {
    log(`⚠️ Dependency graph said 'I can\'t even': ${error}`)
  }

  // 💓 注册心跳命令
  try {
    context.subscriptions.push(
      commands.registerCommand("abapfs.openHeartbeatJson", async () => {
        logTelemetry("command_open_heartbeat_json_called")
        const filePath = HeartbeatWatchlist.getFilePath()
        if (filePath) {
          const doc = await workspace.openTextDocument(filePath)
          await window.showTextDocument(doc)
        } else {
          window.showWarningMessage(
            "No heartbeat.json file found. Open a folder-based workspace first."
          )
        }
      })
    )
    log("💓 Heartbeat watchlist command registered - Your personal SAP nanny awaits")
  } catch (error) {
    log(`⚠️ Heartbeat command registration failed: ${error}`)
  }

  registerSCIDecorator(context)

  // 🎯 初始化增强装饰标记
  try {
    initializeEnhancementDecorations(context)
    log("🎯 Enhancement decorations initialized - Making your code look fancy since 2024")
  } catch (error) {
    log(
      `⚠️ Enhancement decorations refused to cooperate: ${error} (they're artists, they're temperamental)`
    )
  }

  // 📋 初始化 Blame 侧边注释
  try {
    initializeBlameGutter(context)
    log("📋 Blame gutter initialized — Ready to point fingers at your colleagues' code")
  } catch (error) {
    log(`⚠️ Blame gutter initialization failed: ${error}`)
  }
  registerChatTools(context)

  // 引导辅助：打开带预填查询的 Copilot 聊天
  sub.push(
    commands.registerCommand("abapfs.openChatWithQuery", (query: string) => {
      commands.executeCommand("workbench.action.chat.open", {
        query,
        isPartialQuery: true
      })
    })
  )

  // 检查 v1 → v2 升级并显示通知 + 状态栏提示
  checkUpgradeNotification(context)

  // 首次安装时显示入门引导
  showWelcomeWalkthrough(context)

  // 初始化评分提示（持续使用后在 Marketplace 评分）
  try {
    initializeReviewPrompt(context)
  } catch {
    // 非关键 — 绝不中断扩展激活
  }

  // 注册虚拟工具修复 — 在首次 SAP 连接时触发一次，而不是激活时
  registerVirtualToolsFixOnConnect(context)

  // 最后初始化 MCP 服务器，确保所有 LM 工具、上下文键和提供器
  // 在任何等待中的 MCP 客户端（Claude Code、Cursor 等）
  // 连接并枚举 vscode.lm.tools 之前已全部注册。
  try {
    await initializeMcpServer(context)
  } catch (error) {
    log(`⚠️ MCP server initialization failed: ${error}`)
  }

  const elapsed = new Date().getTime() - startTime
  log.debug(`Activated,pid=${process.pid}, activation time(ms):${elapsed}`)
  return api
}

// 扩展停用时调用此方法
// 终止这些会话很重要，因为 ABAP 端可能有打开的进程
// 最常见的原因是源码被锁定。
// 锁在显式关闭或会话终止之前不会释放
// 打开的会话可能让源码保持锁定，且没有任何界面能释放它们（SM12 等除外）
export async function deactivate() {
  if (hasLocks())
    window.showInformationMessage(
      "Locks will be dropped now. If the relevant editors are still open they will be restored later"
    )
  setContext("abapfs:extensionActive", false)

  // 停止 Feed 轮询服务
  if (feedPollingServiceInstance) {
    feedPollingServiceInstance.stop()
    log("📰 Feed polling service stopped - No more news is good news, right?")
  }

  // 清除 SAP 系统信息缓存
  try {
    clearSystemInfoCache()
    log("🧹 SAP system info cache cleared - It's like it never happened *whistles innocently*")
  } catch (e) {
    // 忽略 - 服务可能未加载
  }

  return disconnect()
}
