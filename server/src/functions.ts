import { types } from "util"

/**
 * 运行时检查通过时把值收窄为字符串类型。
 */
export const isString = (x: any): x is string => typeof x === "string"

/**
 * 运行时检查通过时把值收窄为数字类型。
 */
export const isNumber = (x: any): x is number => typeof x === "number"

/**
 * 在包装器生命周期内缓存异步函数的结果。
 */
export const memoize = <P, R>(base: (p: P) => Promise<R>): ((p: P) => Promise<R>) => {
  const cache: Map<P, R> = new Map()
  return async (param: P) => {
    let result = cache.get(param)
    if (!result) {
      result = await base(param)
      cache.set(param, result)
    }
    return result
  }
}

/**
 * 使用提供的正则表达式从字符串提取捕获组。
 */
export function parts(whole: any, pattern: RegExp): string[] {
  if (!isString(whole)) return []
  const match = whole.match(pattern)
  return match ? match.slice(1) : []
}

/**
 * 把值转换为整数，同时容忍空或非数字输入。
 */
export function toInt(raw: any): number {
  if (isNaN(raw)) return 0
  if (isNumber(raw)) return Math.floor(raw)
  if (!raw && !isString(raw)) return 0
  const n = Number.parseInt(raw, 10)
  if (isNaN(n)) return 0
  return n
}

/**
 * 把 ADT URI 中的查询字符串风格片段解析为普通对象。
 */
export const hashParms = (uri: string): any => {
  const parms: any = {}
  const hash = uri.split(/#/)[1]
  const uriHashArgs: string[] = (hash && hash.split(/;/)) || []
  for (const arg of uriHashArgs) {
    const argTuple = arg.split(/=/, 2)
    if (argTuple.length > 1) parms[argTuple[0]] = decodeURIComponent(argTuple[1])
  }
  return parms
}

/**
 * 对使用 .abap 扩展名的 ABAP 源文件返回 true。
 */
export const isAbap = (uri: string) => !!uri.match(/\.abap$/i)

/**
 * 对 CDS DDLS 源文件返回 true。
 */
export const isCdsView = (uri: string) => !!uri.match(/\.ddls.asddls$/i)

/**
 * 对语言服务器处理的类 CDS 源文件扩展名返回 true。
 */
export const isCdsLike = (uri: string) =>
  !!uri.match(/\.(ddls\.asddls|dcls\.asdcls|ddlx\.asddlxs|bdef\.asbdef|srvd\.srvdsrv)$/i)

/**
 * 对应由服务器处理的 ABAP 或基于 CDS 的资源返回 true。
 */
export const isAbapOrCds = (uri: string) => isAbap(uri) || isCdsLike(uri)

interface RunningState<T> {
  current: Promise<T>
  next?: () => Promise<T>
}
const doNext = <T>(p: Promise<T>, n: (ok?: T, err?: any) => Promise<T>) =>
  p.then(ok => n(ok)).catch(err => n(undefined, err))
// 重复请求共享单个进行中的调用，并排队下一次尝试，直到当前运行完成。

/**
 * 通过复用进行中的请求或排队下一次尝试，限制同一键的并发调用。
 */
export const callThrottler = <T>() => {
  const runStates = new Map<string, RunningState<T>>()

  return (key: string, call: () => Promise<T>) => {
    const state = runStates.get(key) || { current: call() }
    const isNew = !runStates.has(key)
    if (!isNew) runStates.set(key, state)
    const current = state.current

    function resume(ok: T): T
    function resume(err: any): any
    function resume(ok?: T, err?: any) {
      if (state.next) {
        const nextval = state.next()
        state.current = doNext(nextval, resume)
        state.next = undefined
        return nextval
      } else runStates.delete(key)
      if (err) throw err
      return ok
    }

    if (isNew) {
      state.current = doNext(state.current, resume)
      runStates.set(key, state)
    } else {
      state.next = call
      return state.current
    }

    return current
  }
}

/**
 * 把未知值转换为稳定的字符串，用于日志和诊断。
 */
export const caughtToString = (e: any) => {
  if (types.isNativeError(e)) return e.message
  if (typeof e === "object" && typeof e.toString === "function") return e.toString()
  if (typeof e === "object" && typeof e.message === "string") return e.message
  return `${e}`
}
