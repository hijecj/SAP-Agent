/**
 * SAP 系统信息工具
 * 检索全面 SAP 系统信息的 LM 工具
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { getSAPSystemInfo, formatSAPSystemInfoAsText } from "../sapSystemInfo"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ============================================================================
// 接口
// ============================================================================

export interface ISAPSystemInfoParameters {
  connectionId: string
  includeComponents?: boolean
}

// ============================================================================
// 工具类
// ============================================================================

/**
 * 📊 SAP 系统信息工具
 * 检索关于 SAP 系统的全面信息，包括：
 * - Client 信息（来自 T000）
 * - 软件组件版本（来自 CVERS）
 * - SAP 版本信息（来自 SVERS）
 */
export class SAPSystemInfoTool implements vscode.LanguageModelTool<ISAPSystemInfoParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ISAPSystemInfoParameters>,
    _token: vscode.CancellationToken
  ) {
    const { connectionId } = options.input

    if (!connectionId) {
      throw new Error("connectionId is required")
    }

    const confirmationMessages = {
      title: "Get SAP System Info",
      message: new vscode.MarkdownString(
        `Retrieve comprehensive SAP system information for connection: \`${connectionId}\`\n\n` +
          `This will query system tables (T000, CVERS, SVERS) to gather:\n` +
          `- Client configuration\n` +
          `- Software component versions\n` +
          `- SAP release information`
      )
    }

    return {
      invocationMessage: `Getting SAP system info for: ${connectionId}...`,
      confirmationMessages
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ISAPSystemInfoParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    logTelemetry("tool_get_sap_system_info_called", { connectionId: options.input.connectionId })
    let { connectionId, includeComponents } = options.input

    if (!connectionId) {
      throw new Error("connectionId is required")
    }

    // 把连接 ID 规范化为小写
    connectionId = connectionId.toLowerCase()

    // 默认 includeComponents 为 false
    includeComponents = includeComponents ?? false

    try {
      // 获取系统信息（带缓存）- connectionId 查找在内部完成
      const systemInfo = await getSAPSystemInfo(connectionId, includeComponents)

      // 创建简洁摘要
      let summary = `SAP System: ${connectionId.toUpperCase()}\n`
      summary += `- Type: ${systemInfo.systemType}\n`
      summary += `- Release: ${systemInfo.sapRelease || "N/A"}\n`

      if (systemInfo.currentClient) {
        summary += `- Client: ${systemInfo.currentClient.clientNumber} (${systemInfo.currentClient.clientName})\n`
      }

      if (systemInfo.timezone) {
        summary += `- Timezone: ${systemInfo.timezone.timezone} (${systemInfo.timezone.description}), ${systemInfo.timezone.utcOffset}`
        if (systemInfo.timezone.dstRule !== "NONE") {
          summary += `, DST: ${systemInfo.timezone.dstRule}`
        }
        summary += "\n"
      }

      if (includeComponents && systemInfo.softwareComponents.length > 0) {
        summary += `- Components: ${systemInfo.softwareComponents.length} installed\n`
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(summary),
        new vscode.LanguageModelTextPart(JSON.stringify(systemInfo, null, 2))
      ])
    } catch (error: any) {
      const errorMsg = error?.localizedMessage || error?.message || String(error)
      throw new Error(`Failed to get SAP system info: ${errorMsg}`)
    }
  }
}

// ============================================================================
// 注册
// ============================================================================

export function registerSAPSystemInfoTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("get_sap_system_info", new SAPSystemInfoTool())
  )
}
