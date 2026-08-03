/**
 * MCP 在 ABAP 对象中替换字符串工具
 *
 * 此工具仅限 MCP（不是 VS Code LM 工具）。它让外部 AI 客户端
 * （Cursor、Claude Code、Cline 等）通过对其工作区 URI 标识的文件
 * 执行查找替换操作来编辑 ABAP 源代码。
 *
 * 当 VS Code Copilot 编辑 ABAP 文件时，它使用内置的 replace_string_in_file
 * 工具，该工具作用于 adt:// 文件系统。外部 MCP 客户端无法访问
 * 那些内置工具，所以此工具提供等价功能。
 *
 * 流程：
 * 1. AI 通过 get_abap_object_workspace_uri 工具获取工作区 URI
 * 2. AI 通过 get_abap_object_lines 读取当前内容
 * 3. AI 用 URI、oldString 和 newString 调用此工具
 * 4. 此工具读取文件、校验匹配、替换并写回
 * 5. adt:// 文件系统提供器处理锁定、传输选择和 SAP 同步
 */

import * as vscode from "vscode"

// ============================================================================
// 接口
// ============================================================================

export interface IMcpReplaceStringParams {
  /** ABAP 源文件的完整工作区 URI（例如 'adt://dev100/path/to/file.prog.abap'）。
   * 使用 get_abap_object_workspace_uri 工具获取此 URI。 */
  fileUri: string
  /** 要查找和替换的精确字面文本。必须与文件中的恰好一个出现位置匹配。
   * 包含足够的上下文（周围 3-5 行）以确保唯一性。不能为空。 */
  oldString: string
  /** 替换文本。结果代码必须是语法有效的 ABAP。 */
  newString: string
}

// ============================================================================
// 核心逻辑
// ============================================================================

/**
 * 对文件内容执行单次查找替换。
 * 返回更新后的内容，如果匹配数不是恰好 1 则抛出异常。
 */
export function findAndReplace(content: string, oldString: string, newString: string): string {
  if (!oldString) {
    // 只有当当前文件完全为空时才允许空 oldString
    //（例如刚创建、还没有源码的 ABAP 对象）。
    if (content.length === 0) {
      return newString
    }
    throw new Error(
      "oldString can only be empty when the file is currently completely blank. " +
        "The file has existing content, so oldString is mandatory. " +
        "Read the current content with get_abap_object_lines first and include the exact text to replace."
    )
  }

  if (oldString === newString) {
    throw new Error("oldString and newString are identical. No change would be made.")
  }

  // 统计出现次数
  let count = 0
  let searchIdx = 0
  while (true) {
    const idx = content.indexOf(oldString, searchIdx)
    if (idx === -1) break
    count++
    searchIdx = idx + oldString.length
  }

  if (count === 0) {
    // 尝试规范化行尾
    const normalizedContent = content.replace(/\r\n/g, "\n")
    const normalizedOld = oldString.replace(/\r\n/g, "\n")
    if (normalizedContent.includes(normalizedOld)) {
      // 行尾规范化后找到匹配 - 在原始内容上执行替换
      const normalizedNew = newString.replace(/\r\n/g, "\n")
      const updated = normalizedContent.replace(normalizedOld, normalizedNew)
      // 如果内容有 \r\n，恢复原始行尾样式
      if (content.includes("\r\n")) {
        return updated.replace(/(?<!\r)\n/g, "\r\n")
      }
      return updated
    }
    throw new Error(
      "Could not find the specified oldString in the file. " +
        "Make sure the text matches exactly (including whitespace and indentation). " +
        "Use get_abap_object_lines or search_abap_object_lines to read the current file content first."
    )
  }

  if (count > 1) {
    throw new Error(
      `Found ${count} occurrences of oldString. It must match exactly one location. ` +
        "Include more surrounding context lines to make the match unique."
    )
  }

  // 恰好一个匹配 - 执行替换
  return content.replace(oldString, newString)
}

/**
 * 对 VS Code 文件系统执行替换操作。
 * 这通过 adt:// 文件系统提供器完成，它处理
 * 锁定、传输选择和与 SAP 的同步。
 */
export async function executeReplace(
  fileUri: string,
  oldString: string,
  newString: string
): Promise<string> {
  const uri = vscode.Uri.parse(fileUri)

  // 校验 URI 协议
  if (uri.scheme !== "adt") {
    throw new Error(
      `Invalid URI scheme '${uri.scheme}'. Expected 'adt://' URI. ` +
        "Use the get_abap_object_workspace_uri tool to get the correct URI."
    )
  }

  // 读取当前文件内容
  const contentBytes = await vscode.workspace.fs.readFile(uri)
  const currentContent = Buffer.from(contentBytes).toString("utf8")

  // 执行替换
  const updatedContent = findAndReplace(currentContent, oldString, newString)

  // 通过文件系统提供器写回（处理锁定/传输/同步）
  // 重要：必须使用 Buffer.from() 而不是 TextEncoder - FsProvider 调用
  // content.toString()，它只在 Buffer 上正确解码 UTF-8，而不是 Uint8Array
  await vscode.workspace.fs.writeFile(uri, Buffer.from(updatedContent, "utf8"))

  return updatedContent
}
