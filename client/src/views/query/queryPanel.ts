import * as vscode from "vscode"
import { funWindow as window } from "../../services/funMessenger"
import { ADTClient } from "abap-adt-api"
import { log } from "../../lib"

/**
 * SQL 安全校验器
 */
class SQLValidator {
  static validate(sql: string): void {
    if (!sql || typeof sql !== "string") {
      throw new Error("SQL query must be a non-empty string")
    }

    const upperSQL = sql.toUpperCase().trim()

    // 阻止危险 SQL 操作
    const dangerousPatterns = [
      /\bDROP\s+/i,
      /\bDELETE\s+(?!.*\bFROM\s+@)/i,
      /\bINSERT\s+/i,
      /\bUPDATE\s+/i,
      /\bALTER\s+/i,
      /\bCREATE\s+/i,
      /\bTRUNCATE\s+/i,
      /;\s*(?!$)/i, // 多条语句
      /--/i, // SQL 注释
      /\/\*/i // 块注释
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(upperSQL)) {
        throw new Error(`SQL query contains dangerous operation`)
      }
    }

    // 确保是 SELECT 或 WITH 语句
    if (!upperSQL.startsWith("SELECT") && !upperSQL.startsWith("WITH")) {
      throw new Error("Only SELECT and WITH statements are allowed")
    }
  }
}
/**
 * 管理 cat coding Webview 面板
 */
export class QueryPanel {
  /**
   * 跟踪当前面板。一次只允许存在一个面板。
   */
  public static readonly viewType = "ABAPQuery"

  private readonly _panel: vscode.WebviewPanel
  private readonly _extensionUri: vscode.Uri
  private _disposables: vscode.Disposable[] = []

  private _client: ADTClient
  private _table: string

  public static createOrShow(extensionUri: vscode.Uri, client: ADTClient, table: string) {
    const column = window.activeTextEditor ? window.activeTextEditor.viewColumn : undefined

    // 允许多个面板；不复用单例

    // 否则，创建新面板。
    const panel = window.createWebviewPanel(
      QueryPanel.viewType,
      "Query",
      column || vscode.ViewColumn.One,
      getWebviewOptions(extensionUri)
    )

    new QueryPanel(panel, extensionUri, client, table)
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    client: ADTClient,
    table: string
  ) {
    this._panel = panel
    this._client = client
    this._extensionUri = extensionUri
    this._table = table
    // 设置 Webview 的初始 HTML 内容
    this._update()

    // 监听面板销毁
    // 这发生在用户关闭面板或面板被程序化关闭时
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables)

    // 按视图变化更新内容
    this._panel.onDidChangeViewState(
      e => {
        if (this._panel.visible) {
          // this._update();
        }
      },
      null,
      this._disposables
    )

    // 处理来自 Webview 的消息
    this._panel.webview.onDidReceiveMessage(
      async message => {
        try {
          switch (message.command) {
            case "execute": {
              // 旧版自由 SQL
              const resp = await client.runQuery(message.query, message.rowCount)
              this.showResult(JSON.stringify(resp))
              return
            }
            case "searchObjects": {
              const { term, types, max } = message
              const base = Array.isArray(types) && types.length ? types : ["TABL", "VIEW", "DDLS"]
              const wanted: string[] = base.includes("ALL") ? ["TABL", "VIEW", "DDLS"] : base
              const cap = typeof max === "number" && max > 0 ? max : 20
              const all: any[] = []
              const typeVariants = (t: string) => {
                switch (t) {
                  case "TABL":
                    return ["TABL/DT"] // 只返回表，排除结构/TA
                  case "VIEW":
                    return ["VIEW", "VIEW/V"]
                  case "DDLS":
                    return ["DDLS", "DDLS/DF"]
                  default:
                    return [t]
                }
              }
              for (const t of wanted) {
                const variants = typeVariants(t)
                try {
                  for (const vt of variants) {
                    const part = await client.searchObject(term, vt, cap)
                    for (const r of part) {
                      const type = r["adtcore:type"]
                      // 只允许我们请求的精确类型，而不是任何以该前缀开头的内容
                      if (variants.includes(type)) {
                        all.push({
                          name: r["adtcore:name"],
                          type,
                          description: r["adtcore:description"] || ""
                        })
                      }
                    }
                  }
                } catch (e) {
                  // 忽略按类型的错误并继续
                }
              }
              // 按名称+类型去重
              const uniq = new Map<string, any>()
              for (const it of all) uniq.set(`${it.name}|${it.type}`, it)
              this._panel.webview.postMessage({
                command: "objects",
                data: Array.from(uniq.values())
              })
              return
            }
            case "exportCSV": {
              const { columns, rows, defaultName } = message
              const headers: string[] = columns.map((c: any) => c.title || c.field || c.name)
              const fields: string[] = columns.map((c: any) => c.field || c.name)
              const csvEscape = (v: any) => {
                const s = v == null ? "" : String(v)
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
              }
              const lines: string[] = []
              lines.push(headers.map(csvEscape).join(","))
              for (const r of rows) lines.push(fields.map(f => csvEscape((r as any)[f])).join(","))
              const data = Buffer.from("\uFEFF" + lines.join("\r\n"), "utf8")
              const uri = await window.showSaveDialog({
                defaultUri: vscode.Uri.file((defaultName || "data") + ".csv"),
                filters: { CSV: ["csv"] }
              })
              if (!uri) return
              await vscode.workspace.fs.writeFile(uri, data)
              return
            }
            case "loadFields": {
              const { entity } = message // { name, kind }
              const top = 1
              const meta = await client.tableContents(entity.name, top, true)
              const cols = meta.columns || []
              this._panel.webview.postMessage({
                command: "fields",
                data: { entity, columns: cols }
              })
              return
            }
            case "runCriteria": {
              const { entity, where, top, columns } = message
              const limit = typeof top === "number" && top > 0 ? top : 200
              const sanitized = (where || "").replace(/^\s*where\s+/i, "")
              const list =
                Array.isArray(columns) && columns.length
                  ? columns
                      .map((c: string) => c.trim().toUpperCase())
                      .filter(Boolean)
                      .join(", ")
                  : "*"
              const sql = `select ${list} from ${entity.name}${sanitized ? " where " + sanitized : ""}`
              // 为 ADT 兼容性对 LIKE 查询中的 % 字符进行 URL 编码
              // const encodedSql = sql.replace(/%/g, '%25')
              const resp = await client.runQuery(sql, limit + 1, true)
              const hasMore = (resp.values?.length || 0) > limit
              if (hasMore) resp.values = resp.values.slice(0, limit)
              this._panel.webview.postMessage({
                command: "queryResult",
                data: {
                  result: resp,
                  hasMore,
                  top: limit,
                  mode: "criteria",
                  where: sanitized,
                  entity
                }
              })
              return
            }
            case "runSQL": {
              const { sql, top } = message

              // 为安全校验 SQL
              try {
                SQLValidator.validate(sql)
              } catch (error) {
                this._panel.webview.postMessage({
                  command: "error",
                  data: `SQL Security Error: ${error instanceof Error ? error.message : String(error)}`
                })
                return
              }

              const limit = typeof top === "number" && top > 0 ? top : 200
              // 为 ADT 兼容性对 LIKE 查询中的 % 字符进行 URL 编码
              //  const encodedSql = sql.replace(/%/g, '%25')
              const resp = await client.runQuery(sql, limit + 1, true)
              const hasMore = (resp.values?.length || 0) > limit
              if (hasMore) resp.values = resp.values.slice(0, limit)
              this._panel.webview.postMessage({
                command: "queryResult",
                data: { result: resp, hasMore, top: limit, mode: "sql", sql }
              })
              return
            }
            case "loadMore": {
              const { mode, entity, where, sql, nextTop, columns } = message
              const limit = typeof nextTop === "number" && nextTop > 0 ? nextTop : 500

              // SQL 模式下校验 SQL
              if (mode === "sql") {
                try {
                  SQLValidator.validate(sql)
                } catch (error) {
                  this._panel.webview.postMessage({
                    command: "error",
                    data: `SQL Security Error: ${error instanceof Error ? error.message : String(error)}`
                  })
                  return
                }
              }

              const resp =
                mode === "sql"
                  ? await client.runQuery(sql, limit + 1, true)
                  : await client.runQuery(
                      `select ${
                        Array.isArray(columns) && columns.length
                          ? columns
                              .map((c: string) => c.trim().toUpperCase())
                              .filter(Boolean)
                              .join(", ")
                          : "*"
                      } from ${entity.name}${where ? " where " + where : ""}`,
                      limit + 1,
                      true
                    )
              const hasMore = (resp.values?.length || 0) > limit
              if (hasMore) resp.values = resp.values.slice(0, limit)
              this._panel.webview.postMessage({
                command: "queryResult",
                data: { result: resp, hasMore, top: limit, mode, where, sql, entity }
              })
              return
            }
            case "getShowPrefs": {
              const { table } = message
              const result = await readShowPrefs()
              const fields = result[(table || "").toUpperCase()] || []
              this._panel.webview.postMessage({ command: "showPrefs", data: { table, fields } })
              return
            }
            case "setShowPrefs": {
              const { table, fields } = message as { table: string; fields: string[] }
              const key = (table || "").toUpperCase()
              const all = await readShowPrefs()
              all[key] = Array.isArray(fields) ? fields.map(f => f.toUpperCase()) : []
              await writeShowPrefs(all)
              return
            }
          }
        } catch (error: any) {
          const msg = error?.localizedMessage || error?.message || String(error)
          this.showError(msg)
        }
      },
      null,
      this._disposables
    )
  }

  public setTable(table: string) {
    this._table = table
    this._update()
  }

  public showResult(data: string) {
    // 向 Webview 发送消息。
    // 你可以发送任何可 JSON 序列化的数据。
    this._panel.webview.postMessage({ command: "result", data: data })
  }

  public showError(errorMsg: string) {
    // 向 Webview 发送消息。
    // 你可以发送任何可 JSON 序列化的数据。
    try {
      this._panel.webview.postMessage({ command: "error", data: errorMsg })
    } catch (disposalError) {
      // 如果 Webview 已销毁，记录原始错误并以 VS Code 通知显示
      log(`[QUERY_PANEL] Cannot show error in webview (disposed): ${errorMsg}`)
      window.showErrorMessage(`SQL Error: ${errorMsg}`)
    }
  }

  public dispose() {
    // 清理我们的资源
    this._panel.dispose()

    while (this._disposables.length) {
      const x = this._disposables.pop()
      if (x) {
        x.dispose()
      }
    }
  }

  private _update() {
    const webview = this._panel.webview

    // 根据 Webview 在编辑器中的位置变化其内容。
    this._panel.title = "Data Browser"
    this._panel.webview.html = this._getHtmlForWebview(webview, this._table)
  }

  private _getHtmlForWebview(webview: vscode.Webview, tableName: string) {
    // 在 Webview 中运行的主脚本的本地路径
    const scriptPathOnDisk = vscode.Uri.joinPath(
      this._extensionUri,
      "client",
      "dist",
      "media",
      "query.js"
    )

    // 以及我们在 Webview 中加载此脚本所用的 URI
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk)

    // CSS 样式的本地路径
    //const styleResetPath = vscode.Uri.joinPath(this._extensionUri, 'client/media', 'reset.css');
    const stylesPathMainPath = vscode.Uri.joinPath(
      this._extensionUri,
      "client",
      "dist",
      "media",
      "editor.css"
    )

    // Tabulator 文件的本地路径 - 使用较轻的主题
    const tabulatorCssPath = vscode.Uri.joinPath(
      this._extensionUri,
      "client",
      "dist",
      "media",
      "tabulator_bootstrap4.min.css"
    )
    const tabulatorJsPath = vscode.Uri.joinPath(
      this._extensionUri,
      "client",
      "dist",
      "media",
      "tabulator.min.js"
    )

    // 把样式和脚本加载到 Webview 的 URI
    //const stylesResetUri = webview.asWebviewUri(styleResetPath);
    const stylesMainUri = webview.asWebviewUri(stylesPathMainPath)
    const tabulatorCssUri = webview.asWebviewUri(tabulatorCssPath)
    const tabulatorJsUri = webview.asWebviewUri(tabulatorJsPath)

    // 允许本地扩展资源的 CSP
    const cspSource = webview.cspSource

    return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; script-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource};">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${stylesMainUri}" rel="stylesheet">
                <link href="${tabulatorCssUri}" rel="stylesheet">
                <script type="text/javascript" src="${tabulatorJsUri}"></script>
                <title>ABAP Data Browser</title>
            </head>
            <body>
                <div class="adb-root">
                    <div class="adb-toolbar">
                        <div class="adb-object">
                            <label>Object</label>
                            <input id="adb-object-input" type="text" placeholder="Enter table/view/CDS name" value="${tableName || ""}" />
                            <select id="adb-object-type">
                                <option value="ALL">All</option>
                                <option value="TABL">Table</option>
                                <option value="VIEW">View</option>
                                <option value="DDLS">CDS</option>
                            </select>
                            <div id="adb-search-results" class="adb-search-results"></div>
                        </div>
                        <div class="adb-actions">
                            <label>Rows</label>
                            <input id="adb-rowCount" value="200" />
                            <button id="adb-execute">Search</button>
                            <button id="adb-toggle-sql">SQL Mode</button>
                            <button id="adb-toggle-fields">Hide Selection Fields</button>
                            <button id="adb-view-sql" title="Preview generated SQL">Show SQL Query</button>
                        </div>
                        <div class="adb-actions-row2">
                            <button id="adb-copy-rows" title="Copy selected rows to clipboard">Copy Rows</button>
                        </div>
                    </div>

                    <div id="adb-panels">
                        <div id="adb-fields-header" class="adb-fields-header">
                            <label>Filter fields</label>
                            <input id="adb-field-filter" placeholder="type to filter fields by name/description" />
                            <span class="adb-fields-pager">
                                <button id="adb-fields-prev">◀</button>
                                <span id="adb-fields-page">1</span>
                                <button id="adb-fields-next">▶</button>
                            </span>
                        </div>
                        <div id="adb-criteria-panel" class="adb-panel"></div>
                        <div style="display:flex;align-items:center;gap:12px;padding:8px;border-bottom:1px solid var(--vscode-editorWidget-border);">
                            <label style="display:flex;align-items:center;gap:6px;">Technical Field Names<input id="adb-tech-names" type="checkbox"/></label>
                            <button id="adb-export-csv">Export CSV</button>
                        </div>
                        <div id="adb-sql-panel" class="adb-panel" style="display:none;">
                            <textarea id="adb-sql" spellcheck="false" class="adb-sqlbox" placeholder="SELECT * FROM <entity> WHERE ..."></textarea>
                        </div>
                    </div>

                    <div id="result-table"></div>
                    <div id="adb-busy" class="adb-busy" style="display:none;"><div class="adb-spinner"></div><span>Searching…</span></div>
                    <div id="adb-sql-modal" style="display:none; position:fixed; inset:0; background: rgba(0,0,0,0.35); align-items:center; justify-content:center;">
                        <div style="background:#fff; max-width:80vw; max-height:80vh; width:80vw; height:80vh; display:flex; flex-direction:column; border:1px solid #ccc; box-shadow:0 4px 16px rgba(0,0,0,0.2);">
                            <div style="padding:8px; border-bottom:1px solid #eee; display:flex; gap:8px; align-items:center;">
                                <strong style="flex:1;">Generated SQL</strong>
                                <button id="adb-sql-copy" title="Copy to clipboard">Copy</button>
                                <button id="adb-sql-open" title="Open in SQL Mode">Open in SQL Mode</button>
                                <button id="adb-sql-close">Close</button>
                            </div>
                            <pre id="adb-sql-text" style="margin:0; padding:12px; overflow:auto; white-space:pre-wrap; font-family: Consolas, monospace; font-size:12px;"></pre>
                        </div>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>`
  }
}

// 在单独文件中为 Show 偏好做简单 JSON 持久化
async function prefsFileUri(): Promise<vscode.Uri> {
  // 优先使用本地用户配置以确保跨工作区安全；只在真实文件工作区时使用工作区文件夹
  const folders = vscode.workspace.workspaceFolders
  if (folders && folders.length) {
    const root = folders[0].uri
    if (root.scheme === "file") {
      const dir = vscode.Uri.joinPath(root, ".vscode")
      try {
        await vscode.workspace.fs.createDirectory(dir)
      } catch {}
      return vscode.Uri.joinPath(dir, "abap-data-browser.json")
    }
  }
  // 回退到用户配置
  const home = process.env.HOME || process.env.USERPROFILE || ""
  const base = vscode.Uri.file(home)
  const dir = vscode.Uri.joinPath(base, ".abap-data-browser")
  try {
    await vscode.workspace.fs.createDirectory(dir)
  } catch {}
  return vscode.Uri.joinPath(dir, "prefs.json")
}

async function readShowPrefs(): Promise<Record<string, string[]>> {
  try {
    const uri = await prefsFileUri()
    const data = await vscode.workspace.fs.readFile(uri)
    const txt = new TextDecoder().decode(data)
    const obj = JSON.parse(txt)
    return obj && typeof obj === "object" ? obj : {}
  } catch {
    return {}
  }
}

async function writeShowPrefs(all: Record<string, string[]>) {
  const uri = await prefsFileUri()
  const txt = JSON.stringify(all, null, 2)
  const buf = new TextEncoder().encode(txt)
  await vscode.workspace.fs.writeFile(uri, buf)
}

function getWebviewOptions(
  extensionUri: vscode.Uri
): vscode.WebviewOptions & vscode.WebviewPanelOptions {
  return {
    // 在 Webview 中启用 JavaScript
    enableScripts: true,
    retainContextWhenHidden: true,

    // 并把 Webview 限制为只从我们扩展的 `media` 目录加载内容。
    localResourceRoots: [
      vscode.Uri.joinPath(extensionUri, "client", "dist", "media"),
      vscode.Uri.joinPath(extensionUri, "client", "media")
    ]
  }
}
