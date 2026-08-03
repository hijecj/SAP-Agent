/**
 * ABAP 对象搜索服务
 */

import { getClient } from "../adt/conections"
import { logSearch } from "./abapCopilotLogger"

// 为兼容性导出接口（为基于行的访问简化）
export interface ABAPObjectInfo {
  name: string
  type: string
  description: string
  package: string
  systemType: "STANDARD" | "CUSTOM"
  lastModified?: Date
  uri?: string
  details?: any
}

export class searchService {
  private connectionId: string

  constructor(connectionId: string) {
    this.connectionId = connectionId
  }

  /**
   * 按模式搜索 ABAP 对象 - 直接 ADT 搜索
   */
  async searchObjects(
    pattern: string,
    types?: string[],
    maxResults: number = 50
  ): Promise<ABAPObjectInfo[]> {
    try {
      const client = getClient(this.connectionId)
      const searchPattern = pattern.toUpperCase()
      const results: ABAPObjectInfo[] = []

      // 确定要搜索的类型
      const searchTypes =
        types && types.length > 0
          ? types
          : [
              "FUNC", // 函数模块
              "CLAS", // 类
              "TABL", // 数据库表
              "PROG", // 报表/程序
              "INTF", // 接口
              "DTEL", // 数据元素
              "DDLS", // CDS 视图
              "DOMA", // 域
              "TTYP", // 表类型
              "ENQU", // 锁对象
              "MSAG", // 消息类
              "FUGR", // 函数组
              "DEVC", // 包
              "TRAN", // 事务
              "VIEW", // 视图
              "SICF", // ICF 服务
              "WDYN", // Web Dynpro 组件
              "SPRX", // 代理
              "XSLT", // XSLT 程序
              "TRANSFORMATIONS", // 简单转换
              "SUSH", // 授权对象
              "SUSC", // 授权对象类
              "PINF", // 包接口
              "ENHC", // 增强实现
              "ENHO", // 增强实现
              "ENHS", // 增强点
              "BADI", // BAdI 定义
              "BADII", // BAdI 实现
              "SAMC", // AMC 类
              "SAPC", // APC 类
              "SFSW", // 开关框架
              "SFBF", // 业务功能
              "SFBS", // 业务功能集
              "JOBD", // 作业定义
              "NROB", // 编号范围对象
              "SUSO", // 授权对象集
              "BDEF", // 行为定义
              "SRVB" // 服务绑定
            ]

      for (const type of searchTypes) {
        try {
          const searchResults = await client.searchObject(searchPattern, type)
          for (const result of searchResults.slice(0, maxResults)) {
            const objName = result["adtcore:name"]
            const objType = result["adtcore:type"]

            if (objName && objType) {
              const objectInfo: ABAPObjectInfo = {
                name: objName,
                type: objType,
                description: result["adtcore:description"] || "",
                package: result["adtcore:packageName"] || "",
                systemType: this.determineSystemType(objName),
                uri: result["adtcore:uri"] || ""
              }
              results.push(objectInfo)

              if (results.length >= maxResults) break
            }
          }

          if (results.length >= maxResults) break
        } catch (error) {
          // 跳过失败的类型
        }
      }

      return results
    } catch (error) {
      logSearch.error("Error searching objects", error)
      return []
    }
  }

  /**
   * 确定对象是标准还是自定义
   */
  private determineSystemType(name: string): "STANDARD" | "CUSTOM" {
    return name.startsWith("Z") || name.startsWith("Y") ? "CUSTOM" : "STANDARD"
  }
}

// 全局搜索实例
const search = new Map<string, searchService>()

export function getSearchService(connectionId: string): searchService {
  if (!search.has(connectionId)) {
    search.set(connectionId, new searchService(connectionId))
  }
  return search.get(connectionId)!
}
