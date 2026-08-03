import {
  commands,
  debug,
  DebugConfigurationProviderTriggerKind,
  ExtensionContext,
  Uri
} from "vscode"
import {
  ReplayAdapterFactory,
  ReplayConfigurationProvider,
  REPLAY_DEBUG_TYPE
} from "./replayAdapterFactory"
import { DEBUGTYPE } from "../abapConfigurationProvider"
import { AbapDebugSession } from "../abapDebugSession"
import {
  saveRecording,
  saveRecordingCompressed,
  loadRecordingFromUri,
  compressRecording,
  decompressRecording
} from "./recordingIO"
import { funWindow as window } from "../../../services/funMessenger"
import { log } from "../../../lib"
import { DebugListener } from "../debugListener"
import { logTelemetry } from "../../../services/telemetry"

/**
 * 注册回放调试器适配器、配置提供器和命令。
 */
export function registerReplayDebugger(context: ExtensionContext) {
  const factory = ReplayAdapterFactory.instance
  const provider = new ReplayConfigurationProvider()

  const factoryReg = debug.registerDebugAdapterDescriptorFactory(REPLAY_DEBUG_TYPE, factory)
  const providerReg = debug.registerDebugConfigurationProvider(
    REPLAY_DEBUG_TYPE,
    provider,
    DebugConfigurationProviderTriggerKind.Dynamic
  )

  context.subscriptions.push(
    factoryReg,
    providerReg,
    commands.registerCommand("abapfs.startRecording", startRecordingCommand),
    commands.registerCommand("abapfs.stopRecording", stopRecordingCommand),
    commands.registerCommand("abapfs.replaySession", replaySessionCommand),
    commands.registerCommand("abapfs.compressRecording", compressRecordingCommand),
    commands.registerCommand("abapfs.decompressRecording", decompressRecordingCommand),
    // 安全网：ABAP 调试会话终止时自动停止录制
    // 主要自动停止在 AbapDebugSession.logOut() 中，但 disconnectRequest
    // 可能并不总是触发（例如 VS Code 强制关闭会话）
    debug.onDidTerminateDebugSession(session => {
      if (session.type !== DEBUGTYPE) return
      const connId = session.configuration?.connId
      if (!connId) return
      const abapSession = AbapDebugSession.byConnection(connId)
      // 检查此连接是否仍有录制监听器
      if (abapSession?.debugListener?.isRecording) {
        log(`onDidTerminateDebugSession: auto-stopping recording for ${connId}`)
        autoStopRecording(abapSession.debugListener)
      }
    })
  )
}

async function startRecordingCommand() {
  logTelemetry("command_start_recording_called")
  // 查找活动 ABAP 调试会话
  const session = debug.activeDebugSession
  if (!session || session.type !== DEBUGTYPE) {
    window.showErrorMessage("No active ABAP debug session. Start debugging first.")
    return
  }

  const connId = session.configuration.connId
  if (!connId) {
    window.showErrorMessage("Cannot determine connection ID from debug session")
    return
  }

  const abapSession = AbapDebugSession.byConnection(connId)
  if (!abapSession) {
    window.showErrorMessage("Cannot find ABAP debug session")
    return
  }

  const listener = abapSession.debugListener
  if (listener.isRecording) {
    window.showInformationMessage("Already recording")
    return
  }

  listener.startRecording()
  window.showInformationMessage("⏺ Recording started")
}

async function stopRecordingCommand() {
  logTelemetry("command_stop_recording_called")
  const listener = findRecordingListener()
  if (!listener) {
    window.showInformationMessage("No active recording")
    return
  }

  const recording = await listener.stopRecording()

  if (!recording) {
    window.showInformationMessage("No steps recorded")
    return
  }

  const action = await window.showInformationMessage(
    `Recording complete: ${recording.totalSteps} steps. Save?`,
    "Save",
    "Compress & Save",
    "Discard"
  )
  if (action === "Save") {
    await saveRecording(recording)
  } else if (action === "Compress & Save") {
    await saveRecordingCompressed(recording)
  }
}

async function replaySessionCommand(fileUri?: Uri) {
  logTelemetry("command_replay_session_called")
  let recording
  if (fileUri) {
    recording = await loadRecordingFromUri(fileUri)
    if (!recording) return // 加载失败，错误已显示
  }

  if (recording) {
    ReplayAdapterFactory.instance.setPendingRecording(recording)
  }

  const started = await debug.startDebugging(undefined, {
    type: REPLAY_DEBUG_TYPE,
    request: "launch",
    name: "Replay ABAP Recording"
  })
  if (!started) {
    ReplayAdapterFactory.instance.clearPendingRecording()
  }
}

async function compressRecordingCommand() {
  logTelemetry("command_compress_recording_called")
  await compressRecording()
}

async function decompressRecordingCommand() {
  logTelemetry("command_decompress_recording_called")
  await decompressRecording()
}

/** 查找当前正在录制的 DebugListener（如果有） */
function findRecordingListener(): DebugListener | undefined {
  // 先尝试活动会话
  const session = debug.activeDebugSession
  if (session?.type === DEBUGTYPE) {
    const connId = session.configuration?.connId
    if (connId) {
      const abapSession = AbapDebugSession.byConnection(connId)
      if (abapSession?.debugListener?.isRecording) return abapSession.debugListener
    }
  }
  // 回退：扫描所有会话
  for (const s of AbapDebugSession.allSessions()) {
    if (s.debugListener?.isRecording) return s.debugListener
  }
  return undefined
}

async function autoStopRecording(listener: DebugListener) {
  try {
    const recording = await listener.stopRecording()
    if (!recording) return
    const action = await window.showInformationMessage(
      `Debug session ended. Save recording (${recording.totalSteps} steps)?`,
      "Save",
      "Compress & Save",
      "Discard"
    )
    if (action === "Save") {
      await saveRecording(recording)
    } else if (action === "Compress & Save") {
      await saveRecordingCompressed(recording)
    }
  } catch (e) {
    log(`autoStopRecording failed: ${e}`)
  }
}
