/**
 * 语言模型工具索引
 * 所有 ABAP FS LM 工具的中心注册点
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { registerMermaidTools } from "./mermaidTools"
import { registerDumpAnalysisTool } from "./dumpAnalysisTool"
import { registerTraceAnalysisTool } from "./traceAnalysisTool"
import { registerWhereUsedTool } from "./whereUsedTool"
import { registerSearchObjectsTool } from "./searchObjectsTool"
import { registerGetObjectLinesTool } from "./getObjectLinesTool"
import { registerSearchObjectLinesTool } from "./searchObjectLinesTool"
import { registerGetObjectInfoTool } from "./getObjectInfoTool"
import { registerGetBatchLinesTool } from "./getBatchLinesTool"
import { registerGetObjectByUriTool } from "./getObjectByUriTool"
import { registerCreateObjectTool } from "./createObjectTool"
import { registerOpenObjectTool } from "./openObjectTool"
import { registerDownloadTool } from "./downloadTool"
import { registerExecuteCommandTool } from "./executeCommandTool"
import { registerGetWorkspaceUriTool } from "./getWorkspaceUriTool"
import { registerGetObjectUrlTool } from "./getObjectUrlTool"
import { registerDocumentationTool } from "./documentationTool"
import { registerUnitTestTools } from "./unitTestTools"
import { registerAtcTools } from "./atcTools"
import { registerTransportTool } from "./transportTool"
import { registerDataQueryTool } from "./dataQueryTool"
import { registerSqlSyntaxTool } from "./sqlSyntaxTool"
import { registerTestDocumentationTool } from "./testDocumentationTool"
import { ManageTextElementsTool } from "./textElementsTools"
import { registerSAPSystemInfoTool } from "./sapSystemInfoTool"
import { registerConnectedSystemsTool } from "./connectedSystemsTool"
import {
  ABAPDebugSessionTool,
  ABAPBreakpointTool,
  ABAPDebugStepTool,
  ABAPDebugVariableTool,
  ABAPDebugStackTool,
  ABAPDebugStatusTool
} from "./abapDebuggerTool"
import { registerVersionHistoryTool } from "./versionHistoryTool"
import { registerSubagentConfigTool } from "./subagentConfigTool"
import { WebviewManager } from "../webviewManager"
import { registerHeartbeatTool, initializeHeartbeatService } from "../heartbeat"
import { registerAdtDiscoveryTool } from "./adtDiscoveryTool"

/**
 * 注册所有语言模型工具
 */
export async function registerAllTools(context: vscode.ExtensionContext): Promise<void> {
  // 共享工具（无需注册 - 只是导出）
  // 已经可以通过：import { ... } from './lm-tools/shared' 使用

  // 1. Mermaid 工具（4 个工具）
  registerMermaidTools(context)

  // 2. 分析工具
  registerDumpAnalysisTool(context)
  registerTraceAnalysisTool(context)
  registerWhereUsedTool(context)

  // 3. 核心对象工具
  registerSearchObjectsTool(context)
  registerGetObjectLinesTool(context)
  registerSearchObjectLinesTool(context)
  registerGetObjectInfoTool(context)
  registerGetBatchLinesTool(context)
  registerGetObjectByUriTool(context)
  registerCreateObjectTool(context)
  registerOpenObjectTool(context)
  registerDownloadTool(context)
  registerExecuteCommandTool(context)
  registerGetWorkspaceUriTool(context)
  registerGetObjectUrlTool(context)

  // 4. 文档工具
  registerDocumentationTool(context)

  // 5. 单元测试工具
  registerUnitTestTools(context)

  // 6. ATC 工具
  registerAtcTools(context)

  // 7. 传输工具
  registerTransportTool(context)

  // 8. 数据查询工具
  registerDataQueryTool(context)

  // 9. SQL 语法工具
  registerSqlSyntaxTool(context)

  // 10. 测试文档工具
  registerTestDocumentationTool(context)

  // 11. 文本元素
  context.subscriptions.push(
    registerToolWithRegistry("manage_text_elements", new ManageTextElementsTool())
  )

  // 12. SAP 系统信息工具
  registerSAPSystemInfoTool(context)

  // 13. 已连接系统工具（供 MCP 客户端发现可用连接）
  registerConnectedSystemsTool(context)

  // 14. 调试器工具（6 个工具）
  context.subscriptions.push(
    registerToolWithRegistry("abap_debug_session", new ABAPDebugSessionTool())
  )
  context.subscriptions.push(
    registerToolWithRegistry("abap_debug_breakpoint", new ABAPBreakpointTool())
  )
  context.subscriptions.push(registerToolWithRegistry("abap_debug_step", new ABAPDebugStepTool()))
  context.subscriptions.push(
    registerToolWithRegistry("abap_debug_variable", new ABAPDebugVariableTool())
  )
  context.subscriptions.push(registerToolWithRegistry("abap_debug_stack", new ABAPDebugStackTool()))
  context.subscriptions.push(
    registerToolWithRegistry("abap_debug_status", new ABAPDebugStatusTool())
  )

  // 15. 版本历史工具
  registerVersionHistoryTool(context)

  // 16. 子代理配置工具
  registerSubagentConfigTool(context)

  // 17. 心跳工具（OpenClaw 风格周期性 LLM 监控）
  registerHeartbeatTool(context)

  // 18. ADT 发现工具
  registerAdtDiscoveryTool(context)

  // 初始化心跳服务（配置中启用时会自动启动）
  const heartbeatService = initializeHeartbeatService(context)
  const heartbeatConfig = vscode.workspace.getConfiguration("abapfs.heartbeat")
  if (heartbeatConfig.get("enabled", false)) {
    heartbeatService.start()
  }
  // 初始化 WebviewManager 单例（数据查询工具需要）
  WebviewManager.getInstance(context)
}
