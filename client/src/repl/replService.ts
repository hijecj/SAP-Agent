import { ADTClient } from "abap-adt-api"
import { log } from "../lib"

const REPL_PATH = "/sap/bc/z_abap_repl"

export interface ReplResponse {
  success: boolean
  output: string
  error: string
  runtime_ms: number
}

export interface ReplHealthCheck {
  status: string
  version: string
  user: string
  system: string
  client: string
  production: boolean
}

/** 剥离 ABAP 可能嵌入字符串值中的 JSON 请求体控制字符 */
function sanitizeJsonBody(body: string): string {
  // 替换 JSON 字符串值中的真实换行/制表符/控制字符，
  // 通过只扫描和替换引号字符串内的字符
  let result = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (escaped) {
      result += ch
      escaped = false
      continue
    }
    if (ch === "\\" && inString) {
      result += ch
      escaped = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      continue
    }
    if (inString && ch.charCodeAt(0) < 0x20) {
      // 用其 JSON 转义替换原始控制字符
      if (ch === "\n") result += "\\n"
      else if (ch === "\r") result += "\\r"
      else if (ch === "\t") result += "\\t"
      else result += `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`
      continue
    }
    result += ch
  }
  return result
}

export async function checkReplAvailability(client: ADTClient): Promise<ReplHealthCheck> {
  const response = await (client as any).httpClient.request(REPL_PATH, {
    method: "GET",
    timeout: 10_000
  })

  log.debug(
    `ABAP REPL health: status=${response.status}, body="${response.body.substring(0, 300)}"`
  )
  return JSON.parse(sanitizeJsonBody(response.body)) as ReplHealthCheck
}

export async function executeAbapCode(client: ADTClient, code: string): Promise<ReplResponse> {
  const reqBody = JSON.stringify({ code })
  log.debug(`ABAP REPL: executing ${code.length} chars, body="${reqBody.substring(0, 200)}"`)

  const response = await (client as any).httpClient.request(REPL_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: reqBody,
    timeout: 60_000
  })

  log.debug(`ABAP REPL exec: status=${response.status}, body="${response.body.substring(0, 300)}"`)
  return JSON.parse(sanitizeJsonBody(response.body)) as ReplResponse
}
