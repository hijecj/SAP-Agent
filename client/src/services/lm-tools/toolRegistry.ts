import * as vscode from "vscode"

/**
 * 按工具名键控的工具实例共享注册表。
 * 在注册时填充，这样 MCP 服务器可以直接调用 invoke()，
 * 绕过 vscode.lm.invokeTool() 及其 prepareInvocation
 * 确认对话框流程。
 */
export const toolRegistry = new Map<string, vscode.LanguageModelTool<any>>()

/**
 * 同时向 VS Code LM 和共享注册表注册工具。
 * 返回 vscode.lm.registerTool 的 disposable，让调用方可以
 * 像以前一样把它推入 context.subscriptions。
 */
export function registerToolWithRegistry(
  name: string,
  tool: vscode.LanguageModelTool<any>
): vscode.Disposable {
  toolRegistry.set(name, tool)
  return vscode.lm.registerTool(name, tool)
}
