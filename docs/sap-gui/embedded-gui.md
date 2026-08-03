# 嵌入式 SAP GUI（WebView）

直接在 VS Code 中运行 SAP GUI 事务——无需在窗口之间切换。SAP WebGUI 渲染在**WebView**中：一个托管在 VS Code 内部的嵌入式浏览器标签页。

## 打开嵌入式 SAP GUI

三种打开方式：

| 方法 | 操作 |
|--------|--------|
| 键盘快捷键 | **Ctrl+Shift+F7**（打开 ABAP 文件时） |
| 编辑器工具栏 | 点击编辑器工具栏中的**嵌入式 GUI**按钮 |
| 命令面板 | `ABAP FS: Open SAP GUI in embedded WebView` |

## 要求

- 你的 SAP 系统启用了 WebGUI
- 在 ABAP FS 设置中配置了连接

## 工作原理

默认情况下，扩展在 VS Code 的**集成浏览器**（Simple Browser）中打开 SAP GUI，而不是原始 iframe WebView。集成浏览器不把页面包裹在 iframe 中，这避免了下文描述的常见白屏问题。

## 白屏 / 点击劫持问题

如果你看到**空白白页**，说明你的 SAP 系统启用了点击劫持框架保护（`ClickjackingFramingProtection.js`）。这是 SAP 服务端安全功能，会阻止 SAP WebGUI 在 iframe 中加载——扩展无法覆盖它。

你也可能看到这些浏览器控制台错误：

- `ClickjackingFramingProtection.js: Ignored call to 'alert()'. The document is sandboxed`
- `Potential permissions policy violation: fullscreen is not allowed in this document`

**解决方案：** `abapfs.sapGui.useIntegratedBrowser` 设置**默认启用**，可以解决此问题。如果你之前禁用了它，请重新启用：

```json
{
  "abapfs.sapGui.useIntegratedBrowser": true
}
```

要回退到原始嵌入式 WebView（例如集成浏览器在你的环境中引起问题时）：

```json
{
  "abapfs.sapGui.useIntegratedBrowser": false
}
```

此设置适用于所有入口：工具栏按钮、命令面板和运行事务命令。

> **VS Code 提示：** VS Code 设置 `simpleBrowser.useIntegratedBrowser`（标记为实验性）控制 Simple Browser 是否使用 VS Code 内置浏览器引擎。启用它可能提高桌面端兼容性。这是 VS Code 设置，不是 ABAP FS 设置。
