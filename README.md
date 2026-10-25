# dsh-sidebar

Claude Desktop 风格的 DeepSeek Harness 右侧栏增强插件（纯插件，零宿主补丁、零原生功能删减）。

## 功能（v9）

- **单页、无标签、无全屏**：右栏不再显示「会话 / 文件 / 终端」等标签 chip，也不显示全屏按钮；原生 dockkit 标签条整条隐藏，用户一次只看到当前页面。
- **侧栏内新增「终端」分区**：与「进度 / 工作目录 / 上下文」同级、默认展开，显示「新建终端」行；点击打开原生终端页签。会话标题栏不再有终端按钮。
- **外层控制**：会话标题栏右侧是 **侧栏开关**（以及其它非文件宽栏页的 X）；侧栏开关独立负责右栏开/关，不承担关闭宽栏页的职责。
- **宽栏页的 X**：
  - 文件预览：X 位于「重新读取文件」工具栏行的**最右侧**（通过 `sidebar.right.tab.document.actions` 座位追加，在原生 reload 控件之后），关闭该文件预览页并回到上级；
  - 终端：X 以悬浮按钮形式放在**终端页面右上角**（React portal 到右侧栏面板），关闭终端页并回到上级；
  - 其它非文件宽栏页：会话标题栏右侧保留一个 X，关闭该宽栏页；
  - X 永不用来关闭侧栏；侧栏只由侧栏开关控制。
- **侧栏开关状态跨会话保持**：关闭侧栏后切换会话，侧栏仍是关闭的；打开侧栏后切换会话，侧栏仍是打开的。首次加载/重新加载默认关闭，不会自动打开；手动打开会落到本插件的会话页（进度 / 工作目录 / 终端 / 上下文）。
- **清理旧会话侧栏状态**：DSH 会把每个会话的侧栏布局持久化到 localStorage（`dsh.sidebar-right.v1.<sessionId>`，含 `layout.expanded`）。插件启动时会把所有这类旧布局的 `expanded` 重置为 `false`，切换会话时同步目标会话的持久化状态，并在切换后 1.5 秒内对“旧状态回弹”做一次保护性关闭/打开，避免打开会话时侧栏偶尔自己弹出。
- **固定窄栏**：会话页激活时右栏宽度固定（约 320–420px），**隐藏外层拖拽调宽手柄**，不能手动拉宽；原生预览页签激活时仍可使用宽栏。
- **省略号 + 悬停预览**：窄栏下任务文本、技能名、记忆标题、文件名、工作目录路径都单行省略，超出部分用 `…`；鼠标悬停通过 `title` 显示完整内容。
- **进度**：当前会话**最近一次有任务清单的轮次**的待办清单（不要求是最后一轮对话；后面又聊了几轮但没写任务，仍显示上一次有任务的清单）。完成项蓝色对勾 + 划线、进行中旋转指示、待处理空心圆；顶部有完成比例和细进度条。
- **工作目录**：与「进度」同级的可折叠分区，**默认展开**；文件样式按原生 Files 树重绘（目录优先、18px 层级缩进、5×10px 行、文件夹/文件图标、行 hover、名称省略）；点击文件直接打开原生文本预览，不再有右侧「在文件树中打开」按钮。
- **上下文**：
  - **技能**：本会话 skill 工具调用与显式 `/技能名` 使用统计（用会话技能目录过滤普通 slash 命令）。只显示用过的技能行和次数，没有「本会话 N 次 · M 个技能」摘要，也没有「仅统计模型工具调用」提示；
  - **记忆**：只显示**本会话创建或最后更新过**的主题（按 dsh-memory 列表项的 `source.sessionId` 匹配，跨会话写入的旧主题不出现），最多 4 条；上下文分区展开期间订阅 dsh-memory 的 `/api/dsh-memory/events` 变更事件，只有记忆库真的变化才重取（500ms 合并），平时不轮询；异步抽取产生的新主题保存后约 1 秒内出现，无需切换会话；无记忆时显示「本会话暂无记忆」；**去掉记忆 icon**，scope 标签保留在行首；
  - 技能行和记忆行都有整行 hover 反馈，hover 背景在分组卡片底色上进一步加深（`color-mix(..., black)`）。
- **任务数据不依赖 `todos` 投影**：`todos` 是 standing plan，下一轮 `turn/start` 会清空它。Host 半的 `dshSidebarTasks` 投影只保留当前会话最近一次非空 `todo/write`，永不被后续轮次清空；只显示当前会话，fork 前缀不计。
- **Skill 使用统计**：Host 半的 `dshSidebarSkillUsage` 投影折叠 `tool/call`（`name: 'skill'`）与用户首行 `/<name>` 手势；Client 用 `remote.skills.list` 过滤真正的用户可调用技能。DSH 没有原生统计 API，这是会话事件派生统计。
- **打开原生页签不再先窄后宽**：本插件触发的文件预览/终端打开会先同步把右栏设为宽栏，再打开页签。
- **原生功能保留**：文件预览、变更审查、终端、浏览器、计划、子代理、计划任务等原生页签仍可通过原生入口/快捷键打开；插件隐藏标签条，并为宽栏页提供 X 关闭返回。

## 实现要点

- 右栏页签类型、内容、标题通过 `ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` 注册。
- **Host 半**（[index.js](index.js)、[lib/tasks.js](lib/tasks.js)、[lib/skills.js](lib/skills.js)）：
  - `dshSidebarTasks`：`stateVersion: 1`、`wire.summary: false`、纯 JS `{ parse, safeParse }`；state `{ todos, time, inherited }`；`init` 记录 `inheritedEventCount`，fold 忽略 `seq < inherited` 的 `todo/write`；只对非空 `todo/write` 更新。
  - `dshSidebarSkillUsage`：`stateVersion: 1`、`wire.summary: false`；`{ calls, gestures, inherited }`；`tool/call` 的 skill 名和用户首行 `/技能名` 手势分别计数；fork 前缀忽略。
- **Client 半**（[client.js](client.js)）：
  - 座位标准 prop `useProjection('dshSidebarTasks')` / `useProjection('dshSidebarSkillUsage')` 读当前会话。
  - 工作目录树通过 `ctx.remote.workspaceFiles.list(sessionId, path, signal)` 懒加载；根传当前 cwd（或 `.`）；点击文件用 `dsh-resource://file/session/<id>/<相对路径>` 打开原生文本预览。
  - 技能目录通过 `ctx.remote.skills.list({ sessionId }, signal)` 读取。
  - 记忆主题读取 `/api/dsh-memory/state`，用列表项的 `source.sessionId` 只保留本会话创建或最后修改的主题；上下文分区展开时订阅 `/api/dsh-memory/events` 变更流，收到事件后 500ms 合并刷新；不可用时自动省略。
  - 侧栏开关注册在 `conversation.session.header.utilities`（order 110）；文件预览 X 注册在 `sidebar.right.tab.document.actions`；终端 X 由 `NativePageCloseOverlay` 通过 `ReactDOM.createPortal` 渲染到右侧栏面板右上角；其它非文件宽栏页的 X 在 header utilities（order 120）。所有 X 只关闭宽栏页，永不关闭侧栏。
  - 终端分区使用 `ctx.sidebarRight.openTab('terminal')`，打开前加宽并记录父 tab。
  - 侧栏开关状态：订阅 `ctx.sidebarRight.mounted`，首次挂载强制关闭；之后切换会话按上一个会话最后记录的开关状态应用（关闭仍关闭、打开仍打开），打开时用 `openTab(PAGE_KIND)` 落到本插件会话页。
  - 旧状态清理：启动时遍历 `dsh.sidebar-right.v1.*` 把 `layout.expanded` 写为 `false`；切换前把目标会话的持久化 `expanded` 写成期望值；切换后 1.5s 保护窗口内若实际状态与期望不符则再次纠正。
  - 宽度：`rightbarWidthFace(ctx)` 读私有 `layout.panels.setRightbar`；打开文件/终端前先加宽；会话页激活时用 CSS 隐藏外层 `[data-side='rightbar']` 调宽手柄。
  - 标签条整条隐藏：CSS 覆盖 `[data-dockkit-strip]`；原生 corner 展开按钮与全屏/收起控件不再显示。
  - 无 Host HTTP 路由、无 Host 存储、无 Harness 包导入；分区折叠状态只写浏览器 `localStorage`。

## 原生文件树与工作目录

DSH 的原生文件树是 `ui-sidebar-files` 注册的独立页签 body，**纯插件不能把它作为组件内嵌到另一个页面**。v6 按要求在侧栏内实现了一个**按原生 Files 树样式重绘**的工作目录树（同一套行高、层级缩进、图标、hover、名称省略），点击文件仍调用原生预览；这样既保留了当前栏内的直接浏览，又不复制原生文件预览实现。

## 安装与生效

```bash
# 本插件已通过 plugin_manager install_bundle 以本地目录（link）方式安装到 web profile。
# 修改 index.js / lib/ / client.js 后：重启 dsh web（Ctrl+C 后重新执行原启动命令），再刷新页面。
# 原因：DSH 只在 dsh web 启动时打包加载插件的 Client 模块，Host 投影也只在启动时注册。
```

## 验证清单

1. 右栏没有任何标签 chip、全屏按钮；会话标题栏右侧只有侧栏开关（以及其它宽栏页的 X）。
2. 侧栏内有独立的「终端」分区；点击「新建终端」打开终端。
3. 打开文件预览：X 在「重新读取文件」行最右侧；打开终端：X 在终端页面右上角；点击关闭并回到上级，都不关闭侧栏。
4. 侧栏只由侧栏开关开/关；关闭后切换会话仍关闭，打开后切换会话仍打开；首次加载默认关闭，打开旧会话时不再因历史布局弹出侧栏。
5. 会话页窄栏固定，不能拖拽调宽；原生预览页签仍可宽栏。
6. 「进度」显示当前会话最近有任务轮次的清单与进度条；任务文本单行省略，悬停看完整。
7. 「工作目录」与「进度」同级、默认展开；文件树按原生样式显示，点击文件打开原生预览；没有「在文件树中打开」按钮。
8. 打开文件/终端时侧栏直接是宽栏，不出现先窄后宽。
9. 「技能」只显示技能行和次数，没有汇总句或「仅统计模型工具调用」；每行 hover 背景明显加深。
10. 「记忆」只显示本会话创建或最后修改的主题；无记忆时显示「本会话暂无记忆」；面板展开后新保存的记忆保存后约 1 秒内出现，无需切换会话；没有 icon，scope 标签在行首；每行 hover 背景明显加深；
11. 输入框上方不再出现原生任务条；草稿纸不存在。

## 文件结构

- `index.js`：Host 半，注册 `dshSidebarTasks` / `dshSidebarSkillUsage`。
- `lib/tasks.js`：任务投影 fold。
- `lib/skills.js`：技能使用统计投影 fold。
- `client.js`：Web 半，分区页、工作目录树、终端分区、技能/记忆、外层侧栏开关与宽栏 X、宽度策略、开关状态保持、任务条遮蔽。
- `cordis.patch.yml`：bundle 补丁，仅插入本插件一行。
- `locale/`、`icon.svg`：插件管理页显示元数据。
- `test/`：纯函数与 Host 接线单元测试（`node --test`）。

## 边界

- 原生文件树无法作为组件内嵌；v6 用原生样式重绘并调用原生预览，属于「尽量接近原生」的纯插件方案。
- 自定义投影 key + `wire` 依赖 DSH 0.2.1-rc.3 的运行时行为（公共 TS 类型只允许 `SessionProjectionMap` 内 key 带 wire）；`engines.dsh` 已收紧到 `>=0.2.1-rc.3 <0.3.0`。
- 标签条隐藏、固定窄栏手柄隐藏、X/侧栏按钮依赖 dockkit 的稳定 `data-*` 锚点；升级 DSH 时若锚点变化，最坏情况是标签条/handle 重新出现，不影响原生功能。
- 宽度设置使用 layout 控制器的内部 `panels.setRightbar`（无公开宽度 API）；缺失时只降级宽度行为。
- 技能统计从会话事件派生，不是原生统计 API；手势只有取得技能目录时才计入。
- 记忆分组依赖本地 `dsh-memory` 插件；未安装时省略。归属会话取列表项的 `source.sessionId`（最后一次写入该主题的会话）：一个主题被后来的会话改写后会从旧会话的记忆栏消失，在设置页手工改写不会改变归属会话。实时刷新依赖 dsh-memory 的 `/api/dsh-memory/events` 变更流；旧版没有该路由时只在切换会话、重开分区或页面重新可见时刷新。
- 不改 deepseek-harness 源码、不禁用任何原生插件行。
