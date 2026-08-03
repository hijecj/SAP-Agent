/** S/4HANA 就绪仪表盘的数据类型 */

export interface SimplificationItem {
  id: string
  version: string
  title: string
  note: number
  replacementId: string
}

export interface CustomReference {
  extractionSysid: string
  extractionName: string
  referenceKind: string
  hash: string
  refObjType: string
  refObjName: string
  refSubType: string
  refSubName: string
  refIntType: string
  refIntName: string
  objType: string
  objName: string
  subType: string
  subName: string
  includeName: string
  devclass: string
  genflag: string
  dlvunit: string
  refApplComponent: string
}

export interface PiecelistEntry {
  piecelistId: string
  pgmid: string
  objectType: string
  objectName: string
  packageName: string
  applicationComponent: string
}

export interface ItemPiecelistLink {
  id: string
  version: string
  piecelistId: string
}

/** 带链接简化项增强的自定义引用 */
export interface EnrichedReference {
  ref: CustomReference
  item: SimplificationItem | undefined
}

/** 准备好用于树渲染的分组数据 */
export interface GroupedData {
  /** 有匹配自定义引用的项 */
  groups: ItemGroup[]
  /** 无法链接到任何简化项的引用 */
  ungrouped: CustomReference[]
  /** 总引用数 */
  totalRefs: number
}

export interface ItemGroup {
  item: SimplificationItem
  refs: CustomReference[]
}
