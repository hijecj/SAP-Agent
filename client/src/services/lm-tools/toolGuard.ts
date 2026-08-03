/**
 * LM 工具安全守卫
 *
 * 防止未授权扩展通过 vscode.lm.invokeTool() 调用 LM 工具。
 *
 * 授权调用方：
 * 1. Copilot — 由 VS Code 在 API 层校验 toolInvocationToken 识别
 *    （伪造 token 在到达我们的代码之前就被 VS Code 拒绝）
 * 2. 我们自己的 MCP 服务器 — 用只有本模块能生成和校验的
 *    按调用 nonce 直接调用 invoke()（外部不可访问）
 *
 * 未授权调用方（恶意扩展）：
 * - 调用 vscode.lm.invokeTool() → VS Code 拒绝伪造 token，或
 *   以 undefined token 通过 → 我们的守卫阻止它
 * - 无法访问 nonce 集合，因为它在模块私有闭包中
 * - 无法在并行 MCP 调用期间溜过（nonce 按调用生成，不是全局的）
 */

import { randomUUID } from "crypto"
import * as vscode from "vscode"

/** 当前有效的 MCP 调用一次性 nonce 集合 */
const activeNonces = new Set<string>()

/**
 * 用作 options 对象上携带 MCP nonce 的隐藏键的 Symbol。
 * Symbol 不可枚举、无法通过 Object.keys() 访问，且此特定
 * symbol 实例对模块闭包是私有的。
 */
const MCP_NONCE_KEY = Symbol("abapfs.mcpNonce")

/** 可以携带我们隐藏 nonce 的扩展选项类型 */
export interface McpAuthorizedOptions<T> extends vscode.LanguageModelToolInvocationOptions<T> {
  [key: symbol]: string
}

/**
 * 为 MCP 工具调用创建已授权选项对象。
 * 注入 assertToolInvocationAuthorized 将校验的一次性 nonce。
 */
export function createMcpAuthorizedOptions<T>(input: T): McpAuthorizedOptions<T> {
  const nonce = randomUUID()
  activeNonces.add(nonce)
  // 安全：30 秒后自动过期 nonce，防止在工具调用被取消或
  // 在守卫检查之前抛出时无限积累
  setTimeout(() => activeNonces.delete(nonce), 30_000)
  const options = { input, toolInvocationToken: undefined } as unknown as McpAuthorizedOptions<T>
  options[MCP_NONCE_KEY] = nonce
  return options
}

/**
 * 校验工具调用是否已授权。
 * 已授权返回 true，被阻止返回 false。
 */
export function isToolInvocationAuthorized(
  options: vscode.LanguageModelToolInvocationOptions<any>
): boolean {
  if (options.toolInvocationToken) return true
  const nonce = (options as any)[MCP_NONCE_KEY] as string | undefined
  if (nonce && activeNonces.has(nonce)) {
    activeNonces.delete(nonce)
    return true
  }
  return false
}

/**
 * 如果工具调用未授权则抛出错误。
 * 在每个工具的 invoke() 方法开头调用。
 */
export function assertToolInvocationAuthorized(
  options: vscode.LanguageModelToolInvocationOptions<any>
): void {
  if (!isToolInvocationAuthorized(options)) {
    throw new Error(
      "Unauthorized tool invocation. This tool can only be called by GitHub Copilot or the ABAP FS MCP server."
    )
  }
}
