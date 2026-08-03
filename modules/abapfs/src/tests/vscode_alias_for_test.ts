// 从 Visual Studio Code 复制，因为 jest 无法解析其 js 实现
// 目前找不到更好的解决方案
export enum FileType {
  /**
   * 文件类型未知。
   */
  Unknown = 0,
  /**
   * 常规文件。
   */
  File = 1,
  /**
   * 目录。
   */
  Directory = 2,
  /**
   * 指向文件的符号链接。
   */
  SymbolicLink = 64
}

export class FileSystemError extends Error {
  static FileNotADirectory(messageOrUri?: string) {
    return new Error(messageOrUri)
  }
}
