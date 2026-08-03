import {
  InitializedEvent,
  LoggingDebugSession,
  StoppedEvent,
  Thread,
  Source,
  TerminatedEvent
} from "@vscode/debugadapter"
import { DebugProtocol } from "@vscode/debugprotocol"
import { DebugRecording, DebugSnapshot, REPLAY_DEBUG_TYPE } from "./types"
import { ReplayVariableManager } from "./replayVariableManager"

const REPLAY_THREAD_ID = 1

/**
 * 回放录制的 ABAP 调试会话的只读调试适配器。
 * 通过 DAP 的 supportsStepBack 支持前进和后退步进。
 */
export class ReplayDebugSession extends LoggingDebugSession {
  private currentStep = 0
  private variableManager = new ReplayVariableManager()
  private sourceRefMap = new Map<number, string>()
  private nextSourceRef = 1

  constructor(private recording: DebugRecording) {
    super(REPLAY_DEBUG_TYPE)
  }

  private get snapshot(): DebugSnapshot {
    return this.recording.snapshots[this.currentStep]
  }

  private get totalSteps(): number {
    return this.recording.snapshots.length
  }

  // -- 初始化 --

  protected initializeRequest(
    response: DebugProtocol.InitializeResponse,
    _args: DebugProtocol.InitializeRequestArguments
  ): void {
    response.body = {
      supportsStepBack: true,
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsGotoTargetsRequest: false,
      supportsBreakpointLocationsRequest: false,
      supportsCancelRequest: false,
      supportsTerminateRequest: true,
      supportsLoadedSourcesRequest: false,
      // 禁用步进粒度 — 所有前进步进行为相同
      // （前进到下一个录制快照）。VS Code 总是显示单步跳过、
      // 单步进入、单步返回按钮，但在回放中它们做同样的事。
      supportsSteppingGranularity: false
    }
    this.sendResponse(response)
    this.sendEvent(new InitializedEvent())
  }

  protected configurationDoneRequest(
    response: DebugProtocol.ConfigurationDoneResponse,
    _args: DebugProtocol.ConfigurationDoneArguments
  ): void {
    this.sendResponse(response)
    if (this.totalSteps === 0) {
      this.sendEvent(new TerminatedEvent())
      return
    }
    // 从步骤 0 开始并立即显示
    this.sendEvent(new StoppedEvent("entry", REPLAY_THREAD_ID))
  }

  // -- 启动 --

  protected launchRequest(
    response: DebugProtocol.LaunchResponse,
    _args: DebugProtocol.LaunchRequestArguments
  ): void {
    this.currentStep = 0
    this.sendResponse(response)
  }

  // -- 线程 --

  protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
    const snap = this.snapshot
    const threadLabel = snap ? ` [thread ${snap.threadId}]` : ""
    response.body = {
      threads: [
        new Thread(
          REPLAY_THREAD_ID,
          `\u23fa Replay \u2014 step ${this.currentStep + 1}/${this.totalSteps}${threadLabel}`
        )
      ]
    }
    this.sendResponse(response)
  }

  // -- 调用栈 --

  protected stackTraceRequest(
    response: DebugProtocol.StackTraceResponse,
    _args: DebugProtocol.StackTraceArguments
  ): void {
    const snap = this.snapshot
    if (!snap) {
      response.body = { stackFrames: [], totalFrames: 0 }
      this.sendResponse(response)
      return
    }
    const frames: DebugProtocol.StackFrame[] = snap.stack.map((f, idx) => {
      const sourceRef = this.getSourceRef(f.sourcePath)
      const source = new Source(f.name, f.sourcePath)
      source.sourceReference = sourceRef
      return {
        id: idx,
        name: f.name,
        source,
        line: f.line,
        column: 0
      }
    })
    response.body = { stackFrames: frames, totalFrames: frames.length }
    this.sendResponse(response)
  }

  private getSourceRef(path: string): number {
    for (const [ref, p] of this.sourceRefMap) {
      if (p === path) return ref
    }
    const ref = this.nextSourceRef++
    this.sourceRefMap.set(ref, path)
    return ref
  }

  // -- 作用域与变量 --

  protected scopesRequest(
    response: DebugProtocol.ScopesResponse,
    args: DebugProtocol.ScopesArguments
  ): void {
    const snap = this.snapshot
    if (!snap) {
      response.body = { scopes: [] }
      this.sendResponse(response)
      return
    }
    // 只为顶部帧（帧 0）捕获作用域。
    // 对其他帧，返回空作用域。
    const isTopFrame = args.frameId === 0
    if (isTopFrame) {
      response.body = { scopes: this.variableManager.getScopes(snap) }
    } else {
      response.body = { scopes: [] }
    }
    this.sendResponse(response)
  }

  protected variablesRequest(
    response: DebugProtocol.VariablesResponse,
    args: DebugProtocol.VariablesArguments
  ): void {
    response.body = {
      variables: this.variableManager.getVariables(args.variablesReference)
    }
    this.sendResponse(response)
  }

  protected evaluateRequest(
    response: DebugProtocol.EvaluateResponse,
    args: DebugProtocol.EvaluateArguments
  ): void {
    const snap = this.snapshot
    if (!snap) {
      response.success = false
      response.message = "No snapshot available"
      this.sendResponse(response)
      return
    }
    const result = this.variableManager.evaluate(args.expression, snap)
    if (result) {
      response.body = result
    } else {
      response.success = false
      response.message = "Variable not found in recording"
    }
    this.sendResponse(response)
  }

  // -- 前进步进 --

  protected nextRequest(
    response: DebugProtocol.NextResponse,
    _args: DebugProtocol.NextArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep + 1)
  }

  protected stepInRequest(
    response: DebugProtocol.StepInResponse,
    _args: DebugProtocol.StepInArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep + 1)
  }

  protected stepOutRequest(
    response: DebugProtocol.StepOutResponse,
    _args: DebugProtocol.StepOutArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep + 1)
  }

  protected continueRequest(
    response: DebugProtocol.ContinueResponse,
    _args: DebugProtocol.ContinueArguments
  ): void {
    this.sendResponse(response)
    // 如果已在最后一步，终止。否则跳到最后一步。
    if (this.currentStep >= this.totalSteps - 1) {
      this.sendEvent(new TerminatedEvent())
    } else {
      this.stepTo(this.totalSteps - 1)
    }
  }

  // -- 后退步进 --

  protected stepBackRequest(
    response: DebugProtocol.StepBackResponse,
    _args: DebugProtocol.StepBackArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(this.currentStep - 1)
  }

  protected reverseContinueRequest(
    response: DebugProtocol.ReverseContinueResponse,
    _args: DebugProtocol.ReverseContinueArguments
  ): void {
    this.sendResponse(response)
    this.stepTo(0)
  }

  // -- 导航 --

  private stepTo(target: number): void {
    if (target >= this.totalSteps) {
      this.sendEvent(new TerminatedEvent())
      return
    }
    this.currentStep = Math.max(0, Math.min(target, this.totalSteps - 1))
    this.variableManager.reset()
    this.sendEvent(new StoppedEvent("step", REPLAY_THREAD_ID))
  }

  // -- 生命周期 --

  protected disconnectRequest(
    response: DebugProtocol.DisconnectResponse,
    _args: DebugProtocol.DisconnectArguments
  ): void {
    this.sendResponse(response)
  }

  protected terminateRequest(
    response: DebugProtocol.TerminateResponse,
    _args: DebugProtocol.TerminateArguments
  ): void {
    this.sendResponse(response)
    this.sendEvent(new TerminatedEvent())
  }

  // 回放始终处于停止状态，暂停是空操作
  protected pauseRequest(
    response: DebugProtocol.PauseResponse,
    _args: DebugProtocol.PauseArguments
  ): void {
    this.sendResponse(response)
  }

  // -- 断点（对回放是空操作） --

  protected setBreakPointsRequest(
    response: DebugProtocol.SetBreakpointsResponse,
    args: DebugProtocol.SetBreakpointsArguments
  ): void {
    response.body = {
      breakpoints: (args.breakpoints || []).map(bp => ({
        verified: false,
        line: bp.line,
        message: "Breakpoints not supported in replay mode"
      }))
    }
    this.sendResponse(response)
  }

  // -- 源码 --

  protected sourceRequest(
    response: DebugProtocol.SourceResponse,
    args: DebugProtocol.SourceArguments
  ): void {
    const path =
      args.source?.path ||
      (args.sourceReference ? this.sourceRefMap.get(args.sourceReference) : undefined) ||
      ""
    const content = this.recording.sources?.[path]
    response.body = { content: content ?? "[source unavailable in recording]" }
    this.sendResponse(response)
  }
}
