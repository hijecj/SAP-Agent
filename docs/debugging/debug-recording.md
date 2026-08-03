# 调试录制与回放

> ⚠️ **测试版功能** — 如有问题请报告。

录制实时 ABAP 调试会话并离线回放——前进和后退都可以——就像 DVR。回放时无需 SAP 连接。

**什么时候有用？**

- 你步进得太远，想不重启就回去
- 你想和同事分享 bug 复现过程
- 你需要按自己的节奏分析复杂的执行路径

---

## 录制会话

> 每步比正常慢约 1–3 秒，因为扩展要在 SAP 丢弃数据前捕获所有变量数据。

1. 照常启动调试会话（设置断点、附加到用户/终端）
2. 打开命令面板（`Ctrl+Shift+P`）→ **ABAP FS: Start Debug Recording**
3. 正常单步执行——每一步都会被捕获
4. `Ctrl+Shift+P` → **ABAP FS: Stop Debug Recording**
5. 在提示时选择**保存**（纯 `.abaprecord`）或**压缩并保存**（`.abaprecord.gz`，约小 80–95%）

**每步捕获的内容：**

- 带源码引用的完整调用栈
- 所有作用域的变量（局部、全局、SY）——结构展开，表最多 2,000 行
- 供离线查看的源文件内容

---

## 回放录制

1. `Ctrl+Shift+P` → **ABAP FS: Replay Debug Recording**
2. 选择 `.abaprecord` 或 `.abaprecord.gz` 文件——两者都会自动处理
3. 回放会话打开，显示与录制时完全相同的代码、栈和变量

**回放控制：**

| 操作 | 快捷键 |
|--------|----------|
| 前进（下一个快照） | `F7`、`F10` 或 `F11` |
| 后退（上一个快照） | `Shift+F7` 或 `Shift+F11` |
| 跳到末尾 | `F5`（继续） |
| 跳到开头 | 反向继续 |
| 关闭会话 | 终止 |

> 在回放模式下，三个单步按钮（跳过/进入/返回）作用相同：移动到下一个录制的快照。

你可以检查变量、展开结构、浏览表行、求值表达式、悬停查看变量——全部无需 SAP 连接。

---

## 压缩

大型会话可能产生几十 MB 的文件。使用 gzip 减小存储和共享大小。

| 命令 | 描述 |
|---------|-------------|
| **ABAP FS: Compress Debug Recording** | 压缩现有 `.abaprecord` → `.abaprecord.gz` |
| **ABAP FS: Decompress Debug Recording** | 将 `.abaprecord.gz` 转回纯 JSON |

压缩后扩展会显示体积缩减（例如 *42 MB → 3.2 MB，小 92%*）。两种格式完全可互换。

---

## 全部命令

| 命令 | 描述 |
|---------|-------------|
| `ABAP FS: Start Debug Recording` | 开始录制活动调试会话 |
| `ABAP FS: Stop Debug Recording` | 停止并保存（纯格式或压缩格式） |
| `ABAP FS: Replay Debug Recording` | 打开并回放录制文件 |
| `ABAP FS: Compress Debug Recording` | 压缩现有 `.abaprecord` 文件 |
| `ABAP FS: Decompress Debug Recording` | 解压 `.abaprecord.gz` 文件 |

---

## 限制

| 限制 | 详情 |
|------------|--------|
| 表行 | 只捕获前 2,000 行；其余跳过（回放中会标记） |
| 变量深度 | 超过 4 层的结构/表不展开 |
| 源码不可用 | 录制时缓存失败则显示 `[source unavailable]` |
| 无条件断点 | 回放只能按录制内容步进 |
| 步进速度 | 录制时每步约 1–3 秒（变量捕获开销） |
