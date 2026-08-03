import { getOrCreateRoot } from "../adt/conections"
import {
  FileSystemError,
  FileChangeType,
  FileSystemProvider,
  EventEmitter,
  FileChangeEvent,
  Uri,
  Disposable,
  FileStat,
  FileType,
  TextDocumentSaveReason,
  commands,
  ExtensionContext,
  workspace
} from "vscode"
import { after, caughtToString, log } from "../lib"
import { AbapFile, AbapFolder, isAbapFile, isAbapFolder, isFolder, Root } from "abapfs"
import { getSaveReason, clearSaveReason } from "../listeners"
import { selectTransportIfNeeded } from "../adt/AdtTransports"
import { LocalFsProvider } from "./LocalFsProvider"
import { isHttpError } from "abap-adt-api"
import { ReloginError } from "abapfs/out/lockManager"
import { funWindow as window } from "../services/funMessenger"
import { AbapObject } from "abapobject"

const openInGui = (uri: Uri, object: AbapObject) => {
  const guiObjects = object.gui_objects
  const autoOpen = workspace
    .getConfiguration("abapfs")
    .get<boolean>("autoOpenUnsupportedInGui", true)
  const openXml = workspace.getConfiguration("abapfs").get<boolean>("sapGui.openXmlInGui", true)

  const shouldOpen = guiObjects === "yes" || (guiObjects === "better" && openXml)

  if (shouldOpen) {
    if (autoOpen) {
      // 自动触发 runInGui 命令
      // 使用 setTimeout 确保文档先打开，这样 URI 上下文可用
      setTimeout(() => {
        commands.executeCommand("abapfs.runInGui")
      }, 1000)
    } else {
      // 显示带操作按钮的消息
      setTimeout(async () => {
        const choice = await window.showInformationMessage(
          "This object type is best viewed in SAP GUI.",
          "Open in SAP GUI",
          "Always Auto Open"
        )
        if (choice === "Open in SAP GUI") {
          commands.executeCommand("abapfs.runInGui")
        } else if (choice === "Always Auto Open") {
          await workspace.getConfiguration("abapfs").update("autoOpenUnsupportedInGui", true, true)
          commands.executeCommand("abapfs.runInGui")
        }
      }, 500)
    }
  }
}

const handleTelemetry = (uri: Uri) => {
  try {
    const uriString = uri.toString()

    // 检查此保存是否由非手动操作触发
    const saveReason = getSaveReason(uriString)
    if (saveReason === undefined || saveReason !== TextDocumentSaveReason.Manual) {
      clearSaveReason(uriString)
      return // Block any save that isn't explicitly manual
    }

    clearSaveReason(uriString)
  } catch (e) {}
}
export class FsProvider implements FileSystemProvider {
  private overwriteRejected = new Set<string>()
  private static instance: FsProvider
  // private editorContentCache = new Map<string, string>() // Track editor content to prevent server overwrites
  private localProvider: LocalFsProvider
  // 在焦点风暴期间节流 SAP 标准文件夹的 refresh()。
  private lastFolderRefresh = new Map<string, number>()
  private static readonly STANDARD_REFRESH_TTL_MS = 5 * 60_000
  private constructor(private context: ExtensionContext) {
    this.localProvider = new LocalFsProvider(context)
    // 把本地提供器的文件变化转发到此提供器，让扩展
    // 收到来自本地存储的变化通知
    this.context.subscriptions.push(
      this.localProvider.onDidChangeFile(changes => this.pEventEmitter.fire(changes))
    )
    // 只在用户实际在编辑器中打开对象时触发“最好在 SAP GUI 中查看”提示，
    // 不在每次程序化 readFile 时触发
    // （下载和后台 LM 工具读取时会发生）。
    this.context.subscriptions.push(
      workspace.onDidOpenTextDocument(async doc => {
        const uri = doc.uri
        if (uri.scheme !== "adt" || LocalFsProvider.useLocalStorage(uri)) return
        try {
          const root = await getOrCreateRoot(uri.authority)
          const node = await root.getNodeAsync(uri.path)
          if (isAbapFile(node)) openInGui(uri, node.object)
        } catch {
          // 忽略 — 解析失败已在其他地方记录
        }
      })
    )
  }
  public static get(context?: ExtensionContext) {
    if (!FsProvider.instance)
      if (context) FsProvider.instance = new FsProvider(context)
      else throw new Error("FsProvider not initialized, context is required")
    return FsProvider.instance
  }
  public get onDidChangeFile() {
    return this.pEventEmitter.event
  }
  private pEventEmitter = new EventEmitter<FileChangeEvent[]>()
  public watch(
    uri: Uri,
    options: {
      readonly recursive: boolean
      readonly excludes: readonly string[]
    }
  ): Disposable {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.watch(uri, options)
    return new Disposable(() => undefined)
  }

  public notifyChanges(changes: FileChangeEvent[]) {
    this.pEventEmitter.fire(changes)
  }

  private isOpenDirtyDocument(uri: Uri) {
    return workspace.textDocuments.some(
      document => document.uri.toString() === uri.toString() && document.isDirty
    )
  }

  // VS Code ADT 在窗口聚焦时重新 stat 每个展开的文件夹。自定义文件夹
  // 始终刷新；SAP 标准只在为空或过期时刷新
  // （见 STANDARD_REFRESH_TTL_MS）。
  private async refreshAbapFolder(node: AbapFolder) {
    const isCustom = /^[ZY$/]/i.test(node.object.name)
    if (isCustom) {
      await node.refresh()
      return
    }
    const last = this.lastFolderRefresh.get(node.object.path) ?? 0
    const stale = Date.now() - last > FsProvider.STANDARD_REFRESH_TTL_MS
    if (node.size === 0 || stale) {
      await node.refresh()
      this.lastFolderRefresh.set(node.object.path, Date.now())
    }
  }

  // 绕过 STANDARD_REFRESH_TTL_MS 并立即重新获取：用于 SAP 标准
  // 已变化且用户无法等待 TTL 过期的备份方案。
  public async refreshFilesystem(uri?: Uri) {
    this.lastFolderRefresh.clear()
    if (!uri || LocalFsProvider.useLocalStorage(uri)) return
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (isAbapFolder(node)) {
        await node.refresh()
      } else {
        // 文件或非 ABAP 文件夹：向上走到最近的 AbapFolder。
        for (const step of root.getNodePath(uri.path)) {
          if (isAbapFolder(step.file)) {
            await step.file.refresh()
            break
          }
        }
      }
      this.pEventEmitter.fire([{ type: FileChangeType.Changed, uri }])
    } catch (e) {
      log.debug(`Error refreshing ${uri.toString()}\n${caughtToString(e)}`)
      throw this.wrapHttpError(e, uri)
    }
  }

  public async stat(uri: Uri): Promise<FileStat> {
    // .* 文件和模板文件的本地存储
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.stat(uri)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (!node) throw FileSystemError.FileNotFound(uri)
      if (isAbapFile(node) && !this.isOpenDirtyDocument(uri)) await node.stat()
      if (isAbapFolder(node)) await this.refreshAbapFolder(node)
      return node
    } catch (e) {
      // 不对方法名/调试工件记录 FileNotFound 错误以减少噪音
      if (!(e instanceof FileSystemError && e.name === "FileNotFound (FileSystemError)"))
        log.debug(`Error in stat of ${uri?.toString()}\n${caughtToString(e)}`)
      throw this.wrapHttpError(e, uri)
    }
  }

  public async readFile(uri: Uri): Promise<Uint8Array> {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.readFile(uri)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (isAbapFile(node)) {
        const contents = await node.read()

        const buf = Buffer.from(contents)
        return buf
      }
    } catch (error) {
      log.debug(`Error reading file ${uri?.toString()}\n${caughtToString(error)}`)
    }
    throw FileSystemError.Unavailable(uri)
  }

  public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.readDirectory(uri)

    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (!isFolder(node)) throw FileSystemError.FileNotFound(uri)
      if (isAbapFolder(node) && node.size === 0) await node.refresh()
      const files: [string, FileType][] = [...node].map(i => [i.name, i.file.type])
      if (uri.path === "/") {
        const localfiles = await this.localProvider.readDirectory(uri)
        return [...files, ...localfiles]
      }
      return files
    } catch (e) {
      log(`Error reading directory ${uri?.toString()}\n${caughtToString(e)}`)
      throw this.wrapHttpError(e, uri)
    }
  }

  public createDirectory(uri: Uri): void | Thenable<void> {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.createDirectory(uri)
    throw FileSystemError.NoPermissions(
      "Not a real filesystem, directory creation is not supported"
    )
  }

  private wrapHttpError(e: unknown, uri: Uri): unknown {
    if (e instanceof FileSystemError) return e
    const msg = caughtToString(e)
    if (msg.includes("status code 401"))
      return FileSystemError.NoPermissions(
        `Authentication failed for ${uri.authority}. Wrong password?`
      )
    if (msg.includes("status code 403"))
      return FileSystemError.NoPermissions(
        `Access denied to ${uri.authority} (HTTP 403). Likely a proxy issue or ADT service (/sap/bc/adt) not activated in SICF — contact your Basis team.`
      )
    if (msg.includes("status code 503"))
      return FileSystemError.Unavailable(
        `SAP system ${uri.authority} is unreachable (HTTP 503). ADT endpoint may be down or proxy misconfigured.`
      )
    if (msg.includes("status code 404")) return FileSystemError.FileNotFound(uri)
    return e
  }

  private async askOverwrite(uri: Uri) {
    const choice = await window.showWarningMessage(
      "The SAP object was changed while not locked. Overwrite changes made by others?",
      "Overwrite",
      "Cancel"
    )
    if (choice === "Overwrite") this.overwriteRejected.delete(uri.toString())
    else {
      this.overwriteRejected.add(uri.toString())
      throw new Error(
        `Save cancelled because the file changed during relogin. Change time before relogin`
      )
    }
  }

  private async writewithRelogin(
    root: Root,
    uri: Uri,
    node: AbapFile,
    content: string,
    transportId?: string
  ) {
    const previousChangeTime = node.mtime
    const lock = root.lockManager.lockStatus(uri.path)
    if (lock.status !== "locked") throw new Error("File is not locked")
    try {
      if (this.overwriteRejected.has(uri.toString())) await this.askOverwrite(uri)
      await node.write(content.toString(), lock.LOCK_HANDLE, transportId)
    } catch (error) {
      if (isHttpError(error) && error.status >= 400 && error.status < 500) {
        log(`Error writing file ${uri.toString()}\n${caughtToString(error)}\nAttempting relogin`)
        await root.lockManager.relogin().catch(e => {
          if (!ReloginError.isReloginError(e)) throw e
        })
        await node.stat()
        if (node.mtime !== previousChangeTime) await this.askOverwrite(uri)
        const newlock = await root.lockManager.requestLock(uri.path)
        if (newlock.status !== "locked") throw new Error("File is not locked after relogin")
        await node.write(content.toString(), newlock.LOCK_HANDLE, transportId)
      } else throw error
      this.overwriteRejected.delete(uri.toString())
    }
    await root.lockManager.requestUnlock(uri.path, true)
  }

  public async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    if (LocalFsProvider.useLocalStorage(uri))
      return this.localProvider.writeFile(uri, content, undefined)
    let needUnlocking = false
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      if (isAbapFile(node)) {
        handleTelemetry(uri)
        // 始终请求锁以添加声明 - 防止延迟解锁竞态条件
        const oldlock = (await root.lockManager.finalStatus(uri.path)).status
        await root.lockManager.requestLock(uri.path)
        needUnlocking = oldlock === "unlocked"
        const trsel = await selectTransportIfNeeded(uri)
        if (trsel.cancelled) return
        await this.writewithRelogin(root, uri, node, content.toString(), trsel.transport)
        this.pEventEmitter.fire([{ type: FileChangeType.Changed, uri }])
      } else throw FileSystemError.FileNotFound(uri)
    } catch (e) {
      log(`Error writing file ${uri.toString()}\n${caughtToString(e)}`)
      // 如果我们获取了锁但写入失败，清理锁
      if (needUnlocking)
        await getOrCreateRoot(uri.authority)
          .then(r => r.lockManager.requestUnlock(uri.path, true))
          .catch(() => undefined)
      throw e
    }
  }

  public async delete(uri: Uri, options: { recursive: boolean }) {
    if (LocalFsProvider.useLocalStorage(uri)) return this.localProvider.delete(uri, options)
    try {
      const root = await getOrCreateRoot(uri.authority)
      const node = await root.getNodeAsync(uri.path)
      const lock = await root.lockManager.requestLock(uri.path)
      if (lock.status === "locked") {
        const trsel = await selectTransportIfNeeded(uri)
        if (trsel.cancelled) return
        if (isAbapFolder(node) || isAbapFile(node))
          return await node.delete(lock.LOCK_HANDLE, trsel.transport)
        else throw FileSystemError.Unavailable("Deletion not supported for this object")
      } else throw FileSystemError.NoPermissions(`Unable to acquire lock`)
    } catch (e) {
      log(`[DELETE ERROR] URI: ${uri.toString()}, Error: ${caughtToString(e)}`)
      const msg = `Error deleting file ${uri.toString()}\n${caughtToString(e)}`
      throw new Error(msg)
    }
  }

  public rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void | Thenable<void> {
    if (LocalFsProvider.useLocalStorage(oldUri))
      return this.localProvider.rename(oldUri, newUri, options)
    throw new Error("Method not implemented.")
  }
}
