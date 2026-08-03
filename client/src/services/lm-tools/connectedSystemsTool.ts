/**
 * 已连接系统工具
 * 列出 VS Code 中当前所有已连接 SAP 系统的 LM 工具
 *
 * 这对无法看到 VS Code 工作区、需要发现可用连接 ID 的
 * MCP 客户端（Cursor、Claude Code 等）尤其有用。
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { logTelemetry } from "../telemetry"
import { connectedRoots } from "../../config"

// ============================================================================
// 接口
// ============================================================================

// 不需要输入参数 - 此工具只列出已连接的内容
export interface IConnectedSystemsParameters {
  // 空 - 不需要参数
}

// ============================================================================
// 工具类
// ============================================================================

/**
 * 🔗 已连接系统工具
 * 列出 VS Code 中当前已连接的所有 SAP 系统。
 * 返回可与其他 ABAP FS 工具一起使用的连接 ID。
 */
export class ConnectedSystemsTool implements vscode.LanguageModelTool<IConnectedSystemsParameters> {
  async prepareInvocation(
    _options: vscode.LanguageModelToolInvocationPrepareOptions<IConnectedSystemsParameters>,
    _token: vscode.CancellationToken
  ) {
    return {
      invocationMessage: "Getting list of connected SAP systems..."
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IConnectedSystemsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_get_connected_systems_called")
    try {
      const roots = connectedRoots()
      const connectionIds = Array.from(roots.keys())

      if (connectionIds.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            'No SAP systems are currently connected. User needs to connect first using "ABAP FS: Connect to an SAP system" command.'
          )
        ])
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Connected SAP systems: ${connectionIds.join(", ")}`)
      ])
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to get connected systems: ${errorMsg}`)
    }
  }
}

// ============================================================================
// 注册
// ============================================================================

export function registerConnectedSystemsTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("get_connected_systems", new ConnectedSystemsTool())
  )
}
