// 定义者：Milan Burda <https://github.com/miniak>、Brendan Forster <https://github.com/shiftkey>、Hari Juturu <https://github.com/juturu>
// 改编自 DefinitelyTyped：https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/keytar/index.d.ts

/**
 * 获取服务和账户的已存储密码。
 *
 * @param service 字符串服务名。
 * @param account 字符串账户名。
 *
 * @returns 密码字符串的 Promise。
 */
export declare function getPassword(service: string, account: string): Promise<string | null>

/**
 * 把服务和账户的密码添加到钥匙串。
 *
 * @param service 字符串服务名。
 * @param account 字符串账户名。
 * @param password 字符串密码。
 *
 * @returns 设置密码完成的 Promise。
 */
export declare function setPassword(
  service: string,
  account: string,
  password: string
): Promise<void>

/**
 * 删除服务和账户的已存储密码。
 *
 * @param service 字符串服务名。
 * @param account 字符串账户名。
 *
 * @returns 删除状态的 Promise。成功时为 true。
 */
export declare function deletePassword(service: string, account: string): Promise<boolean>

/**
 * 在钥匙串中查找服务的密码。
 *
 * @param service 字符串服务名。
 *
 * @returns 密码字符串的 Promise。
 */
export declare function findPassword(service: string): Promise<string | null>

/**
 * 在钥匙串中查找 `service` 的所有账户和密码。
 *
 * @param service 字符串服务名。
 *
 * @returns 找到的凭证数组的 Promise。
 */
export declare function findCredentials(
  service: string
): Promise<{ account: string; password: string }[]>
