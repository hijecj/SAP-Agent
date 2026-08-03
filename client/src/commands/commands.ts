import { PACKAGE, AdtObjectCreator } from "../adt/operations/AdtObjectCreator"
import {
  CreatableTypeIds,
  PackageTypes,
  CreatableTypes,
  isBindingOptions,
  NewObjectOptions
} from "abap-adt-api"
import { MySearchResult } from "../adt/operations/AdtObjectFinder"
import { SapGuiPanel } from "../views/sapgui/SapGuiPanel"
import { clearSystemInfoCache } from "../services/sapSystemInfo"
import {
  workspace,
  Uri,
  commands,
  ProgressLocation,
  Range,
  FileChangeType,
  extensions
} from "vscode"
import * as vscode from "vscode"
import { funWindow as window } from "../services/funMessenger"
import { pickAdtRoot, RemoteManager } from "../config"
import {
  caughtToString,
  inputBox,
  lineRange,
  log,
  rangeVscToApi,
  splitAdtUri,
  channel
} from "../lib"
import { FavouritesProvider, FavItem } from "../views/favourites"
import { findEditor, vsCodeUri } from "../langClient"
import { showHideActivate } from "../listeners"
import { UnitTestRunner } from "../adt/operations/UnitTestRunner"
import {
  selectTransport,
  pickTransportProgrammatically,
  TransportPickerError
} from "../adt/AdtTransports"
import { showInGuiCb, executeInGui, runInSapGui, openInGui } from "../adt/sapgui/sapgui"
import { storeTokens, clearTokens } from "../oauth"
import { showAbapDoc } from "../views/help"
import { showQuery } from "../views/query/query"
import {
  ADTSCHEME,
  getClient,
  getRoot,
  uriRoot,
  getOrCreateRoot,
  disconnect
} from "../adt/conections"
import { isAbapFolder, isAbapFile, isAbapStat } from "abapfs"
import { AdtObjectActivator } from "../adt/operations/AdtObjectActivator"
import {
  AdtObjectFinder,
  createUri,
  findAbapObject,
  uriAbapFile
} from "../adt/operations/AdtObjectFinder"
import { isAbapClassInclude, getObjectTypeConfig } from "abapobject"
import { IncludeProvider } from "../adt/includes" // resolve dependencies
import { command, AbapFsCommands } from "."
import { createConnection } from "./connectionwizard"
import { openConnectionManager } from "../configuration/sapConnectionManager"
import { context as extensionContext } from "../extension"
import { types } from "util"
import { atcProvider } from "../views/abaptestcockpit"
import { FsProvider } from "../fs/FsProvider"
import { logTelemetry } from "../services/telemetry"
import { SapGui } from "../adt/sapgui/sapgui"
import { AbapDebugSession } from "../adt/debugger/abapDebugSession"
import { createObjectInEditorCommand } from "./createObjectInEditor"
import { manageTextElementsCommand } from "./textElementsCommands"
import { configureFeedsCommand } from "./configureFeeds"
import { publishServiceBindingCommand } from "./publishServiceBinding"
import { testServiceBindingCommand } from "./testServiceBinding"

export function currentUri() {
  if (!window.activeTextEditor) return
  const uri = window.activeTextEditor.document.uri
  if (uri.scheme !== ADTSCHEME) return
  return uri
}

async function saveDirtyAdtDocuments(connectionId: string) {
  const dirtyDocuments = workspace.textDocuments.filter(
    document =>
      document.isDirty &&
      document.uri.scheme === ADTSCHEME &&
      document.uri.authority === connectionId
  )

  for (const document of dirtyDocuments) {
    const saved = await document.save()
    if (!saved) {
      throw new Error(`Failed to save ${document.uri.path} before activation.`)
    }
  }
}

export function currentAbapFile() {
  const uri = currentUri()
  return uriAbapFile(uri)
}

export function currentEditState() {
  const uri = currentUri()
  if (!uri) return
  const line = window.activeTextEditor?.selection.active.line
  return { uri, line }
}

export function openObject(connId: string, uri: string, objectType?: string) {
  return window.withProgress(
    { location: ProgressLocation.Notification, title: "Opening..." },
    async () => {
      const root = getRoot(connId)
      let result = await root.findByAdtUri(uri, true)

      // 如果未找到，尝试刷新工作区（针对新建对象）
      if (!result) {
        try {
          await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
          await new Promise(resolve => setTimeout(resolve, 500)) // 稍等一下
          result = await root.findByAdtUri(uri, true)
        } catch (e) {
          // 刷新失败或仍未找到
        }
      }

      const { file, path } = result || {}
      if (!file || !path)
        throw new Error("Object not found in workspace. Try refreshing the explorer.")

      if (isAbapFolder(file) && file.object.type === PACKAGE) {
        await commands.executeCommand("revealInExplorer", createUri(connId, path))
        return
      } else if (isAbapFile(file)) {
        const fileUri = createUri(connId, path)

        const config = getObjectTypeConfig(objectType || "")
        if (config?.customEditor) {
          await commands.executeCommand("vscode.openWith", fileUri, config.customEditor)
        } else if (path.endsWith(".msagn.xml")) {
          await commands.executeCommand("vscode.openWith", fileUri, "abapfs.msagn")
        } else {
          await workspace.openTextDocument(fileUri).then(window.showTextDocument)
        }
      }
      return { file, path }
    }
  )
}
interface ShowObjectArgument {
  connId: string
  uri: string
}
export class AdtCommands {
  private static hasEnabledAbapBreakpoints(connectionId: string) {
    return vscode.debug.breakpoints.some(
      breakpoint =>
        breakpoint.enabled &&
        breakpoint instanceof vscode.SourceBreakpoint &&
        breakpoint.location.uri.scheme === ADTSCHEME &&
        breakpoint.location.uri.authority === connectionId
    )
  }

  private static async autoStartDebuggerIfNeeded(connectionId: string) {
    if (AbapDebugSession.byConnection(connectionId)) return
    if (!AdtCommands.hasEnabledAbapBreakpoints(connectionId)) return

    const started = await vscode.debug.startDebugging(undefined, {
      type: "abap",
      request: "attach",
      name: "Auto Attach to server",
      connId: connectionId,
      debugUser: "",
      terminalMode: false
    })

    if (!started) {
      throw new Error("Failed to auto-start ABAP debugger")
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  @command(AbapFsCommands.extractMethod)
  private static async extractMethod(url: string, range: Range) {
    logTelemetry("command_extract_method_called")
    const uri = Uri.parse(url)
    const client = getClient(uri.authority)
    const root = getRoot(uri.authority)
    const file = await root.getNodeAsync(uri.path)
    if (isAbapFile(file)) {
      const o = file.object
      const proposal = await client.extractMethodEvaluate(o.path, rangeVscToApi(range))
      const methodName = await window.showInputBox({ prompt: "Method name" })
      if (!methodName) return
      const transport = await selectTransport(o.path, "", client)
      if (transport.cancelled) return
      proposal.genericRefactoring.transport = transport.transport
      proposal.name = methodName
      const preview = await client.extractMethodPreview(proposal)
      await client.extractMethodExecute(preview)
      FsProvider.get().notifyChanges([{ type: FileChangeType.Changed, uri }])
    }
  }
  @command(AbapFsCommands.showDocumentation)
  private static async showAbapDoc() {
    logTelemetry("command_show_documentation_called")
    return showAbapDoc()
  }

  @command(AbapFsCommands.selectDB)
  private static async selectDB(table?: string) {
    logTelemetry("command_select_db_called")
    return showQuery(table)
  }

  @command(AbapFsCommands.changeInclude)
  private static async changeMain(uri: Uri) {
    return IncludeProvider.get().switchInclude(uri)
  }

  @command(AbapFsCommands.createConnection)
  private static createConnectionCommand() {
    return createConnection()
  }

  @command(AbapFsCommands.connectionManager)
  private static connectionManagerCommand() {
    return openConnectionManager(extensionContext)
  }

  @command(AbapFsCommands.connect)
  private static async connectAdtServer(selector: any) {
    logTelemetry("command_connect_called")
    let name = ""
    try {
      const connectionID = selector && selector.connection
      const manager = RemoteManager.get()

      const { remote, userCancel } = await manager.selectConnection(connectionID)
      if (!remote)
        if (!userCancel) throw Error("No remote configuration available in settings")
        else return
      name = remote.name

      log(`Connecting to server ${remote.name}`)
      // 这可能需要询问密码...
      await getOrCreateRoot(remote.name) // if connection raises an exception don't mount any folder

      await storeTokens()

      const folderCount = workspace.workspaceFolders?.length ?? 0
      workspace.updateWorkspaceFolders(folderCount, 0, {
        uri: Uri.parse("adt://" + remote.name),
        name: remote.name + "(ABAP)"
      })
      extensionContext.subscriptions.push(UnitTestRunner.get(connectionID).controller)
      log(`Connected to server ${remote.name}`)
    } catch (e) {
      const body = typeof e === "object" && (e as any)?.response?.body
      if (body) log(body)
      const isMissing = (e: any) => !!`${e}`.match("name.*org.freedesktop.secrets")
      const errStr = caughtToString(e)

      // 可恢复的配置错误 → 打开连接管理器并显示有帮助的消息
      let configError = ""
      if (errStr.includes("No remote configuration available")) {
        configError = "No SAP systems configured yet. Opening Connection Manager to add one."
      } else if (errStr.includes("Invalid ADTClient configuration")) {
        configError = name
          ? `Connection "${name}" is incomplete (missing ADT URL or username). Opening Connection Manager to fix it.`
          : "Connection is incomplete (missing ADT URL or username). Opening Connection Manager to fix it."
      }

      if (configError) {
        window.showInformationMessage(configError)
        return commands.executeCommand("abapfs.connectionManager")
      }

      // 带友好消息的 HTTP 错误
      if (errStr.includes("status code 401")) {
        return window.showErrorMessage(
          name
            ? `Authentication failed for "${name}". Check your username/password in Connection Manager.`
            : `Authentication failed. Check your credentials.`
        )
      }
      if (errStr.includes("status code 503")) {
        return window.showErrorMessage(
          name
            ? `SAP system "${name}" is unreachable (HTTP 503). The ADT endpoint may be down or proxy settings may be incorrect — contact your Basis team.`
            : `SAP system is unreachable (HTTP 503). The ADT endpoint may be down or proxy settings may be incorrect — contact your Basis team.`
        )
      }

      const message = isMissing(e)
        ? `Password storage not supported. Please install gnome-keyring or add a password to the connection`
        : name
          ? `Failed to connect to ${name}: ${errStr}`
          : `Failed to connect: ${errStr}`
      return window.showErrorMessage(message)
    }
  }

  @command(AbapFsCommands.disconnect)
  private static async disconnectAdtServer(selector?: any) {
    logTelemetry("command_disconnect_called")
    try {
      // 显示确认对话框
      const choice = await window.showWarningMessage(
        "This will disconnect from all ABAP systems and remove them from the workspace. Continue?",
        { modal: true },
        "Disconnect",
        "Cancel"
      )

      if (choice !== "Disconnect") {
        return
      }

      // 获取所有当前的 ABAP 工作区文件夹
      const abapFolders =
        workspace.workspaceFolders?.filter(folder => folder.uri.scheme === ADTSCHEME) || []

      // 从所有连接注销并清除缓存数据
      await disconnect()

      // 从工作区移除所有 ABAP 文件夹
      if (abapFolders.length > 0) {
        const startIndex =
          workspace.workspaceFolders?.findIndex(folder => folder.uri.scheme === ADTSCHEME) ?? 0

        workspace.updateWorkspaceFolders(
          startIndex,
          abapFolders.length // 移除所有 ABAP 文件夹
        )
      }

      // 清除任何缓存的 token
      clearTokens()

      // 刷新文件资源管理器以反映变化
      await commands.executeCommand("workbench.files.action.refreshFilesExplorer")

      window.showInformationMessage("✅ Disconnected from all ABAP systems")
    } catch (e) {
      const message = `Failed to disconnect: ${caughtToString(e)}`
      return window.showErrorMessage(message)
    }
  }

  @command(AbapFsCommands.activate)
  private static async activateCurrent(selector: Uri) {
    try {
      const uri = selector || currentUri()
      logTelemetry("command_activate_called", { connectionId: uri?.authority })
      if (!uri) {
        throw new Error("No ABAP file is currently open")
      }

      const activator = AdtObjectActivator.get(uri.authority)
      const editor = findEditor(uri.toString())

      await window.withProgress(
        { location: ProgressLocation.Notification, title: "Activating..." },
        async progress => {
          progress.report({ message: "Validating object..." })
          const obj = await findAbapObject(uri)

          // 带更好错误处理的增强保存逻辑
          if (editor && editor.document.isDirty) {
            progress.report({ message: "Saving changes..." })
            const saved = await editor.document.save()
            if (!saved) {
              throw new Error(
                "Failed to save file before activation. Please save manually and try again."
              )
            }
            // 短暂延迟确保保存完成
            await new Promise(resolve => setTimeout(resolve, 100))
          }

          progress.report({ message: "Activating object..." })
          const { ok, summary } = await activator.activate(obj, uri)
          if (!ok) {
            throw new Error(summary || "Activation failed; see ABAP FS output for details")
          }

          if (editor === window.activeTextEditor) {
            await workspace.fs.stat(uri)
            await showHideActivate(editor)
          }
        }
      )

      // 显示成功消息
      const objectName = uri.path.split("/").pop() || "Object"
      window.showInformationMessage(`✅ ${objectName} activated successfully`)
    } catch (e) {
      const errorMessage = caughtToString(e)

      const action = await window.showErrorMessage(
        `Activation failed: ${errorMessage}`,
        "Show activation log"
      )
      if (action === "Show activation log") {
        channel.show(true)
      }
      // 不重新抛出或显示额外通知 - 用户已看到摘要
      return
    }
  }

  @command(AbapFsCommands.activateMultiple)
  private static async activateMultiple(selector?: Uri) {
    try {
      const activeUri = selector || currentUri()
      const fsRoot = await pickAdtRoot(activeUri)
      const connectionId = activeUri?.authority || fsRoot?.uri.authority

      if (!connectionId) {
        throw new Error("No ABAP connection available")
      }

      const activator = AdtObjectActivator.get(connectionId)

      const result = await window.withProgress(
        { location: ProgressLocation.Notification, title: "Loading unactivated objects..." },
        async progress => {
          progress.report({ message: "Saving pending changes..." })
          await saveDirtyAdtDocuments(connectionId)

          progress.report({ message: "Loading unactivated objects..." })
          const activationResult = await activator.activateMultiple(true)

          if (activationResult.ok) {
            progress.report({ message: "Refreshing explorer..." })
            await commands.executeCommand("workbench.files.action.refreshFilesExplorer")

            const editor = window.activeTextEditor
            if (
              editor?.document.uri.scheme === ADTSCHEME &&
              editor.document.uri.authority === connectionId
            ) {
              await showHideActivate(editor, true)
            }
          }

          return activationResult
        }
      )

      if (result.cancelled) {
        return
      }

      if (!result.ok) {
        throw new Error(result.summary || "Activation failed; see ABAP FS output for details")
      }

      if (!result.availableCount) {
        window.showInformationMessage("No unactivated objects found")
        return
      }

      window.showInformationMessage(
        `✅ Activated ${result.selectedCount || 0} object${result.selectedCount === 1 ? "" : "s"}`
      )
    } catch (e) {
      const errorMessage = caughtToString(e)

      const action = await window.showErrorMessage(
        `Multiple activation failed: ${errorMessage}`,
        "Show activation log"
      )
      if (action === "Show activation log") {
        channel.show(true)
      }
    }
  }

  @command(AbapFsCommands.pickAdtRootConn)
  private static async pickRoot() {
    const uri = currentUri()
    const fsRoot = await pickAdtRoot(uri)
    if (!fsRoot) return
    return fsRoot.uri.authority
  }

  @command(AbapFsCommands.runClass)
  private static async runClass() {
    logTelemetry("command_run_class_called")
    try {
      const uri = currentUri()
      if (!uri) return
      const client = getClient(uri.authority)
      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) return
      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      const clas = isAbapFile(file) && isAbapClassInclude(file.object) && file.object.parent
      if (clas) {
        const text = await client.runClass(clas.name)
        log(text)
      }
    } catch (error) {
      log(caughtToString(error))
    }
  }

  @command(AbapFsCommands.search)
  private static async searchAdtObject(uri: Uri | undefined) {
    // 找到 ADT 相关的命名空间根，需要时让用户选择一个
    const adtRoot = await pickAdtRoot(uri)
    logTelemetry("command_search_for_object_called", { connectionId: adtRoot?.uri.authority })
    if (!adtRoot) return
    try {
      const connId = adtRoot.uri.authority
      // 对手动命令使用带类型过滤的增强搜索
      const object = await new AdtObjectFinder(connId).findObjectWithTypeFilter()
      if (!object) return // 用户已取消
      // 已找到，显示进度条，因为打开可能需要一段时间
      await openObject(connId, object.uri, object.type)
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.create)
  private static async createAdtObject(uri: Uri | undefined) {
    try {
      // 找到 ADT 相关的命名空间根，需要时让用户选择一个
      const fsRoot = await pickAdtRoot(uri)
      logTelemetry("command_create_object_called", { connectionId: fsRoot?.uri.authority })
      const connId = fsRoot?.uri.authority
      if (!connId) return
      const obj = await new AdtObjectCreator(connId).createObject(uri)
      if (!obj) return // 用户已中止
      log(`Created object ${obj.type} ${obj.name}`)
      await obj.loadStructure()

      if (obj.type === PACKAGE) {
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        return // 包无法打开，也许可以显示它？
      }
      const nodePath = await openObject(connId, obj.path)
      if (nodePath) {
        new AdtObjectFinder(connId).displayNode(nodePath)
        try {
          await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
          log("workspace refreshed")
        } catch (e) {
          log("error refreshing workspace")
        }
      }
    } catch (e) {
      const stack = types.isNativeError(e) ? e.stack || "" : ""
      log("Exception in createAdtObject:", stack)
      return window.showErrorMessage(caughtToString(e))
    }
  }

  /**
   * 以编程方式为 AI/自动化目的创建 ABAP 对象
   * 使用与 createObject() 完全相同的逻辑，但带编程式选择
   *
   * @example
   * // Create a new ABAP report with new transport request
   * await vscode.commands.executeCommand('abapfs.createObjectProgrammatically',
   *   'PROG/P', 'ZTEST_REPORT', 'test:do not use', 'ZXXX', undefined, undefined, {
   *     transportRequest: { type: 'new', description: 'Test transport - do not move' }
   *   });
   *
   * @example
   * // Create a new class with existing transport request
   * await vscode.commands.executeCommand('abapfs.createObjectProgrammatically',
   *   'CLAS/OC', 'ZCL_TEST', 'Test class', 'ZXXX', undefined, undefined, {
   *     transportRequest: { type: 'existing', number: 'DEV1K900123' }
   *   });
   */
  @command(AbapFsCommands.createObjectProgrammatically)
  public static async createAdtObjectProgrammatically(
    objectType: CreatableTypeIds,
    name: string,
    description: string,
    packageName: string = "$TMP",
    parentName?: string,
    connectionId?: string,
    additionalOptions?: {
      // 用于服务绑定
      serviceDefinition?: string
      bindingType?: string
      bindingCategory?: string
      // 用于包
      softwareComponent?: string
      packageType?: PackageTypes
      transportLayer?: string
      // 用于传输请求
      transportRequest?: {
        type: "new" | "existing"
        number?: string // 用于现有传输
        description?: string // 用于新传输
      }
    }
  ) {
    try {
      if (objectType.toUpperCase() === "FUGR/FF" && !parentName?.trim()) {
        return {
          success: false,
          error: "MISSING_FUNCTION_GROUP_PARENT",
          message:
            "Function module creation requires parentName with the parent function group name.",
          objectName: name,
          objectType: objectType
        }
      }

      // 使用当前连接或指定的连接
      const connId = connectionId || (await pickAdtRoot())?.uri.authority
      if (!connId) return

      // 创建使用编程式选择的特殊 AdtObjectCreator
      const creator = new AdtObjectCreator(connId)

      // 基于 AdtObjectCreator 分析重写关键方法

      // 1. 重写 askInput 用于名称和描述提示
      creator["askInput"] = async (
        prompt: string,
        uppercase: boolean = true,
        value = ""
      ): Promise<string> => {
        if (prompt.toLowerCase().includes("name")) {
          const result = uppercase ? name.toUpperCase() : name
          return result
        } else if (prompt.toLowerCase().includes("description")) {
          const result = uppercase ? description.toUpperCase() : description
          return result
        }
        return value
      }

      // 2. 重写 guessParentByType - 这是防止包弹窗的关键方法
      creator["guessParentByType"] = (hierarchy: any[], type: string): string => {
        if (type === "DEVC/K") {
          // PACKAGE 类型 - 这是防止“选择包”对话框的关键
          return packageName
        }
        if (type === "FUGR/F" && parentName) {
          // 函数模块是函数组的子对象；AI 创建必须使用提供的父组
          // 以避免回退到当前工作区位置。
          return parentName.trim().toUpperCase()
        }
        // 对其他类型，使用原始逻辑
        const original =
          hierarchy.filter((n: any) => n.object?.type === type)?.[0]?.object?.name || ""
        return original
      }

      // 3. 重写 guessOrSelectObjectType 返回指定的对象类型
      creator["guessOrSelectObjectType"] = async (hierarchy: any[]): Promise<any> => {
        const objType = CreatableTypes.get(objectType)
        if (objType) {
          return { typeId: objectType, label: objType.label, maxLen: objType.maxLen }
        }
        throw new Error(`Unknown object type: ${objectType}`)
      }

      // 4. 重写 getServiceOptions，对服务绑定使用编程式值
      if (objectType === "SRVB/SVB" && additionalOptions) {
        const { serviceDefinition, bindingType, bindingCategory } = additionalOptions
        if (!serviceDefinition || !bindingType || !bindingCategory) {
          return {
            success: false,
            error: "MISSING_SERVICE_BINDING_OPTIONS",
            message:
              "Service bindings require additionalOptions with serviceDefinition, bindingType ('ODATA'), and bindingCategory ('0' for Web API, '1' for UI)",
            objectName: name,
            objectType: objectType
          }
        }
        creator["getServiceOptions"] = async (options: NewObjectOptions) => {
          const opt = {
            ...options,
            bindingtype: bindingType as "ODATA",
            category: bindingCategory as "0" | "1",
            service: serviceDefinition
          }
          if (isBindingOptions(opt)) return opt
          throw new Error("Invalid service binding options")
        }
      }

      // 5. 如果提供了传输请求，构建非交互式传输选择器。
      // 传递给下面的 createObject，这样它无需任何猴子补丁就能替换默认 UI
      // 选择器。防止 MCP 驱动的创建期间出现阻塞性 QuickPick 和
      // 基于 LOCKS 的静默重新分配。参见 #466。
      let resolvedTransport: string | undefined
      const transportPicker = additionalOptions?.transportRequest
        ? async (objContentPath: string, devclass: string, transportLayer: string) => {
            const sel = await pickTransportProgrammatically(
              getClient(connId),
              additionalOptions.transportRequest!,
              objContentPath,
              devclass,
              transportLayer
            )
            resolvedTransport = sel.transport
            return sel
          }
        : undefined

      // 6. 让 ADT 创建对象（选择器在提供时处理传输步骤）
      const obj = await creator.createObject(undefined, transportPicker)

      if (!obj) {
        log(`❌ Object creation was cancelled or failed`)
        return {
          success: false,
          error: "CREATION_CANCELLED",
          message: "Object creation was cancelled or failed",
          objectName: name,
          objectType: objectType
        }
      }

      // 🔧 修复：遵循与手动创建相同的模式（如 AbapFsCommands.create）
      await obj.loadStructure()

      if (obj.type === PACKAGE) {
        commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        return {
          success: true,
          object: obj,
          objectName: obj.name,
          objectType: obj.type,
          path: obj.path,
          transport: resolvedTransport
        }
      }

      // 🔧 修复：使用与手动创建相同的流程 - 无人为延迟
      const nodePath = await openObject(connId, obj.path)
      if (nodePath) {
        new AdtObjectFinder(connId).displayNode(nodePath)
        try {
          await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
        } catch (e) {
          //log("error refreshing workspace")
        }
      }

      return {
        success: true,
        object: obj,
        objectName: obj.name,
        objectType: obj.type,
        path: obj.path,
        nodePath: nodePath,
        transport: resolvedTransport
      }
    } catch (e) {
      const stack = types.isNativeError(e) ? e.stack || "" : ""
      const errorMessage = caughtToString(e)

      // ⚡ 编程式 API：返回结构化错误结果，不显示 UI 弹窗
      // 供需要以编程方式处理响应的 AI 系统使用
      if (e instanceof TransportPickerError) {
        return {
          success: false,
          error: "TRANSPORT_REQUEST_INVALID",
          message: errorMessage,
          objectName: name,
          objectType: objectType
        }
      }

      if (errorMessage.includes("already exists")) {
        return {
          success: false,
          error: "OBJECT_ALREADY_EXISTS",
          message: errorMessage,
          objectName: name,
          objectType: objectType
        }
      }

      // 对其他错误，返回结构化错误响应
      return {
        success: false,
        error: "CREATION_FAILED",
        message: errorMessage,
        objectName: name,
        objectType: objectType,
        stack: stack
      }
    }
  }

  @command(AbapFsCommands.showObject)
  private static async showObject(arg: ShowObjectArgument) {
    logTelemetry("command_show_object_called")
    const p = splitAdtUri(arg.uri)
    const path = await vsCodeUri(arg.connId, arg.uri, true, true)
    const uri = Uri.parse(path)
    const doc = await workspace.openTextDocument(uri)
    const selection = p.start?.line ? lineRange(p.start?.line + 1) : undefined
    window.showTextDocument(doc, { selection })
  }
  @command(AbapFsCommands.runInGui)
  private static async executeAbap() {
    try {
      log("Open/Run in SAP GUI")
      const uri = currentUri()
      if (!uri) return
      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) return
      logTelemetry("command_sap_gui_called", { connectionId: fsRoot.uri.authority })
      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      if (!isAbapStat(file)) return

      await AdtCommands.autoStartDebuggerIfNeeded(fsRoot.uri.authority)
      // 模式由连接的 sapGui.guiType 配置决定（SAPGUI | WEBGUI_UNSAFE | WEBGUI_UNSAFE_EMBEDDED | WEBGUI_CONTROLLED）
      await openInGui(fsRoot.uri.authority, file.object)
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  /**
   * 在 VS Code 内的嵌入式 SAP GUI 中执行 ABAP 对象
   * 这提供类似 Eclipse ADT 的功能：执行发生在 Webview 中
   */
  @command("abapfs.runInEmbeddedGui")
  private static async executeAbapEmbedded() {
    try {
      const uri = currentUri()
      if (!uri) {
        window.showErrorMessage("No ABAP file is currently open")
        return
      }

      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) return
      logTelemetry("command_sap_gui_embedded_called", { connectionId: fsRoot.uri.authority })

      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      if (!isAbapStat(file)) {
        window.showErrorMessage("Current file is not an ABAP object")
        return
      }

      await AdtCommands.autoStartDebuggerIfNeeded(fsRoot.uri.authority)
      await openInGui(fsRoot.uri.authority, file.object, "EMBEDDED")
    } catch (e) {
      return window.showErrorMessage(`Failed to open embedded GUI: ${caughtToString(e)}`)
    }
  }

  /**
   * 运行 SAP 事务码
   * 允许用户搜索并执行任意 SAP 事务
   */
  @command(AbapFsCommands.runTransaction)
  private static async runTransaction() {
    try {
      // 1. 选择系统
      const fsRoot = await pickAdtRoot()
      if (!fsRoot) return

      const connectionId = fsRoot.uri.authority
      const config = RemoteManager.get().byId(connectionId)
      if (!config) {
        window.showErrorMessage("Connection configuration not found")
        return
      }

      const client = getClient(connectionId)

      // 2. 用允许回车确认的 QuickPick 搜索事务码
      const quickPick = window.createQuickPick()
      quickPick.placeholder =
        "Type transaction code (e.g., MM43, SE16N) and press Enter, or search for transactions..."
      quickPick.matchOnDescription = true
      quickPick.matchOnDetail = true
      quickPick.ignoreFocusOut = true

      let currentInput = ""

      // 使用 ADT 客户端执行搜索的函数
      const performSearch = async (searchTerm: string) => {
        if (!searchTerm || searchTerm.length < 3) {
          quickPick.items = []
          return
        }

        quickPick.busy = true
        try {
          const query = searchTerm.toUpperCase() + "*"
          const raw = await client.searchObject(query, "TRAN/T")

          const results = await MySearchResult.createResults(raw, client)

          quickPick.items = results.map(r => ({
            label: `$(symbol-event) ${r.name}`,
            description: r.description || "",
            detail: `Package: ${r.packageName}`,
            tcode: r.name
          }))
        } catch (error) {
          quickPick.items = []
        } finally {
          quickPick.busy = false
        }
      }

      // 处理输入变化
      quickPick.onDidChangeValue(async value => {
        currentInput = value
        if (value.length >= 3) {
          await performSearch(value)
        } else {
          quickPick.items = []
        }
      })

      // 处理选择
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0]
        let tcodeToRun = ""

        if (selected) {
          // 用户从列表中选择
          tcodeToRun = (selected as any).tcode
        } else if (currentInput) {
          // 用户未选择直接按回车 - 使用输入的值
          tcodeToRun = currentInput.toUpperCase()
        }

        quickPick.hide()

        if (!tcodeToRun) return

        logTelemetry("command_run_transaction_called", { connectionId })
        await AdtCommands.autoStartDebuggerIfNeeded(connectionId)

        // 3. 按 guiType 偏好执行事务
        const guiType = config.sapGui?.guiType || "SAPGUI"

        switch (guiType) {
          case "WEBGUI_UNSAFE_EMBEDDED":
            // 嵌入式 Webview
            await openInGui(connectionId, tcodeToRun, "EMBEDDED")
            break

          case "WEBGUI_UNSAFE":
          case "WEBGUI_CONTROLLED":
            // 外部浏览器
            await openInGui(connectionId, tcodeToRun, "WEBGUI")
            break

          case "SAPGUI":
          default:
            // 原生 SAP GUI
            await openInGui(connectionId, tcodeToRun, "SAPGUI")
            break
        }
      })

      quickPick.onDidHide(() => quickPick.dispose())
      quickPick.show()
    } catch (e) {
      return window.showErrorMessage(`Failed to run transaction: ${caughtToString(e)}`)
    }
  }

  @command(AbapFsCommands.execute)
  private static async openInGuiAbap() {
    try {
      const uri = currentUri()
      if (!uri) return
      const fsRoot = await pickAdtRoot(uri)
      if (!fsRoot) return
      logTelemetry("command_sap_gui_browser_called", { connectionId: fsRoot.uri.authority })
      const file = uriRoot(fsRoot.uri).getNode(uri.path)
      if (!isAbapStat(file)) return

      await AdtCommands.autoStartDebuggerIfNeeded(fsRoot.uri.authority)
      await openInGui(fsRoot.uri.authority, file.object, "WEBGUI")
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.addfavourite)
  private static addFavourite(uri: Uri | undefined) {
    logTelemetry("command_add_favourite_called")
    if (uri) FavouritesProvider.get().addFavourite(uri)
  }

  @command(AbapFsCommands.deletefavourite)
  private static deleteFavourite(node: FavItem) {
    logTelemetry("command_delete_favourite_called")
    FavouritesProvider.get().deleteFavourite(node)
  }

  @command(AbapFsCommands.tableContents)
  private static showTableContents() {
    const file = currentAbapFile()
    const uri = currentUri()
    logTelemetry("command_show_table_contents_called", { connectionId: uri?.authority })
    if (!file) {
      window.showInformationMessage("Unable to determine the table to display")
      return
    }
    commands.executeCommand(AbapFsCommands.selectDB, file.object.name)
  }

  @command(AbapFsCommands.unittest)
  private static async runAbapUnit(targetUri?: Uri) {
    try {
      // 使用提供的 URI（来自语言模型工具）或当前活动编辑器
      const uri = targetUri || currentUri()
      if (!uri) {
        window.showErrorMessage(
          "No ABAP file specified. Please open an ABAP file or provide object details."
        )
        return
      }

      await window.withProgress(
        { location: ProgressLocation.Notification, title: "Running ABAP UNIT" },
        () => UnitTestRunner.get(uri.authority).addResults(uri)
      )
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.atcChecks)
  private static async runAtc() {
    logTelemetry("command_atc_checks_called")
    try {
      const state = await currentEditState()
      if (!state) return

      await window.withProgress(
        { location: ProgressLocation.Window, title: "Running ABAP Test cockpit" },
        progress => {
          const setvariant = (variant: string) =>
            progress.report({ message: "Using variant " + variant })
          return atcProvider.runInspector(state.uri, setvariant)
        }
      )
    } catch (e) {
      return window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.createtestinclude)
  private static createTestInclude(uri?: Uri) {
    if (uri) {
      if (uri.scheme !== ADTSCHEME) return
      return this.createTI(uri)
    }
    const cur = currentEditState()
    if (!cur) return
    return this.createTI(cur.uri)
  }

  @command(AbapFsCommands.clearPassword)
  public static async clearPasswordCmd(connectionId?: string) {
    return RemoteManager.get().clearPasswordCmd(connectionId)
  }

  @command(AbapFsCommands.changePassword)
  private static async changePasswordCmd() {
    const manager = RemoteManager.get()
    const { remote, userCancel } = await manager.selectConnection()
    if (userCancel || !remote) return

    const newPassword = await window.showInputBox({
      prompt: `Enter new password for ${remote.name} (user: ${remote.username})`,
      password: true,
      ignoreFocusOut: true
    })
    if (!newPassword) return

    await manager.clearPassword(remote.name, remote.username)
    await manager.savePassword(remote.name, remote.username, newPassword)
    vscode.window.showInformationMessage(
      `Password updated for "${remote.name}". Reconnect to use the new credentials.`
    )
  }

  private static async createTI(uri: Uri) {
    logTelemetry("command_create_test_class_include_called", { connectionId: uri.authority })
    return window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: "Creating test include...",
        cancellable: false
      },
      async progress => {
        try {
          progress.report({ message: "Validating class..." })

          const obj = await findAbapObject(uri)
          // 只对类有意义
          if (!isAbapClassInclude(obj)) {
            throw new Error("This command only works with ABAP class files")
          }
          if (!obj.parent) {
            throw new Error("Class parent not found")
          }
          if (!obj.parent.structure) await obj.parent.loadStructure()
          if (obj.parent.findInclude("testclasses")) {
            window.showInformationMessage("Test include already exists")
            return // 这会正确关闭进度窗口
          }

          progress.report({ message: "Acquiring lock..." })
          const m = uriRoot(uri).lockManager
          const lock = await m.requestLock(uri.path)
          const lockId = lock.status === "locked" && lock.LOCK_HANDLE
          if (!lockId) {
            throw new Error(`Can't acquire a lock for ${obj.name}`)
          }

          try {
            let created
            const client = getClient(uri.authority)

            progress.report({ message: "Selecting transport..." })
            const transport = await selectTransport(obj.contentsPath(), "", client, true)
            if (transport.cancelled) return

            progress.report({ message: "Creating test include on SAP..." })
            const parentName = obj.parent.name
            await client.createTestInclude(parentName, lockId, transport.transport)
            created = true

            progress.report({ message: "Releasing lock..." })
            if (lock) await m.requestUnlock(uri.path)

            if (created) {
              progress.report({ message: "Refreshing structure..." })
              // 先使缓存失效，强制全新重新加载
              const root = uriRoot(uri)
              root.service.invalidateStructCache(obj.parent.path)
              await obj.parent.loadStructure() // Fetch fresh structure from SAP

              progress.report({ message: "Opening test include..." })
              // 查找新创建的测试 include
              const testInclude = obj.parent.findInclude("testclasses")
              if (testInclude) {
                // 从结构获取测试 include URI
                const testIncludeUri = testInclude["abapsource:sourceUri"] || "includes/testclasses"
                const fullTestPath = `${obj.parent.path}/${testIncludeUri}`

                try {
                  // 打开测试 include（类似创建对象命令）
                  const nodePath = await openObject(uri.authority, fullTestPath)
                  if (nodePath) {
                    // 显示节点（类似创建对象命令）
                    new AdtObjectFinder(uri.authority).displayNode(nodePath)
                  }
                } catch (openError) {
                  // 打开失败时回退到手动刷新
                }
              }

              progress.report({ message: "Refreshing file explorer..." })
              // 刷新文件资源管理器
              await commands.executeCommand("workbench.files.action.refreshFilesExplorer")
            }
          } catch (e) {
            if (lock) await m.requestUnlock(uri.path)
            throw e
          }
        } catch (e) {
          const errorMsg = caughtToString(e)
          window.showErrorMessage(`Error creating test include: ${errorMsg}`)
        }
      }
    )
  }

  /**
   * 刷新 SAP 系统信息缓存
   * 清除缓存的系统信息，让下一次请求获取新数据
   */
  @command(AbapFsCommands.refreshSystemInfoCache)
  private static async refreshSystemInfoCache() {
    try {
      clearSystemInfoCache()
      window.showInformationMessage(
        "SAP system info cache cleared. Next request will fetch fresh data."
      )
    } catch (e) {
      window.showErrorMessage(`Failed to clear cache: ${caughtToString(e)}`)
    }
  }

  /**
   * 刷新右键点击节点的 ABAP 文件系统，绕过
   * SAP 标准文件夹节流。当标准 SAP 对象发生变化
   * 且用户无法等待 TTL 过期时的备份方案。
   */
  @command(AbapFsCommands.refreshFilesystem)
  private static async refreshFilesystem(uri?: Uri) {
    logTelemetry("command_refresh_filesystem_called")
    try {
      await window.withProgress(
        { location: ProgressLocation.Window, title: "Refreshing ABAP FS filesystem" },
        () => FsProvider.get().refreshFilesystem(uri)
      )
    } catch (e) {
      window.showErrorMessage(caughtToString(e))
    }
  }

  @command(AbapFsCommands.createInEditor)
  private static async createObjectInEditorCommand(uri?: Uri) {
    return createObjectInEditorCommand(uri)
  }
  @command(AbapFsCommands.manageTextElements)
  private static async manageTextElementsCommand(uri?: Uri) {
    return manageTextElementsCommand(uri)
  }
  @command(AbapFsCommands.configureFeeds)
  private static async configureFeedsCommand() {
    return configureFeedsCommand()
  }
  @command(AbapFsCommands.publishServiceBinding)
  private static async publishServiceBindingCommand() {
    return publishServiceBindingCommand()
  }
  @command(AbapFsCommands.testServiceBinding)
  private static async testServiceBindingCommand() {
    return testServiceBindingCommand()
  }
}
