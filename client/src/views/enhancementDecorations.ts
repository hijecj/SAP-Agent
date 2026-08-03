/**
 * VSCode 编辑器的增强装饰
 * 像 Eclipse 一样显示增强指示，带悬停支持
 */

import * as vscode from "vscode"
import { funWindow as window } from "../services/funMessenger"
import { logCommands } from "../services/abapCopilotLogger"
import { uriAbapFile } from "../adt/operations/AdtObjectFinder"
import {
  getObjectEnhancements,
  EnhancementInfo,
  EnhancementResult
} from "../services/lm-tools/shared"
import { getOrCreateRoot } from "../adt/conections"

// 增强装饰类型
let enhancementDecorationType: vscode.TextEditorDecorationType

// 增强数据缓存，避免重复 API 调用
const enhancementCache = new Map<string, EnhancementResult>()

// 跟踪待处理的装饰更新，编辑器变化时取消
let pendingDecorationUpdate: AbortController | undefined

/**
 * 初始化增强装饰
 */
export function initializeEnhancementDecorations(context: vscode.ExtensionContext) {
  // 为增强指示创建装饰类型
  enhancementDecorationType = window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 107, 53, 0.15)",
    border: "1px solid rgba(255, 107, 53, 0.5)",
    after: {
      contentText: " 🎯 ENH",
      color: "#FF6B35",
      fontWeight: "bold",
      margin: "0 0 0 5px"
    },
    isWholeLine: false
  })

  // 扩展停用时清理
  context.subscriptions.push({
    dispose: () => {
      enhancementDecorationType?.dispose()
      enhancementCache.clear()
    }
  })
}

/**
 * 更新活动编辑器的增强装饰
 */
export async function updateEnhancementDecorations(editor: vscode.TextEditor) {
  if (!editor || !enhancementDecorationType) {
    return
  }

  // 只处理带 adt:// 协议的 ABAP 文件
  if (editor.document.languageId !== "abap" || editor.document.uri.scheme !== "adt") {
    // 静默跳过非 ABAP 文件（输出面板、设置等）
    return
  }

  // 取消任何待处理的装饰更新
  if (pendingDecorationUpdate) {
    pendingDecorationUpdate.abort()
  }

  // 为此更新创建新的中止控制器
  pendingDecorationUpdate = new AbortController()
  const currentUpdate = pendingDecorationUpdate

  try {
    const documentUri = editor.document.uri.toString()

    // 从 ADT URI 获取连接 ID
    const connectionId = editor.document.uri.authority
    if (!connectionId) {
      logCommands.warn("⚠️ No connection ID found in URI")
      return
    }

    // 双重检查 URI 协议（应该不需要，但作为安全检查）
    if (editor.document.uri.scheme !== "adt") {
      return
    }

    // 使用现有 ABAP 文件工具从文档 URI 提取对象 URI
    let abapFile
    try {
      abapFile = uriAbapFile(editor.document.uri)
    } catch (error) {
      // 只对 adt:// URI 记录错误（忽略其他协议）
      if (editor.document.uri.scheme === "adt") {
        logCommands.error(`❌ Error in uriAbapFile for ${documentUri}: ${error}`)
      }
      return
    }

    if (!abapFile?.object) {
      // 这对新打开的文件是正常的 - 缓存尚未填充
      return
    }

    // 尚未加载时加载结构（contentsPath() 需要）
    if (!abapFile.object.structure) {
      await abapFile.object.loadStructure()
    }

    // 从 ABAP 对象获取 ADT URI - 这取代了手动路径解析
    const objectUri = abapFile.object.contentsPath()

    // 先检查缓存
    const cacheKey = `${connectionId}:${objectUri}`
    let enhancementResult = enhancementCache.get(cacheKey)

    if (!enhancementResult) {
      // 获取增强信息（装饰不需要代码）
      enhancementResult = await getObjectEnhancements(objectUri, connectionId, false)

      // 缓存结果 60 分钟
      enhancementCache.set(cacheKey, enhancementResult)
      setTimeout(() => enhancementCache.delete(cacheKey), 60 * 60 * 1000)
    }

    if (!enhancementResult.hasEnhancements) {
      // 清除任何现有装饰
      editor.setDecorations(enhancementDecorationType, [])
      return
    }

    // 为每个增强位置创建装饰
    const decorations: vscode.DecorationOptions[] = []

    // 按行分组增强，让钩入同一位置的多个实现
    // 不会不可见地相互堆叠
    const byLine = new Map<number, EnhancementInfo[]>()
    for (const enhancement of enhancementResult.enhancements) {
      const startLine = Math.max(0, enhancement.startLine)
      if (startLine >= editor.document.lineCount) continue
      const list = byLine.get(startLine) ?? []
      list.push(enhancement)
      byLine.set(startLine, list)
    }

    for (const [startLine, group] of byLine) {
      const line = editor.document.lineAt(startLine)

      const header =
        group.length === 1
          ? `**🎯 Enhancement: ${group[0].name}**`
          : `**🎯 ${group.length} Enhancements at line ${startLine + 1}**`

      const body = group
        .map(enh => {
          const key = enh.uri ?? enh.name
          const openLink = `[📝 Open](command:abapfs.showEnhancementSource?${encodeURIComponent(
            JSON.stringify([key, objectUri, connectionId])
          )})`
          return `- **${enh.name}** — spot \`${enh.spot}\` ${openLink}`
        })
        .join("\n")

      const hoverMessage = new vscode.MarkdownString(`${header}\n\n${body}`)
      hoverMessage.isTrusted = true // 启用命令链接

      decorations.push({
        range: new vscode.Range(startLine, 0, startLine, line.text.length),
        hoverMessage
      })
    }

    // 应用装饰前检查此更新是否已被取消
    if (currentUpdate.signal.aborted) {
      logCommands.debug("Enhancement decoration update was cancelled (editor changed)")
      return
    }

    // 检查编辑器是否仍是活动的
    if (window.activeTextEditor !== editor) {
      logCommands.debug("Editor is no longer active, skipping decoration update")
      return
    }

    // 应用装饰
    editor.setDecorations(enhancementDecorationType, decorations)
  } catch (error) {
    // 未中止时才记录错误
    if (!currentUpdate.signal.aborted) {
      logCommands.error(`❌ Error updating enhancement decorations: ${error}`)
    }
    // 出错时清除装饰（如果编辑器仍活动）
    if (window.activeTextEditor === editor) {
      editor.setDecorations(enhancementDecorationType, [])
    }
  } finally {
    // 如果这是当前的，清除待处理
    if (pendingDecorationUpdate === currentUpdate) {
      pendingDecorationUpdate = undefined
    }
  }
}

/**
 * 清除编辑器的增强装饰
 */
export function clearEnhancementDecorations(editor: vscode.TextEditor) {
  if (editor && enhancementDecorationType) {
    editor.setDecorations(enhancementDecorationType, [])
  }
}

/**
 * 打开增强进行编辑的命令。
 * `enhancementKey` 是元素 URI（首选、唯一）或实现名（回退）。
 */
/**
 * 打开增强进行编辑的命令。
 * `enhancementKey` 是元素 URI（首选、唯一）或实现名（回退）。
 * `objectUri` 和 `connectionId` 由悬停命令传递 — 不要从活动编辑器
 * 重新推导（它可能已失去焦点给悬停或其他标签页）。
 */
export async function showEnhancementSource(
  enhancementKey: string,
  objectUri: string,
  connectionId: string
) {
  try {
    if (!objectUri || !connectionId) {
      window.showErrorMessage("Missing object URI or connection ID")
      return
    }

    // 直接获取包括宿主对象 URI 的增强信息
    const enhancementResult = await getObjectEnhancements(objectUri, connectionId, false)

    // 先按 uri 匹配（每个元素唯一），对旧调用方回退到名称
    const enhancement =
      enhancementResult.enhancements.find(e => e.uri === enhancementKey) ??
      enhancementResult.enhancements.find(e => e.name === enhancementKey)
    if (!enhancement || !enhancement.uri) {
      window.showWarningMessage(`Could not find enhancement: ${enhancementKey}`)
      return
    }

    // 把增强 ADT URI 转换为 VS Code 工作区 URI
    // 增强 URI 格式：/sap/bc/adt/enhancements/enhoxhh/zxxx/source/main#start=78,0
    // 打开时移除 #start 片段和 /source/main 后缀
    const cleanEnhancementUri = enhancement.uri.split("#")[0].replace("/source/main", "")

    // 构建类似 GetAbapObjectWorkspaceUriTool 逻辑的工作区 URI
    // getOrCreateRoot 已在顶部导入
    const root = await getOrCreateRoot(connectionId)

    // 为此增强 URI 查找工作区路径
    const { path } = (await root.findByAdtUri(cleanEnhancementUri, true)) || {}

    if (!path) {
      window.showErrorMessage(
        `Could not resolve workspace path for enhancement: ${enhancement.name}`
      )
      return
    }

    // 构建工作区 URI
    const workspaceUri = vscode.Uri.parse(`adt://${connectionId}${path}`)

    // 检查文档是否已打开，避免刷新它
    const existingEditor = window.visibleTextEditors.find(
      editor => editor.document.uri.toString() === workspaceUri.toString()
    )

    if (existingEditor) {
      // 文档已打开，直接显示
      await window.showTextDocument(existingEditor.document, {
        preview: false,
        viewColumn: vscode.ViewColumn.Active
      })
    } else {
      // 只在未打开时在 VS Code 中打开增强
      const document = await vscode.workspace.openTextDocument(workspaceUri)
      await window.showTextDocument(document, {
        preview: false,
        viewColumn: vscode.ViewColumn.Active
      })
    }

    //window.showInformationMessage(`✅ Enhancement opened for editing: ${enhancementName}`);
  } catch (error) {
    logCommands.error(`❌ Error opening enhancement: ${error}`)
    window.showErrorMessage(`Failed to open enhancement: ${error}`)
  }
}
