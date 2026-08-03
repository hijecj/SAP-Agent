# 原生桌面 SAP GUI

在本地安装的 SAP GUI 应用中直接打开当前活动的 ABAP 对象，让你无需离开 VS Code 工作流即可访问完整的事务界面。

## 要求

- 机器上安装了 Windows 版 SAP GUI
- 配置了到 SAP 系统的 ABAP FS 连接

## 如何打开

在编辑器中打开 ABAP 文件后，可以使用以下任一方法：

| 方法 | 操作 |
|---|---|
| 键盘快捷键 | `Ctrl+Shift+F5` |
| 编辑器工具栏 | 点击**在 SAP GUI 中打开**图标 |
| 命令面板 | `Ctrl+Shift+P` → `ABAP FS: Open in native SAP GUI desktop application` |

## 何时使用

在以下情况优先使用原生 SAP GUI：

- 浏览器版 GUI 中没有的事务
- 复杂或数据密集型界面需要更好的性能
- 需要完整的 SAP GUI 功能（例如 ALV 网格、自定义控件、脚本）
