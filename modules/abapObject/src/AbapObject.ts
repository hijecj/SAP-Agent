import {
  AbapObjectStructure,
  MainInclude,
  NodeStructure,
  ObjectVersion,
  isNodeParent
} from "abap-adt-api"
import { AbapObjectService } from "./AOService"
import { ObjectErrors } from "./AOError"
import { getObjectTypeConfig } from "./registry"
const SAPGUIONLY = "This object type is not supported in VS Code."
const NSSLASH = "\u2215" // used to be hardcoded as "／", aka "\uFF0F"
export const PACKAGE = "DEVC/K"
export const TMPPACKAGE = "$TMP"
export const PACKAGEBASEPATH = "/sap/bc/adt/repository/nodestructure"
export const convertSlash = (x: string) => x && x.replace(/\//g, NSSLASH)
const objectTag = Symbol("abapObject")

export interface AbapObject {
  readonly [objectTag]: true
  /** 唯一对象 ID，通常是类型和名称 */
  readonly key: string
  /** 按 ADT 定义，例如程序是 PROG/P */
  readonly type: string
  /** 原始对象名 */
  readonly name: string
  /** 对象技术名，例如 main、testclasses…… */
  readonly techName: string
  /** ADT 中的对象路径，用于检索元数据或源码 */
  readonly path: string
  /** 读写操作的路径 */
  contentsPath(): string
  /** 对象是否有子对象，例如类，为 true */
  readonly expandable: boolean
  /** 对象结构，例如激活标志、最后更改数据…… */
  readonly structure?: AbapObjectStructure
  /** 可用于文件系统的清理后名称。例如把 / 替换为其他字符 */
  readonly fsName: string
  /** 编辑时要锁定的对象。例如函数所属的函数组 */
  readonly lockObject: AbapObject
  /** 创建对象的用户。只在加载元数据后可用 */
  readonly createdBy: string
  /** 创建时间。只在加载元数据后可用 */
  readonly createdAt: Date | undefined
  /** 最后更改对象的用户。只在加载元数据后可用 */
  readonly changedBy: string
  /** 最后更改时间。只在加载元数据后可用 */
  readonly changedAt: Date | undefined
  /** 读取此对象可用的主对象 */
  mainPrograms: () => Promise<MainInclude[]>
  readonly parent: AbapObject | undefined
  /** 我们是否能够写入它 */
  readonly canBeWritten: boolean
  /** 对象命名空间
   *  例如 /UI5/IF_ADT_REP_MODEL 的是 /UI5/
   */
  readonly nameSpace: string
  /** 对象基础名
   *  例如 /UI5/IF_ADT_REP_MODEL 的是 IF_ADT_REP_MODEL
   */
  readonly baseName: string
  /** 用于在 SAPGUI 中打开对象 */
  readonly sapGuiUri: string
  /** 受支持或仅 sapgui */
  readonly supported: boolean
  readonly gui_objects: "yes" | "no" | "better"
  readonly owner?: string
  readonly modtime: number
  readonly version: ObjectVersion | undefined

  /** 加载/更新对象元数据 */
  loadStructure: (refresh?: boolean, version?: ObjectVersion) => Promise<AbapObjectStructure>
  delete: (lockId: string, transport: string) => Promise<void>
  write: (contents: string, lockId: string, transport: string) => Promise<void>
  read: () => Promise<string>
  childComponents: (includeIncludes?: boolean) => Promise<NodeStructure>
}

const ignoreErr = () => {}

export type AbapObjectConstructor = new (
  type: string,
  name: string,
  path: string,
  expandable: boolean,
  techName: string,
  parent: AbapObject | undefined,
  sapGuiUri: string,
  client: AbapObjectService
) => AbapObject
export const isAbapObject = (x: any): x is AbapObject => !!x?.[objectTag]

const followPath = (base: string, suffix: string) => {
  if (suffix) {
    if (suffix.match(/^\.\//)) return `${base.replace(/\/[^\/]*$/, "")}${suffix.substr(1)}`
    return suffix.match(/^\//) ? suffix : `${base}/${suffix}`
  }
}
const dd = Symbol.for("debug.description")
export class AbapObjectBase implements AbapObject {
  [dd] = () => `${this.constructor.name} ${this.type} ${this.name}`
  public get expandable(): boolean {
    return this._expandable
  }
  readonly [objectTag]: true = true
  constructor(
    readonly type: string,
    readonly name: string,
    readonly path: string,
    private readonly _expandable: boolean,
    readonly techName: string,
    readonly parent: AbapObject | undefined,
    readonly sapGuiUri: string,
    protected readonly service: AbapObjectService,
    readonly owner?: string
  ) {
    this.supported =
      this.type !== "IWSV" &&
      !path.match("(/sap/bc/adt/vit)|(/sap/bc/adt/ddic/domains/)|(/sap/bc/esproxy)")
  }
  private _structure?: AbapObjectStructure
  public get structure(): AbapObjectStructure | undefined {
    return this._structure
  }
  get modtime() {
    return this.structure?.metaData["adtcore:changedAt"] ?? 0
  }
  public set structure(value: AbapObjectStructure | undefined) {
    this._structure = value
  }
  readonly supported: boolean

  get gui_objects(): "yes" | "no" | "better" {
    const config = getObjectTypeConfig(this.type)
    if (config) return config.gui_objects
    return this.supported ? "no" : "yes"
  }

  get canBeWritten() {
    return this.supported && !this.expandable
  }
  get key() {
    return `${this.type} ${this.name}`
  }
  get extension(): string {
    return this.expandable ? "" : this.supported ? ".abap" : ".txt"
  }
  get fsName() {
    return `${convertSlash(this.name)}${this.extension}`
  }
  get version(): ObjectVersion | undefined {
    const version = this.structure?.metaData["adtcore:version"]
    if (version === "active" || version === "inactive") return version
  }
  get lockObject(): AbapObject {
    return this
  }
  get createdBy() {
    return this.structure?.metaData["adtcore:responsible"] || ""
  }
  get createdAt() {
    const ts = this.structure?.metaData["adtcore:createdAt"]
    return ts ? new Date(ts) : undefined
  }
  get changedBy() {
    return this.structure?.metaData["adtcore:changedBy"] || ""
  }
  get changedAt() {
    const ts = this.structure?.metaData["adtcore:changedAt"]
    return ts ? new Date(ts) : undefined
  }
  get nameSpace() {
    const m = this.name.match(/^(\/[^\/]+\/)/)
    return (m && m[1]) || ""
  }
  get baseName() {
    return this.name.replace(/^(\/[^\/]+\/)/, "")
  }
  contentsPath() {
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    if (!this.supported) throw ObjectErrors.NotSupported(this)
    if (!this.structure) throw ObjectErrors.noStructure(this)
    const suffix =
      this.structure?.metaData["abapsource:sourceUri"] ||
      this.structure?.links?.find(
        l => l.type === "text/plain" && l.rel === "http://www.sap.com/adt/relations/source"
      )?.href ||
      ""
    const path = this.path?.endsWith(suffix) ? this.path : followPath(this.path, suffix)
    if (path) return path
    throw ObjectErrors.notLeaf(this)
  }

  async mainPrograms() {
    if (!this.supported) throw ObjectErrors.NotSupported(this)
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    return this.service.mainPrograms(this.path)
  }
  private _loadstprom: Promise<AbapObjectStructure> | undefined = undefined
  async loadStructure(refresh = false, version?: ObjectVersion): Promise<AbapObjectStructure> {
    if (!this._loadstprom) {
      const loader = async () => {
        if (!this.name) throw ObjectErrors.noStructure(this)
        const base = this.path.replace(/\/source\/main$/, "")
        const structure = await this.service.objectStructure(base, refresh, version)
        const metaData = structure.metaData
        if (!this.structure || metaData["adtcore:changedAt"] >= this.modtime)
          this.structure = structure
        return this.structure
      }
      this._loadstprom = loader().finally(() => (this._loadstprom = undefined))
    }
    return this._loadstprom
  }
  async delete(lockId: string, transport = "") {
    return this.service.delete(this.path, lockId, transport)
  }

  async write(contents: string, lockId: string, transport: string) {
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    if (!this.canBeWritten) throw ObjectErrors.NotSupported(this)
    await this.service.setObjectSource(this.contentsPath(), contents, lockId, transport)
    this.service.invalidateStructCache(this.path)
    if (this.lockObject !== this) this.service.invalidateStructCache(this.lockObject.path)
    if (this.parent && this.parent.type !== PACKAGE) await this.parent.loadStructure()
  }

  async read() {
    await this._loadstprom
    if (this.expandable) throw ObjectErrors.notLeaf(this)
    if (!this.supported) return SAPGUIONLY
    const version = this.version === "inactive" ? "inactive" : undefined
    return this.service.getObjectSource(this.contentsPath(), version)
  }

  protected filterInvalid(original: NodeStructure, includeIncludes?: boolean): NodeStructure {
    const { nodes, objectTypes } = original
    const valid = nodes.filter(
      n => (n.OBJECT_TYPE === PACKAGE || !n.OBJECT_TYPE.match(/DEVC\//)) && !!n.OBJECT_URI
    )
    const types = objectTypes
      .filter(t => t.OBJECT_TYPE === PACKAGE || !t.OBJECT_TYPE.match(/DEVC\//))
      .map(t => {
        if (t.OBJECT_TYPE_LABEL) return t
        const aliasId = t.OBJECT_TYPE.replace(/^[^\/]+\//, "DEVC/")
        const alias = objectTypes.find(ot => ot.OBJECT_TYPE === aliasId)
        return alias ? { ...t, OBJECT_TYPE_LABEL: alias.OBJECT_TYPE_LABEL } : t
      })
    return { ...original, nodes: valid, objectTypes: types }
  }

  async childComponents(includeIncludes?: boolean): Promise<NodeStructure> {
    if (!this.expandable) throw ObjectErrors.isLeaf(this)
    if (!isNodeParent(this.type)) throw ObjectErrors.NotSupported(this)
    const unfiltered = await this.service.nodeContents(this.type, this.name, this.owner)
    return this.filterInvalid(unfiltered, includeIncludes)
  }
}
