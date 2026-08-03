/**
 * ABAP 下载工具
 *
 * 把任意 adt:// 资源（包、程序、类、函数组、
 * 文件夹或单个文件）下载到本地文件夹。
 *
 * 为什么我们自己遍历树而不是用 vscode.workspace.fs.copy：
 *   1. 原子性 — fs.copy 在第一个逐文件失败时中止。abap fs
 *      提供器会暴露陈旧/孤儿条目（已重命名但树仍列出），
 *      其 readFile 会抛 Unavailable；手动遍历会跳过它们，
 *      让包的其余部分落地。
 *   2. 进度 — fs.copy 不透明。我们需要逐文件进度以及通知中
 *      实时更新的已完成/总数计数器。
 *   3. 取消 — fs.copy 不接受 CancellationToken。手动遍历在文件之间
 *      检查 token，所以取消几乎是即时的。
 */

import * as vscode from "vscode"
import { registerToolWithRegistry } from "./toolRegistry"
import { logTelemetry } from "../telemetry"
import { assertToolInvocationAuthorized } from "./toolGuard"
import { getSearchService } from "../abapSearchService"
import { getOrCreateRoot } from "../../adt/conections"

export interface IDownloadParameters {
  /**
   * 源。以下之一：
   *   - 完整 adt URI：`adt://ged100/System Library/ZFOO`
   *   - ADT 路径：`/sap/bc/adt/packages/zfoo`
   *   - 裸对象名（需要 `connectionId`，通常还需要 `objectType`）
   */
  source: string
  /** 绝对本地文件夹路径（`C:\wiki\raw\ZFOO`）或 `file://` URI。 */
  target: string
  /** 如果 `source` 是裸对象名或 ADT 路径，则必填。 */
  connectionId?: string
  /** 裸名称的可选类型消歧符（例如 `CLAS/OC`、`PROG/P`）。 */
  objectType?: string
  /** 覆盖目标位置的现有文件。默认 true。 */
  overwrite?: boolean
}

async function resolveSource(input: IDownloadParameters): Promise<vscode.Uri> {
  const { source, connectionId, objectType } = input

  if (source.startsWith("adt://") || source.startsWith("file://")) {
    return vscode.Uri.parse(source)
  }

  if (!connectionId) {
    throw new Error("connectionId is required when source is not a full adt:// or file:// URI")
  }
  const root = await getOrCreateRoot(connectionId)

  if (source.startsWith("/sap/bc/adt/")) {
    // main=false，让 FUGR / CLAS / DEVC 解析到包含文件夹
    // （包含所有 FM / include / 类部分），而不仅仅是主 include。
    const found = await root.findByAdtUri(source, false)
    if (!found?.path) throw new Error(`Cannot resolve ADT path ${source} on ${connectionId}`)
    return vscode.Uri.parse(`adt://${connectionId}${found.path}`)
  }

  const searcher = getSearchService(connectionId)
  const results = await searcher.searchObjects(source, objectType ? [objectType] : undefined, 5)
  const exact = results?.find(r => r.name?.toUpperCase() === source.toUpperCase()) ?? results?.[0]
  if (!exact?.uri) {
    throw new Error(
      `Object ${source}${objectType ? ` (${objectType})` : ""} not found on ${connectionId}`
    )
  }
  const found = await root.findByAdtUri(exact.uri, false)
  if (!found?.path) throw new Error(`Cannot resolve workspace path for ${source}`)
  return vscode.Uri.parse(`adt://${connectionId}${found.path}`)
}

function resolveTarget(target: string): vscode.Uri {
  if (target.startsWith("file://")) return vscode.Uri.parse(target)
  if (target.startsWith("adt://")) {
    throw new Error("target must be a local path, not an adt:// URI")
  }
  return vscode.Uri.file(target)
}

export class DownloadTool implements vscode.LanguageModelTool<IDownloadParameters> {
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IDownloadParameters>,
    _token: vscode.CancellationToken
  ) {
    const { source, target } = options.input
    return {
      invocationMessage: `Downloading ${source} to ${target}`,
      confirmationMessages: {
        title: "Download ABAP Resource",
        message: new vscode.MarkdownString(
          `Download to local folder:\n\n` +
            `**Source:** \`${source}\`\n` +
            `**Target:** \`${target}\``
        )
      }
    }
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IDownloadParameters>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    assertToolInvocationAuthorized(options)
    const input: IDownloadParameters = {
      ...options.input,
      connectionId: options.input.connectionId?.toLowerCase()
    }
    logTelemetry("tool_download_called", { connectionId: input.connectionId ?? "" })

    const targetUri = resolveTarget(input.target)
    const overwrite = input.overwrite ?? false
    const label =
      input.source
        .split(/[\/\\]/)
        .filter(Boolean)
        .pop() ?? "resource"

    const stats = { files: 0, folders: 0, skipped: 0, failed: [] as string[] }
    let cancelled = false
    let sourceUri: vscode.Uri | undefined
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Downloading ${label}`,
        cancellable: true
      },
      async (progress, progressToken) => {
        // 把 LM 工具 token 与进度通知自己的取消按钮组合
        const cts = new vscode.CancellationTokenSource()
        const sub1 = token.onCancellationRequested(() => cts.cancel())
        const sub2 = progressToken.onCancellationRequested(() => cts.cancel())
        try {
          // 首次命中时解析可能很慢（树水合、findByAdtUri）；
          // 把它放在进度内，让用户立即看到“正在解析…”。
          progress.report({ message: "Resolving source…" })
          const resolved = await race(resolveSource(input), cts.token)
          if (cts.token.isCancellationRequested || !resolved) return
          sourceUri = resolved
          progress.report({ message: "Scanning…" })
          const total = (await race(countFiles(resolved, cts.token), cts.token)) ?? 0
          if (cts.token.isCancellationRequested) return
          let done = 0
          await copyTree(resolved, targetUri, overwrite, stats, cts.token, name => {
            done++
            progress.report({
              message: total ? `${done}/${total} — ${name}` : name,
              increment: total ? 100 / total : undefined
            })
          })
        } finally {
          cancelled = cts.token.isCancellationRequested
          sub1.dispose()
          sub2.dispose()
          cts.dispose()
        }
      }
    )

    if (cancelled) {
      // 传播给 Copilot，让模型看到真正的取消，而不是
      // 可能被当作成功的部分“已下载”结果。
      throw new vscode.CancellationError()
    }

    const summary =
      `Downloaded ${sourceUri?.toString() ?? input.source} to ${targetUri.fsPath}\n` +
      `Files: ${stats.files}, Folders: ${stats.folders}, Skipped: ${stats.skipped}, Failed: ${stats.failed.length}` +
      (stats.failed.length ? `\nFailures:\n  ${stats.failed.slice(0, 50).join("\n  ")}` : "")
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(summary)])
  }
}

/**
 * 递归把 `source`（adt:// 或 file://）复制到 `target`（file://），容忍
 * 逐文件失败 — abap fs 提供器会暴露 readFile 失败的陈旧/孤儿条目；
 * 跳过它们可以让包的其余部分落地。
 */
async function copyTree(
  source: vscode.Uri,
  target: vscode.Uri,
  overwrite: boolean,
  stats: { files: number; folders: number; skipped: number; failed: string[] },
  token: vscode.CancellationToken,
  onFile: (name: string) => void
): Promise<void> {
  if (token.isCancellationRequested) return
  let stat: vscode.FileStat
  try {
    stat = await vscode.workspace.fs.stat(source)
  } catch (e) {
    stats.failed.push(`${source.toString()} (stat: ${errMsg(e)})`)
    return
  }

  if (stat.type === vscode.FileType.Directory) {
    stats.folders++
    try {
      await vscode.workspace.fs.createDirectory(target)
    } catch (e) {
      stats.failed.push(`${target.fsPath} (mkdir: ${errMsg(e)})`)
      return
    }
    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(source)
    } catch (e) {
      stats.failed.push(`${source.toString()} (readDirectory: ${errMsg(e)})`)
      return
    }
    await runPool(entries, DL_CONCURRENCY, ([name]) =>
      copyTree(
        vscode.Uri.joinPath(source, name),
        vscode.Uri.joinPath(target, name),
        overwrite,
        stats,
        token,
        onFile
      )
    )
    return
  }

  // 文件
  const leaf = source.path.split("/").pop() ?? ""
  onFile(leaf)
  if (!overwrite) {
    try {
      await vscode.workspace.fs.stat(target)
      stats.skipped++
      return
    } catch {
      // 目标不存在 — 继续
    }
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(source)
    if (token.isCancellationRequested) return
    await vscode.workspace.fs.writeFile(target, bytes)
    stats.files++
  } catch (e) {
    stats.failed.push(`${source.toString()} (${errMsg(e)})`)
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/**
 * 让 Promise 与取消令牌竞争。如果令牌先触发，
 * 返回的 Promise 解析为 `undefined`（原始 Promise 继续运行，
 * 但没人等待它）。只在底层操作没有原生取消时使用。
 */
function race<T>(p: Promise<T>, token: vscode.CancellationToken): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const sub = token.onCancellationRequested(() => {
      sub.dispose()
      resolve(undefined)
    })
    p.then(
      v => {
        sub.dispose()
        resolve(v)
      },
      e => {
        sub.dispose()
        if (token.isCancellationRequested) resolve(undefined)
        else reject(e)
      }
    )
  })
}

/**
 * 快速递归统计 `source` 下的文件数。只使用 readDirectory
 * （不 readFile）。任何错误都返回 0；复制将回退到
 * 不确定进度。
 */
async function countFiles(source: vscode.Uri, token: vscode.CancellationToken): Promise<number> {
  if (token.isCancellationRequested) return 0
  try {
    const stat = await vscode.workspace.fs.stat(source)
    if (stat.type !== vscode.FileType.Directory) return 1
    const entries = await vscode.workspace.fs.readDirectory(source)
    const counts = await Promise.all(
      entries.map(([name]) => countFiles(vscode.Uri.joinPath(source, name), token))
    )
    return counts.reduce((a, b) => a + b, 0)
  } catch {
    return 0
  }
}

/**
 * 并行工作池：在 `items` 上同时最多运行 `limit` 个 Promise。
 * ADT 容忍一个 HTTP 会话上的少量并行读取；超过约 8 个
 * 往往会遇到后端串行化或锁竞争。
 */
const DL_CONCURRENCY = 5
async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let i = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await worker(items[idx])
    }
  })
  await Promise.all(runners)
}

export function registerDownloadTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(registerToolWithRegistry("abap_download", new DownloadTool()))
}
