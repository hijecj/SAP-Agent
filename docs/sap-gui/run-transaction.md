# 运行 SAP 事务

直接从 VS Code 执行 SAP 事务码，无需切换到 SAP GUI 窗口。

## 使用方法

1. 打开命令面板（`Ctrl+Shift+P`）
2. 运行 **ABAP Copilot: Run SAP Transaction**
3. 如果连接了多个系统，选择目标系统
4. 输入事务码（例如 `MM43`、`SE38`）
5. 按 `Enter`——事务在你配置的 GUI 中打开

## GUI 配置

在设置中按连接设置你偏好的 GUI 类型（`sapGui.guiType`）。

## 限制

- **原生 SAP GUI** — 仅 Windows
- **嵌入式 WebView** — 不支持 SSO；需要手动登录
- 某些事务在嵌入式模式下可能无法正常工作
