import {
  CancellationToken,
  DebugAdapterDescriptor,
  DebugAdapterDescriptorFactory,
  DebugAdapterInlineImplementation,
  DebugConfigurationProvider,
  DebugSession,
  Uri,
  WorkspaceFolder
} from "vscode"
import { DebugRecording, REPLAY_DEBUG_TYPE } from "./types"
import { ReplayDebugSession } from "./replayDebugSession"
import { loadRecording, loadRecordingFromUri } from "./recordingIO"
import { funWindow as window } from "../../../services/funMessenger"

export { REPLAY_DEBUG_TYPE }

interface ReplayLaunchConfig {
  type: string
  name: string
  request: string
  recordingPath?: string
}

/**
 * 为 abap-replay 适配器类型提供调试配置。
 */
export class ReplayConfigurationProvider implements DebugConfigurationProvider {
  provideDebugConfigurations(): ReplayLaunchConfig[] {
    return [
      {
        type: REPLAY_DEBUG_TYPE,
        request: "launch",
        name: "Replay ABAP Recording"
      }
    ]
  }

  resolveDebugConfiguration(
    _folder: WorkspaceFolder | undefined,
    config: ReplayLaunchConfig,
    _token?: CancellationToken
  ): ReplayLaunchConfig {
    return {
      ...config,
      type: REPLAY_DEBUG_TYPE,
      request: "launch",
      name: config.name || "Replay ABAP Recording"
    }
  }
}

/**
 * 创建 ReplayDebugSession 实例的工厂。
 * 从文件加载录制并传递给会话。
 */
export class ReplayAdapterFactory implements DebugAdapterDescriptorFactory {
  private static _instance: ReplayAdapterFactory
  private pendingRecording: DebugRecording | undefined

  private constructor() {}

  /** 为下一次工厂调用设置录制。覆盖任何先前的。 */
  setPendingRecording(recording: DebugRecording) {
    this.pendingRecording = recording
  }

  /** 清除任何待处理的录制（例如会话启动失败时） */
  clearPendingRecording() {
    this.pendingRecording = undefined
  }

  async createDebugAdapterDescriptor(
    session: DebugSession
  ): Promise<DebugAdapterDescriptor | undefined> {
    let recording = this.pendingRecording
    this.pendingRecording = undefined

    if (!recording) {
      const config = session.configuration as ReplayLaunchConfig
      if (config.recordingPath) {
        recording = await loadRecordingFromUri(Uri.file(config.recordingPath))
      } else {
        recording = await loadRecording()
      }
    }

    if (!recording) {
      window.showErrorMessage("No recording loaded")
      return undefined
    }

    const replaySession = new ReplayDebugSession(recording)
    return new DebugAdapterInlineImplementation(replaySession)
  }

  static get instance(): ReplayAdapterFactory {
    if (!this._instance) {
      this._instance = new ReplayAdapterFactory()
    }
    return this._instance
  }
}
