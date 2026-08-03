import {
  TextDocument,
  TextDocumentChangeEvent,
  TextDocumentSaveReason,
  TextDocumentWillSaveEvent,
  TextEditor,
  Uri,
  Disposable,
  Event,
  workspace,
  TabInputTextDiff
} from "vscode"

import { caughtToString, debounce, log, viewableObjecttypes } from "./lib"
import { ADTSCHEME, uriRoot, abapUri, getRoot } from "./adt/conections"
import { AbapObject } from "abapobject"
import { isAbapStat } from "abapfs"
import { isCsrfError } from "abap-adt-api"
import { LockStatus } from "abapfs/out/lockObject"
import { uriAbapFile } from "./adt/operations/AdtObjectFinder"
import { versionRevisions } from "./scm/abaprevisions"
import { setContext } from "./context"
import { logTelemetry } from "./services/telemetry"
import { LocalFsProvider } from "./fs/LocalFsProvider"
import { triggerSyntaxCheck } from "./langClient"
import { updateEnhancementDecorations } from "./views/enhancementDecorations"
import { updateCleanerContext } from "./services/cleanerCommands"
import { onBlameActiveEditorChanged, onBlameDocumentChanged } from "./views/blameGutter"
import { ReloginError } from "abapfs/out/lockManager"
import { funWindow as window } from "./services/funMessenger"

// 全局跟踪保存原因，协调 documentWillSave 和 writeFile
const pendingSaveReasons = new Map<string, TextDocumentSaveReason>()

export function setSaveReason(uri: string, reason: TextDocumentSaveReason) {
  pendingSaveReasons.set(uri, reason)
  // 5 秒后自动清理，防止内存泄漏
  setTimeout(() => pendingSaveReasons.delete(uri), 5000)
}

export function getSaveReason(uri: string): TextDocumentSaveReason | undefined {
  return pendingSaveReasons.get(uri)
}

export function clearSaveReason(uri: string) {
  pendingSaveReasons.delete(uri)
}

export const listenersubscribers: ((...x: any[]) => Disposable)[] = []

export const listener =
  <T>(event: Event<T>) =>
  (target: any, propertyKey: string) => {
    const func = () => event(target[propertyKey].bind(target))
    listenersubscribers.push(func)
  }
export async function documentClosedListener(doc: TextDocument) {
  if (!abapUri(doc.uri)) return
  try {
    const uri = doc.uri
    const root = uriRoot(uri)
    if (uri.scheme === ADTSCHEME) {
      if ((await root.lockManager.finalStatus(uri.path)).status === "locked")
        await root.lockManager.requestUnlock(uri.path)
    }
  } catch (error) {
    log(caughtToString(error))
  }
}

type LockValidator = (l: LockStatus) => Promise<boolean>
async function validateLock(lock: LockStatus) {
  const ok = "Ok"
  if (lock.status === "locked" && lock.IS_LINK_UP) {
    const resp = await window.showWarningMessage(
      `Object is locked, a new task will be created in ${lock.CORRUSER}'s ${lock.CORRNR} ${lock.CORRTEXT}`,
      ok,
      "Cancel"
    )
    return resp === ok
  }
  return true
}
const isRecord = (o: unknown): o is Record<any, any> => typeof o === "object" && o !== null
export const isExpired = (error: any) =>
  isCsrfError(error) || (error.err === 400 && `${error.message}`.match(/Session.*timed.*out/i))

export async function setDocumentLock(
  document: TextDocument,
  interactive = false,
  retry = true
): Promise<LockStatus | undefined> {
  const uri = document.uri
  if (!abapUri(uri)) return

  const lockManager = getRoot(uri.authority).lockManager

  if (document.isDirty)
    try {
      const lock = await lockManager.requestLock(uri.path)
      if (!validateLock(lock)) {
        await lockManager.requestUnlock(uri.path)
        const error = new Error("Lock validation failed")
        if (interactive) {
          window.showErrorMessage(`Lock validation failed\nWon't be able to save changes`)
        }
        throw error
      }
    } catch (e) {
      // 按交互标志处理错误通知
      if (interactive)
        if (ReloginError.isReloginError(e) && e.outcome)
          window.showInformationMessage(`${caughtToString(e)}\nAll should be fine`)
        else window.showErrorMessage(`${caughtToString(e)}\nWon't be able to save changes`)
      // 始终抛出错误，让调用方处理
      if (!(ReloginError.isReloginError(e) && e.outcome)) throw e
    }
  else
    await lockManager.requestUnlock(uri.path).catch(e => {
      if (interactive)
        if (ReloginError.isReloginError(e) && e.outcome)
          window.showInformationMessage(`${caughtToString(e)}`)
        else window.showErrorMessage(`${caughtToString(e)}`)
      if (!(ReloginError.isReloginError(e) && e.outcome)) throw e
    })
  return await lockManager.finalStatus(uri.path)
}
// 扩展停用时，所有锁都会被释放
// 尝试按需恢复它们
export async function restoreLocks() {
  return Promise.all(workspace.textDocuments.map(doc => setDocumentLock(doc)))
}

// 防抖对一个边界情况很重要：
// 如果对象被修改但未锁定，撤销更改并恢复编辑器
// 会导致尝试锁定（可能出错或要求选择传输）
// 然后在几毫秒后发出解锁请求
// 防抖后只处理最后的状态
// 注意：现在只用于显式保存操作，不用于自动文档更改
// 性能：减少防抖时间以获得更灵敏的保存
const doclock = debounce(200, async (document: TextDocument) => {
  try {
    await setDocumentLock(document, true) // 显式保存始终交互式
  } finally {
    const editor = window.activeTextEditor
    if (editor && editor.document === document) showHideActivate(editor)
  }
})

export async function documentChangedListener(event: TextDocumentChangeEvent) {
  const uri = event.document.uri
  if (!abapUri(uri)) return
  // 只在 isDirty 标志变化时（取消）锁定，这暗示没有编辑的状态变化
  // 脏状态时无论如何都会调用，因为保存必须锁定
  if (event.contentChanges.length === 0 || event.document.isDirty) doclock(event.document)
  // 恢复无 copilot 检测的原始锁定

  // Blame：变脏时自动隐藏
  onBlameDocumentChanged(event)

  // // 🤖 COPILOT DETECTION: Check if content changed without isDirty being set
  const document = event.document
  const hasContentChanges = event.contentChanges.length > 0
  const isDocumentDirty = document.isDirty

  if (hasContentChanges && !isDocumentDirty) {
    // 内容已变但 isDirty 为 false = 可能是 Copilot！

    // 检查这是否像撤销操作（整个文档替换）
    const isLikelyUndo = event.contentChanges.some(
      change => change.range.start.line === 0 && change.range.end.line >= document.lineCount - 1
    )

    if (isLikelyUndo) {
      // 这是撤销，不把它计为更改
      return
    }

    const totalLinesChanged = event.contentChanges.reduce((sum, change) => {
      const insertedLines = (change.text.match(/\n/g) || []).length
      const deletedLines = change.range.end.line - change.range.start.line
      // 使用总修改量：插入 + 删除的行
      return sum + insertedLines + deletedLines
    }, 0)

    // 只在重大更改时记录（过滤掉微小编辑）
    if (totalLinesChanged > 0) {
      const action = `Number of code lines changed: ${totalLinesChanged}`
      // 从文档 URI 提取 connectionId
      const connectionId = uri.authority
      logTelemetry(action, { connectionId })
    }
  }
}

export async function documentWillSave(e: TextDocumentWillSaveEvent) {
  const uri = e.document.uri

  if (uri.scheme !== ADTSCHEME || LocalFsProvider.useLocalStorage(uri)) return
  if (!e.document.isDirty) await setDocumentLock({ ...e.document, isDirty: true }, true)

  // 存储保存原因，让 writeFile 可以访问它
  setSaveReason(uri.toString(), e.reason)

  // // New logic: only proceed with lock/save if the trigger was manual (Ctrl+S, Keep, etc.)
  // // // For non-manual saves, we do nothing. This prevents lock attempts on auto-saves.
  // // if (e.reason !== TextDocumentSaveReason.Manual) return

  // // This is the logic that ensures the object is locked before saving.
  // // It will show an error to the user only if this explicit save fails.
  // const lockPromise = setDocumentLock(e.document, true).catch(error => {
  //   // This error is now expected behavior, as it tells the user their
  //   // explicit save action failed.
  //   throw new Error(`Failed to lock SAP object. Save cancelled.`)
  // })
  // // Defer the save operation until the lock is acquired.
  // e.waitUntil(lockPromise)
}

function isInactive(obj: AbapObject): boolean {
  const inactive = !!(obj.structure?.metaData["adtcore:version"] === "inactive")
  return inactive
}

function showHidedbIcon(editor?: TextEditor) {
  try {
    const type = uriAbapFile(editor?.document.uri)?.object.type
    setContext("abapfs:showTableContentIcon", viewableObjecttypes.has(type))
    setContext("abapfs:activeEditorIsTable", type === "TABL/DT")
  } catch (error) {}
}

export async function showHideActivate(editor?: TextEditor, refresh = false) {
  let shouldShow = false
  const uri = editor?.document.uri
  if (!(uri && abapUri(uri))) return
  try {
    const root = uriRoot(uri)
    const lockStatus = await root.lockManager.finalStatus(uri.path)
    shouldShow = editor.document.isDirty && lockStatus.status === "locked"
    if (!shouldShow) {
      const file = root.getNode(uri.path)
      const obj = isAbapStat(file) && file.object
      if (!obj) return
      // 对任何有激活状态的对象显示（未激活对象肯定需要激活）
      if (refresh) await obj.loadStructure()
      // shouldShow = obj && (isInactive(obj) || Boolean(obj.structure?.metaData?.hasOwnProperty("adtcore:version")))
      shouldShow = obj && isInactive(obj)
    }
  } catch (e) {
    shouldShow = false
  }
  // 竞态条件：异步操作挂起期间活动编辑器可能已变化
  if (editor !== window.activeTextEditor) return
  await setContext("abapfs:showActivate", shouldShow)
}
export async function activationStateListener(uri: Uri) {
  const editor = window.activeTextEditor
  if (editor && editor.document.uri.scheme === ADTSCHEME) {
    const euri = editor.document.uri
    if (uri.path !== euri.path) return
    await showHideActivate(editor)
  }
}
const setRevisionContext = (
  leftprev: boolean,
  leftnext: boolean,
  rightprev: boolean,
  rightnext: boolean
) => {
  setContext("abapfs:enableLeftNextRev", leftnext)
  setContext("abapfs:enableLeftPrevRev", leftprev)
  setContext("abapfs:enableRightNextRev", rightnext)
  setContext("abapfs:enableRightPrevRev", rightprev)
}
const enableRevNavigation = async (editor: TextEditor | undefined) => {
  if (editor) {
    const firstlast = async (u: Uri): Promise<[boolean, boolean]> => {
      const v = await versionRevisions(u)
      if (!v) return [false, false]
      const { revision, revisions } = v
      const idx = revisions.findIndex(r => r.uri === revision.uri)
      const hasNext = idx > 0
      const hasprev = idx >= 0 && idx < revisions.length - 1
      return [hasprev, hasNext]
    }
    try {
      const tab = window.tabGroups.activeTabGroup.activeTab
      if (tab?.input instanceof TabInputTextDiff) {
        const { original, modified } = tab.input
        const lefts = await firstlast(original)
        const rights = await firstlast(modified)
        if (rights && lefts) return setRevisionContext(...lefts, ...rights)
      }
    } catch (error) {
      // 出错时全部禁用
    }
  }
  return setRevisionContext(false, false, false, false)
}
export async function activeTextEditorChangedListener(editor: TextEditor | undefined) {
  showHidedbIcon(editor)
  enableRevNavigation(editor)

  // 更新功能可用性上下文（为性能合并）
  if (editor) updateCleanerContext()
  // 注意：updateFillContext 需要 context 参数，在其自己的监听器中单独处理

  try {
    if (editor && editor.document.uri.scheme === ADTSCHEME) {
      // 如果文档有未保存的更改，不从服务器刷新其状态。
      // 这防止覆盖本地更改（尤其是工具的程序化更改）。
      //if (editor.document.isDirty) {
      //  return;
      //}

      await showHideActivate(editor)

      // 切换到 ADT 文件时触发语法检查
      try {
        await triggerSyntaxCheck(editor.document.uri.toString())
      } catch (syntaxError) {
        // 语法检查是可选的 - 失败时不中断
      }

      // 🎯 新增：更新 ABAP 文件的增强装饰
      try {
        await updateEnhancementDecorations(editor)
      } catch (enhError) {
        //   // Enhancement decorations are optional - don't break if they fail
        log(`⚠️ Enhancement decorations failed: ${enhError}`)
      }
    }
  } catch (e) {
    await showHideActivate() // 重置
  }

  // 📋 更新 blame 侧边注释状态
  onBlameActiveEditorChanged(editor)
}
