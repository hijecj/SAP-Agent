import {
  ADTClient,
  Debuggee,
  isDebugListenerError,
  DebuggingMode,
  isAdtError,
  session_types
} from "abap-adt-api"
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { log, caughtToString, ignore, isUnDefined, firstInMap } from "../../lib"
import { DebugProtocol } from "@vscode/debugprotocol"
import { Disposable, EventEmitter } from "vscode"
import { getOrCreateClient } from "../conections"
import { homedir } from "os"
import { join } from "path"
import { StoppedEvent, TerminatedEvent, ThreadEvent } from "@vscode/debugadapter"
import { v1 } from "uuid"
import { getWinRegistryReader } from "./winregistry"
import { context } from "../../extension"
import { DebugService, isEnded } from "./debugService"
import { BreakpointManager } from "./breakpointManager"
import { VariableManager } from "./variableManager"
import { configFromKey } from "../../langClient"
import { newClientFromKey } from "./functions"
import { DebugRecorder } from "./replay/debugRecorder"

type ConflictResult = { with: "none" } | { with: "other" | "myself"; message?: string }

const ATTACHTIMEOUT = "autoAttachTimeout"
const sessionNumbers = new Map<string, number>()

export const THREAD_EXITED = "exited"

export interface DebuggerUI {
  Confirmator: (message: string) => Thenable<boolean>
  ShowError: (message: string) => any
}

const getOrCreateIdeId = (): string => {
  const ideId = context.workspaceState.get("adt.ideId")
  if (typeof ideId === "string") return ideId
  const newIdeId = v1().replace(/-/g, "").toUpperCase()
  context.workspaceState.update("adt.ideId", newIdeId)
  return newIdeId
}

const getOrCreateTerminalId = async () => {
  if (process.platform === "win32") {
    const reg = getWinRegistryReader()
    const terminalId =
      reg && reg("HKEY_CURRENT_USER", "Software\\SAP\\ABAP Debugging", "TerminalID")
    if (!terminalId) throw new Error("Unable to read terminal ID from windows registry")
    return terminalId
  } else {
    const cfgpath = join(homedir(), ".SAP/ABAPDebugging")
    const cfgfile = join(cfgpath, "terminalId")
    try {
      return readFileSync(cfgfile).toString("utf8")
    } catch (error) {
      const terminalId = v1().replace(/-/g, "").toUpperCase()
      if (!existsSync(cfgpath)) mkdirSync(cfgpath, { recursive: true })
      writeFileSync(cfgfile, terminalId)
      return terminalId
    }
  }
}

export const errorType = (err: any): string | undefined => {
  try {
    const exceptionType = err?.properties?.["com.sap.adt.communicationFramework.subType"]
    if (!exceptionType && `${err.response.body}`.match(/Connection timed out/)) return ATTACHTIMEOUT
    return exceptionType
  } catch (error) {
    /**/
  }
}

const isConflictError = (e: any) =>
  (errorType(e) || "").match(/conflictNotification|conflictDetected/)
class ServiceCollection {
  constructor(private maxThreads = 4) {}
  private services = new Map<number, DebugService>()
  set(threadId: number, service: DebugService) {
    this.services.set(threadId, service)
  }
  get(threadId: number) {
    return this.services.get(threadId)
  }
  delete(threadId: number) {
    this.services.delete(threadId)
  }
  get active() {
    return [...this.services]
  }
  get isFull() {
    return this.services.size >= this.maxThreads
  }
  get nextThreadId() {
    return Math.max(0, ...this.services.keys()) + 1
  }
}
export class DebugListener {
  readonly ideId: string
  private active: boolean = false
  private killed = false
  private notifier: EventEmitter<DebugProtocol.Event> = new EventEmitter()
  private listeners: Disposable[] = []
  readonly mode: DebuggingMode
  readonly breakpointManager
  readonly variableManager
  sessionNumber: number
  listening = false
  private threadCreation?: Promise<void>
  private _recorder: DebugRecorder | undefined

  public get client() {
    if (this.killed) throw new Error("Disconnected")
    return this._client
  }

  public get activeThreads() {
    return this.services.active
  }

  get recorder(): DebugRecorder | undefined {
    return this._recorder
  }

  get isRecording(): boolean {
    return !!this._recorder?.isRecording
  }

  /** 在此监听器上开始录制。 */
  startRecording(): void {
    if (this._recorder?.isRecording) return
    this._recorder = new DebugRecorder()
    this._recorder.startRecording(this.connId)
  }

  async stopRecording() {
    const recorder = this._recorder
    this._recorder = undefined
    if (!recorder?.isRecording) return undefined
    return recorder.stopRecording()
  }

  /** 如果应录制此线程则返回 true */
  shouldRecordThread(_threadId: number): boolean {
    return !!this._recorder?.isRecording
  }

  constructor(
    readonly connId: string,
    private _client: ADTClient,
    readonly terminalId: string,
    readonly username: string,
    terminalMode: boolean,
    private ui: DebuggerUI,
    private services: ServiceCollection
  ) {
    this.sessionNumber = (sessionNumbers.get(connId) || 0) + 1
    sessionNumbers.set(connId, this.sessionNumber)
    this.ideId = getOrCreateIdeId()
    this.mode = terminalMode ? "terminal" : "user"
    if (!this.username) this.username = _client.username.toUpperCase()
    this.breakpointManager = new BreakpointManager(this)
    this.variableManager = new VariableManager(this)
  }

  public static async create(
    connId: string,
    ui: DebuggerUI,
    username: string,
    terminalMode: boolean
  ) {
    const client = await getOrCreateClient(connId)
    if (!client) throw new Error(`Unable to get client for${connId}`)
    const terminalId = await getOrCreateTerminalId()
    const cfg = await configFromKey(connId).catch(ignore)
    const services = new ServiceCollection(cfg?.maxDebugThreads || 4)
    return new DebugListener(connId, client, terminalId, username, terminalMode, ui, services)
  }

  addListener(listener: (e: DebugProtocol.Event) => any, thisArg?: any) {
    return this.notifier.event(listener, thisArg, this.listeners)
  }

  service(threadid: number): DebugService {
    const service = this.services.get(threadid)
    if (!service) throw new Error(`No service for threadid ${threadid}`)
    return service
  }

  private async stopListener(norestart = true) {
    if (norestart) {
      this.active = false
    }
    return this._client.statelessClone.debuggerDeleteListener(
      this.mode,
      this.terminalId,
      this.ideId,
      this.username
    )
  }

  private async debuggerListen() {
    this.listening = true
    try {
      return await this.client.statelessClone.debuggerListen(
        this.mode,
        this.terminalId,
        this.ideId,
        this.username
      )
    } finally {
      this.listening = false
    }
  }

  private async hasConflict(): Promise<ConflictResult> {
    const client = (await newClientFromKey(this.connId)) || this.client
    try {
      await client.debuggerListeners(this.mode, this.terminalId, this.ideId, this.username)
    } catch (error: any) {
      if (isConflictError(error)) return { with: "other", message: error?.properties?.conflictText }
      throw error
    }
    try {
      await client.debuggerListeners(this.mode, this.terminalId, "", this.username)
    } catch (error: any) {
      if (isConflictError(error))
        return { with: "myself", message: error?.properties?.conflictText }
      throw error
    }
    return { with: "none" }
  }

  public async fireMainLoop(): Promise<boolean> {
    try {
      const conflict = await this.hasConflict()
      switch (conflict.with) {
        case "myself":
          await this.stopListener()
          this.mainLoop()
          return true
        case "other":
          const resp = await this.ui.Confirmator(
            `${conflict.message || "Debugger conflict detected"} Take over debugging?`
          )
          if (resp) {
            await this.stopListener(false)
            this.mainLoop()
            return true
          }
          return false
        case "none":
          this.mainLoop()
          return true
      }
    } catch (error) {
      this.ui.ShowError(`Error listening to debugger: ${caughtToString(error)}`)
      return false
    }
  }

  private async mainLoop() {
    this.active = true
    let startTime = 0
    while (this.active) {
      try {
        log(`Debugger ${this.sessionNumber} listening on connection  ${this.connId}`)
        startTime = new Date().getTime()
        const debuggee = await this.debuggerListen()
        if (!debuggee || !this.active) continue
        log(`Debugger ${this.sessionNumber} disconnected`)
        if (isDebugListenerError(debuggee)) {
          log(`Debugger ${this.sessionNumber} reconnecting to ${this.connId}`)
          // 重新连接
          break
        }
        log(`Debugger ${this.sessionNumber} on connection  ${this.connId} reached a breakpoint`)
        await this.onBreakpointReached(debuggee)
      } catch (error) {
        if (!this.active) return
        if (!isAdtError(error)) {
          this.ui.ShowError(`Error listening to debugger: ${caughtToString(error)}`)
        } else {
          // autoAttachTimeout
          const exceptionType = errorType(error)
          switch (exceptionType) {
            case "conflictNotification":
            case "conflictDetected":
              const txt =
                error?.properties?.conflictText || "Debugger terminated by another session/user"
              this.ui.ShowError(txt)
              await this.stopDebugging()
              break
            case ATTACHTIMEOUT:
              // this.refresh()
              break
            default:
              const elapsed = new Date().getTime() - startTime
              if (elapsed < 50000) {
              // 更大可能是超时
                const quit = await this.ui.Confirmator(
                  `Error listening to debugger: ${caughtToString(error)} Close session?`
                )
                if (quit) await this.stopDebugging()
              }
          }
        }
      }
    }
  }

  private async stopThread(threadid: number) {
    const service = this.service(threadid)
    this.services.delete(threadid)
    if (service) {
      await this.breakpointManager
        .removeAllBreakpoints(service)
        .catch(e => log(`stopThread: removeAllBreakpoints failed: ${caughtToString(e)}`))
      // stepContinue 释放 SAP 上的被调试程序。如果失败，内核级
      // 调试附加会持续存在，下一次会话的 TPDA_ATTACH 将失败。
      try {
        await service.client.debuggerStep("stepContinue")
      } catch (e: any) {
        const details = e?.properties ? JSON.stringify(e.properties) : ""
        log(`stopThread: stepContinue failed: ${caughtToString(e)} ${details}`)
        // 如果被调试程序已结束，没关系。否则尝试丢弃会话，
        // 强制 SAP 释放调试附加。
        if (!isEnded(e)) {
          await service.client
            .dropSession()
            .catch(e2 => log(`stopThread: dropSession failed: ${caughtToString(e2)}`))
        }
      }
      await service.logout()
    }
  }

  private async onBreakpointReached(debuggee: Debuggee) {
    try {
      if (this.services.isFull) {
        log(`Max debug threads reached (${this.services.active.length}), refusing new session`)
        return this.resume(debuggee)
      }
      log(`onBreakpointReached: creating service for ${debuggee.DEBUGGEE_ID}`)
      const service = await DebugService.create(this.connId, this.ui, this, debuggee)
      service.threadId = this.services.nextThreadId
      this.services.set(service.threadId, service)
      const creation = (async () => {
        await service.attach()
        service.addListener(e => {
          if (e instanceof ThreadEvent && e.body.reason === THREAD_EXITED)
            this.stopThread(service.threadId)
          this.notifier.fire(e)
        })
        this.notifier.fire(new StoppedEvent("breakpoint", service.threadId))
      })()
      this.threadCreation = creation.finally(() => (this.threadCreation = undefined))
      await creation
    } catch (error: any) {
      const details = error?.properties ? JSON.stringify(error.properties) : ""
      log(`onBreakpointReached FAILED: ${caughtToString(error)} ${details}`)
      await this.stopDebugging()
    }
  }
  private async resume(debuggee: Debuggee) {
    try {
      const client = await newClientFromKey(this.connId)
      if (!client) throw new Error("Failed to connect to debuggee")
      client.stateful = session_types.stateful
      try {
        await client.debuggerAttach(this.mode, debuggee.DEBUGGEE_ID, this.username, true)
        while (true) await client.debuggerStep("stepContinue")
      } catch (error) {
        if (isEnded(error)) return
        log(`${error}`)
      } finally {
        client.logout()
      }
    } catch (error) {
      log(`${error}`)
      await this.stopDebugging()
    }
  }

  public async stopDebugging() {
    this.active = false
    this.notifier.fire(new TerminatedEvent())
  }

  public async logout() {
    this.active = false
    if (this.killed) return
    this.killed = true
    // 活动时停止录制
    if (this._recorder?.isRecording) {
      await this._recorder
        .stopRecording()
        .catch(e => log(`logout: stopRecording failed: ${caughtToString(e)}`))
      this._recorder = undefined
    }
    // 注销时始终从 SAP 删除监听器
    await this.stopListener().catch(e => log(`logout: stopListener failed: ${caughtToString(e)}`))
    const stopServices = this.services.active.map(([s, _]) => this.stopThread(s))
    const proms: Promise<any>[] = [...stopServices]

    await Promise.all(proms)

    // 释放所有事件监听器以防止内存泄漏
    this.listeners.forEach(l => l.dispose())
    this.listeners = []
    this.notifier.dispose()
  }
}
