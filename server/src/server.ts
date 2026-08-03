import { CommLogTogglePayload, Methods } from "vscode-abap-remote-fs-sharedapi"
import {
  TextDocuments,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CodeActionKind,
  InitializeResult,
  TextDocumentSyncKind
} from "vscode-languageserver"
import { connection, log, setCommLogActive } from "./clientManager"
import { syntaxCheck } from "./syntaxcheck"
import { completion, completionResolve, signatureHelp } from "./completion"
import { findDefinition, findReferences, cancelSearch } from "./references"
import { documentSymbols } from "./symbols"
import { formatDocument } from "./documentformatter"
import { codeActionHandler } from "./codeActions"
import { updateInclude } from "./objectManager"
import { TextDocument } from "vscode-languageserver-textdocument"
import { renameHandler } from "./rename"
/**
 * 跟踪打开的文档，让服务器可以响应编辑器事件并刷新诊断。
 */
export const documents = new TextDocuments(TextDocument)

let hasConfigurationCapability: boolean = false
let hasWorkspaceFolderCapability: boolean = false
let hasLiteral: boolean = false

/**
 * 语言服务器中 ADT 支持文档使用的 URI 协议。
 */
export const ADTSCHEME = "adt"

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities

  // 客户端是否支持 `workspace/configuration` 请求？
  // 不支持则回退到全局设置
  hasConfigurationCapability = !!(capabilities.workspace && !!capabilities.workspace.configuration)
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  )

  hasLiteral = !!(
    capabilities.textDocument &&
    capabilities.textDocument.codeAction &&
    capabilities.textDocument.codeAction.codeActionLiteralSupport
  )

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      // 告知客户端服务器支持代码补全
      completionProvider: {
        resolveProvider: true
      },
      signatureHelpProvider: {
        triggerCharacters: ["(", ","]
      },
      definitionProvider: true,
      renameProvider: true,
      implementationProvider: {
        documentSelector: [{ scheme: ADTSCHEME, language: "abap" }]
      },
      referencesProvider: true,
      documentSymbolProvider: true,
      documentFormattingProvider: true
    }
  }

  if (hasLiteral)
    result.capabilities.codeActionProvider = {
      codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorExtract]
    }
  return result
})

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // 注册所有配置变化。
    connection.client.register(DidChangeConfigurationNotification.type, undefined)
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(event => {
      log("Workspace folder change event received.")
    })
  }
})

connection.onCompletion(completion)
connection.onCompletionResolve(completionResolve)
connection.onSignatureHelp(signatureHelp)
// Eclipse ADT 风格：Ctrl+Click 先去实现，然后声明
connection.onDefinition(findDefinition.bind(null, true)) // 已互换：现在显示实现
connection.onImplementation(findDefinition.bind(null, false)) // 已互换：现在显示声明
connection.onReferences(findReferences)
connection.onDocumentSymbol(documentSymbols)
connection.onDocumentFormatting(formatDocument)
documents.onDidOpen(e => setTimeout(() => syntaxCheck(e.document), 500))
documents.onDidChangeContent(change => syntaxCheck(change.document))
documents.onDidSave(e => {
  syntaxCheck(e.document)
  // include <-> 程序关系的跨文件语法刷新
  // 检查工作区路径中是否包含 "Includes" 或 "Programs"（不区分大小写、URL 编码）
  const uri = e.document.uri.toLowerCase()
  const isInclude = uri.includes("/includes/") || uri.includes("%2fincludes%2f")
  const isProgram = !isInclude && (uri.includes("/programs/") || uri.includes("%2fprograms%2f"))

  // 延迟确保 SAP 在检查相关文件前已处理保存
  setTimeout(() => {
    if (isInclude) {
      // Include 已保存：重新检查所有打开的程序
      for (const doc of documents.all()) {
        const docUri = doc.uri.toLowerCase()
        const docIsProgram =
          !docUri.includes("/includes/") &&
          !docUri.includes("%2fincludes%2f") &&
          (docUri.includes("/programs/") || docUri.includes("%2fprograms%2f"))
        if (doc.uri !== e.document.uri && docIsProgram) {
          syntaxCheck(doc)
        }
      }
    } else if (isProgram) {
      // 程序已保存：重新检查所有打开的 include
      for (const doc of documents.all()) {
        const docUri = doc.uri.toLowerCase()
        const docIsInclude = docUri.includes("/includes/") || docUri.includes("%2fincludes%2f")
        if (doc.uri !== e.document.uri && docIsInclude) {
          syntaxCheck(doc)
        }
      }
    }
  }, 2000)
})
connection.onCodeAction(codeActionHandler)
connection.onRenameRequest(renameHandler)
// 暴露给客户端的自定义 API
connection.onRequest(Methods.cancelSearch, cancelSearch)
connection.onRequest(Methods.updateMainProgram, updateInclude)
connection.onRequest(Methods.triggerSyntaxCheck, (uri: string) => {
  const doc = documents.get(uri)
  if (doc) syntaxCheck(doc)
})
connection.onNotification(Methods.commLogToggle, setCommLogActive)

documents.listen(connection)
connection.listen()
