import { context } from "../../extension"

/**
 * 持久化最近对象的规范形状。
 * 弹窗（AdtObjectFinder）和侧边栏（objectSearchView）
 * 都读写此相同形状，让项目在任何地方看起来一致。
 */
export interface RecentObject {
  uri: string
  type: string
  name: string
  packageName: string
  description?: string
}

const RECENT_KEY_PREFIX = "abapfs.recentObjects."
export const RECENT_MAX = 10

function key(connId: string) {
  return `${RECENT_KEY_PREFIX}${connId}`
}

export function getRecent(connId: string): RecentObject[] {
  return context.globalState.get<RecentObject[]>(key(connId)) || []
}

export async function addRecent(connId: string, item: RecentObject): Promise<void> {
  let recent = getRecent(connId).filter(r => r.uri !== item.uri)
  recent.unshift(item)
  if (recent.length > RECENT_MAX) {
    recent = recent.slice(0, RECENT_MAX)
  }
  await context.globalState.update(key(connId), recent)
}

export async function clearRecent(connId: string): Promise<void> {
  await context.globalState.update(key(connId), [])
}
