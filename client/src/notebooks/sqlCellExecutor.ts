/**
 * SQL 单元格执行器。通过 ADT 的 datapreview API 运行 ABAP SQL。
 *
 * 注意：ADT HTTP 请求无法中途中止。用户取消执行时，
 * UI 立即显示“已中断”，但 SAP 端查询会运行到完成。
 * 结果被控制器丢弃（不存储在 cellResults 中）。
 * 这与 SE16N 和现有 execute_data_query LM 工具的行为一致。
 */

import { ADTClient } from "abap-adt-api"
import { CellResult, DEFAULT_MAX_ROWS } from "./types"
import { interpolateSql } from "./interpolation"

export async function executeSqlCell(
  rawSql: string,
  client: ADTClient,
  cellIndex: number,
  cellResults: Map<number, CellResult>,
  maxRows?: number
): Promise<CellResult> {
  const sql = interpolateSql(rawSql, cellResults)

  validateSql(sql)

  const ADT_MAX_ROWS_LIMIT = 10_000_000
  const limit =
    typeof maxRows === "number" && maxRows > 0 && isFinite(maxRows)
      ? Math.min(Math.floor(maxRows), ADT_MAX_ROWS_LIMIT)
      : DEFAULT_MAX_ROWS
  const result = await client.runQuery(sql, limit, true)

  if (!result || !result.columns) {
    return { result: [], rowCount: 0, columns: [] }
  }

  const columns = result.columns.map((col: any) => ({
    name: typeof col === "string" ? col : col.name || col.COLUMN_NAME || String(col),
    type: typeof col === "object" ? col.type || "C" : "C"
  }))

  const values = result.values || []

  return {
    result: values,
    rowCount: values.length,
    columns
  }
}

function validateSql(sql: string): void {
  const trimmed = sql.trim()
  if (!trimmed) {
    throw new Error("SQL cell is empty")
  }

  const withoutComments = stripComments(trimmed)
  const firstWord = withoutComments.trim().split(/\s/)[0]?.toUpperCase()

  if (firstWord !== "SELECT" && firstWord !== "WITH") {
    throw new Error("Only SELECT and WITH statements are allowed in SQL cells")
  }

  const stripped = stripStringLiterals(withoutComments)

  const dangerousKeywords = ["DROP", "DELETE", "INSERT", "UPDATE", "ALTER", "CREATE", "TRUNCATE"]

  for (const kw of dangerousKeywords) {
    const pattern = new RegExp(`\\b${kw}\\b`, "i")
    if (pattern.test(stripped)) {
      throw new Error(`SQL contains '${kw}'. Only SELECT and WITH statements are allowed.`)
    }
  }

  if (stripped.includes(";")) {
    throw new Error(
      "Semicolons are not allowed in ABAP SQL queries. Remove any trailing semicolons."
    )
  }
}

function stripComments(sql: string): string {
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, " ")
  result = result.replace(/--[^\n]*/g, " ")
  return result
}

function stripStringLiterals(sql: string): string {
  return sql.replace(/'([^']|'')*'/g, "''")
}
