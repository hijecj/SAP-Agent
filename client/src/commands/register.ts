import { ExtensionContext, commands } from "vscode"
import { funWindow as window } from "../services/funMessenger"
import { abapcmds } from "."
// 导入/导出以解析依赖
export { AdtCommands } from "./commands"
export { IncludeProvider } from "../adt/includes"
export { LanguageCommands } from "../langClient"
export { ClassHierarchyLensProvider } from "../adt/classhierarchy"
export { GitCommands } from "../scm/abapGit/commands"
export { AbapRevisionCommands } from "../scm/abaprevisions/commands"

export const registerCommands = (context: ExtensionContext) => {
  for (const cmd of abapcmds)
    context.subscriptions.push(commands.registerCommand(cmd.name, cmd.func.bind(cmd.target)))

  // 🎯 Register Enhancement Commands
  try {
    const { showEnhancementSource } = require("../views/enhancementDecorations")
    context.subscriptions.push(
      commands.registerCommand("abapfs.showEnhancementSource", showEnhancementSource)
    )
  } catch (error) {
    console.warn("⚠️ Failed to register enhancement commands:", error)
  }

  // 🔄 注册 SAP 系统校验器命令
  try {
    const { SapSystemValidator } = require("../services/sapSystemValidator")
    const validator = SapSystemValidator.getInstance()

    context.subscriptions.push(
      commands.registerCommand("abapfs.retryWhitelist", () => validator.forceRetryWhitelist())
    )

    context.subscriptions.push(
      commands.registerCommand("abapfs.showVpnHelp", () => validator.showVpnHelp())
    )

    context.subscriptions.push(
      commands.registerCommand("abapfs.refreshWhitelist", async () => {
        try {
          await validator.refreshWhitelist()
          window.showInformationMessage("✅ SAP system whitelist refreshed successfully!")
        } catch (error) {
          window.showErrorMessage(`❌ Failed to refresh whitelist: ${error}`)
        }
      })
    )
  } catch (error) {
    console.warn("⚠️ Failed to register SAP validator commands:", error)
  }

  // 📊 注册与其他系统比较命令
  try {
    const { registerCompareWithSystemCommand } = require("./compareWithSystem")
    registerCompareWithSystemCommand(context)
  } catch (error) {
    console.warn("⚠️ Failed to register compare command:", error)
  }
}
