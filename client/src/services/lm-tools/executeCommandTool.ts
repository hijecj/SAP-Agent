/**
 * ABAP FS 执行命令工具
 *
 * 围绕 vscode.commands.executeCommand 的薄包装器，让 Copilot 触发
 * 精选的 ABAP FS 命令白名单（通信日志、调试录制等）。
 * 白名单位于工具的 package.json 枚举中 — 模型实际上
 * 无法调用其外的任何内容。
 *
 * 只支持即发即忘：返回值被丢弃，工具报告“已触发”。
 * 需要有意义参数或返回结构化数据的命令应
 * 拥有自己的专用 LM 工具。
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"

export interface IExecuteCommandParameters {
  command: string
}

/**
 * 工具在返回前应等待的命令。不在此集合中的任何命令
 * 都是即发即忘 — 工具立即报告“已触发”。当模型需要
 * 在决定下一步之前知道命令已完成时（例如设置/引导命令），
 * 把命令加到这里。
 */
const AWAIT_COMMANDS = new Set<string>(["abapfs.activateCommLog"])

export class ExecuteCommandTool implements vscode.LanguageModelTool<IExecuteCommandParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IExecuteCommandParameters>,
    _token: vscode.CancellationToken
  ) {
    const { command } = options.input
    return {
      invocationMessage: `Running ABAP FS command: ${command}`,
      confirmationMessages: {
        title: "Run ABAP FS Command",
        message: new vscode.MarkdownString(`Run VS Code command:\n\n**\`${command}\`**`)
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IExecuteCommandParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const { command } = options.input
    logTelemetry("tool_execute_command_called", {})
    logTelemetry(`command_${command}_called`, {})

    if (AWAIT_COMMANDS.has(command)) {
      await vscode.commands.executeCommand(command)
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`Command \`${command}\` finished.`)
      ])
    }

    void vscode.commands.executeCommand(command)
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(`Command \`${command}\` was triggered.`)
    ])
  }
}

export function registerExecuteCommandTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("abap_execute_command", new ExecuteCommandTool())
  )
}
