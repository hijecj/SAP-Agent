import * as vscode from "vscode"
import { funWindow as window } from "../../services/funMessenger"
import { ADTClient } from "abap-adt-api"
import { log } from "../../lib"
import { RemoteManager } from "../../config"
import { runInSapGui } from "../../adt/sapgui/sapgui"
import { getObjectTypeConfig } from "abapobject"

/**
 * 管理用于 ABAP 执行的嵌入式 SAP GUI Webview 面板
 * 这提供类似 Eclipse ADT 的功能：可以运行报表
 * 并直接在 VS Code 中查看输出，无需外部 GUI 窗口
 */
export class SapGuiPanel {
  /**
   * 跟踪当前面板。允许为不同报表打开多个面板
   */
  private static currentPanels: Map<string, SapGuiPanel> = new Map()

  public static readonly viewType = "ABAPSapGui"

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private _disposables: vscode.Disposable[] = []

  private _client: ADTClient
  private _connectionId: string
  private _objectName: string
  private _objectType: string

  // 标志：已加载认证 URL 时防止重复执行
  private _authenticatedUrlLoaded: boolean = false

  /**
   * 创建或显示用于执行 ABAP 对象的嵌入式 SAP GUI 面板
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    client: ADTClient,
    connectionId: string,
    objectName: string,
    objectType: string = "PROG/P"
  ) {
    const column = window.activeTextEditor ? window.activeTextEditor.viewColumn : undefined

    const panelKey = `${connectionId}-${objectName}`

    // 如果已有此对象的面板，显示它
    if (SapGuiPanel.currentPanels.has(panelKey)) {
      const panel = SapGuiPanel.currentPanels.get(panelKey)!
      panel._panel.reveal(column)
      return panel
    }

    // 否则，创建新面板
    const panel = window.createWebviewPanel(
      SapGuiPanel.viewType,
      `SAP GUI - ${objectName}`,
      column || vscode.ViewColumn.Beside, // 在当前编辑器旁边打开
      {
        enableScripts: true,
        enableForms: true,
        enableCommandUris: true,
        retainContextWhenHidden: true, // 隐藏时保留状态
        localResourceRoots: [extensionUri]
      }
    )

    const sapGuiPanel = new SapGuiPanel(
      panel,
      extensionUri,
      client,
      connectionId,
      objectName,
      objectType
    )
    SapGuiPanel.currentPanels.set(panelKey, sapGuiPanel)
    return sapGuiPanel
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: ADTClient,
    connectionId: string,
    objectName: string,
    objectType: string
  ) {
    this._panel = panel
    this._client = client
    this._extensionUri = extensionUri
    this._connectionId = connectionId
    this._objectName = objectName
    this._objectType = objectType

    // 设置 Webview 的初始 HTML 内容
    this._update()

    // 监听面板销毁
    // 这发生在用户关闭面板或面板被程序化关闭时
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // 处理来自 Webview 的消息
    this._panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case "execute":
            // 如果已加载认证 URL，不重新执行
            if (this._authenticatedUrlLoaded) {
              return
            }
            this.executeObject(message.parameters)
            return
          case "refresh":
            this.refreshExecution()
            return
          case "refreshAuth":
            this.refreshAuthentication()
            return
          case "refreshTransaction":
            this.refreshTransaction()
            return
          case "webviewLog":
            return
          case "webGuiLoaded":
            return
          case "webGuiError":
            log("❌ WEBVIEW: SAP GUI iframe failed to load")
            window.showErrorMessage(
              "Failed to load SAP GUI in WebView. Try refreshing or using external GUI."
            )
            return
          case "webGuiLoaded":
            return
          case "webGuiError":
            window.showErrorMessage(
              "Failed to load Direct WebGUI in WebView. Try refreshing or using external GUI."
            )
            return

          case "webviewLog":
            return
        }
      },
      null,
      this._disposables
    )
  }

  /**
   * 使用现有基础设施构建 WebGUI URL
   * 对新的 get_abap_object_url 语言工具设为公共方法
   */
  public async buildWebGuiUrl(): Promise<string> {
    const transactionInfo = SapGuiPanel.getTransactionInfo(this._objectType, this._objectName)
    const config = RemoteManager.get().byId(this._connectionId)

    if (!config) {
      throw new Error("Connection configuration not found")
    }

    // 构建基础 URL — 尊重用户配置的协议。仅在无协议时
    // 默认使用 https。修复 GitHub issue #446：之前
    // http:// 被静默改写为 https://，破坏了仅 HTTP 的系统。
    let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, "")
    if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://")) {
      baseUrl = "https://" + baseUrl
    }

    // 生成 WebGUI URL
    const cleanedObjectName = transactionInfo.sapGuiCommand.parameters[0].value
    const webguiUrl =
      `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
      `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${cleanedObjectName}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
      `&sap-client=${config.client}` +
      `&sap-language=${config.language || "EN"}` +
      `&saml2=disabled`

    return webguiUrl
  }

  /**
   * 在嵌入式 GUI 中执行 ABAP 对象（常规模式 - 无自动化）
   * 用户手动触发嵌入式 GUI 时调用
   */
  private async executeObject(parameters: any = {}) {
    try {
      this.showProgress("Loading SAP GUI for HTML...")

      // 复用现有 SAP GUI 基础设施
      // runInSapGui 和 RemoteManager 已在上面静态导入

      const originalConfig = RemoteManager.get().byId(this._connectionId)
      if (!originalConfig) {
        this.showError("Connection configuration not found")
        return
      }

      // 创建配置的可变副本，避免只读属性错误
      const config = JSON.parse(JSON.stringify(originalConfig))

      // 为我们的面板强制嵌入式模式
      const originalGuiType = config.sapGui?.guiType

      // 确保 sapGui 配置包含嵌入式模式所需的属性
      if (!config.sapGui) {
        config.sapGui = {
          disabled: false,
          routerString: "",
          messageServer: "",
          messageServerPort: "",
          group: "",
          server: "",
          systemNumber: "",
          guiType: "WEBGUI_UNSAFE_EMBEDDED"
        }
      } else {
        // 现在可以安全修改副本
        config.sapGui.guiType = "WEBGUI_UNSAFE_EMBEDDED"
      }

      // 使用现有 runInSapGui 逻辑，但捕获 URL 而不是打开外部浏览器
      const url = await this.generateSapGuiUrl(config)
      if (url) {
        this.showEmbeddedSapGui(url)
      } else {
        this.showError("Could not generate SAP GUI URL. Please check your connection settings.")
      }
    } catch (error) {
      //log('Failed to load SAP GUI: ' + (error instanceof Error ? error.message : String(error)))
      this.showError(
        `Failed to load SAP GUI: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * 加载直接 WebGUI URL（简单方式 - 无 SSO ticket）
   * 使用 ADT 客户端已有的相同认证 cookie
   */
  public loadDirectWebGuiUrl(webguiUrl: string) {
    // 检查用户是否偏好 VS Code 的集成浏览器而不是嵌入式 Webview
    const useIntegratedBrowser = vscode.workspace
      .getConfiguration("abapfs.sapGui")
      .get<boolean>("useIntegratedBrowser", true)
    if (useIntegratedBrowser) {
      vscode.commands.executeCommand("simpleBrowser.api.open", webguiUrl, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false
      })
      this.dispose()
      return
    }

    // 设置标志防止重复执行
    this._authenticatedUrlLoaded = true

    this.showDirectWebGui(webguiUrl)
  }

  /**
   * 清理 URL 以防止注入攻击
   */
  private sanitizeUrl(url: string): string {
    try {
      // 解析 URL 以校验结构并防止注入
      const parsedUrl = new URL(url)
      // 只允许 https 和 http 协议
      if (!["https:", "http:"].includes(parsedUrl.protocol)) {
        throw new Error("Invalid protocol")
      }
      return parsedUrl.toString()
    } catch (error) {
      throw new Error(`Invalid URL: ${error}`)
    }
  }

  /**
   * 使用简单 URL 显示直接 WebGUI（无 SSO ticket 复杂性）
   */
  private showDirectWebGui(webguiUrl: string) {
    // 清理 URL 以防止注入
    const sanitizedUrl = this.sanitizeUrl(webguiUrl)

    const html = `
            <div class="execution-container">
                <div class="toolbar">
                    <button onclick="refreshWebGui()" title="🔄 Refresh this WebView">🔄 Refresh</button>
                </div>
                <iframe 
                    id="webguiFrame"
                    src="${sanitizedUrl}" 
                    width="100%" 
                    height="calc(100vh - 60px)"
                    frameborder="0"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-downloads allow-modals allow-presentation"
                    title="SAP WebGUI - ${this._objectName}"
                    onload="handleWebGuiLoad()"
                    onerror="handleWebGuiError()"
                    style="border: 1px solid var(--vscode-panel-border); background: white;"
                    allowfullscreen
                ></iframe>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                function handleWebGuiLoad() {
                    vscode.postMessage({ command: 'webviewLog', message: '✅ Direct WebGUI iframe onload event fired' });
                    
                    // Debug iframe content after a delay
                    setTimeout(() => {
                        const iframe = document.getElementById('webguiFrame');
                        if (iframe) {
                            try {
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: WebGUI iframe dimensions: ' + iframe.offsetWidth + 'x' + iframe.offsetHeight });
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: WebGUI iframe src: ' + iframe.src });
                                
                                // Try to check if content loaded
                                try {
                                    const doc = iframe.contentDocument || iframe.contentWindow.document;
                                    if (doc) {
                                        vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document title: ' + doc.title });
                                        vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document readyState: ' + doc.readyState });
                                    } else {
                                        vscode.postMessage({ command: 'webviewLog', message: '⚠️ DEBUG: Cannot access iframe content (likely CORS)' });
                                    }
                                } catch (e) {
                                    vscode.postMessage({ command: 'webviewLog', message: '⚠️ DEBUG: Error accessing iframe content: ' + e.message });
                                }
                            } catch (e) {
                                vscode.postMessage({ command: 'webviewLog', message: '❌ DEBUG: Error in iframe inspection: ' + e.message });
                            }
                        }
                    }, 3000);
                    
                    vscode.postMessage({ command: 'webGuiLoaded', url: '${sanitizedUrl}' });
                }
                
                function handleWebGuiError() {
                    vscode.postMessage({ command: 'webviewLog', message: '❌ Direct WebGUI iframe onerror event fired' });
                    vscode.postMessage({ command: 'webGuiError', url: '${sanitizedUrl}' });
                }
                
                function refreshWebGui() {
                    vscode.postMessage({ command: 'webviewLog', message: '🔄 Requesting transaction reload' });
                    vscode.postMessage({ command: 'refreshTransaction' });
                }
                
                // Function to reload iframe with new URL (called from refresh)
                function reloadIframe(newUrl) {
                    const iframe = document.getElementById('webguiFrame');
                    if (iframe) {
                        vscode.postMessage({ command: 'webviewLog', message: '🔄 Reloading iframe with URL: ' + newUrl });
                        iframe.src = newUrl + '&_refresh=' + Date.now(); // Add timestamp to force reload
                    }
                }
                
                // Listen for messages from VS Code
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'reloadIframe') {
                        reloadIframe(message.url);
                    }
                });
                
                // Log when iframe starts loading
                vscode.postMessage({ command: 'webviewLog', message: '🚀 Starting to load Direct WebGUI iframe: ' + '${sanitizedUrl}' });
            </script>
        `

    this.showResult(html)
    // log('✅ WEBVIEW: Direct WebGUI HTML rendered, waiting for iframe to load...')
  }

  /**
   * 使用带正确 cookie 处理的 WebView 显示已认证的 SAP GUI
   */
  private showAuthenticatedSapGui(authenticatedUrl: string) {
    const html = `
            <div class="execution-container">
                <div class="info-banner" style="background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 8px; margin: 4px 0; border-radius: 3px;">
                    <span style="font-weight: bold;">🔐 WebView SAP GUI</span> - 
                    <span>Authenticated session active</span>
                </div>
                <div class="toolbar">
                    <button onclick="refreshAuthentication()" title="🔄 Refresh authentication ticket">🔄 Refresh Auth</button>
                    <button onclick="refreshExecution()" title="🔄 Refresh this WebView">🔄 Refresh</button>
                    <button onclick="openInExternalGui()" title="🖥️ Open in native SAP GUI desktop application">�️ Native GUI</button>
                    <button onclick="openInBrowser()" title="🌐 Open in external web browser">🌐 Browser</button>
                </div>
                <iframe 
                    id="sapGuiFrame"
                    src="${authenticatedUrl}" 
                    width="100%" 
                    height="calc(100vh - 80px)"
                    frameborder="0"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-downloads allow-modals allow-presentation"
                    title="SAP GUI for HTML - ${this._objectName}"
                    onload="handleSapGuiLoad()"
                    onerror="handleSapGuiError()"
                    style="border: 1px solid var(--vscode-panel-border); background: white;"
                ></iframe>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                function handleSapGuiLoad() {
                    vscode.postMessage({ command: 'webviewLog', message: '✅ WebView SAP GUI iframe loaded successfully' });
                    
                    // Debug: Check if iframe has actual content
                    setTimeout(() => {
                        const iframe = document.getElementById('sapGuiFrame');
                        if (iframe) {
                            vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe dimensions: ' + iframe.offsetWidth + 'x' + iframe.offsetHeight });
                            try {
                                // Try to access iframe content (will fail for cross-origin)
                                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document title: ' + iframeDoc.title });
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: iframe document body length: ' + (iframeDoc.body ? iframeDoc.body.innerHTML.length : 'no body') });
                            } catch (e) {
                                vscode.postMessage({ command: 'webviewLog', message: '🔍 DEBUG: Cannot access iframe content (cross-origin): ' + e.message });
                            }
                        }
                    }, 2000);
                    
                    vscode.postMessage({ command: 'sapGuiLoaded', url: '${authenticatedUrl}' });
                }
                
                function handleSapGuiError() {
                    console.error('❌ WebView SAP GUI iframe failed to load');
                    vscode.postMessage({ command: 'sapGuiError', url: '${authenticatedUrl}' });
                }
                
                function refreshAuthentication() {
                    console.//log('🔄 Requesting authentication refresh');
                    vscode.postMessage({ command: 'refreshAuth' });
                }
                
                function refreshExecution() {
                    console.//log('🔄 Requesting execution refresh');
                    vscode.postMessage({ command: 'refresh' });
                }
                
                function openInExternalGui() {
                    vscode.postMessage({ command: 'openInExternalGui' });
                }
                
                function openInBrowser() {
                    vscode.postMessage({ command: 'openInBrowser' });
                }
                
                // Log when iframe starts loading
                console.//log('🚀 Starting to load SAP GUI in WebView iframe:', '${authenticatedUrl}');
            </script>
        `

    this.showResult(html)
    //log('✅ WebView HTML rendered, waiting for iframe to load...')
  }

  /**
   * 通过重新生成 SSO ticket 并重新加载来刷新认证
   */
  /**
   * 刷新事务 - 重新生成相同的 WebGUI URL 并重新加载
   */
  private async refreshTransaction() {
    try {
      //log('🔄 Refreshing transaction for object: ' + this._objectName + ' (type: ' + this._objectType + ')')

      // 获取配置用于构建 URL
      const config = RemoteManager.get().byId(this._connectionId)
      if (!config) {
        //log('❌ No config found for connection: ' + this._connectionId)
        return
      }

      // 构建基础 URL — 尊重用户配置的协议。仅在无协议时
      // 默认使用 https。修复 GitHub issue #446。
      let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, "")
      if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://")) {
        baseUrl = "https://" + baseUrl
      }

      // 🎯 使用集中式事务映射
      const transactionInfo = SapGuiPanel.getTransactionInfo(this._objectType, this._objectName)

      // 使用事务信息中的清理后对象名重建 WebGUI URL
      const cleanedObjectName = transactionInfo.sapGuiCommand.parameters[0].value
      const webguiUrl =
        `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
        `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${cleanedObjectName}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
        `&sap-client=${config.client}` +
        `&sap-language=${config.language || "EN"}` +
        `&saml2=disabled`

      //log('🔄 Refreshing with URL: ' + webguiUrl)

      // 发送消息让 WebView 重新加载 iframe，而不是重建 HTML
      this._panel.webview.postMessage({
        command: "reloadIframe",
        url: webguiUrl
      })
    } catch (error) {
      //log('❌ Error refreshing transaction: ' + error)
      window.showErrorMessage("Failed to refresh transaction: " + error)
    }
  }

  private async refreshAuthentication() {
    try {
      //log('🔄 Refreshing SAP GUI authentication...')
      this.showProgress("Refreshing authentication...")

      // 获取最新配置并重新生成认证 URL
      const config = RemoteManager.get().byId(this._connectionId)
      if (!config) {
        throw new Error("Connection configuration not found")
      }

      // 生成新的认证 URL
      const url = await this.generateSapGuiUrl(config)
      if (url) {
        this.showAuthenticatedSapGui(url)
      } else {
        this.showError("Could not regenerate SAP GUI URL. Please check your connection.")
      }
    } catch (error) {
      this.showError(
        `Failed to refresh authentication: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * 使用集中式事务逻辑生成 SAP GUI URL（不再重复！）
   */
  private async generateSapGuiUrl(config: any): Promise<string | null> {
    try {
      // 🎯 使用集中式事务映射 - 不再重复！
      const transactionInfo = SapGuiPanel.getTransactionInfo(this._objectType, this._objectName)

      // 构建基础 URL — 尊重用户配置的协议。仅在无协议时
      // 默认使用 https。修复 GitHub issue #446。
      let baseUrl = config.url.replace(/\/sap\/bc\/adt.*$/, "")
      if (!baseUrl.startsWith("https://") && !baseUrl.startsWith("http://")) {
        baseUrl = "https://" + baseUrl
      }

      // 使用集中式事务信息（与可用的 WebView 相同）
      const cleanedObjectName = transactionInfo.sapGuiCommand.parameters[0].value
      const webguiUrl =
        `${baseUrl}/sap/bc/gui/sap/its/webgui?` +
        `%7etransaction=%2a${transactionInfo.transaction}%20${transactionInfo.dynprofield}%3d${cleanedObjectName}%3bDYNP_OKCODE%3d${transactionInfo.okcode}` +
        `&sap-client=${config.client}` +
        `&sap-language=${config.language || "EN"}` +
        `&saml2=disabled`

      return webguiUrl
    } catch (error) {
      console.error("Error generating SAP GUI URL:", error)
      return null
    }
  }

  /**
   * 🎯 集中式事务映射工具 - 所有方法都使用
   * 这消除了代码重复并确保一致性
   *
   * ✅ 设为 PUBLIC STATIC，以便从 commands.ts 使用
   */
  public static getTransactionInfo(
    objectType: string,
    objectName: string
  ): {
    transaction: string
    dynprofield: string
    okcode: string
    sapGuiCommand: any
  } {
    // 清理类名 - 移除 .main/.inc/.etc 后缀
    let cleanObjectName = objectName
    if (objectType === "CLAS/OC" || objectType === "CLAS/I") {
      cleanObjectName = objectName.split(".")[0] // ZCL_DEMO_ABAP.main → ZCL_DEMO_ABAP
    }

    const config = getObjectTypeConfig(objectType)
    let transaction: string
    let dynprofield: string
    let okcode: string

    if (config?.transactionInfo) {
      transaction = config.transactionInfo.transaction
      dynprofield = config.transactionInfo.dynprofield
      okcode = config.transactionInfo.okcode
    } else {
      transaction = "SE38"
      dynprofield = "RS38M-PROGRAMM"
      okcode = "STRT"
    }

    const sapGuiCommand = {
      type: "Transaction" as const,
      command: `*${transaction}`,
      parameters: [
        { name: dynprofield, value: cleanObjectName },
        { name: "DYNP_OKCODE", value: okcode }
      ]
    }

    return { transaction, dynprofield, okcode, sapGuiCommand }
  }

  /**
   * 使用 iframe 显示嵌入式 SAP GUI
   */
  private showEmbeddedSapGui(url: string) {
    const html = `
            <div class="execution-container">
                <div class="toolbar">
                    <button onclick="refreshExecution()" title="🔄 Refresh this WebView">🔄 Refresh</button>
                    <button onclick="openInExternalGui()" title="🖥️ Open in native SAP GUI desktop application">�️ Native GUI</button>
                    <button onclick="openInBrowser()" title="🌐 Open in external web browser">🌐 Browser</button>
                </div>
                <iframe 
                    src="${url}" 
                    width="100%" 
                    height="calc(100vh - 60px)"
                    frameborder="0"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-top-navigation allow-modals allow-presentation"
                    title="SAP GUI for HTML - ${this._objectName}"
                ></iframe>
            </div>
        `

    this.showResult(html)
  }

  /**
   * 显示执行进度
   */
  private showProgress(message: string) {
    const html = `
            <div class="execution-container">
                <div class="progress">
                    <div class="spinner"></div>
                    <span>${message}</span>
                </div>
            </div>
        `
    this._panel.webview.html = this.getFullHtml(html)
  }

  /**
   * 显示执行结果
   */
  private showResult(resultHtml: string) {
    this._panel.webview.html = this.getFullHtml(resultHtml)
  }

  /**
   * 显示错误消息
   */
  private showError(errorMessage: string) {
    const html = `
            <div class="execution-container">
                <div class="error">
                    <h3>Execution Error</h3>
                    <p>${errorMessage}</p>
                    <button onclick="refreshExecution()">🔄 Try Again</button>
                </div>
            </div>
        `
    this._panel.webview.html = this.getFullHtml(html)
  }

  /**
   * 刷新当前执行
   */
  private refreshExecution() {
    this.executeObject()
  }

  /**
   * 获取 WebView 的简单 HTML - 无 DOM 操作
   */
  private getFullHtml(content: string): string {
    return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>SAP GUI - ${this._objectName}</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        margin: 0;
                        padding: 10px;
                    }
                    .execution-container {
                        width: 100%;
                        height: 100vh;
                        display: flex;
                        flex-direction: column;
                    }
                    .toolbar {
                        background-color: var(--vscode-panel-background);
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding: 8px;
                        display: flex;
                        gap: 8px;
                    }
                    .toolbar button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 6px 12px;
                        border-radius: 3px;
                        cursor: pointer;
                    }
                    iframe {
                        border: none;
                        flex: 1;
                        width: 100%;
                        background-color: white;
                        min-height: 500px;
                    }
                </style>
            </head>
            <body>
                ${content}
                <script>
                    const vscode = acquireVsCodeApi();
                    function refreshExecution() {
                        vscode.postMessage({ command: 'refresh' });
                    }
                </script>
            </body>
            </html>
        `
  }

  private _update() {
    this.showProgress("Initializing SAP GUI for HTML...")
  }

  public dispose() {
    const panelKey = `${this._connectionId}-${this._objectName}`
    SapGuiPanel.currentPanels.delete(panelKey)

    // 清理面板资源
    this._panel.dispose()

    // 清理其他可释放资源
    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }
}
