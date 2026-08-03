# 网页浏览器 SAP GUI

在默认网页浏览器中运行 SAP GUI（SAP WebGUI），打开当前活动的 ABAP 对象。当你需要以原生 SAP GUI 界面与对象交互、又不离开开发工作流时很有用。

## 前置条件

- 目标 SAP 系统必须启用 SAP WebGUI（不确定的话问问你的 Basis 团队）。

## 如何打开

在编辑器中打开 ABAP 文件后，可以使用以下任一方式：

| 方法 | 操作 |
|---|---|
| 键盘快捷键 | `Ctrl+Shift+F6` |
| 编辑器工具栏 | 点击**在浏览器 GUI 中打开**图标 |
| 命令面板 | `Ctrl+Shift+P` → `ABAP FS: Open SAP GUI in external web browser` |

对象在默认浏览器中打开。URL 可以复制并分享给有权访问同一系统的其他用户。
