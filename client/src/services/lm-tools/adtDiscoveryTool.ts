/**
 * ADT 发现工具
 *
 * 把完整 ADT 发现树（工作区、集合、模板链接）
 * 和 RES_APP 类列表转储为工作区中的 markdown 文件。
 *
 * AI 使用这些文件 + 其他 ABAP 工具 + adt-api-discovery 技能包
 * 来追踪处理程序类、读取转换并解析请求/响应模式。
 *
 * 此工具刻意保持“简单” — 不做常量解析、不解析源码、
 * 不匹配标题。只做确定性的 API 调用和结构化输出。
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { getClient } from "../../adt/conections"
import { assertToolInvocationAuthorized } from "./toolGuard"

// ── 接口（镜像 abap-adt-api 类型）─────────────────────

interface TemplateLink {
  rel: string
  template: string
  title?: string
  type?: string
}

interface Collection {
  href: string
  title?: string
  templateLinks: TemplateLink[]
}

interface DiscoveryWorkspace {
  title: string
  collection: Collection[]
}

interface CoreDiscoveryWorkspace {
  title: string
  collection: { href: string; title: string; category: string }
}

// ── 参数 ──────────────────────────────────────────────────

export interface IAdtDiscoveryParameters {
  connectionId: string
}

// ── 工具 ────────────────────────────────────────────────────────

export class AdtDiscoveryTool implements vscode.LanguageModelTool<IAdtDiscoveryParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IAdtDiscoveryParameters>,
    _token: vscode.CancellationToken
  ) {
    const connId = options.input.connectionId
    return {
      invocationMessage: `Exporting ADT discovery for ${connId} to markdown files…`
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IAdtDiscoveryParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)

    const connId = options.input.connectionId
    if (!connId) {
      throw new Error("connectionId is required")
    }

    logTelemetry("tool_adt_discovery_called")

    const client = getClient(connId.toLowerCase())

    // ── 1. 并行调用发现端点 ─────────────────
    const [discovery, coreDiscovery] = await Promise.all([
      client.adtDiscovery() as Promise<DiscoveryWorkspace[]>,
      client.adtCoreDiscovery() as Promise<CoreDiscoveryWorkspace[]>
    ])

    // ── 2. 查询 SEOMETAREL 获取所有 RES_APP 类 ─────────────
    let resAppClasses: { name: string; description: string }[] = []
    try {
      const sql1 =
        `SELECT r~CLSNAME, t~DESCRIPT ` +
        `FROM SEOMETAREL AS r ` +
        `LEFT OUTER JOIN SEOCLASSTX AS t ON r~CLSNAME = t~CLSNAME AND t~LANGU = 'E' ` +
        `WHERE r~REFCLSNAME = 'CL_ADT_DISC_RES_APP_BASE' ` +
        `AND r~RELTYPE = '2' AND r~VERSION = '1'`
      const r1 = await client.runQuery(sql1, 500, true)
      if (r1?.values) {
        for (const row of r1.values) {
          resAppClasses.push({ name: row.CLSNAME || "", description: row.DESCRIPT || "" })
        }
      }
      const sql2 =
        `SELECT r~CLSNAME, t~DESCRIPT ` +
        `FROM SEOMETAREL AS r ` +
        `LEFT OUTER JOIN SEOCLASSTX AS t ON r~CLSNAME = t~CLSNAME AND t~LANGU = 'E' ` +
        `WHERE r~REFCLSNAME = 'CL_ADT_RES_APP_BASE' ` +
        `AND r~RELTYPE = '2' AND r~VERSION = '1'`
      const r2 = await client.runQuery(sql2, 100, true)
      const seen = new Set(resAppClasses.map(c => c.name))
      if (r2?.values) {
        for (const row of r2.values) {
          if (!seen.has(row.CLSNAME)) {
            resAppClasses.push({ name: row.CLSNAME || "", description: row.DESCRIPT || "" })
          }
        }
      }
    } catch {
      // 非致命 — 我们仍有发现数据
    }

    // ── 3. 生成 markdown 内容 ────────────────────────────
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:T]/g, "-").replace(/\..+/, "")
    const folderName = `adt-discovery_${connId}_${timestamp}`

    // 计算统计
    let totalCollections = 0
    let totalTemplateLinks = 0
    for (const ws of discovery) {
      totalCollections += ws.collection.length
      for (const col of ws.collection) {
        totalTemplateLinks += col.templateLinks.length
      }
    }

    const indexMd = buildIndexMd(connId, discovery, coreDiscovery, resAppClasses, {
      workspaces: discovery.length,
      collections: totalCollections,
      templateLinks: totalTemplateLinks,
      coreCollections: coreDiscovery.length,
      resAppClasses: resAppClasses.length
    })

    const workspacesMd = buildWorkspacesMd(discovery)
    const coreDiscoveryMd = buildCoreDiscoveryMd(coreDiscovery)
    const resAppMd = buildResAppClassesMd(resAppClasses)

    // ── 4. 把文件写入工作区 ─────────────────────────────
    const workspaceFolder = getFirstNonAdtFolder()
    if (!workspaceFolder) {
      throw new Error(
        "No local workspace folder found. A non-ADT workspace folder is required to write discovery files."
      )
    }

    const baseUri = vscode.Uri.joinPath(workspaceFolder, folderName)
    const enc = new TextEncoder()

    await vscode.workspace.fs.createDirectory(baseUri)
    await Promise.all([
      vscode.workspace.fs.writeFile(vscode.Uri.joinPath(baseUri, "README.md"), enc.encode(indexMd)),
      vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(baseUri, "workspaces.md"),
        enc.encode(workspacesMd)
      ),
      vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(baseUri, "core-discovery.md"),
        enc.encode(coreDiscoveryMd)
      ),
      vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(baseUri, "res-app-classes.md"),
        enc.encode(resAppMd)
      )
    ])

    const folderPath = baseUri.fsPath
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `ADT discovery exported to folder: ${folderPath}\n\n` +
          `Files created:\n` +
          `- README.md — Overview and stats\n` +
          `- workspaces.md — All ${discovery.length} discovery workspaces with ${totalCollections} collections and ${totalTemplateLinks} template links\n` +
          `- core-discovery.md — ${coreDiscovery.length} core discovery entries\n` +
          `- res-app-classes.md — ${resAppClasses.length} RES_APP classes (from SEOMETAREL)\n\n` +
          `Use the adt-api-discovery skill and other ABAP tools to explore handler classes, ` +
          `read Simple Transformations, and trace request/response XML schemas.`
      )
    ])
  }
}

// ── Markdown 生成器 ─────────────────────────────────────────

function buildIndexMd(
  connId: string,
  discovery: DiscoveryWorkspace[],
  coreDiscovery: CoreDiscoveryWorkspace[],
  resAppClasses: { name: string; description: string }[],
  stats: {
    workspaces: number
    collections: number
    templateLinks: number
    coreCollections: number
    resAppClasses: number
  }
): string {
  const lines: string[] = []
  lines.push(`# ADT Discovery — ${connId.toUpperCase()}`)
  lines.push("")
  lines.push(`> Exported ${new Date().toISOString()}`)
  lines.push("")
  lines.push("## Stats")
  lines.push("")
  lines.push(`| Metric | Count |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Discovery workspaces | ${stats.workspaces} |`)
  lines.push(`| Collections | ${stats.collections} |`)
  lines.push(`| Template links | ${stats.templateLinks} |`)
  lines.push(`| Core discovery entries | ${stats.coreCollections} |`)
  lines.push(`| RES_APP classes (SEOMETAREL) | ${stats.resAppClasses} |`)
  lines.push("")
  lines.push("## Files")
  lines.push("")
  lines.push("| File | Description |")
  lines.push("|------|-------------|")
  lines.push(
    "| [workspaces.md](workspaces.md) | Full discovery tree — workspaces → collections → template links |"
  )
  lines.push(
    "| [core-discovery.md](core-discovery.md) | Core discovery entries (simpler flat list) |"
  )
  lines.push(
    "| [res-app-classes.md](res-app-classes.md) | All RES_APP classes that register ADT endpoints |"
  )
  lines.push("")
  lines.push("## How to use these files")
  lines.push("")
  lines.push(
    "These files contain the raw discovery data from the SAP system. To investigate a specific ADT endpoint:"
  )
  lines.push("")
  lines.push("1. Find the endpoint URL in `workspaces.md` (search by keyword)")
  lines.push(
    "2. Use the `adt-api-discovery` skill which teaches how to trace from discovery → RES_APP class → handler class → Simple Transformation → XML schema"
  )
  lines.push(
    "3. Use ABAP tools (`get_abap_object_lines`, `search_abap_objects`, `search_abap_object_lines`) to read source code"
  )
  lines.push("")
  return lines.join("\n")
}

function buildWorkspacesMd(discovery: DiscoveryWorkspace[]): string {
  const lines: string[] = []
  lines.push("# ADT Discovery Workspaces")
  lines.push("")
  lines.push(`${discovery.length} workspaces from \`GET /sap/bc/adt/discovery\``)
  lines.push("")

  for (const ws of discovery) {
    lines.push(`## ${ws.title}`)
    lines.push("")

    if (ws.collection.length === 0) {
      lines.push("_No collections_")
      lines.push("")
      continue
    }

    for (const col of ws.collection) {
      lines.push(`### ${col.title || "(untitled)"}`)
      lines.push("")
      lines.push(`- href: \`${col.href}\``)
      lines.push("")

      if (col.templateLinks.length === 0) {
        lines.push("_No template links_")
        lines.push("")
        continue
      }

      lines.push("| Template | Relation | Type | Title |")
      lines.push("|----------|----------|------|-------|")
      for (const tl of col.templateLinks) {
        const tmpl = `\`${tl.template}\``
        const rel = tl.rel || ""
        const type = tl.type ? `\`${tl.type}\`` : ""
        const title = tl.title || ""
        lines.push(`| ${tmpl} | ${rel} | ${type} | ${title} |`)
      }
      lines.push("")
    }
  }

  return lines.join("\n")
}

function buildCoreDiscoveryMd(coreDiscovery: CoreDiscoveryWorkspace[]): string {
  const lines: string[] = []
  lines.push("# ADT Core Discovery")
  lines.push("")
  lines.push(`${coreDiscovery.length} entries from \`GET /sap/bc/adt/core/discovery\``)
  lines.push("")
  lines.push("| Workspace Title | Collection Title | href | Category |")
  lines.push("|-----------------|-----------------|------|----------|")

  for (const ws of coreDiscovery) {
    const c = ws.collection
    lines.push(`| ${ws.title} | ${c.title || ""} | \`${c.href}\` | ${c.category || ""} |`)
  }

  lines.push("")
  return lines.join("\n")
}

function buildResAppClassesMd(classes: { name: string; description: string }[]): string {
  const lines: string[] = []
  lines.push("# RES_APP Classes")
  lines.push("")
  lines.push(
    `${classes.length} classes found via SEOMETAREL query ` +
      `(subclasses of CL_ADT_DISC_RES_APP_BASE and CL_ADT_RES_APP_BASE).`
  )
  lines.push("")
  lines.push(
    "Each class has a `register_resources()` method that registers ADT endpoints. " +
      "Read the source code to find which URLs and handler classes it registers."
  )
  lines.push("")
  lines.push("| Class Name | Description |")
  lines.push("|------------|-------------|")

  const sorted = [...classes].sort((a, b) => a.name.localeCompare(b.name))
  for (const cls of sorted) {
    lines.push(`| \`${cls.name}\` | ${cls.description || ""} |`)
  }

  lines.push("")
  return lines.join("\n")
}

// ── 辅助 ─────────────────────────────────────────────────────

function getFirstNonAdtFolder(): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return undefined
  for (const f of folders) {
    if (!f.uri.scheme.startsWith("adt")) return f.uri
  }
  return folders[0].uri
}

// ── 注册 ────────────────────────────────────────────────

export function registerAdtDiscoveryTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerToolWithRegistry("adt_discovery_export", new AdtDiscoveryTool())
  )
}
