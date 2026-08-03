/**
 * 使用 worker_threads 实现真正隔离的 JavaScript 单元格执行器。
 *
 * 每个 JS 单元格都在新的 Worker 线程中运行。worker 处理一条
 * 消息，发送结果，然后退出。如果单元格挂起，主线程
 * 在超时后终止 worker。
 *
 * 数据通过 postMessage 传输，它使用 V8 的结构化克隆
 * 算法 — 原生保留 Date、Map、Set、RegExp、ArrayBuffer、类型化
 * 数组以及所有其他可克隆类型。无 JSON 往返。
 */

import { Worker } from "worker_threads"
import * as path from "path"
import { CellResult, JS_EXECUTION_TIMEOUT_MS } from "./types"

function getWorkerScriptPath(): string {
  return path.join(__dirname, "jsWorkerEntry.js")
}

interface WorkerResponse {
  success: boolean
  result?: unknown
  logs?: string[]
  error?: string
}

export async function executeJsCell(
  code: string,
  cellIndex: number,
  cellResults: Map<number, CellResult>,
  abortSignal?: AbortSignal
): Promise<CellResult> {
  if (!code.trim()) {
    return { result: undefined }
  }

  const referencedIndices = findReferencedCellIndices(code)
  const cellData = buildCellData(cellResults, referencedIndices)

  return new Promise<CellResult>((resolve, reject) => {
    let settled = false
    let worker: Worker | undefined
    let timer: ReturnType<typeof setTimeout> | undefined

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (onAbort) abortSignal?.removeEventListener("abort", onAbort)
      fn()
      setImmediate(() => {
        try {
          worker?.terminate()
        } catch {
          /* 已死亡 */
        }
      })
    }

    timer = setTimeout(() => {
      settle(() => {
        reject(
          new Error(
            `JavaScript cell timed out after ${JS_EXECUTION_TIMEOUT_MS / 1000}s. ` +
              `Possible infinite loop — the worker was killed.`
          )
        )
      })
    }, JS_EXECUTION_TIMEOUT_MS)

    const onAbort = () => {
      settle(() => reject(new Error("Interrupted by user.")))
    }

    if (abortSignal?.aborted) {
      if (timer) clearTimeout(timer)
      reject(new Error("Interrupted by user."))
      return
    }

    abortSignal?.addEventListener("abort", onAbort, { once: true })

    try {
      worker = new Worker(getWorkerScriptPath())
    } catch (err: any) {
      settle(() => reject(new Error(`Failed to start JS worker: ${err.message}`)))
      return
    }

    worker.on("message", (response: WorkerResponse) => {
      settle(() => {
        if (response.success) {
          resolve({
            result: response.result,
            ...(response.logs && response.logs.length > 0 ? { logs: response.logs } : {})
          })
        } else {
          resolve({
            result: undefined,
            error: response.error || "Unknown error in JS cell",
            ...(response.logs && response.logs.length > 0 ? { logs: response.logs } : {})
          })
        }
      })
    })

    worker.on("error", err => {
      settle(() => reject(new Error(`JS worker error: ${err.message}`)))
    })

    worker.on("exit", _exitCode => {
      settle(() => {
        reject(new Error("JS worker exited without sending a result. Check cell syntax."))
      })
    })

    try {
      worker.postMessage({
        code,
        cellIndex,
        cellResults: cellData,
        timeoutMs: JS_EXECUTION_TIMEOUT_MS
      })
    } catch (err: any) {
      settle(() => reject(new Error(`Failed to send data to JS worker: ${err.message}`)))
    }
  })
}

function findReferencedCellIndices(code: string): Set<number> {
  const indices = new Set<number>()
  const pattern = /cells\[(\d+)\]/g
  let match
  while ((match = pattern.exec(code)) !== null) {
    indices.add(parseInt(match[1], 10))
  }
  return indices
}

function buildCellData(
  cellResults: Map<number, CellResult>,
  referencedIndices: Set<number>
): Record<string, { result: unknown }> {
  const data: Record<string, { result: unknown }> = {}
  for (const idx of referencedIndices) {
    const cellResult = cellResults.get(idx)
    if (!cellResult) continue
    data[String(idx)] = { result: cellResult.result }
  }
  return data
}
