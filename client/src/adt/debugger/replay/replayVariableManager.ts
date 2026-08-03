import { Handles, Scope } from "@vscode/debugadapter"
import { DebugProtocol } from "@vscode/debugprotocol"
import { debugMetaIsComplex } from "abap-adt-api"
import { CapturedVariable, CapturedScope, DebugSnapshot } from "./types"

const HANDLE_BASE = 1000

/**
 * 从录制快照提供变量数据。
 * 使用 Handles 把 CapturedVariable 树映射到 DAP 变量引用。
 */
export class ReplayVariableManager {
  private handles = new Handles<CapturedVariable[]>(HANDLE_BASE)

  reset() {
    this.handles.reset()
  }

  /** 从快照的捕获作用域构建 DAP Scopes */
  getScopes(snapshot: DebugSnapshot): DebugProtocol.Scope[] {
    return snapshot.scopes.map(scope => {
      const ref = this.handles.create(scope.variables)
      return new Scope(scope.name, ref, false)
    })
  }

  /** 获取给定 variablesReference（作用域或展开的子项）的变量 */
  getVariables(reference: number): DebugProtocol.Variable[] {
    const children = this.handles.get(reference)
    if (!children) return []

    return children.map(v => {
      let variablesReference = 0
      if (v.children && v.children.length > 0 && !v.skipped) {
        variablesReference = this.handles.create(v.children)
      } else if (debugMetaIsComplex(v.metaType) && !v.skipped) {
        // 复杂但未捕获子项 — 显示为不可展开
        variablesReference = 0
      }

      return {
        name: v.name,
        value: formatValue(v),
        variablesReference,
        evaluateName: v.id
      }
    })
  }

  /** 对当前快照的简单表达式求值 */
  evaluate(
    expression: string,
    snapshot: DebugSnapshot
  ): DebugProtocol.EvaluateResponse["body"] | undefined {
    const found = findVariable(expression, snapshot.scopes)
    if (!found) return undefined

    let variablesReference = 0
    if (found.children && found.children.length > 0 && !found.skipped) {
      variablesReference = this.handles.create(found.children)
    }

    return {
      result: formatValue(found),
      variablesReference
    }
  }
}

function formatValue(v: CapturedVariable): string {
  if (v.skipped) return `[not captured: ${v.skipReason || "skipped"}]`
  if (v.metaType === "table") return `${v.type || "table"} ${v.tableLines ?? 0} lines`
  if (v.metaType === "objectref") return v.value
  if (debugMetaIsComplex(v.metaType)) return v.metaType
  return v.value
}

function findVariable(name: string, scopes: CapturedScope[]): CapturedVariable | undefined {
  const upper = name.toUpperCase()
  for (const scope of scopes) {
    const found = findInList(upper, scope.variables)
    if (found) return found
  }
  return undefined
}

function findInList(name: string, vars: CapturedVariable[]): CapturedVariable | undefined {
  for (const v of vars) {
    if (v.name.toUpperCase() === name || v.id.toUpperCase() === name) return v
    if (v.children) {
      const found = findInList(name, v.children)
      if (found) return found
    }
  }
  return undefined
}
