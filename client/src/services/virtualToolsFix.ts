/**
 * 禁用 VS Code 的实验性“虚拟工具”功能。
 *
 * 当阈值 > 0 且注册了很多工具时，VS Code 会把它们
 * 分组，Copilot 经常无法激活这些组 — 使我们的 30+ 个 ABAP
 * 工具不可见。把阈值设为 0 会完全禁用分组。
 *
 * 这在用户首次连接 SAP 系统后触发一次。
 * 它显示非模态通知而不是阻塞式模态对话框。
 */

import * as vscode from "vscode"
import { log } from "../lib"
import { funWindow as window } from "./funMessenger"
import { ADTSCHEME } from "../adt/conections"

const FULL_SETTING_ID = "github.copilot.chat.virtualTools.threshold"
const RESET_COMMAND = "github.copilot.debug.resetVirtualToolGroups"
const DISMISSED_KEY = "abapfs.virtualToolsFix.dismissed"

/**
 * 每次激活时调用。处理两种场景：
 * 1. ADT 文件夹已存在（连接后扩展重启）→ 延迟后检查。
 * 2. 还没有 ADT 文件夹 → 注册监听器并等待首次连接。
 *
 * 每次激活都可以安全调用 — 已关闭/已修复状态会持久化。
 */
export function registerVirtualToolsFixOnConnect(context: vscode.ExtensionContext): void {
  // 已关闭 — 永远无需再做任何事
  if (context.globalState.get<boolean>(DISMISSED_KEY)) return

  const hasAdtFolders =
    vscode.workspace.workspaceFolders?.some(f => f.uri.scheme === ADTSCHEME) ?? false

  if (hasAdtFolders) {
    // 扩展重启时 ADT 文件夹已挂载（例如连接之后）。
    // 延迟让工作区稳定后再显示通知。
    setTimeout(() => disableVirtualToolGrouping(context), 5000)
    return
  }

  // 还没有 ADT 文件夹 — 等待首次连接
  const listener = vscode.workspace.onDidChangeWorkspaceFolders(e => {
    const hasNewAdtFolder = e.added.some(f => f.uri.scheme === ADTSCHEME)
    if (!hasNewAdtFolder) return

    listener.dispose()
    setTimeout(() => disableVirtualToolGrouping(context), 5000)
  })
  context.subscriptions.push(listener)
}

export async function disableVirtualToolGrouping(context: vscode.ExtensionContext): Promise<void> {
  try {
    if (context.globalState.get<boolean>(DISMISSED_KEY)) return

    // 只在 AI 模型可用时继续 — 不可用则 Copilot 尚未激活，
    // 没有需要修复的内容。下次激活会自动重试。
    let hasModels = false
    try {
      const models = await vscode.lm.selectChatModels({})
      hasModels = models.length > 0
    } catch {
      // selectChatModels 不可用或失败 — 静默跳过
    }
    if (!hasModels) return

    const rootConfig = vscode.workspace.getConfiguration()
    const inspection = rootConfig.inspect<number>(FULL_SETTING_ID)

    const workspaceValue = inspection?.workspaceValue
    const globalValue = inspection?.globalValue
    const effectiveValue = workspaceValue ?? globalValue ?? inspection?.defaultValue ?? 128

    if (effectiveValue === 0) {
      return // 已禁用 — 保持休眠
    }

    // 非模态通知 — 不中断用户的工作流
    const selection = await window.showWarningMessage(
      `ABAP FS: Virtual tool grouping is active (threshold: ${effectiveValue}). ` +
        "Copilot may not see all 30+ ABAP tools. " +
        "Disable grouping to make all tools available?",
      "Disable & Reload",
      "Later",
      "Don't Ask Again"
    )

    if (selection === "Don't Ask Again") {
      await context.globalState.update(DISMISSED_KEY, true)
      log("🔧 User chose not to disable virtual tool grouping — won't ask again")
      return
    }

    if (selection !== "Disable & Reload") {
      log("🔧 User deferred virtual tool grouping fix — will ask again next connection")
      return
    }

    // 应用更改时显示进度
    await window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Disabling virtual tool grouping..."
      },
      async progress => {
        progress.report({ message: "Updating settings..." })

        await rootConfig.update(FULL_SETTING_ID, 0, vscode.ConfigurationTarget.Global)
        log("🔧 Disabled virtual tool grouping at global level")

        if (vscode.workspace.workspaceFolders?.length) {
          try {
            await rootConfig.update(FULL_SETTING_ID, 0, vscode.ConfigurationTarget.Workspace)
            log("🔧 Disabled virtual tool grouping at workspace level")
          } catch {
            // 单文件模式或只读工作区可能失败 — 全局设置就足够了
          }
        }

        progress.report({ message: "Resetting tool groups..." })
        try {
          await vscode.commands.executeCommand(RESET_COMMAND)
          log("🔧 Reset virtual tool groups")
        } catch {
          // 旧版 Copilot 中命令可能不存在 — 没关系
        }

        progress.report({ message: "Reloading window..." })
        await vscode.commands.executeCommand("workbench.action.reloadWindow")
      }
    )
  } catch (error) {
    const msg = String(error)
    if (msg.includes("Canceled")) return
    // 意外错误（例如设置写入失败、重新加载命令不可用）
    log(`⚠️ Could not apply virtual tool grouping fix: ${error}`)
  }
}
