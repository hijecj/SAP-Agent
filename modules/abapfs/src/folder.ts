import { FileStat, FileType } from "vscode"
const tag = Symbol("Folder")
const refTime = new Date().getMilliseconds()

interface Child {
  file: FileStat
  manual: boolean
}

export interface FolderItem {
  name: string
  file: FileStat
}
export interface PathItem {
  path: string
  file: FileStat
}

export const isFolder = (x: any): x is Folder => !!x?.[tag]
export const isRefreshable = (f: any): f is Refreshable =>
  isFolder(f) && typeof (f as any).refresh === "function"

export class Folder implements Iterable<FolderItem>, FileStat {
  [tag] = true
  type = FileType.Directory
  private _children = new Map<string, Child>();

  *[Symbol.iterator](): Iterator<FolderItem> {
    const mi = this._children.entries()
    for (const [name, child] of mi) yield { name, file: child.file }
  }
  *expandPath(startPath = ""): Generator<PathItem> {
    for (const child of this) {
      const path = `${startPath}/${child.name}`
      yield { path, file: child.file }
      if (isFolder(child.file)) yield* child.file.expandPath(path)
    }
  }
  get ctime() {
    return refTime
  }
  get mtime() {
    return refTime
  }
  /** 添加/替换子节点
   *  返回 this 以支持链式调用
   *
   *  manual 用于文件系统中实际不存在但应属于这里的内容
   */
  set(name: string, file: FileStat, manual = true) {
    this._children.set(name, { file, manual })
    return this
  }

  get(name: string) {
    return this._children.get(name)?.file
  }

  protected hasManual() {
    for (const [_, child] of this._children) if (child.manual) return true
    for (const [_, child] of this._children) if (isFolder(child) && child.hasManual()) return true
  }

  /** 按路径查找文件/文件夹
   *  只对已见过的节点有效
   */
  getNode(path: string): FileStat | undefined {
    const parts = path.split("/").filter(x => x)
    const nodePath = this.getNodePathInt(parts, "")
    return nodePath[0]?.file
  }

  /** 按路径查找文件/文件夹
   *  按需展开节点
   */
  async getNodeAsync(path: string) {
    const parts = path.split("/").filter(x => x)
    const item = await this.getPathAsyncInt(parts, "")
    return item[0]?.file
  }

  /** 按路径查找文件/文件夹及其所有前驱
   *  只对已见过的节点有效
   */
  getNodePath(path: string) {
    const parts = path.split("/").filter(x => x)
    return this.getNodePathInt(parts, "")
  }

  /** 按路径查找文件/文件夹及其所有前驱
   *  按需展开节点
   */
  getNodePathAsync(path: string) {
    const parts = path.split("/").filter(x => x)
    return this.getPathAsyncInt(parts, "")
  }

  get size() {
    return this._children.size
  }

  /** 合并文件夹结构
   *  我们绝不应把节点替换为新节点，只能添加/移除
   *
   * - 缺失的条目被移除，除非是手动添加的
   * - 新条目被添加
   * - 与旧条目匹配的文件夹递归合并
   * - 与旧条目匹配的叶子保持不变
   */
  public merge(items: FolderItem[]) {
    // 清理缺失项
    for (const [name, child] of this._children.entries()) {
      if (child.manual || items.find(i => i.name === name)) continue
      if (isFolder(child.file) && child.file.hasManual()) child.file.merge([])
      else this._children.delete(name)
    }

    for (const item of items) {
      const { name, file } = item
      const old = this._children.get(name)
      // 新文件
      if (!old) this.set(name, file, false)
      // 合并子节点
      else if (isFolder(old?.file) && isFolder(file)) old?.file.merge([...file])
      // 得到新叶子或叶子被文件夹替换时要做点什么吗？可能最好忽略
    }
  }

  private getNodePathInt(parts: string[], start: string): PathItem[] {
    let current: PathItem = { file: this, path: `${start || "/"}` }
    const nodePath = [current]
    for (const p of parts) {
      const file = isFolder(current.file) && current.file.get(p)
      if (!file) return []
      const path = current.path === "/" ? `/${p}` : `${current.path}/${p}`
      current = { file, path }
      nodePath.unshift(current)
    }
    return nodePath
  }

  private async getPathAsyncInt(parts: string[], start: string): Promise<PathItem[]> {
    let nodePath = this.getNodePathInt(parts, start)
    if (nodePath.length) return nodePath
    let current: PathItem = { file: this, path: `${start || "/"}` }
    nodePath = [current]
    let refresh: (() => any) | undefined

    for (const p of parts) {
      if (isRefreshable(current.file)) {
        const f = current.file
        refresh = async () => {
          await f.refresh()
          refresh = undefined
        }
      }
      if (isFolder(current.file)) {
        let file = current.file.get(p)
        if (!file && refresh) {
          await refresh()
          file = current.file.get(p)
        }
        if (!file) return []
        const path = current.path === "/" ? `/${p}` : `${current.path}/${p}`
        current = { file, path }
        nodePath.unshift(current)
      } else return []
    }
    return nodePath
  }
}

interface Refreshable extends Folder {
  refresh: () => Promise<void>
}
