# 关键区别：命令 vs 工具

扩展暴露两种类型的功能：**命令**由你自己调用，**工具**由 GitHub Copilot 代表你调用。

## 命令——你调用它们

命令是你在 VS Code 中直接触发的离散操作。

**如何运行命令：**

- 用 `Ctrl+Shift+P` 打开命令面板并输入 `ABAP FS`
- 点击 VS Code 界面中的按钮（例如编辑器工具栏、资源管理器右键菜单）
- 使用键盘快捷键

**示例：**

| 命令 | 作用 |
|---|---|
| `ABAP FS: Create object` | 打开对话框创建新的 ABAP 对象 |
| `ABAP FS: Run ABAP Unit Tests` | 运行当前对象的单元测试 |
| `ABAP FS: Text Elements Manager` | 打开文本元素编辑器 |

## 语言模型工具——Copilot 调用它们

工具是扩展提供给 GitHub Copilot 的能力。你不直接调用它们——而是在 Copilot 聊天面板中描述需求，Copilot 自动选择并调用正确的工具。

**如何使用：**

- 打开 Copilot 聊天面板（`Ctrl+Alt+I`）
- 用自然语言提问

**示例：**

| 你输入的内容 | Copilot 调用的工具 |
|---|---|
| “BAPI_USER_GET_DETAIL 用在哪里？” | `find_where_used` |
| “给我看看 `ZCL_MY_CLASS` 的代码” | `get_abap_object_lines` |
| “对这个文件运行 ATC 检查” | `run_atc_analysis` |

> **刚接触 VS Code？** 直接操作请从命令开始。想探索或分析 SAP 对象但不知道具体步骤时，用 Copilot 聊天。
