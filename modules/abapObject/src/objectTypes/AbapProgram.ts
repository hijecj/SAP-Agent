import { AbapObjectBase } from "../AbapObject"
import { NodeStructure, ADTClient } from "abap-adt-api"
import { ObjectErrors } from "../AOError"

const tag = Symbol("AbapProgram")

export class AbapProgram extends AbapObjectBase {
  [tag] = true
  protected filterInvalid(original: NodeStructure, includeIncludes?: boolean): NodeStructure {
    if (!this.structure) throw ObjectErrors.noStructure(this, `metadata not loaded for ${this.key}`)

    const { nodes } = original

    // 主程序节点 - 始终包含它
    const mainProgramNode = {
      OBJECT_TYPE: "PROG/P",
      OBJECT_NAME: `${this.name}`,
      TECH_NAME: "",
      OBJECT_URI: this.path,
      EXPANDABLE: "",
      OBJECT_VIT_URI: this.sapGuiUri
    }

    // 如果 includeIncludes 为 true（从激活器调用），返回 include + 主程序
    if (includeIncludes) {
      const includeNodes = nodes.filter(
        n => n.OBJECT_TYPE === "PROG/I" && n.OBJECT_NAME && n.OBJECT_URI
      )
      // 返回主程序 + 所有 include
      return { categories: [], objectTypes: [], nodes: [mainProgramNode, ...includeNodes] }
    }

    // 否则（文件系统操作），只返回程序本身
    return { categories: [], objectTypes: [], nodes: [mainProgramNode] }
  }

  get extension() {
    return this.expandable ? "" : ".prog.abap"
  }

  async childComponents(includeIncludes?: boolean) {
    if (!this.structure) await this.loadStructure()
    if (!this.expandable) return { nodes: [], categories: [], objectTypes: [] }
    // 对文件系统操作，filterInvalid() 无论如何都会丢弃所有 nodeContents 结果 —
    // 跳过服务器调用，避免在带本地类（CLAS/OLA 节点）的程序上使 ADT 崩溃。
    if (!includeIncludes) return this.filterInvalid({ nodes: [], categories: [], objectTypes: [] })
    return super.childComponents(includeIncludes)
  }
}

export const isAbapProgram = (x: any): x is AbapProgram => !!x?.[tag]
