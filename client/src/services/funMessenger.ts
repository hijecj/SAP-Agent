/**
 * 趣味信使 - 运行时消息增强
 *
 * 自动让消息更有趣，无需更改每个调用点
 */

import * as vscode from "vscode"

// ============================================================================
// 消息模式与检测
// ============================================================================

const PATTERNS = {
  // 来自实际消息的成功模式（分析了 177 条消息）
  success:
    /(?:✅|successfully|success|saved|completed|refreshed|added|updated|deleted|loaded|activated|connected|disconnected|cleared|exported|generated|passed|done|ready|clean|already clean)/i,

  // 来自实际消息的错误模式
  error:
    /(?:❌|⚠️|failed|fail|failure|error|exception|cannot|unable|could not|not found|invalid|no active|no adt|no abap|no connection|only works|ABAP file|missing|denied|errors during)/i,

  // 警告模式
  warning: /(?:⚠️|warning|caution|note|attention|please|multiple|already exists|already running)/i,

  // 操作专属模式
  activation: /activat(?:e|ed|ing)/i,
  connection: /connect(?:ed|ing|ion)?|disconnect/i,
  saved: /sav(?:e|ed|ing)/i,
  test: /test(?:s|ing)?|unit test/i,
  search: /search|find|found|hunting/i,
  creation: /creat(?:e|ed|ing)|generat(?:e|ed|ing)|add(?:ed|ing)/i,
  deletion: /delet(?:e|ed|ing)|remov(?:e|ed|ing)/i,
  refresh: /refresh(?:ed|ing)?|reload/i,
  open: /open(?:ed|ing)?/i,
  gui: /gui|webview|browser|sap gui/i,
  transport: /transport/i,
  cleaner: /clean|abap cleaner/i,
  whitelist: /whitelist/i,
  feed: /feed/i
}

const FUN_PREFIXES = {
  success: [
    "🎉 Boom! ",
    "✨ Nailed it! ",
    "🚀 Success! ",
    "💪 Crushing it! ",
    "🎯 Bullseye! ",
    "⚡ Lightning fast! ",
    "🌟 Flawless victory! ",
    "💎 Pure gold! ",
    "🏆 Champion move! ",
    "🎊 Fantastic! ",
    "👌 Perfection! ",
    "🔥 On fire! ",
    "💯 Perfect score! ",
    "🎖️ Mission accomplished! ",
    "⭐ Stellar! ",
    "🌈 Beautiful! ",
    "🎪 Ta-da! ",
    "🎭 Bravo! ",
    "🎺 Fanfare! ",
    "🥇 Gold medal! "
  ],
  error: [
    "🚨 Houston, we have a problem... ",
    "😅 Whoopsie daisy! ",
    "🙈 Uh oh, spaghetti-o! ",
    "🤔 Well, that's awkward... ",
    "😬 Yikes on bikes! ",
    "🛑 Nope, not today! ",
    "💥 Plot twist! ",
    "🤷 Computer says no... ",
    "😵 That escalated quickly! ",
    "🎢 Unexpected detour! ",
    "🎪 Circus error! ",
    "🌪️ Oops tornado! ",
    "🎲 Snake eyes! ",
    "🔥 Dumpster fire alert! ",
    "🚧 Road closed! ",
    "🎯 Missed the target! ",
    "🌊 Drowning in errors! "
  ],
  warning: [
    "⚠️ Heads up! ",
    "👀 Psst, listen... ",
    "💡 Pro tip: ",
    "📌 Note to self: ",
    "🔔 Ding ding! ",
    "📣 Attention please! ",
    "🎯 Friendly reminder: ",
    "🚦 Yellow light! ",
    "👉 By the way... ",
    "🔊 Announcement: "
  ],
  activation: [
    "🚀 Engage! ",
    "⚡ Energizing... ",
    "✨ Activating awesomeness... ",
    "🔮 Summoning magic... ",
    "💫 Booting up brilliance... ",
    "🎯 Deploying code... ",
    "🏗️ Building greatness... ",
    "🛸 Beam me up, Scotty! ",
    "⚙️ Spinning up... ",
    "🎬 Lights, camera, activation! ",
    "🎪 Showtime! ",
    "🔋 Charging... ",
    "🌟 Powering up! ",
    "🎮 Game on! "
  ],
  test: [
    "🧪 Mixing potions... ",
    "🔬 Science time! ",
    "🎯 Testing, testing, 1-2-3... ",
    "🧬 Running diagnostics... ",
    "🎪 Quality check in progress... ",
    "🔍 Investigating... ",
    "🎲 Rolling the dice... ",
    "🧙 Casting test spells... ",
    "🎭 Rehearsing... "
  ],
  search: [
    "🔍 Sherlock mode activated... ",
    "🕵️ On the hunt... ",
    "🗺️ Treasure hunting... ",
    "🎯 Target locked... ",
    "🔭 Scanning the horizon... ",
    "🧭 Navigating... ",
    "🎪 Seeking... ",
    "👁️ Eagle eye engaged... ",
    "🐕 Sniffing out... "
  ],
  connection: [
    "🔌 Plugging in... ",
    "🌐 Dialing up... ",
    "📡 Establishing signal... ",
    "🛰️ Connecting to mothership... ",
    "🎮 Player 2 joining... ",
    "🌉 Building bridges... ",
    "🔗 Linking up... ",
    "📞 Calling home... ",
    "🎪 Syncing... "
  ],
  saved: [
    "💾 Committed! ",
    "✅ Locked in! ",
    "📝 Written to history! ",
    "🏦 Deposited! ",
    "🎯 Captured! ",
    "🔒 Secured! ",
    "📦 Packaged! ",
    "🎪 Preserved! "
  ],
  refresh: [
    "🔄 Refreshing like a morning breeze... ",
    "⚡ Zap! Reloading... ",
    "🌊 Splashing new data... ",
    "🎪 Updating the show... ",
    "🔮 Renewing the magic... ",
    "🎯 Syncing reality... "
  ],
  gui: [
    "🖥️ Opening portal... ",
    "🌐 Launching rocket... ",
    "🎪 Starting the show... ",
    "🚪 Opening doors... ",
    "🎬 Rolling film... ",
    "🎮 Loading level... "
  ],
  creation: [
    "🎨 Painting masterpiece... ",
    "✨ Conjuring from thin air... ",
    "🏗️ Building blocks... ",
    "🎪 Manufacturing magic... ",
    "🔨 Forging... ",
    "🎯 Materializing... ",
    "🌱 Sprouting... "
  ]
}

// ============================================================================
// 消息类型检测
// ============================================================================

function detectMessageType(message: string): string {
  const msg = message.toLowerCase()

  // 先检查更具体的模式（顺序很重要！）
  // 先检查成功/错误/警告，再检查操作专属模式
  if (PATTERNS.success.test(msg)) return "success"
  if (PATTERNS.error.test(msg)) return "error"
  if (PATTERNS.warning.test(msg)) return "warning"

  // 然后检查操作专属模式
  if (PATTERNS.activation.test(msg)) return "activation"
  if (PATTERNS.test.test(msg)) return "test"
  if (PATTERNS.search.test(msg)) return "search"
  if (PATTERNS.connection.test(msg)) return "connection"
  if (PATTERNS.saved.test(msg)) return "saved"
  if (PATTERNS.refresh.test(msg)) return "refresh"
  if (PATTERNS.gui.test(msg)) return "gui"
  if (PATTERNS.creation.test(msg)) return "creation"

  return "normal"
}

function getRandom<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

// ============================================================================
// 消息增强
// ============================================================================

/**
 * 检查是否启用了专业通知模式
 */
function isProfessionalMode(): boolean {
  const config = vscode.workspace.getConfiguration("abapfs.copilot")
  return config.get("professionalNotifications", false)
}

function enhanceMessage(message: string, type: "info" | "error" | "warning"): string {
  // 启用专业模式时跳过增强
  if (isProfessionalMode()) {
    return message
  }

  const msgType = detectMessageType(message)

  // 按检测到的类型添加趣味前缀
  const prefixMap: Record<string, string[]> = {
    success: FUN_PREFIXES.success,
    activation: FUN_PREFIXES.activation,
    test: FUN_PREFIXES.test,
    search: FUN_PREFIXES.search,
    connection: FUN_PREFIXES.connection,
    saved: FUN_PREFIXES.saved,
    refresh: FUN_PREFIXES.refresh,
    gui: FUN_PREFIXES.gui,
    creation: FUN_PREFIXES.creation,
    error: FUN_PREFIXES.error,
    warning: FUN_PREFIXES.warning
  }

  // 先尝试获取检测到的消息类型的前缀
  let prefixes = prefixMap[msgType]

  // 未检测到特定类型时，回退到类型参数
  if (!prefixes || prefixes.length === 0) {
    prefixes = prefixMap[type] || []
  }

  if (prefixes && prefixes.length > 0) {
    return getRandom(prefixes) + message
  }

  return message
}

// ============================================================================
// 包装的窗口函数
// ============================================================================

export const funWindow = {
  showInformationMessage: (message: string, ...items: any[]) => {
    const enhanced = enhanceMessage(message, "info")
    return vscode.window.showInformationMessage(enhanced, ...items)
  },

  showErrorMessage: (message: string, ...items: any[]) => {
    const enhanced = enhanceMessage(message, "error")
    return vscode.window.showErrorMessage(enhanced, ...items)
  },

  showWarningMessage: (message: string, ...items: any[]) => {
    const enhanced = enhanceMessage(message, "warning")
    return vscode.window.showWarningMessage(enhanced, ...items)
  },

  setStatusBarMessage: (message: string, hideAfterTimeout?: number | Thenable<any>) => {
    const enhanced = enhanceMessage(message, "info")
    return vscode.window.setStatusBarMessage(enhanced, hideAfterTimeout as any)
  },

  // 增强的 withProgress，向进度标题添加趣味消息
  withProgress: <R>(
    options: vscode.ProgressOptions,
    task: (
      progress: vscode.Progress<{ message?: string; increment?: number }>,
      token: vscode.CancellationToken
    ) => Thenable<R>
  ): Thenable<R> => {
    const enhancedOptions = {
      ...options,
      title: options.title ? enhanceMessage(options.title, "info") : options.title
    }
    return vscode.window.withProgress(enhancedOptions, task)
  },

  // 全面窗口 API 的直通（使用 getter 处理动态属性）
  createOutputChannel: vscode.window.createOutputChannel,
  showQuickPick: vscode.window.showQuickPick,
  showInputBox: vscode.window.showInputBox,
  showOpenDialog: vscode.window.showOpenDialog,
  showSaveDialog: vscode.window.showSaveDialog,
  get activeTextEditor() {
    return vscode.window.activeTextEditor
  },
  get visibleTextEditors() {
    return vscode.window.visibleTextEditors
  },
  get state() {
    return vscode.window.state
  },
  get activeNotebookEditor() {
    return vscode.window.activeNotebookEditor
  },
  get visibleNotebookEditors() {
    return vscode.window.visibleNotebookEditors
  },
  get activeTerminal() {
    return vscode.window.activeTerminal
  },
  get terminals() {
    return vscode.window.terminals
  },
  get tabGroups() {
    return vscode.window.tabGroups
  },
  showTextDocument: vscode.window.showTextDocument,
  showNotebookDocument: vscode.window.showNotebookDocument,
  createQuickPick: vscode.window.createQuickPick,
  createInputBox: vscode.window.createInputBox,
  createTreeView: vscode.window.createTreeView,
  createTerminal: vscode.window.createTerminal,
  createTextEditorDecorationType: vscode.window.createTextEditorDecorationType,
  createWebviewPanel: vscode.window.createWebviewPanel,
  createStatusBarItem: vscode.window.createStatusBarItem,
  registerTreeDataProvider: vscode.window.registerTreeDataProvider,
  registerWebviewViewProvider: vscode.window.registerWebviewViewProvider,
  registerWebviewPanelSerializer: vscode.window.registerWebviewPanelSerializer,
  registerCustomEditorProvider: vscode.window.registerCustomEditorProvider,
  registerTerminalLinkProvider: vscode.window.registerTerminalLinkProvider,
  registerTerminalProfileProvider: vscode.window.registerTerminalProfileProvider,
  registerFileDecorationProvider: vscode.window.registerFileDecorationProvider,
  onDidChangeActiveTextEditor: vscode.window.onDidChangeActiveTextEditor,
  onDidChangeActiveNotebookEditor: vscode.window.onDidChangeActiveNotebookEditor,
  onDidChangeVisibleNotebookEditors: vscode.window.onDidChangeVisibleNotebookEditors,
  onDidChangeVisibleTextEditors: vscode.window.onDidChangeVisibleTextEditors,
  onDidChangeTextEditorSelection: vscode.window.onDidChangeTextEditorSelection,
  onDidChangeTextEditorVisibleRanges: vscode.window.onDidChangeTextEditorVisibleRanges,
  onDidChangeTextEditorOptions: vscode.window.onDidChangeTextEditorOptions,
  onDidChangeTextEditorViewColumn: vscode.window.onDidChangeTextEditorViewColumn,
  onDidChangeActiveTerminal: vscode.window.onDidChangeActiveTerminal,
  onDidOpenTerminal: vscode.window.onDidOpenTerminal,
  onDidCloseTerminal: vscode.window.onDidCloseTerminal,
  onDidChangeTerminalState: vscode.window.onDidChangeTerminalState,
  onDidChangeWindowState: vscode.window.onDidChangeWindowState
}
