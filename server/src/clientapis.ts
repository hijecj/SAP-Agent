import {
  ClientConfiguration,
  Methods,
  AbapObjectDetail,
  AbapObjectSource,
  StringWrapper,
  UriRequest,
  SearchProgress
} from "vscode-abap-remote-fs-sharedapi"
import { connection } from "./clientManager"

/**
 * 为给定 ADT 连接键请求客户端配置。
 */
export async function readConfiguration(key: string) {
  const c = (await connection.sendRequest(Methods.readConfiguration, key)) as
    | ClientConfiguration
    | undefined
  return c
}

/**
 * 从客户端扩展检索所提供 ADT URI 的对象元数据。
 */
export async function getObjectDetails(uri: string) {
  const object = (await connection.sendRequest(Methods.objectDetails, uri)) as
    | AbapObjectDetail
    | undefined
  return object
}

/**
 * 读取给定 URI 标识对象的当前编辑器源码。
 */
export async function getEditorObjectSource(uri: string) {
  const source = (await connection.sendRequest(
    Methods.readEditorObjectSource,
    uri
  )) as AbapObjectSource
  return (source && source.source) || ""
}

/**
 * 读取对象源码，需要时回退到主程序。
 */
export async function getObjectSource(uri: string) {
  const source = (await connection.sendRequest(
    Methods.readObjectSourceOrMain,
    uri
  )) as AbapObjectSource
  return source
}

/**
 * 把 ADT URI 转换为 VS Code 可以打开的编辑器 URI。
 */
export async function getVSCodeUri(confKey: string, uri: string, mainInclude: boolean) {
  const req: UriRequest = { confKey, uri, mainInclude }
  const s = (await connection.sendRequest(Methods.vsUri, req)) as StringWrapper
  return (s && s.s) || ""
}

/**
 * 报告当前引用搜索操作的进度更新。
 */
export async function setSearchProgress(progress: SearchProgress) {
  connection.sendRequest(Methods.setSearchProgress, progress)
}
