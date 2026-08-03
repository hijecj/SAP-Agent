/**
 * Mermaid Webview 管理器 - 无头本地渲染引擎
 *
 * 此类创建不可见的 Webview 面板，作为 Mermaid 图表的安全本地
 * 渲染引擎。无外部依赖或 CDN。
 */

import * as vscode from "vscode"
import { funWindow as window } from "./funMessenger"
import { logCommands } from "./abapCopilotLogger"
import { DiagramWebviewManager } from "./DiagramWebviewManager"
//import * as path from 'path';

export interface MermaidRenderResult {
  svg: string
  diagramType: string
  success: boolean
  error?: string
}

export interface MermaidValidationResult {
  isValid: boolean
  diagramType?: string
  error?: string
}

export class MermaidWebviewManager {
  private static instance: MermaidWebviewManager
  private static isInitialized = false
  private panel: vscode.WebviewPanel | null = null
  private extensionUri: vscode.Uri
  private pendingOperations = new Map<
    string,
    {
      resolve: (result: any) => void
      reject: (error: Error) => void
      timeout: NodeJS.Timeout
    }
  >()

  private constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri
  }

  public static initialize(extensionUri: vscode.Uri): void {
    if (!MermaidWebviewManager.instance) {
      MermaidWebviewManager.instance = new MermaidWebviewManager(extensionUri)
      MermaidWebviewManager.isInitialized = true
    }
  }

  public static getInstance(): MermaidWebviewManager {
    if (!MermaidWebviewManager.isInitialized) {
      throw new Error(
        "MermaidWebviewManager not initialized. Call initialize() first in the extension activation."
      )
    }
    return MermaidWebviewManager.instance
  }

  /**
   * 按需为单个操作创建新的 Webview 面板。
   * 这是“按需创建、用后销毁”模式的核心。
   */
  private async createOneTimeWebview(): Promise<vscode.WebviewPanel> {
    // 创建真正不可见的 Webview 面板
    const panel = window.createWebviewPanel(
      "mermaidRenderer",
      "Mermaid Renderer",
      // 使用 Active 列但不显示它
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "media"),
          vscode.Uri.joinPath(this.extensionUri, "dist", "media"),
          vscode.Uri.joinPath(this.extensionUri, "client", "dist", "media")
        ]
        // 移除 retainContextWhenHidden，因为我们立即销毁
      }
    )

    // 设置 HTML 并等待就绪信号。
    panel.webview.html = this.getWebviewContent(panel.webview)

    // waitForReady Promise 现在绑定到这个特定面板实例。
    await this.waitForReady(panel)

    return panel
  }

  private getWebviewContent(webview: vscode.Webview): string {
    // 获取 mermaid 库的本地路径
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "client", "dist", "media", "mermaid.min.js")
    )

    // 记录扩展 URI 和 mermaid URI 用于调试

    // 用于内容安全策略的 nonce
    const nonce = Date.now().toString()

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src vscode-resource: 'unsafe-inline'; style-src vscode-resource: 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mermaid Renderer</title>
    <style nonce="${nonce}">
        body { 
            margin: 0; 
            padding: 20px; 
            background: #1e1e1e; 
            font-family: Arial, sans-serif;
            font-size: 12px;
            line-height: 1.2;
        }
        #diagram { 
            display: block; 
            width: 100%; 
            height: auto; 
        }
        /* 不干扰 Mermaid 的最小文本改进 */
        svg text {
            font-family: Arial, sans-serif;
            font-size: 12px;
        }
    </style>
</head>
<body>
    <div id="diagram"></div>
    <script nonce="${nonce}" src="${mermaidUri}"></script>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // 等待 mermaid 加载，带正确的错误处理
        let attempts = 0;
        const maxAttempts = 50; // 总共 5 秒
        
        function waitForMermaid() {
            attempts++;
            
            if (typeof mermaid !== 'undefined') {
                vscode.postMessage({ type: 'log', message: 'Mermaid library loaded successfully' });
                initializeMermaid();
            } else if (attempts < maxAttempts) {
                setTimeout(waitForMermaid, 100);
            } else {
                vscode.postMessage({ type: 'error', id: 'initialization-error', error: 'Mermaid library failed to load after 5 seconds' });
            }
        }
        
        function initializeMermaid() {
            try {
                vscode.postMessage({ type: 'log', message: 'Initializing Mermaid...' });
                vscode.postMessage({ type: 'log', message: 'Mermaid library found, initializing...' });
                
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'forest',
                    securityLevel: 'strict',  // ✅ SECURITY FIX: Changed from 'loose' to prevent XSS
                    fontFamily: 'Arial, sans-serif',
                    fontSize: 12,
                    flowchart: {
                        htmlLabels: false
                    }
                });

                vscode.postMessage({ type: 'log', message: 'Mermaid initialized, sending ready signal' });
                
                // 发出就绪信号
                vscode.postMessage({ type: 'ready' });

                // 处理来自扩展的消息
                window.addEventListener('message', async (event) => {
                    vscode.postMessage({ type: 'log', message: 'Received message: ' + event.data.type });
                    
                    const { type, id, data } = event.data;

                    try {
                        switch (type) {
                            case 'render':
                                await handleRender(id, data.code, data.theme);
                                break;
                            case 'validate':
                                await handleValidate(id, data.code);
                                break;
                            case 'detectType':
                                await handleDetectType(id, data.code);
                                break;
                            default:
                                vscode.postMessage({
                                    type: 'error',
                                    id,
                                    error: 'Unknown operation type: ' + type
                                });
                        }
                    } catch (error) {
                        vscode.postMessage({
                            type: 'error',
                            id,
                            error: error.message || String(error)
                        });
                    }
                });
                
                // 处理函数
                async function handleRender(id, code, theme) {
                    try {
                        const element = document.getElementById('diagram');
                        element.innerHTML = '';
                        
                        const { svg } = await mermaid.render('temp-id', code);
                        
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: {
                                svg,
                                diagramType: 'auto-detected',
                                success: true
                            }
                        });
                    } catch (error) {
                        vscode.postMessage({
                            type: 'error',
                            id,
                            error: error.message || String(error)
                        });
                    }
                }
                
                async function handleValidate(id, code) {
                    try {
                        // 尝试解析图表
                        await mermaid.parse(code);
                        
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: {
                                isValid: true,
                                diagramType: 'valid'
                            }
                        });
                    } catch (error) {
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: {
                                isValid: false,
                                error: error.message || String(error)
                            }
                        });
                    }
                }
                
                async function handleDetectType(id, code) {
                    try {
                        // 使用 mermaid 的 getDiagramFromText 函数进行正确的类型检测
                        const diagramType = mermaid.detectType ? mermaid.detectType(code) : 'unknown';
                        
                        vscode.postMessage({
                            type: 'result',
                            id,
                            result: { diagramType }
                        });
                    } catch (error) {
                        vscode.postMessage({
                            type: 'error',
                            id,
                            error: error.message || String(error)
                        });
                    }
                }
            } catch (e) {
                vscode.postMessage({ type: 'error', id: 'initialization-error', error: e.message });
            }
        }
        
        // 启动初始化过程
        waitForMermaid();
    </script>
</body>
</html>`
  }

  private handleWebviewMessage(message: any, panelId: string): void {
    const { type, id, result, error } = message

    // 处理来自 Webview 的日志消息
    if (type === "log") {
      return
    }

    // 使用复合键处理多个面板（如果需要），尽管我们立即销毁。
    const operationKey = `${panelId}-${id}`
    const initKey = `ready-${panelId}`

    // 处理初始化专属消息
    if (type === "ready" || (type === "error" && id === "initialization-error")) {
      const initPromise = this.pendingOperations.get(initKey)
      if (initPromise) {
        clearTimeout(initPromise.timeout)
        if (type === "ready") {
          initPromise.resolve(undefined)
        } else {
          logCommands.error(`🧜‍♀️ Webview initialization failed: ${error}`)
          initPromise.reject(new Error(`Webview initialization failed: ${error}`))
        }
        this.pendingOperations.delete(initKey)
      }
      if (type === "ready") return
    }

    const operation = this.pendingOperations.get(operationKey)
    if (!operation) {
      return // Operation timed out or doesn't exist
    }

    clearTimeout(operation.timeout)
    this.pendingOperations.delete(operationKey)

    if (error) {
      // logCommands.error(`🧜‍♀️ Operation error: ${error}`);
      operation.reject(new Error(error))
    } else {
      //logCommands.info(`🧜‍♀️ Operation completed successfully`);
      operation.resolve(result)
    }
  }

  private waitForReady(panel: vscode.WebviewPanel): Promise<void> {
    const panelId = Date.now().toString() // Simple unique ID for this panel's lifetime
    const readyKey = `ready-${panelId}`

    // 附加临时消息监听器
    const listener = panel.webview.onDidReceiveMessage(message => {
      //logCommands.info(`🧜‍♀️ Received message from webview: ${JSON.stringify(message)}`);

      // 处理日志消息
      if (message.type === "log") {
        this.handleWebviewMessage(message, panelId)
        return
      }

      // 我们只关心此特定面板的就绪/错误信号
      if (message.type === "ready" && this.pendingOperations.has(readyKey)) {
        this.handleWebviewMessage({ ...message, id: "ready" }, panelId)
        listener.dispose() // 清理监听器
      } else if (
        message.type === "error" &&
        message.id === "initialization-error" &&
        this.pendingOperations.has(readyKey)
      ) {
        this.handleWebviewMessage(message, panelId)
        listener.dispose() // 清理监听器
      }
    })

    // Promise 现在针对此特定面板
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingOperations.delete(readyKey)
        listener.dispose()
        reject(new Error("Webview initialization timed out after 10 seconds."))
      }, 10000)

      this.pendingOperations.set(readyKey, {
        resolve: () => {
          clearTimeout(timeout)
          resolve()
        },
        reject: err => {
          clearTimeout(timeout)
          reject(err)
        },
        timeout
      })
    })
  }

  private async executeOperation<T>(
    type: string,
    data: any,
    timeoutMs: number = 30000
  ): Promise<T> {
    let panel: vscode.WebviewPanel | undefined
    try {
      panel = await this.createOneTimeWebview()
      const panelId = Date.now().toString() // 简单唯一 ID
      const operationKey = `${panelId}-${panelId}` // 为简单起见使用相同 ID

      // 为此特定面板实例重新连接消息处理程序
      const listener = panel.webview.onDidReceiveMessage(message => {
        ////logCommands.info(`🧜‍♀️ Operation message: ${JSON.stringify(message)}`);

        // 处理日志消息
        if (message.type === "log") {
          this.handleWebviewMessage(message, panelId)
          return
        }

        // 处理结果和错误消息
        if (message.type === "result" || message.type === "error") {
          this.handleWebviewMessage(message, panelId)
        }
      })

      const promise = new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingOperations.delete(operationKey)
          reject(new Error(`Operation ${type} timed out after ${timeoutMs}ms`))
        }, timeoutMs)

        this.pendingOperations.set(operationKey, {
          resolve: resolve as (value: any) => void,
          reject,
          timeout
        })

        panel!.webview.postMessage({ type, id: panelId, data })
      })

      // 销毁时清理监听器
      panel.onDidDispose(() => {
        listener.dispose()
      })

      return await promise
    } finally {
      // 关键：操作后始终销毁面板。
      if (panel) {
        panel.dispose()
      }
    }
  }

  public async renderDiagram(code: string, theme: string = "dark"): Promise<MermaidRenderResult> {
    const result = await this.executeOperation<MermaidRenderResult>("render", { code, theme })

    // 成功时在图表查看器中显示，而不是立即保存
    if (result.success && result.svg) {
      try {
        const diagramManager = DiagramWebviewManager.getInstance()
        await diagramManager.displayDiagram(
          result.svg,
          result.diagramType,
          `Mermaid Diagram - ${result.diagramType}`
        )
        // logCommands.info('✅ Diagram displayed in webview successfully');
      } catch (error) {
        logCommands.error("Failed to display diagram in webview:", error)
        // 即使 Webview 显示失败，也继续使用原始结果
      }
    }

    return result
  }

  public async validateSyntax(code: string): Promise<MermaidValidationResult> {
    return this.executeOperation<MermaidValidationResult>("validate", { code })
  }

  public async detectDiagramType(code: string): Promise<{ diagramType: string }> {
    return this.executeOperation<{ diagramType: string }>("detectType", { code })
  }

  public dispose(): void {
    // 空操作，因为面板现在使用后立即销毁。
  }
}
