import { PACKAGE } from "./AdtObjectCreator"
import {
  ADTClient,
  CreatableTypeIds,
  FragmentLocation,
  ObjectType,
  SearchResult,
  UriParts
} from "abap-adt-api"
import { QuickPickItem, workspace, commands, Uri, FileStat, Range, ThemeIcon } from "vscode"

import { splitAdtUri, vscPosition, log, caughtToString, promCache } from "../../lib"
import { getClient, getRoot, uriRoot } from "../conections"
import {
  PathItem,
  isFolder,
  isAbapFolder,
  isAbapFile,
  isAbapStat,
  Root,
  AbapFile,
  AbapStat
} from "abapfs"
import { context } from "../../extension"
import { funWindow as window } from "../../services/funMessenger"
import { getRecent, addRecent, clearRecent, RecentObject } from "./recentObjects"
import { getObjectTypeLabel } from "../../views/objectTypeLabels"

interface AdtSearchResult {
  uri: string
  type: string
  name: string
  packageName?: string
  description?: string
}

export class MySearchResult implements QuickPickItem, AdtSearchResult {
  private static packageCache = new Map<string, string>()
  public static async createResults(results: SearchResult[], client: ADTClient) {
    const myresults = results.map(r => new MySearchResult(r))

    const toResolve = myresults.filter(r => {
      if (r.type === PACKAGE) {
        r.packageName = r.name
        return false
      }
      if (r.packageName && r.packageName !== "unknown") {
        return false
      }
      if (this.packageCache.has(r.uri)) {
        r.packageName = this.packageCache.get(r.uri)
        return false
      }
      return true
    })

    if (toResolve.length > 0) {
      await Promise.all(
        toResolve.map(async r => {
          try {
            const steps = await client.findObjectPath(r.uri)
            const pkgStep = steps.find(
              s => s["adtcore:type"] === PACKAGE || s["adtcore:type"].startsWith("DEVC")
            )
            if (pkgStep) {
              r.packageName = pkgStep["adtcore:name"]
              if (this.packageCache.size >= 1000) {
                const firstKey = this.packageCache.keys().next().value
                if (firstKey !== undefined) {
                  this.packageCache.delete(firstKey)
                }
              }
              this.packageCache.set(r.uri, r.packageName)
            } else {
              r.packageName = "unknown"
            }
          } catch (e) {
            r.packageName = "unknown"
          }
        })
      )
    }

    myresults.forEach(typ => {
      if (!typ.packageName) typ.packageName = typ.type === PACKAGE ? typ.name : "unknown"
    })
    return myresults
  }
  get label(): string {
    return this.name
  }
  public uri: string
  public type: string
  public name: string
  public packageName?: string
  public description?: string
  get detail(): string | undefined {
    const typeLabel = getObjectTypeLabel(this.type)
    return `${typeLabel} • Package ${this.packageName} type ${this.type}`
  }
  public picked: boolean = false
  constructor(r: SearchResult) {
    this.uri = r["adtcore:uri"]
    this.type = r["adtcore:type"]
    this.name = r["adtcore:name"]
    this.packageName = r["adtcore:packageName"]
    this.description = r["adtcore:description"]
  }
}

export class AdtObjectFinder {
  constructor(public readonly connId: string) {}
  private fragCache = promCache<FragmentLocation>()

  public async vscodeUriWithFile(uri: string, main = true) {
    const { path, file } = (await getRoot(this.connId).findByAdtUri(uri, main)) || {}
    if (!path) throw new Error(`can't find an URL for ${uri}`)
    const url = createUri(this.connId, path).toString()
    return { uri: url, file }
  }

  public async vscodeUri(uri: string, main = true) {
    const uf = await this.vscodeUriWithFile(uri, main)
    return uf.uri
  }

  public async vscodeObject(uri: string, main = true) {
    const { file } = await this.vscodeUriWithFile(uri, main)
    if (isAbapStat(file)) return file.object
  }

  public clearCaches() {
    this.fragCache = promCache()
  }

  public async vscodeRange(uri: string | UriParts, useFragCache = false) {
    const u = splitAdtUri(uri)
    const rval = { uri: "", start: u.start, file: undefined as AbapFile | undefined }
    if (u.type && u.name) {
      const getFrag = () => getClient(this.connId).fragmentMappings(u.path, u.type!, u.name!)
      const frag = await this.fragCache(`${u.path}_${u.type}_${u.name}`, getFrag, !useFragCache)
      const uf = await this.vscodeUriWithFile(frag.uri)
      rval.uri = uf.uri
      if (isAbapFile(uf.file)) rval.file = uf.file // 此时应该始终是 abapfile
      rval.start = vscPosition(frag.line + (u.start?.line || 0), frag.column)
    } else {
      const uf = await this.vscodeUriWithFile(u.path)
      if (isAbapFile(uf.file)) rval.file = uf.file // 此时应该始终是 abapfile
      rval.uri = uf.uri
    }
    return rval
  }

  public async vscodeUriFromAdt(adtUri: string) {
    const prefixRe = /adt:\/\/[^\/]+\/sap\/bc\/adt/
    if (adtUri.match(prefixRe)) {
      const base = adtUri.replace(prefixRe, "/sap/bc/adt")
      const { uri, start } = await this.vscodeRange(base)
      return { uri: Uri.parse(uri), start }
    } else {
      throw new Error(`Unexpected ADT URI format for ${adtUri}`)
    }
  }

  public async displayAdtUri(adtUri: string) {
    try {
      const { uri, start } = (await this.vscodeUriFromAdt(adtUri)) || {}
      if (uri && start) {
        const document = await workspace.openTextDocument(uri)
        const selection = start ? new Range(start, start) : undefined
        window.showTextDocument(document, { selection })
      }
    } catch (error) {
      window.showErrorMessage(
        `Failed to open document for object ${adtUri}:\n${caughtToString(error)}`
      )
    }
  }

  public async displayNode(nodePath: PathItem) {
    let uri
    if (isFolder(nodePath.file)) {
      if (isAbapFolder(nodePath.file) && nodePath.file.object.type.match(/DEVC/i)) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      const main = await findMainIncludeAsync(nodePath)
      if (!main) {
        window.showInformationMessage(`Can't open object ${nodePath.path}`)
        return
      }
      uri = main.path
    } else uri = nodePath.path
    try {
      const doc = await workspace.openTextDocument(createUri(this.connId, uri))
      await window.showTextDocument(doc)
      commands.executeCommand("workbench.files.action.showActiveFileInExplorer")
    } catch (e) {
      window.showErrorMessage(`Error displaying object ${nodePath.path}.Type not supported?`)
    }
  }
  EPMTYPACKAGE = {
    "adtcore:uri": "",
    "adtcore:type": PACKAGE,
    "adtcore:name": "",
    "adtcore:packageName": "",
    "adtcore:description": "<NONE>"
  }
  /**
   * 带类型选择界面的增强搜索（用于手动搜索命令）
   */
  public async findObjectWithTypeFilter(
    prompt: string = "Search an ABAP object",
    forceTypeSelection: boolean = false
  ): Promise<MySearchResult | undefined> {
    const skipTypeSelectionKey = "abapfs.searchSkipTypeSelection"
    const skipTypeSelection = context.globalState.get<boolean>(skipTypeSelectionKey)
    const savedTypesKey = "abapfs.searchTypeFilter"
    const savedTypes = context.globalState.get<string[]>(savedTypesKey)

    let selectedTypes: string[] | undefined

    // 检查是否应跳过类型选择（除非强制显示）
    if (!forceTypeSelection && skipTypeSelection === true && savedTypes !== undefined) {
      // 直接使用保存的类型，跳过类型选择
      selectedTypes = savedTypes
    } else {
      // 显示类型选择器
      selectedTypes = await this.selectObjectTypes()
      if (selectedTypes === undefined) {
        return undefined // 用户已取消
      }

      // 询问用户是否想在未来跳过类型选择（只在偏好未设置或被强制时）
      if (skipTypeSelection === undefined || forceTypeSelection) {
        const answer = await window.showQuickPick(
          [
            {
              label: "Yes",
              value: true,
              description: "Skip type selection and use these types for future searches"
            },
            {
              label: "No",
              value: false,
              description: "Always ask me to select types before searching"
            }
          ],
          {
            placeHolder: "Would you like to save this type preference for future searches?",
            title: "Save Search Type Preference"
          }
        )

        if (answer) {
          await context.globalState.update(skipTypeSelectionKey, answer.value)
        }
      }
    }
    // 注意：如果选择了所有类型，selectedTypes 可以是 []（空数组）- 这是有意的

    // 第 2 步：用选中的类型搜索
    return this.findObject(prompt, "", undefined, selectedTypes)
  }

  /**
   * 选择对象类型以过滤搜索
   */
  private async selectObjectTypes(): Promise<string[] | undefined> {
    const storageKey = "abapfs.searchTypeFilter"
    const previousSelection = context.globalState.get<string[]>(storageKey) || []

    // ADT 搜索支持的所有 SAP 对象类型
    const objectTypes = [
      // 程序与代码
      { type: "PROG/P", label: "Programs (Reports)", picked: previousSelection.includes("PROG/P") },
      { type: "PROG/I", label: "Includes", picked: previousSelection.includes("PROG/I") },
      { type: "CLAS/OC", label: "Classes", picked: previousSelection.includes("CLAS/OC") },
      { type: "INTF/OI", label: "Interfaces", picked: previousSelection.includes("INTF/OI") },
      { type: "FUGR/F", label: "Function Groups", picked: previousSelection.includes("FUGR/F") },
      { type: "FUGR/FF", label: "Function Modules", picked: previousSelection.includes("FUGR/FF") },
      { type: "TYPE/TY", label: "Type Groups", picked: previousSelection.includes("TYPE/TY") },

      // 字典对象
      { type: "TABL/DT", label: "Database Tables", picked: previousSelection.includes("TABL/DT") },
      { type: "TABL/DS", label: "Structures", picked: previousSelection.includes("TABL/DS") },
      { type: "DTEL/DE", label: "Data Elements", picked: previousSelection.includes("DTEL/DE") },
      { type: "DOMA/DD", label: "Domains", picked: previousSelection.includes("DOMA/DD") },
      { type: "TTYP/DA", label: "Table Types", picked: previousSelection.includes("TTYP/DA") },
      { type: "VIEW/DV", label: "Views", picked: previousSelection.includes("VIEW/DV") },
      { type: "SHLP/DH", label: "Search Helps", picked: previousSelection.includes("SHLP/DH") },
      {
        type: "ENQU/DL",
        label: "Lock/Enqueue Objects (ENQU/DL)",
        picked: previousSelection.includes("ENQU/DL")
      },
      {
        type: "DDLS/DF",
        label: "CDS Data Definitions (DDLS/DF)",
        picked: previousSelection.includes("DDLS/DF")
      },
      {
        type: "STOB/DO",
        label: "CDS Entities (STOB/DO)",
        picked: previousSelection.includes("STOB/DO")
      },
      {
        type: "VIEW/DV",
        label: "CDS Database Views (VIEW/DV)",
        picked: previousSelection.includes("VIEW/DV")
      },

      // 其他对象
      { type: "MSAG/N", label: "Message Classes", picked: previousSelection.includes("MSAG/N") },
      { type: "TRAN/T", label: "Transactions", picked: previousSelection.includes("TRAN/T") },
      { type: "DEVC/K", label: "Packages", picked: previousSelection.includes("DEVC/K") },

      // 增强与 BAdI
      {
        type: "ENHO/XHB",
        label: "Enhancement Implementations",
        picked: previousSelection.includes("ENHO/XHB")
      },
      {
        type: "ENHO/XHH",
        label: "Enhancement Implementations",
        picked: previousSelection.includes("ENHO/XHH")
      },
      {
        type: "ENHS/XS",
        label: "Enhancement Spots",
        picked: previousSelection.includes("ENHS/XS")
      },
      { type: "SXSD/XD", label: "BAdI Definitions", picked: previousSelection.includes("SXSD/XD") },
      {
        type: "SXCI/XI",
        label: "BAdI Implementations",
        picked: previousSelection.includes("SXCI/XI")
      },

      // 转换
      { type: "XSLT/XT", label: "XSLT Programs", picked: previousSelection.includes("XSLT/XT") },
      {
        type: "STOB/ST",
        label: "Simple Transformations",
        picked: previousSelection.includes("STOB/ST")
      },

      // 授权与安全
      {
        type: "SUSO/SO",
        label: "Authorization Objects",
        picked: previousSelection.includes("SUSO/SO")
      },
      {
        type: "SUSO/B",
        label: "Authorization Object Sets",
        picked: previousSelection.includes("SUSO/B")
      },
      {
        type: "SUSC/SC",
        label: "Authorization Object Classes",
        picked: previousSelection.includes("SUSC/SC")
      },

      // 高级对象
      {
        type: "PINF/PI",
        label: "Package Interfaces",
        picked: previousSelection.includes("PINF/PI")
      },
      {
        type: "NROB/NR",
        label: "Number Range Objects",
        picked: previousSelection.includes("NROB/NR")
      },
      {
        type: "BDEF/BDO",
        label: "Behavior Definitions",
        picked: previousSelection.includes("BDEF/BDO")
      },
      {
        type: "SRVB/SVB",
        label: "Service Bindings",
        picked: previousSelection.includes("SRVB/SVB")
      },
      {
        type: "SRVD/SRV",
        label: "Service Definitions",
        picked: previousSelection.includes("SRVD/SRV")
      }
    ]

    const selected = await window.showQuickPick(
      objectTypes.map(ot => ({
        label: ot.label,
        description: ot.type,
        picked: ot.picked,
        type: ot.type
      })),
      {
        canPickMany: true,
        placeHolder: "⚠️ Type here to FILTER the list below (not to search objects!)",
        title: "1️⃣ Select Object Types → 2️⃣ Then Search Objects",
        matchOnDescription: true,
        matchOnDetail: true
      }
    )

    if (!selected || selected.length === 0) {
      return undefined
    }

    const selectedTypeStrings = selected.map(s => (s as any).type)

    // 保存选择供下次使用
    await context.globalState.update(storageKey, selectedTypeStrings)

    // 如果选择了所有类型，返回空数组以搜索所有类型
    // 这确保我们不会遗漏列表之外的对象类型
    if (selectedTypeStrings.length === objectTypes.length) {
      return [] // Empty array will be treated as "search all types"
    }

    return selectedTypeStrings
  }

  private toMySearchResults(items: RecentObject[]): MySearchResult[] {
    return items.map(
      item =>
        new MySearchResult({
          "adtcore:uri": item.uri,
          "adtcore:type": item.type,
          "adtcore:name": item.name,
          "adtcore:packageName": item.packageName,
          "adtcore:description": item.description || getObjectTypeLabel(item.type)
        })
    )
  }

  public async findObject(
    prompt: string = "Search an ABAP object",
    objType: string = "",
    forType?: CreatableTypeIds,
    typeFilter?: string[]
  ): Promise<MySearchResult | undefined> {
    const o = await new Promise<MySearchResult>(async resolve => {
      const qp = window.createQuickPick()
      qp.ignoreFocusOut = true

      let recentItems = this.toMySearchResults(getRecent(this.connId))
      let initialItems: MySearchResult[] =
        forType === PACKAGE ? [new MySearchResult(this.EPMTYPACKAGE), ...recentItems] : recentItems

      // 添加更改类型过滤的按钮（未请求特定类型时始终显示）
      if (!objType && !forType) {
        const filterButton = {
          iconPath: new ThemeIcon("filter"),
          tooltip: "Change Type Filter (Click to select different object types)"
        }
        const clearHistoryButton = {
          iconPath: new ThemeIcon("trash"),
          tooltip: "Clear Search History"
        }

        qp.buttons = [filterButton, clearHistoryButton]

        qp.onDidTriggerButton(async button => {
          if (button === filterButton) {
            qp.hide()
            // 重新运行完整流程（强制类型选择并再次询问偏好）
            const result = await this.findObjectWithTypeFilter(prompt, true)
            if (result) {
              resolve(result)
            }
          } else if (button === clearHistoryButton) {
            await clearRecent(this.connId)
            recentItems = []
            initialItems = forType === PACKAGE ? [new MySearchResult(this.EPMTYPACKAGE)] : []
            qp.items = initialItems
          }
        })

        // 更新占位符以提及过滤按钮
        prompt = prompt + " (Use filter button on the top right to change types)"
      }

      const searchParent = async (e: string) => {
        qp.items =
          e.length >= 2
            ? await this.search(e, getClient(this.connId), objType, typeFilter)
            : initialItems
      }

      qp.items = initialItems
      qp.onDidChangeValue(async e => searchParent(e))
      qp.placeholder = prompt
      qp.onDidChangeSelection(e => {
        if (e[0]) {
          const selected = e[0] as MySearchResult
          void addRecent(this.connId, {
            uri: selected.uri,
            type: selected.type,
            name: selected.name,
            packageName: selected.packageName || "",
            description: selected.description
          })
          resolve(selected)
          qp.hide()
        }
      })
      qp.onDidHide(() => qp.dispose())
      qp.show()
    })
    return o
  }

  private async search(
    prefix: string,
    client: ADTClient,
    objType: string = "",
    typeFilter?: string[]
  ): Promise<MySearchResult[]> {
    const query = prefix.toUpperCase() + "*"
    const raw = await client.searchObject(query, objType)

    // 提供了类型过滤则应用
    let filtered = raw
    if (typeFilter && typeFilter.length > 0) {
      filtered = raw.filter(r => typeFilter.includes(r["adtcore:type"]))
    } else if (objType) {
      // 回退到原始 objType 过滤
      filtered = raw.filter(r => objType === r["adtcore:type"])
    }

    return await MySearchResult.createResults(filtered, client)
  }
}

const findMainIncludeAsync = async (item: PathItem) => {
  if (isAbapFile(item.file)) return item
  if (isAbapFolder(item.file)) {
    const main = item.file.mainInclude(item.path)
    if (main) return main
    await item.file.refresh()
    return item.file.mainInclude(item.path)
  }
}

export function createUri(connId: string, path: string, query: string = "") {
  return Uri.parse("adt://" + connId).with({
    path,
    query
  })
}

export async function findAbapObject(uri: Uri) {
  const file = await uriRoot(uri).getNodeAsync(uri.path)
  if (isAbapStat(file)) return file.object
  throw new Error("Not an ABAP object")
}

export const uriAbapFile = (uri?: Uri): AbapStat | undefined => {
  try {
    if (!uri) return

    // 只处理 adt:// URI - 拒绝 output、file 等
    if (uri.scheme !== "adt") {
      return undefined
    }

    const root = uriRoot(uri)
    const file = root.getNode(uri.path)
    if (isAbapStat(file)) return file
  } catch (error) {
    // 记录实际错误而不是用堆栈吞掉
    throw error // 重新抛出，让调用方处理
  }
}

export const pathSequence = (root: Root, uri: Uri | undefined): FileStat[] => {
  if (uri)
    try {
      const parts = uri.path.split("/")
      let path = ""
      const nodes: FileStat[] = []
      for (const part of parts) {
        const sep = path.substr(-1) === "/" ? "" : "/"
        path = `${path}${sep}${part}`
        const hit = root.getNode(path)
        if (!hit) log(`Incomplete path hierarchy for ${uri.path}`)
        else nodes.unshift(hit)
      }
      return nodes
    } catch (e) {
      // 忽略
    }
  return []
}
