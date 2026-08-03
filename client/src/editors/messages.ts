import {
  CustomTextEditorProvider,
  TextDocument,
  WebviewPanel,
  CancellationToken,
  ExtensionContext,
  Webview,
  Uri,
  ViewColumn,
  Range,
  WorkspaceEdit,
  workspace
} from "vscode"
import { XMLParser } from "fast-xml-parser"
import { decode } from "html-entities"
import path from "path"
import { getClient } from "../adt/conections"
import { funWindow as window } from "../services/funMessenger"

const parser = new XMLParser({
  parseAttributeValue: true,
  ignoreAttributes: false
})
const xmlNode = (xml: any, ...xmlpath: string[]) => {
  xmlpath = xmlpath.flatMap(x => x.split("/")).filter(x => x)
  let cur = xml
  for (const p of xmlpath) cur = cur && cur[p]
  return cur
}

const xmlArray = (xml: any, ...xmlpath: string[]) => {
  const target = xmlNode(xml, ...xmlpath)
  if (!target) return []
  return Array.isArray(target) ? target : [target]
}

/**
 * 从 XML 源码提取消息类名
 */
const getMessageClassName = (source: string): string => {
  const raw = parser.parse(source)
  const messageClass = xmlNode(raw, "mc:messageClass")
  // 先尝试 adtcore:name 属性，然后回退到从链接解析
  const name = messageClass?.["@_adtcore:name"]
  if (name) return name

  // 回退：尝试从现有消息链接提取
  const linkMatch = source.match(/\/messageclass\/([^/]+)\/messages/i)
  if (linkMatch) return linkMatch[1]

  return "UNKNOWN"
}

const parseMessages = (source: string) => {
  const raw = parser.parse(source)
  const rawMessages = xmlArray(raw, "mc:messageClass", "mc:messages")
  return rawMessages.map(m => {
    const link = xmlArray(m, "atom:link").find(
      l => l["@_rel"] === "http://www.sap.com/adt/relations/messageclasses/messages/longtext"
    )?.[" @_href"]

    // 确保消息编号始终是 3 位数字（零填充）
    const msgno = String(m["@_mc:msgno"]).padStart(3, "0")

    return {
      number: msgno,
      text: decode(m["@_mc:msgtext"]),
      selfexplainatory: m["@_mc:selfexplainatory"],
      link
    }
  })
}

export class MessagesProvider implements CustomTextEditorProvider {
  public static register(context: ExtensionContext) {
    const provider = new MessagesProvider(context)
    return window.registerCustomEditorProvider("abapfs.msagn", provider, {
      webviewOptions: {
        retainContextWhenHidden: true
      }
    })
  }
  constructor(private context: ExtensionContext) {}
  resolveCustomTextEditor(document: TextDocument, panel: WebviewPanel, token: CancellationToken) {
    panel.webview.options = { enableScripts: true, enableCommandUris: true }

    // 更新 Webview 内容的函数
    const updateWebview = () => {
      panel.webview.html = this.toHtml(panel.webview, document.getText())
    }

    // 初始渲染
    updateWebview()

    // 监听文档变化
    const changeDocumentSubscription = workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview()
      }
    })

    // 处理来自 Webview 的消息
    panel.webview.onDidReceiveMessage(async message => {
      switch (message?.type) {
        case "doc":
          if (message?.url) {
            const client = getClient(document.uri.authority)
            const contents = await client.httpClient.request(message.url)
            window.createWebviewPanel(
              "LONGTEXT",
              "ABAP message long text",
              ViewColumn.Beside
            ).webview.html = contents.body
          }
          break

        case "requestEdit":
          // 来自 Webview 的显示编辑对话框请求
          if (typeof message.number !== "undefined" && typeof message.currentText !== "undefined") {
            const newText = await window.showInputBox({
              prompt: `Edit message ${message.number}`,
              value: message.currentText,
              validateInput: value => {
                if (!value || value.trim().length === 0) {
                  return "Message text cannot be empty"
                }
                if (value.length > 72) {
                  return "Message text should not exceed 72 characters"
                }
                return null
              }
            })

            if (newText && newText !== message.currentText) {
              this.updateMessageText(document, message.number, newText)
            }
          }
          break

        case "edit":
          // 处理消息文本编辑（直接来自 Webview - 已弃用）
          if (typeof message.number !== "undefined" && typeof message.text !== "undefined") {
            this.updateMessageText(document, message.number, message.text)
          }
          break

        case "add":
          // 处理添加新消息
          this.addNewMessage(document)
          break

        case "delete":
          // 处理删除消息
          if (typeof message.number !== "undefined") {
            this.deleteMessage(document, message.number)
          }
          break

        case "openXml":
          // 在表格视图旁边打开原始 XML 编辑器
          window.showTextDocument(document, ViewColumn.Beside)
          break
      }
    })

    // 销毁时清理
    panel.onDidDispose(() => {
      changeDocumentSubscription.dispose()
    })
  }

  /**
   * 向 XML 文档添加新消息
   */
  private async addNewMessage(document: TextDocument) {
    const docText = document.getText()

    // 获取现有消息以找到下一个可用编号
    const messages = parseMessages(docText)
    const existingNumbers = messages.map(m => parseInt(m.number)).filter(n => !isNaN(n))

    // 检查是否有已删除的消息 - 如果有，找到第一个空档或所有消息之后的下一个编号
    const deletedMessagesPattern = /<mc:deletedmessages[^>]*mc:msgno="(\d+)"/g
    const deletedNumbers = new Set<number>()
    let match
    while ((match = deletedMessagesPattern.exec(docText)) !== null) {
      deletedNumbers.add(parseInt(match[1]))
    }

    // 查找不在现有消息或已删除消息中的下一个可用编号
    let nextNumber = 1
    while (existingNumbers.includes(nextNumber) || deletedNumbers.has(nextNumber)) {
      nextNumber++
    }

    const paddedNumber = String(nextNumber).padStart(3, "0")

    // 询问用户消息文本
    const messageText = await window.showInputBox({
      prompt: `Enter text for message ${paddedNumber}`,
      placeHolder: "Message text",
      validateInput: value => {
        if (!value || value.trim().length === 0) {
          return "Message text cannot be empty"
        }
        if (value.length > 72) {
          return "Message text should not exceed 72 characters"
        }
        return null
      }
    })

    if (!messageText) {
      return // 用户已取消
    }

    const text = document.getText()

    // 从文档动态获取消息类名
    const messageClassName = getMessageClassName(text)
    const messageClassNameUpper = messageClassName.toUpperCase()
    const messageClassNameLower = messageClassName.toLowerCase()

    // 创建新消息 XML 条目（匹配 SAP 带所有属性的格式）
    const newMessageXml =
      `<mc:messages mc:msgno="${paddedNumber}" mc:msgtext="${messageText}" mc:selfexplainatory="false" mc:documented="false" mc:lastchangedby="" mc:lastmodified="" adtcore:name="">\n` +
      `  <atom:link href="/sap/bc/adt/vit/docu/object_type/NA/object_name/${messageClassNameUpper}${paddedNumber}" rel="http://www.sap.com/adt/relations/longtext" xmlns:atom="http://www.w3.org/2005/Atom"/>\n` +
      `  <atom:link href="/sap/bc/adt/messageclass/${messageClassNameLower}/messages/${paddedNumber}" rel="http://www.sap.com/adt/relations/messageclasses/messages" xmlns:atom="http://www.w3.org/2005/Atom"/>\n` +
      `</mc:messages>\n\n`

    let insertPosition: number

    // 重要：新消息必须放在任何 deletedmessages 之前！
    // SAP 期望：先 <mc:messages>...</mc:messages>，然后 <mc:deletedmessages>...</mc:deletedmessages>

    // 首先，尝试找到第一个 <mc:deletedmessages> 标签
    const firstDeletedMatch = text.match(/<mc:deletedmessages/)

    if (firstDeletedMatch && firstDeletedMatch.index !== undefined) {
      // 在第一个 deletedmessages 标签之前插入
      insertPosition = firstDeletedMatch.index
    } else {
      // 没有已删除消息 - 尝试找到最后一个 </mc:messages> 闭合标签
      const messagesPattern = /<\/mc:messages>/g
      let lastMatch
      let match
      while ((match = messagesPattern.exec(text)) !== null) {
        lastMatch = match
      }

      if (lastMatch && lastMatch.index !== undefined) {
        // 在最后一个普通消息闭合标签之后插入
        insertPosition = lastMatch.index + lastMatch[0].length
      } else {
        // 没有消息 - 在 </mc:messageClass> 之前插入
        const messageClassClosing = text.indexOf("</mc:messageClass>")
        if (messageClassClosing === -1) {
          window.showErrorMessage("Could not find valid location to insert message in XML")
          return
        }
        insertPosition = messageClassClosing
      }
    }

    const updatedText =
      text.substring(0, insertPosition) + newMessageXml + text.substring(insertPosition)

    // 应用编辑
    const fullRange = new Range(document.positionAt(0), document.positionAt(text.length))

    const workspaceEdit = new WorkspaceEdit()
    workspaceEdit.replace(document.uri, fullRange, updatedText)
    await workspace.applyEdit(workspaceEdit)

    window.showInformationMessage(`✅ Message ${paddedNumber} added successfully`)
  }

  /**
   * 更新 XML 文档中的消息文本
   */
  private async updateMessageText(
    document: TextDocument,
    msgNumber: string,
    newMessageText: string
  ) {
    const text = document.getText()

    // 用正则查找 XML 文本中的消息
    // 匹配：mc:msgtext="..."，其中消息附近有 mc:msgno="XXX"
    const msgPattern = /(mc:msgtext=")([^"]*)(")/g

    let replacementCount = 0
    const updatedText = text.replace(msgPattern, (match, prefix, oldText, suffix, offset) => {
      // 获取此匹配之前的上下文以找到消息编号
      const contextBefore = text.substring(Math.max(0, offset - 200), offset)

      // 检查这是否是正确的消息编号
      if (contextBefore.includes(`mc:msgno="${msgNumber}"`)) {
        replacementCount++
        return `${prefix}${newMessageText}${suffix}`
      }
      return match
    })

    if (replacementCount === 0) {
      window.showErrorMessage(`Could not find message ${msgNumber} in XML`)
      return
    }

    // 应用编辑
    const fullRange = new Range(document.positionAt(0), document.positionAt(text.length))

    const workspaceEdit = new WorkspaceEdit()
    workspaceEdit.replace(document.uri, fullRange, updatedText)
    await workspace.applyEdit(workspaceEdit)

    window.showInformationMessage(`✅ Message ${msgNumber} updated`)
  }

  /**
   * 从 XML 文档删除消息
   */
  private async deleteMessage(document: TextDocument, msgNumber: string) {
    // 确认删除
    const confirmation = await window.showWarningMessage(
      `Delete message ${msgNumber}?`,
      { modal: true },
      "Delete"
    )

    if (confirmation !== "Delete") {
      return // 用户已取消
    }

    const text = document.getText()

    // 为 SAP 删除把 <mc:messages> 转换为 <mc:deletedmessages>
    // 第 1 步：替换开始标签
    const openingTagPattern = new RegExp(`<mc:messages([^>]*mc:msgno="${msgNumber}"[^>]*)>`, "g")

    let updatedText = text.replace(openingTagPattern, "<mc:deletedmessages$1>")

    if (updatedText === text) {
      window.showErrorMessage(`Could not find message ${msgNumber} in XML`)
      return
    }

    // 第 2 步：替换此特定消息的闭合标签
    // 在我们转换后的开始标签之后找到第一个 </mc:messages>
    const openingIndex = updatedText.indexOf("<mc:deletedmessages")
    if (openingIndex !== -1) {
      const afterOpening = updatedText.substring(openingIndex)
      const closingMatch = afterOpening.match(/<\/mc:messages>/)

      if (closingMatch && closingMatch.index !== undefined) {
        const closingIndex = openingIndex + closingMatch.index
        updatedText =
          updatedText.substring(0, closingIndex) +
          "</mc:deletedmessages>" +
          updatedText.substring(closingIndex + "</mc:messages>".length)
      }
    }

    // 应用编辑
    const fullRange = new Range(document.positionAt(0), document.positionAt(text.length))

    const workspaceEdit = new WorkspaceEdit()
    workspaceEdit.replace(document.uri, fullRange, updatedText)
    await workspace.applyEdit(workspaceEdit)

    window.showInformationMessage(`✅ Message ${msgNumber} deleted`)
  }

  private toHtml(webview: Webview, source: string) {
    const header = `<tr><th>number</th><th>text</th><th>self explainatory</th><th>actions</th></tr>`
    const messages = parseMessages(source)
    const body = messages
      .map(m => {
        const escapedText = m.text.replace(/'/g, "\\'").replace(/"/g, "&quot;")
        const mainline = m.link
          ? `<a href=${m.link} onclick="send(event,'${m.link}')">${m.text}</a>`
          : `<span class="editable-text" ondblclick="editMessage('${m.number}', '${escapedText}')">${m.text}</span>`

        return `<tr data-msg="${m.number}">
          <td class="number">${m.number}</td>
          <td class="message-text">${mainline}</td>
          <td class="flag">${m.selfexplainatory ? "\u2713" : ""}</td>
          <td class="actions">
            <button onclick="editMessage('${m.number}', '${escapedText}')" title="Edit message text">✏️</button>
            <button onclick="deleteMessage('${m.number}')" title="Delete message">🗑️</button>
          </td>
          </tr>`
      })
      .join("\n")

    const styleUri = webview.asWebviewUri(
      Uri.file(path.join(this.context.extensionPath, "client/media", "editor.css"))
    )

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
    <title>Message Class</title>
    <link href="${styleUri}" rel="stylesheet" />
    <style>
      .editable-text {
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 3px;
      }
      .editable-text:hover {
        background-color: var(--vscode-list-hoverBackground);
      }
      .actions button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 4px 8px;
        cursor: pointer;
        border-radius: 3px;
        font-size: 12px;
      }
      .actions button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .toolbar {
        padding: 10px;
        border-bottom: 1px solid var(--vscode-panel-border);
        background: var(--vscode-editor-background);
      }
      .toolbar button {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 6px 12px;
        cursor: pointer;
        border-radius: 3px;
        margin-right: 8px;
      }
      .toolbar button:hover {
        background: var(--vscode-button-hoverBackground);
      }
      td.message-text {
        max-width: 500px;
      }
    </style>
    <script>
    const vscode = acquireVsCodeApi();
    
    function send(event, url) {
        event.preventDefault();
        vscode.postMessage({type:"doc", url});
    }
    
    function editMessage(msgNumber, currentText) {
        // Send request to VS Code to show input box
        vscode.postMessage({
            type: 'requestEdit',
            number: msgNumber,
            currentText: currentText
        });
    }
    
    function deleteMessage(msgNumber) {
        // Send delete request to VS Code
        vscode.postMessage({
            type: 'delete',
            number: msgNumber
        });
    }
    
    function openXmlEditor() {
        vscode.postMessage({type: 'openXml'});
    }
    
    function addNewMessage() {
        vscode.postMessage({type: 'add'});
    }
    </script></head>
    <body>
    <div class="toolbar">
      <button onclick="addNewMessage()">➕ Add Message</button>
      <button onclick="openXmlEditor()">📝 Open XML Editor</button>
      <span style="color: var(--vscode-descriptionForeground); margin-left: 10px;">
        💡 Double-click message text or use ✏️ button to edit
      </span>
    </div>
    <table><thead>${header}</thead>
    <tbody>${body}</tbody>
    </table></body></html>`
  }
}
