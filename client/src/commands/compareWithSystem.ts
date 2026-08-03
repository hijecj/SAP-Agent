/**
 * 把 ABAP 对象与另一个 SAP 系统中的同一对象比较
 * 右键菜单："ABAP FS: Compare With Other System"
 */

import * as vscode from "vscode"
import { funWindow as window } from "../services/funMessenger"
import { ADTSCHEME } from "../adt/conections"
import { connectedRoots, formatKey } from "../config"
import { logTelemetry } from "../services/telemetry"

/**
 * 把当前 ABAP 对象与另一个已连接系统中的同一对象比较
 */
export async function compareWithOtherSystem(uri?: vscode.Uri): Promise<void> {
  logTelemetry("command_compare_with_system_called")
  try {
    // 获取源 URI（来自右键菜单或活动编辑器）
    let sourceUri: vscode.Uri | undefined = uri

    if (!sourceUri) {
      const activeEditor = window.activeTextEditor
      if (activeEditor && activeEditor.document.uri.scheme === ADTSCHEME) {
        sourceUri = activeEditor.document.uri
      }
    }

    if (!sourceUri || sourceUri.scheme !== ADTSCHEME) {
      window.showWarningMessage("Please select an ABAP file to compare")
      return
    }

    const currentSystem = formatKey(sourceUri.authority)

    // 获取除当前系统外的所有已连接系统
    const roots = connectedRoots()

    if (roots.size <= 1) {
      window.showWarningMessage("Connect to at least one other SAP system to compare.")
      return
    }

    // 只显示与当前不同的系统
    const otherSystems: vscode.QuickPickItem[] = []

    for (const [systemId, folder] of roots.entries()) {
      if (systemId !== currentSystem) {
        otherSystems.push({
          label: folder.name,
          description: systemId.toUpperCase()
        })
      }
    }

    if (otherSystems.length === 0) {
      window.showWarningMessage(
        "No other SAP systems connected. Connect to another system to compare."
      )
      return
    }

    // 显示快速选择以选择目标系统
    const selected = await window.showQuickPick(otherSystems, {
      placeHolder: `Compare with which system? (current: ${currentSystem.toUpperCase()})`,
      title: "ABAP FS: Compare With Other System"
    })

    if (!selected) {
      return // 用户已取消
    }

    const targetSystem = formatKey(selected.description || selected.label)

    // 构建目标 URI - 相同路径，不同权威
    const targetUri = sourceUri.with({ authority: targetSystem })
    const sourcePath = sourceUri.path

    // 提取对象名用于 diff 标题
    const pathParts = sourceUri.path.split("/")
    const fileName = pathParts[pathParts.length - 1] || "Unknown"
    const objectName = fileName.replace(/\.(prog|clas|fugr|intf|ddls)\.abap$/, "")
    const diffTitle = `${objectName}: ${currentSystem.toUpperCase()} ↔ ${targetSystem.toUpperCase()}`

    // 新版系统："Source Code Library"，旧版系统："Source Library"

    // 首先，尝试读取目标文件以检查它是否存在
    let finalTargetUri = targetUri
    try {
      await vscode.workspace.fs.stat(targetUri)
      // 文件存在，使用它
    } catch {
      // 文件不存在，尝试备用路径
      if (sourcePath.includes("/Source Code Library/") || sourcePath.includes("/Source Library/")) {
        const alternatePath = sourcePath.includes("/Source Code Library/")
          ? sourcePath.replace("/Source Code Library/", "/Source Library/")
          : sourcePath.replace("/Source Library/", "/Source Code Library/")

        const alternateUri = sourceUri.with({ authority: targetSystem, path: alternatePath })

        try {
          await vscode.workspace.fs.stat(alternateUri)
          // 备用路径存在，使用它
          finalTargetUri = alternateUri
        } catch {
          throw new Error(
            `Object "${objectName}" not found in ${targetSystem.toUpperCase()}. Tried both "Source Code Library" and "Source Library" paths.`
          )
        }
      } else {
        throw new Error(`Object "${objectName}" not found in ${targetSystem.toUpperCase()}.`)
      }
    }

    // 现在用正确的 URI 打开 diff
    await vscode.commands.executeCommand(
      "vscode.diff",
      sourceUri, // 左侧（当前系统）
      finalTargetUri, // 右侧（目标系统）
      diffTitle // diff 编辑器的标题
    )
  } catch (error) {
    window.showErrorMessage(`Failed to compare: ${error}`)
  }
}

/**
 * 注册比较命令
 */
export function registerCompareWithSystemCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.compareWithOtherSystem", compareWithOtherSystem)
  )
}
