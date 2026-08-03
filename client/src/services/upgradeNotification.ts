/**
 * 一次性升级通知 + 新用户的闪烁状态栏。
 */

import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"

const MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=murbani.vscode-abap-remote-fs"
const CHANGELOG_URL =
  "https://github.com/marcellourbani/vscode_abap_remote_fs/blob/master/CHANGELOG.md"

const STATE_LAST_VERSION = "abapfs.lastVersion"
const STATE_UPGRADE_DISMISSED = "abapfs.upgradeStatusBarDismissed"
const STATE_STATUS_BAR_PENDING = "abapfs.upgradeStatusBarPending"

export function checkUpgradeNotification(context: vscode.ExtensionContext): void {
  const currentVersion: string = context.extension.packageJSON.version ?? "0.0.0"
  const lastVersion = context.globalState.get<string>(STATE_LAST_VERSION)

  // 始终更新存储的版本
  context.globalState.update(STATE_LAST_VERSION, currentVersion)

  // 为从 v1 升级的用户触发。
  // v1 从不存储此键，所以 undefined 意味着他们使用的是 v1（或全新安装）。
  // 如果他们已存储 v2 版本则跳过（意味着之前运行过 v2）。
  const isUpgradeFromV1 = lastVersion === undefined || lastVersion.startsWith("1.")

  if (isUpgradeFromV1) {
    // 标记我们要显示状态栏 — 在重新加载之间持久化，直到被关闭
    context.globalState.update(STATE_STATUS_BAR_PENDING, true)
  } else if (lastVersion && lastVersion !== currentVersion) {
    // 常规版本升级 — 显示简单通知
    showVersionUpgradeNotification(currentVersion)
  }

  // 有待处理时显示状态栏（覆盖全新升级和重新加载后重新激活）
  if (context.globalState.get<boolean>(STATE_STATUS_BAR_PENDING)) {
    showBlinkingStatusBar(context)
  }
}

// ─── 闪烁状态栏 ─────────────────────────────────────────────────────

function showVersionUpgradeNotification(version: string): void {
  window
    .showInformationMessage(`ABAP Remote Filesystem has been updated to v${version}`, "What's New")
    .then(choice => {
      if (choice === "What's New") {
        vscode.env.openExternal(vscode.Uri.parse(CHANGELOG_URL))
      }
    })
}

function showBlinkingStatusBar(context: vscode.ExtensionContext): void {
  // 已通过点击关闭？
  if (context.globalState.get<boolean>(STATE_UPGRADE_DISMISSED)) return

  // 创建状态栏项
  const item = window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000)
  item.command = "abapfs.openUpgradeMarketplace"
  item.tooltip = "ABAP Remote FS v2 — Click to learn about new AI features or just ask Copilot!"
  context.subscriptions.push(item)

  // 在两个状态之间闪烁
  const textOn = "$(rocket) ABAP FS v2 — New AI Features!"
  const textOff = "$(sparkle) ABAP FS v2 — New AI Features!"
  let on = true

  item.text = textOn
  item.show()

  const blinkInterval = setInterval(() => {
    on = !on
    item.text = on ? textOn : textOff
  }, 1500)

  // 命令：打开市场 + 永久关闭
  const cmd = vscode.commands.registerCommand("abapfs.openUpgradeMarketplace", () => {
    vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_URL))
    context.globalState.update(STATE_UPGRADE_DISMISSED, true)
    context.globalState.update(STATE_STATUS_BAR_PENDING, false)
    clearInterval(blinkInterval)
    item.dispose()
  })
  context.subscriptions.push(cmd)
}
