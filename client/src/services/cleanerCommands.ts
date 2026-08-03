/**
 * ABAP Cleaner 命令
 * ABAP Cleaner 集成的命令
 */

import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"
import { ABAPCleanerService } from "./abapCleanerService"
import { log } from "../lib"
import { logTelemetry } from "./telemetry"

/**
 * 注册所有 ABAP Cleaner 相关命令
 */
export function registerCleanerCommands(context: vscode.ExtensionContext): void {
  const cleanerService = ABAPCleanerService.getInstance()

  // 主清理代码命令 - 可以从图标或右键菜单调用
  const cleanCodeCommand = vscode.commands.registerCommand("abapfs.cleanCode", async () => {
    // log('🧹 AbapFs Clean Code command triggered');

    if (!cleanerService.isAvailable()) {
      const setup = await window.showInformationMessage(
        "ABAP Cleaner is not configured. Would you like to set it up now?",
        "Setup Now",
        "Cancel"
      )

      if (setup === "Setup Now") {
        await cleanerService.setupWizard()
      }
      return
    }

    await cleanerService.cleanActiveEditor()
  })

  // 设置向导命令
  const setupCleanerCommand = vscode.commands.registerCommand("abapfs.setupCleaner", async () => {
    // log('⚙️ AbapFs Setup ABAP Cleaner command triggered');
    await cleanerService.setupWizard()
  })

  // 启用时注册保存时自动清理
  const onSaveListener = vscode.workspace.onWillSaveTextDocument(async event => {
    if (
      cleanerService.shouldCleanOnSave() &&
      event.document.languageId === "abap" &&
      event.document.uri.scheme === "adt"
    ) {
      log("💾 Auto-cleaning ABAP code on save...")

      // 注意：这是简化版本。生产环境你可能想
      // 更仔细地把它集成到文档保存管道中
      const editor = window.visibleTextEditors.find(e => e.document === event.document)

      if (editor) {
        // 我们不能在 onWillSave 期间直接修改文档，
        // 所以改为显示消息
        window.showInformationMessage("💡 Tip: Use the clean code icon to format before saving")
      }
    }
  })

  context.subscriptions.push(cleanCodeCommand, setupCleanerCommand, onSaveListener)

  log("✅ ABAP Cleaner commands registered successfully")
}

/**
 * 更新用于显示/隐藏 ABAP Cleaner 命令的编辑器上下文
 * 注意：为效率从主 activeTextEditorChangedListener 调用
 */
export function updateCleanerContext(): void {
  const cleanerService = ABAPCleanerService.getInstance()
  const isAvailable = cleanerService.isAvailable()

  // 为 package.json 中的 when 子句设置上下文
  vscode.commands.executeCommand("setContext", "abapfs.cleanerAvailable", isAvailable)
}

/**
 * 设置清理器上下文监控
 * 注意：编辑器变化监控由主监听器处理以提升性能
 */
export function setupCleanerContextMonitoring(context: vscode.ExtensionContext): void {
  // 配置变化时更新上下文
  const configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration("abapfs.cleaner")) {
      updateCleanerContext()
    }
  })

  context.subscriptions.push(configChangeListener)

  // 初始上下文更新
  updateCleanerContext()

  log("✅ ABAP Cleaner context monitoring setup complete")
}
