/**
 * 评分提示服务
 *
 * 提示活跃用户在 VS Code Marketplace 上为扩展评分。
 *
 * 条件（两者都必须满足）：
 *   1. 用户已调用至少 100 次工具/命令操作（通过全局状态计数器跟踪）。
 *   2. 自扩展首次激活以来至少已过 7 天。
 *
 * 两个条件都满足后，延迟 5 分钟触发，然后：
 *   - 带三个按钮的通知：
 *       "⭐ 立即评分"       → 打开 Marketplace 评分页面
 *       "稍后提醒"  → 重置计数器和日期，让循环重新开始
 *       "不再显示" → 永久抑制提示
 *   - 链接到 Marketplace 页面的持久状态栏项
 *     （用户点击后永久关闭）。
 */

import * as vscode from "vscode"

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs&ssr=false#review-details"

// ─── 全局状态键 ───────────────────────────────────────────────────────

const STATE_USAGE_COUNT = "abapfs.reviewPrompt.usageCount"
const STATE_FIRST_ACTIVATION_DATE = "abapfs.reviewPrompt.firstActivationDate"
const STATE_NEVER_SHOW_AGAIN = "abapfs.reviewPrompt.neverShowAgain"
const STATE_STATUSBAR_DISMISSED = "abapfs.reviewPrompt.statusBarDismissed"

// ─── 阈值 ──────────────────────────────────────────────────────────────

const USAGE_THRESHOLD = 100
const DAYS_THRESHOLD = 7
const PROMPT_DELAY_MS = 5 * 60 * 1000 // 5 分钟

// ─── 模块状态 ────────────────────────────────────────────────────────────

let extensionContext: vscode.ExtensionContext | undefined
let promptTimer: ReturnType<typeof setTimeout> | undefined
let promptShownThisSession = false
let statusBarCreated = false
let reviewStatusBarItem: vscode.StatusBarItem | undefined

// ─── 公共 API ──────────────────────────────────────────────────────────────

/**
 * 在扩展激活期间调用一次，记录首次使用日期并
 * 安排评分提示检查。
 */
export function initializeReviewPrompt(context: vscode.ExtensionContext): void {
  try {
    extensionContext = context

    // 记录首次激活日期（只在尚未存储时）
    const storedDate = context.globalState.get<string>(STATE_FIRST_ACTIVATION_DATE)
    if (!storedDate) {
      context.globalState.update(STATE_FIRST_ACTIVATION_DATE, new Date().toISOString())
    }

    // 停用时清理定时器
    context.subscriptions.push(
      new vscode.Disposable(() => {
        if (promptTimer) {
          clearTimeout(promptTimer)
          promptTimer = undefined
        }
      })
    )

    // 立即检查条件（处理计数在上次会话已超过阈值的情况）
    evaluateAndSchedule()
  } catch (error) {
    // 评分提示非关键 — 绝不让它中断扩展激活
    console.error("Review prompt initialization failed:", error)
  }
}

/**
 * 对符合条件的命令/工具使用调用，递增计数器。
 */
export function incrementReviewCounter(): void {
  try {
    if (!extensionContext) return

    const count = extensionContext.globalState.get<number>(STATE_USAGE_COUNT) ?? 0
    extensionContext.globalState.update(STATE_USAGE_COUNT, count + 1)

    // 每 10 次调用重新评估，避免每次调用都检查
    if ((count + 1) % 10 === 0) {
      evaluateAndSchedule()
    }
  } catch (error) {
    // 评分提示非关键 — 绝不让它中断遥测
    console.error("Review prompt counter increment failed:", error)
  }
}

// ─── 内部辅助 ────────────────────────────────────────────────────────

function evaluateAndSchedule(): void {
  if (!extensionContext) return

  // 已永久关闭？
  if (extensionContext.globalState.get<boolean>(STATE_NEVER_SHOW_AGAIN)) return

  // 本次会话已显示 — 不再打扰
  if (promptShownThisSession) return

  // 条件 1：使用计数
  const count = extensionContext.globalState.get<number>(STATE_USAGE_COUNT) ?? 0
  if (count < USAGE_THRESHOLD) return

  // 条件 2：自首次激活以来的天数
  const firstDate = extensionContext.globalState.get<string>(STATE_FIRST_ACTIVATION_DATE)
  if (!firstDate) return

  const daysSinceFirst = (Date.now() - new Date(firstDate).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSinceFirst < DAYS_THRESHOLD) return

  // 两个条件都满足 — 延迟后安排提示（避免重复定时器）
  if (promptTimer) return
  promptTimer = setTimeout(() => {
    promptTimer = undefined
    showReviewPrompt()
  }, PROMPT_DELAY_MS)
}

function showReviewPrompt(): void {
  if (!extensionContext) return

  promptShownThisSession = true
  const ctx = extensionContext

  // ── 通知 ───────────────────────────────────────────────────────────
  vscode.window
    .showInformationMessage(
      "You've been using ABAP Remote FS for a while now — thank you! " +
        "If it's been helpful, a quick rating on the Marketplace would mean a lot. ❤️",
      "⭐ Rate Now",
      "Remind Me Later",
      "Never Show Again"
    )
    .then(choice => {
      if (choice === "⭐ Rate Now") {
        vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL))
        ctx.globalState.update(STATE_NEVER_SHOW_AGAIN, true)
        ctx.globalState.update(STATE_STATUSBAR_DISMISSED, true)
        disposeReviewStatusBar()
      } else if (choice === "Never Show Again") {
        ctx.globalState.update(STATE_NEVER_SHOW_AGAIN, true)
        ctx.globalState.update(STATE_STATUSBAR_DISMISSED, true)
        disposeReviewStatusBar()
      } else {
        // “稍后提醒”或关闭（X）— 重置跟踪，让循环重新开始
        ctx.globalState.update(STATE_USAGE_COUNT, undefined)
        ctx.globalState.update(STATE_FIRST_ACTIVATION_DATE, undefined)
      }
    })

  // ── 状态栏项（点击前持久显示）─────────────────────────────
  if (!statusBarCreated && !ctx.globalState.get<boolean>(STATE_STATUSBAR_DISMISSED)) {
    statusBarCreated = true
    showReviewStatusBar(ctx)
  }
}

function disposeReviewStatusBar(): void {
  if (reviewStatusBarItem) {
    reviewStatusBarItem.dispose()
    reviewStatusBarItem = undefined
  }
  statusBarCreated = false
}

function showReviewStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 900)
  reviewStatusBarItem = item
  item.text = "$(star) Rate ABAP FS"
  item.tooltip = "Enjoying ABAP Remote FS? Click to rate on the Marketplace!"
  item.command = "abapfs.openReviewMarketplace"
  item.show()
  context.subscriptions.push(item)

  const cmd = vscode.commands.registerCommand("abapfs.openReviewMarketplace", () => {
    vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL))
    context.globalState.update(STATE_STATUSBAR_DISMISSED, true)
    disposeReviewStatusBar()
  })
  context.subscriptions.push(cmd)
}
