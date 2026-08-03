import * as vscode from "vscode"
import { funWindow as window } from "../services/funMessenger"
import { getClient, getRoot } from "../adt/conections"
import {
  getTextElementsSafe,
  updateTextElementsWithTransport,
  TextElement
} from "../adt/textElements"
import { logCommands } from "../services/abapCopilotLogger"
import { session_types } from "abap-adt-api"
import { logTelemetry } from "../services/telemetry"
import { isAbapFile } from "abapfs"
import { parseObjectName } from "../adt/textElements"
import { SapGuiPanel } from "../views/sapgui/SapGuiPanel"
import { RemoteManager } from "../config"

/**
 * 把 ABAP 对象类型（例如 "PROG/P"）映射为下游 `parseObjectName`
 * 用来区分程序、类、函数组和函数模块的伪文件名后缀。
 *
 * 这里使用 `file.object.type`（而不是解析 URI 路径）可以让命令
 * 在任何 SAP 登录语言下正常工作：URI 路径包含本地化类别标签
 * （例如 "Programs" / "Programme" / "Zdrojové programy"），
 * 而 ADT 对象类型是稳定、与语言无关的标识符。
 *
 * 注意：`FUGR/F`（组）和 `FUGR/FF`（模块）在 `abapObject` 中都使用
 * `.fugr.abap` 扩展名，所以我们为单个函数模块合成 `.func.abap`，
 * 以便下游区分它们。
 */
function objectNameForType(name: string, type: string): string | undefined {
  switch (type) {
    case "PROG/P":
      return name + ".prog.abap"
    case "CLAS/OC":
      return name + ".clas.abap"
    case "FUGR/F":
      return name + ".fugr.abap"
    case "FUGR/FF":
      return name + ".func.abap"
    default:
      return undefined
  }
}

/**
 * 管理文本元素命令
 * 打开用于管理文本元素（读取/创建/编辑/删除）的 Webview
 * 可以从命令面板、右键菜单或活动编辑器调用
 */
export async function manageTextElementsCommand(uri?: vscode.Uri): Promise<void> {
  try {
    // 从上下文确定程序名 - 只从打开的 ABAP 文件
    let objectName: string | undefined
    let sourceUri: vscode.Uri | undefined

    if (uri) {
      // 从右键菜单或特定文件调用
      if (uri.scheme !== "adt") {
        window.showErrorMessage(
          "Text Elements Manager only works with ABAP files. Please open an ABAP file first."
        )
        return
      }
      sourceUri = uri
    } else {
      // 从命令面板调用 - 从活动编辑器获取
      const activeEditor = window.activeTextEditor
      if (!activeEditor || activeEditor.document.uri.scheme !== "adt") {
        window.showErrorMessage(
          "Text Elements Manager only works with ABAP files. Please open an ABAP file first."
        )
        return
      }
      sourceUri = activeEditor.document.uri
    }

    if (!sourceUri) {
      window.showErrorMessage("Could not determine ABAP file.")
      return
    }

    // 通过 abapfs API 解析 ABAP 对象。`file.object.type` 和
    // `file.object.name` 直接来自 ADT（`adtcore:type` / `adtcore:name`），
    // 且与语言无关——不像 URI 路径包含本地化类别标签
    // （"Programs" / "Programme" / "Zdrojové programy"）。
    // 原始本地化 bug 见 GitHub issue #445。
    try {
      const root = getRoot(sourceUri.authority)
      const file = await root.getNodeAsync(sourceUri.path)

      if (!isAbapFile(file)) {
        window.showErrorMessage("Could not determine program name from the current ABAP file.")
        return
      }

      const obj = file.object
      if (obj.type === "PROG/I") {
        // Include — 解析到它的主程序并取第一个。
        const mainPrograms = await obj.mainPrograms()
        const mainProgName = mainPrograms?.[0]?.["adtcore:name"]
        if (mainProgName) {
          objectName = mainProgName + ".prog.abap"
        }
      } else if (obj.type === "FUGR/FF" && obj.parent?.type === "FUGR/F") {
        // 函数模块 — 文本元素位于函数组级别，
        // 没有按模块划分的文本池。解析到父组。
        objectName = obj.parent.name + ".fugr.abap"
      } else {
        objectName = objectNameForType(obj.name, obj.type)
      }
    } catch (error) {
      logCommands.error(`Error resolving object: ${error}`)
    }

    if (!objectName) {
      window.showErrorMessage("Could not determine program name from the current ABAP file.")
      return
    }

    logTelemetry("command_text_elements_manager_called", { connectionId: sourceUri.authority })

    await showTextElementsEditor(objectName.trim(), sourceUri)
  } catch (error) {
    logCommands.error(`Error opening text elements manager: ${error}`)
    window.showErrorMessage(`Failed to open text elements manager: ${error}`)
  }
}

/**
 * 为程序显示文本元素管理器
 */
async function showTextElementsEditor(programName: string, sourceUri: vscode.Uri): Promise<void> {
  // 获取 ADT 连接 - 获取活动连接或询问用户
  const activeEditor = window.activeTextEditor
  let connectionId: string

  if (activeEditor && activeEditor.document.uri.scheme === "adt") {
    connectionId = activeEditor.document.uri.authority
  } else {
    window.showErrorMessage("No ADT connection available. Please open an ABAP file first.")
    return
  }

  const client = getClient(connectionId)
  if (!client) {
    window.showErrorMessage("No ADT connection available. Please connect to an SAP system first.")
    return
  }

  // 加载时显示进度
  await window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Loading text elements for ${programName}...`,
      cancellable: false
    },
    async progress => {
      try {
        progress.report({ increment: 30, message: "Fetching text elements..." })

        const result = await getTextElementsSafe(client, programName)

        progress.report({ increment: 70, message: "Opening editor..." })

        // 创建并显示文本元素管理器 Webview
        await createTextElementsWebview(programName, result.textElements, connectionId, sourceUri)
      } catch (error) {
        // 检查是否为 "Resource does not exist" 错误 - 旧系统回退到 SAP GUI
        const errorMessage = String(error)
        if (errorMessage.includes("Resource") && errorMessage.includes("does not exist")) {
          progress.report({ increment: 50, message: "Falling back to SAP GUI..." })

          // 使用现有逻辑确定对象类型并为文本元素构建 SAP GUI URL
          await openTextElementsInSapGui(programName, connectionId)

          window.showInformationMessage(
            `Text elements ADT API not available for this system. Opened text elements editor in SAP GUI instead.`
          )
        } else {
          throw error
        }
      }
    }
  )
}

/**
 * 在 SAP GUI 中打开文本元素编辑器，作为旧系统的回退
 * 复用现有 SAP GUI 基础设施
 */
export async function openTextElementsInSapGui(
  programName: string,
  connectionId: string
): Promise<void> {
  try {
    // 解析对象名以确定类型
    const objectInfo = parseObjectName(programName)

    // 获取 ADT 客户端
    const client = getClient(connectionId)

    // 映射到 SAP GUI 对象类型
    let sapGuiObjectType: string
    switch (objectInfo.type) {
      case "CLASS":
        sapGuiObjectType = "CLAS/OC"
        break
      case "FUNCTION_GROUP":
        sapGuiObjectType = "FUGR/FF"
        break
      case "FUNCTION_MODULE":
        // 单个函数模块直接用 SE37 和 FM 名
        sapGuiObjectType = "FUNC/FM"
        break
      case "PROGRAM":
      default:
        sapGuiObjectType = "PROG/P"
        break
    }

    // 获取扩展 URI（与可用的嵌入式 GUI 相同）
    let extensionUri: vscode.Uri
    try {
      const extension = vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")
      if (extension) {
        extensionUri = extension.extensionUri
      } else {
        const altExtension = vscode.extensions.getExtension("abap-copilot")
        if (altExtension) {
          extensionUri = altExtension.extensionUri
        } else {
          extensionUri = vscode.Uri.file(__dirname)
        }
      }
    } catch (error) {
      extensionUri = vscode.Uri.file(__dirname)
    }

    // 使用完全相同的工作逻辑创建面板
    const panel = SapGuiPanel.createOrShow(
      extensionUri,
      client,
      connectionId,
      objectInfo.name,
      sapGuiObjectType
    )

    // 构建文本元素 URL
    const baseUrl = await panel.buildWebGuiUrl()

    // 对文本元素，不同对象类型需要不同方法
    let textElementsUrl: string

    if (sapGuiObjectType === "CLAS/OC") {
      // 对类：使用预填类名的 SE24（类构建器）
      const config = RemoteManager.get().byId(connectionId)
      if (!config) {
        throw new Error(`Connection configuration not found for ${connectionId}`)
      }

      let baseUrlForSE24 = config.url.replace(/\/sap\/bc\/adt.*$/, "")
      if (!baseUrlForSE24.startsWith("https://") && !baseUrlForSE24.startsWith("http://")) {
        baseUrlForSE24 = "https://" + baseUrlForSE24
      } else if (baseUrlForSE24.startsWith("http://")) {
        baseUrlForSE24 = baseUrlForSE24.replace("http://", "https://")
      }

      // 使用预填类名的 SE24（类构建器）
      textElementsUrl =
        `${baseUrlForSE24}/sap/bc/gui/sap/its/webgui?` +
        `~transaction=SE24 SEOCLASS-CLSNAME=${objectInfo.cleanName}` +
        `&sap-client=${config.client}` +
        `&sap-language=${config.language || "EN"}` +
        `&saml2=disabled`
    } else if (sapGuiObjectType === "FUGR/FF" || sapGuiObjectType === "FUNC/FM") {
      // 对函数模块和函数组：带 TEXT okcode 的 SE37
      textElementsUrl = baseUrl.replace("DYNP_OKCODE%3dWB_EXEC", "DYNP_OKCODE%3dTEXT")
    } else {
      // 对程序：带 TEXT okcode 的 SE38 可以正常工作
      textElementsUrl = baseUrl.replace("DYNP_OKCODE%3dSTRT", "DYNP_OKCODE%3dTEXT")
    }

    // 直接加载文本元素 URL
    panel.loadDirectWebGuiUrl(textElementsUrl)
  } catch (error) {
    logCommands.error(`❌ Error opening SAP GUI text elements: ${error}`)
    throw error
  }
}

/**
 * 创建并显示文本元素管理器 Webview
 */
async function createTextElementsWebview(
  programName: string,
  textElements: TextElement[],
  connectionId: string,
  sourceUri: vscode.Uri
): Promise<void> {
  const panel = window.createWebviewPanel(
    "textElementsManager",
    `Text Elements Manager - ${programName}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: []
    }
  )

  // 设置 Webview HTML 内容
  panel.webview.html = getTextElementsWebviewContent(programName, textElements)

  // 处理来自 Webview 的消息
  panel.webview.onDidReceiveMessage(async message => {
    switch (message.command) {
      // 🚫 已禁用：保存功能因锁句柄问题被禁用

      case "save":
        await handleSaveTextElements(
          programName,
          message.textElements,
          panel,
          connectionId,
          sourceUri
        )
        break

      case "refresh":
        await handleRefreshTextElements(programName, panel, connectionId)
        break
      // 🚫 已禁用：添加/删除功能被禁用

      case "add":
        // 添加空行 - 在 Webview 中处理
        break
      case "delete":
        // 删除行 - 在 Webview 中处理
        break
    }
  })

  // 显示面板
  panel.reveal()
}

/**
 * 处理来自 Webview 的文本元素保存
 * 🚫 已禁用：保存功能因锁句柄问题被禁用
 */

async function handleSaveTextElements(
  programName: string,
  textElements: TextElement[],
  panel: vscode.WebviewPanel,
  connectionId: string,
  sourceUri: vscode.Uri
): Promise<void> {
  try {
    // 用原始上下文中的 connectionId 获取客户端 - 获取原始客户端而不是克隆
    const client = getClient(connectionId, false) // false = 不克隆，获取原始客户端
    if (!client) {
      window.showErrorMessage(`No ADT connection available for ${connectionId}.`)
      return
    }
    client.stateful = session_types.stateful

    await window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Saving text elements for ${programName}...`,
        cancellable: false
      },
      async progress => {
        progress.report({ increment: 30, message: "Validating..." })

        // 过滤掉空的文本元素
        const validTextElements = textElements.filter(te => te.id && te.text)

        if (validTextElements.length === 0) {
          throw new Error("No valid text elements to save")
        }

        progress.report({ increment: 60, message: "Saving to SAP system..." })
        // 修改下面这行，不使用锁管理器版本的函数
        await updateTextElementsWithTransport(
          client,
          programName,
          validTextElements,
          sourceUri.toString()
        )

        progress.report({ increment: 100, message: "Saved successfully" })
      }
    )

    window.showInformationMessage(`Text elements saved successfully for ${programName}`)

    // 向 Webview 发送成功消息
    panel.webview.postMessage({ command: "saveSuccess" })
  } catch (error) {
    logCommands.error(`Error saving text elements: ${error}`)
    window.showErrorMessage(`Failed to save text elements: ${error}`)

    // 向 Webview 发送错误消息
    panel.webview.postMessage({ command: "saveError", error: String(error) })
  }
}

/**
 * 处理来自 Webview 的文本元素刷新
 */
async function handleRefreshTextElements(
  programName: string,
  panel: vscode.WebviewPanel,
  connectionId: string
): Promise<void> {
  try {
    // 用原始上下文中的 connectionId 获取客户端
    const client = getClient(connectionId)
    if (!client) {
      window.showErrorMessage(`No ADT connection available for ${connectionId}.`)
      panel.webview.postMessage({
        command: "refreshError",
        error: `No ADT connection available for ${connectionId}`
      })
      return
    }

    // 从 SAP 重新加载文本元素
    const result = await getTextElementsSafe(client, programName)

    // 向 Webview 发送更新后的数据
    panel.webview.postMessage({
      command: "refresh",
      textElements: result.textElements
    })
  } catch (error: any) {
    logCommands.error(`Error refreshing text elements: ${error}`)
    window.showErrorMessage(`Failed to refresh text elements: ${error.message}`)

    // 向 Webview 发送错误消息
    panel.webview.postMessage({
      command: "refreshError",
      error: error.message || String(error)
    })
  }
}

/**
 * 生成文本元素 Webview 的 HTML 内容
 */
function getTextElementsWebviewContent(programName: string, textElements: TextElement[]): string {
  const textElementsJson = JSON.stringify(textElements)

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Text Elements - ${programName}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 20px;
        }
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
        }
        .title {
            font-size: 18px;
            font-weight: bold;
        }
        .buttons {
            display: flex;
            gap: 10px;
        }
        .btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 13px;
        }
        .btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .btn.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 8px 12px;
            text-align: left;
        }
        th {
            background-color: var(--vscode-list-headerBackground);
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: var(--vscode-list-evenBackground);
        }
        tr:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        input {
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
            padding: 4px 8px;
            width: 100%;
            box-sizing: border-box;
        }
        input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .id-input {
            width: 80px;
        }
        .maxlength-input {
            width: 80px;
        }
        .delete-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 11px;
        }
        .delete-btn:hover {
            background-color: var(--vscode-errorBackground);
            color: var(--vscode-errorForeground);
        }
        .status {
            margin-top: 10px;
            padding: 8px;
            border-radius: 3px;
            display: none;
        }
        .status.success {
            background-color: var(--vscode-testing-iconPassed);
            color: white;
        }
        .status.error {
            background-color: var(--vscode-testing-iconFailed);
            color: white;
        }
        .empty-message {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .program-info {
            background-color: var(--vscode-list-headerBackground);
            padding: 10px 15px;
            border-radius: 3px;
            margin-bottom: 15px;
            font-size: 12px;
        }
        .validation-error {
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
        .row-number {
            width: 40px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">� Text Elements Manager - ${programName}</div>
        <div class="buttons">
            <button class="btn secondary" onclick="refreshTextElements()">🔄 Refresh</button>
            <button class="btn secondary" onclick="addRow()">➕ Add Text Element</button> 
            <button class="btn" onclick="saveTextElements()">💾 Save & Activate</button>
        </div>
    </div>
    
    <div id="status" class="status"></div>
    
    <div class="program-info">
        <strong>Object:</strong> ${programName} | <strong>Text Elements:</strong> <span id="elementCount">${textElements.length}</span>
    </div>
    
    <div id="content">
        <table id="textElementsTable">
            <thead>
                <tr>
                    <th class="row-number">#</th>
                    <th>ID</th>
                    <th>Text</th>
                    <th>Max Length</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody id="tableBody">
                <!-- Rows will be populated by JavaScript -->
            </tbody>
        </table>
        
        <div id="emptyMessage" class="empty-message" style="display: none;">
            No text elements found in this object.
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let textElements = ${textElementsJson};
        
        function renderTable() {
            const tbody = document.getElementById('tableBody');
            const emptyMessage = document.getElementById('emptyMessage');
            
            if (textElements.length === 0) {
                tbody.innerHTML = '';
                emptyMessage.style.display = 'block';
                return;
            }
            
            emptyMessage.style.display = 'none';
            
            tbody.innerHTML = textElements.map((element, index) => \`
                <tr>
                    <td class="row-number">\${index + 1}</td>
                    <td>
                        <input type="text" class="id-input" value="\${element.id || ''}" 
                             onchange="updateElement(\${index}, 'id', this.value.toUpperCase())"
                             maxlength="8"
                             pattern="[A-Z0-9_]*"
                             title="1-8 characters, letters, numbers, underscore only"
                             placeholder="e.g., 001">
                    </td>
                    <td>
                        <input type="text" value="\${element.text || ''}" 
                             onchange="updateElement(\${index}, 'text', this.value)"
                             placeholder="Enter text content"> 
                    </td>
                    <td>
                        <input type="number" class="maxlength-input" value="\${element.maxLength || ''}" 
                             onchange="updateElement(\${index}, 'maxLength', parseInt(this.value))"
                             min="1" max="255"
                             placeholder="Auto"
                             title="Maximum length for this text element">
                    </td>
                    <td>
                        <button class="delete-btn" onclick="deleteRow(\${index})" title="Delete this text element">🗑️</button>
                    </td> 
                </tr>
            \`).join('');
        }
        
        // 🚫 DISABLED: Add row functionality disabled due to lock handle issues
        
        function addRow() {
            // Auto-generate next available ID
            const usedIds = new Set(textElements.map(te => te.id).filter(id => id));
            let nextId = '';
            
            // Find next available numeric ID (001, 002, etc.)
            for (let i = 1; i <= 999; i++) {
                const candidateId = i.toString().padStart(3, '0');
                if (!usedIds.has(candidateId)) {
                    nextId = candidateId;
                    break;
                }
            }
            
            textElements.push({ id: nextId, text: '', maxLength: undefined });
            renderTable();
            updateElementCount();
            
            // Focus on the new text input
            setTimeout(() => {
                const rows = document.querySelectorAll('#tableBody tr');
                const lastRow = rows[rows.length - 1];
                const textInput = lastRow.querySelector('input[type="text"]:nth-of-type(2)');
                if (textInput) textInput.focus();
            }, 100);
        }
        
        
        function refreshTextElements() {
            showStatus('success', 'Refreshing text elements...');
            vscode.postMessage({
                command: 'refresh'
            });
        }
        
        // 🚫 DISABLED: Delete row functionality disabled due to lock handle issues
        
        function deleteRow(index) {
            if (confirm(\`Delete text element '\${textElements[index].id}' - '\${textElements[index].text}'?\`)) {
                textElements.splice(index, 1);
                renderTable();
                updateElementCount();
            }
        }
        
        
        function updateElementCount() {
            document.getElementById('elementCount').textContent = textElements.length;
        }
        
        // 🚫 DISABLED: Update element functionality disabled due to lock handle issues
        
        function updateElement(index, field, value) {
            if (field === 'id') {
                value = value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
            }
            
            textElements[index][field] = value;
            
            // Auto-update maxLength based on text length if it's currently undefined/empty
            if (field === 'text' && value) {
                const currentMaxLength = textElements[index].maxLength;
                if (!currentMaxLength || currentMaxLength === '' || isNaN(currentMaxLength)) {
                    // Auto-calculate: at least text length + some buffer (minimum 10)
                    const autoLength = Math.max(value.length + 5, 10);
                    textElements[index].maxLength = autoLength;
                    
                    // Update the input field visually
                    const row = document.querySelectorAll('#tableBody tr')[index];
                    const maxLengthInput = row.querySelector('input[type="number"]');
                    if (maxLengthInput) {
                        maxLengthInput.value = autoLength;
                    }
                }
            }
        }
        
        
        // 🚫 DISABLED: Save functionality disabled due to lock handle issues
        
        function saveTextElements() {
            // Validate before saving
            const errors = [];
            const usedIds = new Set();
            
            textElements.forEach((element, index) => {
                if (!element.id) {
                    errors.push(\`Row \${index + 1}: ID is required\`);
                } else if (usedIds.has(element.id)) {
                    errors.push(\`Row \${index + 1}: Duplicate ID '\${element.id}'\`);
                } else {
                    usedIds.add(element.id);
                }
                
                if (!element.text) {
                    errors.push(\`Row \${index + 1}: Text is required\`);
                }
                
                if (element.maxLength && element.text && element.text.length > element.maxLength) {
                    errors.push(\`Row \${index + 1}: Text length (\${element.text.length}) exceeds max length (\${element.maxLength})\`);
                }
            });
            
            if (errors.length > 0) {
                showStatus('error', 'Validation errors:\\n' + errors.join('\\n'));
                return;
            }
            
            // Filter out empty rows
            const validElements = textElements.filter(te => te.id && te.text);
            
            if (validElements.length === 0) {
                showStatus('error', 'No valid text elements to save');
                return;
            }
            
            showStatus('success', 'Saving...');
            vscode.postMessage({
                command: 'save',
                textElements: validElements
            });
        }
        
        
        function showStatus(type, message) {
            const status = document.getElementById('status');
            status.className = 'status ' + type;
            status.textContent = message;
            status.style.display = 'block';
            
            if (type === 'success' && message !== 'Saving...') {
                setTimeout(() => {
                    status.style.display = 'none';
                }, 3000);
            }
        }
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                // 🚫 DISABLED: Save-related message handlers disabled
                
                case 'saveSuccess':
                    showStatus('success', 'Text elements saved successfully!');
                    break;
                case 'saveError':
                    showStatus('error', 'Save failed: ' + message.error);
                    break;
                
                case 'refresh':
                    // Update textElements array and re-render
                    textElements = message.textElements || [];
                    renderTable();
                    updateElementCount();
                    showStatus('success', 'Text elements refreshed successfully!');
                    break;
                case 'refreshError':
                    showStatus('error', 'Refresh failed: ' + message.error);
                    break;
            }
        });
        
        // Initial render
        renderTable();
    </script>
</body>
</html>`
}
