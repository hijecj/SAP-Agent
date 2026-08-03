# ABAP Cleaner 集成

ABAP Cleaner 自动格式化和清理 ABAP 代码——一步完成缩进修正、语法现代化和可配置的清理规则。

## 设置

ABAP Cleaner 需要其独立的命令行工具（`abap-cleanerc.exe`）。

1. 从 [github.com/SAP/abap-cleaner](https://github.com/SAP/abap-cleaner) 下载 ABAP Cleaner 并解压到文件夹。
2. 打开命令面板（`Ctrl+Shift+P`）并运行 **ABAP FS: Setup ABAP Cleaner Integration**。
3. 提示时输入 `abap-cleanerc.exe` 的路径。

## 清理代码

打开 ABAP 文件后，可以使用以下任一方法：

| 方法 | 操作 |
|---|---|
| 键盘快捷键 | `Ctrl+Shift+Alt+F` |
| 保存时格式化 | `Shift+Alt+F`（标准 VS Code 格式化——如果配置了 ABAP Cleaner 作为格式化器，会触发它） |
| 命令面板 | **ABAP FS: Clean ABAP Code with ABAP Cleaner** |
| 工具栏按钮 | 点击编辑器工具栏中的 Cleaner 按钮 |

只清理选中行：先选中代码，再触发命令。

## 它的作用

- 对文件应用所有已配置的 ABAP Cleaner 规则
- 如果配置了自定义清理配置文件，则遵守该配置
- 以你指定的 ABAP 版本为目标（避免使用你系统上不可用的语法）
- 报告应用了哪些规则以及修改了多少行

## 配置

在 VS Code 设置（`Ctrl+,`）中搜索 **ABAP Cleaner** 进行配置：

- **可执行文件路径** — `abap-cleanerc.exe` 的路径
- **配置文件** — 自定义清理配置文件（可选）
- **目标版本** — 目标 ABAP 版本（例如 `757`）
- **保存时清理** — 每次保存 ABAP 文件时自动清理
