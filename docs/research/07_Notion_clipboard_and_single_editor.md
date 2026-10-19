# Notion 剪贴板实测与 Minework 单编辑器方案

日期：2026-10-19。状态：调研方案已实现，见文末的实现与验证记录。

## 决策

保留现有 Tiptap / ProseMirror 编辑器和日志 JSON 文档，提供一个连续编辑界面。Markdown 是输入、复制和导出的交换格式；解决本次问题不需要增加源码模式，也不需要更换编辑内核。

此前提议的“可视化 + Markdown 源码双模式”不作为本次方案。后续若需要源码模式，应作为另行提出的高级功能，而不是正常编辑的前置条件。

## 证据与边界

### A. 真实 Notion 七条待办复制实验（浏览器观察）

通过 computer-use 读取用户已打开的 Notion 页面，选中用户给出的七条待办并执行复制，没有修改、创建或删除 Notion 正文。剪贴板同时出现：

| MIME | 实际内容 | 作用 |
| --- | --- | --- |
| `text/_notion-blocks-v3-production` | `blocks`、`blockSubtree`、`type: "to_do"`、`properties.title`；第三项带 `properties.checked: [["Yes"]]` | 提供结构、顺序和勾选状态 |
| `text/_notion-page-source-production` | 来源页面引用 | 来源信息 |
| `text/plain` | 七条 Markdown 待办，第三条为 `- [x]`，其余为 `- [ ]` | 供普通文本目标使用 |
| `text/html` | 一个 `ul` 下的七个 `li`，每项文字开头为 `[ ]` 或 `[x]` | 供富文本目标使用 |

实测纯文本项间是一个 `\n`，共六个分隔，没有前置空行和空白段落。`[ ]` 后有两个空格，这不影响任务语义。HTML 不是直接复制屏幕上的可编辑 `div`，而是重新生成的列表格式。

只记录以上最小结构，不把剪贴板中的用户 ID、空间 ID、业务页面引用或完整内部数据写入 Git。浏览器观察不是 REA Evidence，不能冒充 REA 运行跟踪。

### B. REA 对公开 Notion 分包的静态分析

当前页面 DOM 显示加载 `app-35e5420b406cfb21.js`。从该公开文件的分包名称和哈希映射定位并下载以下公开脚本，没有传递登录 Cookie，也没有执行第三方脚本：

- `clipboard-856cc32bc4cba534.js`
- `clipboardActions-2ec5caa54b1148de.js`
- `largeExternalPasteSplit-ec9c95fcc87cf61d.js`
- `notion-markdown-vnext-40dab90d8078cc60.js`

REA 输入：`.runtime/research/notion-clipboard-bundles/focused/`。

| Evidence ID | 内容 |
| --- | --- |
| `ev_03f6b5b961e8d59744a8e85a2c3df92d6572a621a073e6cc3ead743f3b7c9fe0` | 四个文件的完整静态分析，50,160 字节、47 个模块、零解析失败 |
| `ev_f9637674160c231278ee1114a5db2a1a1533e1546d20407f1db8f627ec1963e6` | 上述分析摘要 |
| `ev_64409570383c8e2b982efa8e1ae4d5b649a232f85a9afd1a343d3f6a777d4f19` | clipboard 文件身份核验，SHA-256 `9c6af761217e986bf937345d9b4969624a0318b573a144de9ec39f597edac811` |
| `ev_d7bda6969fde7a78be803d49ed095c882a02261c05b935d88f643075e9bde3b9` | 同一文件的源模块定位 |

人工核对 REA 标识的原始文件：clipboard 的模块 `488391` 导出 `copyHtml`、`copyString`，接收 `htmlValue`、`stringValue`，构建 `text/plain` 和可选的 `text/html`，通过 ClipboardItem 写入；不可用时回退至 writeText 或手动复制窗口。这证明该辅助函数专门生成不同的剪贴板格式，但没有证明本次块复制调用了这个辅助函数。

largeExternalPasteSplit 的模块 `324716` 接受 `operations`、`rootContentIds`、`transaction`，按块分割过大的外部粘贴，并给事务设置同一 `undoCheckpoint`。这说明存在把粘贴结果作为块操作处理的路径；仅凭静态代码不能证明普通七项粘贴一定经过此分包。

限制：四个分包不是全部编辑器。REA 的应用清单在输入范围内完整，语义关系仍部分未知；`text/plain` literal 和 `writeText` property 的语义追踪未匹配节点，不能据此声称运行路径已追通。Notion 内部粘贴优先级、全部导入规则和撤销实现尚未完整恢复。上述 A 的实际剪贴板结果比对内部调用关系的猜测更直接。

REA 可复核证据包：`.runtime/research/notion-clipboard-evidence-20261019.json`，保留在被 Git 忽略的本地研究目录。旧调研证据从原有 notion-drag-evidence.json 导入复用。

### C. Minework 问题复现（本地代码实验）

运行 `npx tsx .runtime/spacing-diagnose.ts`，三个任务的复制纯文本实际为：

```json
"\n\n\n\n任务 A\n\n\n\n任务 B\n\n\n\n任务 C"
```

Tiptap 默认 `getTextBetween` 给多个结构层级重复添加 `\n\n`；taskItem 和内部 paragraph 的分隔叠加，导致四个换行，也就是三行空白，同时丢失复选标记。`editor.getText()` 的结果相同。

`parseMarkdownTasks` 把 `- [ ] A\n\n- [x] B\n\n- [ ] C` 转为 taskList、空 paragraph、taskList、空 paragraph、taskList。空行被变成了实际内容，不能通过调小 CSS 行距根治。

还有一个互操作问题：Notion 的 HTML 是 `ul/li`，勾选信息在 `[x]` 文本前缀中。当前 MarkdownTaskPaste 遇到富文本列表就交回原生解析，因此不能只修纯文本路径，还需要覆盖这种实际 Notion HTML 样本。

## 实施顺序

### 1. 先统一复制与粘贴

新增一个剪贴板适配层，普通文字选择与块选择共用转换规则；继续由 ProseMirror 处理文档和选区。

- 复制：从选区的文档结构生成语义文本，连续任务每项一行，保留 `[ ]` / `[x]`、嵌套缩进、行内换行和文字格式的合理降级。不得遍历每个容器都加分隔。
- 同时提供标准 HTML；内部复制使用 ProseMirror 的切片元信息，并按需要增加带版本的 Minework 数据，保存图片、HTML、分栏等块的结构。自定义 MIME 受环境限制时仍能通过 HTML 和纯文本粘贴。
- 粘贴优先恢复可识别的内部切片；普通网页 HTML 按结构解析；对已确认的 Notion 待办 HTML 识别 li 开头的 `[ ]` / `[x]`，移除标记并保留后续行内格式。不能因纯文本出现待办符号而丢掉整个 HTML 的表格、图片或链接。
- 纯文本任务解析采用列表的空行规则：同级相邻任务间的分隔空行不创建空任务或空段落；正文段落、任务内续行、代码块和用户明确插入的内容换行分别处理。不能全局删除空行。
- 部分文字选择继续只复制所选文字，不能把整条任务或文档一起带出。代码区域保留原文。
- 普通复制与块选择复制必须一致；剪切在写入成功后再删除选区；一次粘贴保持一次可理解的撤销操作。

### 2. 统一单编辑界面的键盘行为

采用一个文档和同一条撤销历史。先检查现有 Tiptap 行为，再只补缺失项：

- Enter 新建同级任务；空任务 Enter 退出列表。
- Shift+Enter 在当前任务内换行。
- Tab / Shift+Tab 调整任务层级。
- Backspace 在任务开头按上下文合并或退出，避免残留空容器。
- 输入和整段粘贴的 Markdown 最终生成相同的块类型；中文输入法组词期间不抢快捷键。

### 3. 再扩充 Markdown 交换能力

按常用程度覆盖标题、普通列表、有序列表、引用、链接、代码围栏和表格。在同一编辑界面里输入后直接显示为对应内容，不增加必须切换的 Markdown 编辑器。

日志 JSON 仍是完整数据来源。标准 Markdown 无法无损表示分栏宽度、白板、HTML 预览等所有自定义块；这些节点的内部复制应走结构化路径，对外纯文本做明确、可用的降级。

## 验收

1. 用户的七条待办：粘贴后恰好七个任务，第三项勾选，没有夹在任务间的空段落。
2. 完成“复制 → 粘贴”连续三轮，每轮任务数量、顺序、完成状态、嵌套关系不变，间距不增长。
3. 复制到纯文本目标：七行、六个分隔换行、无前后多余空行，第三项仍为 `- [x]`。
4. 分别用真实 Notion HTML 样本、纯 Markdown、Windows CRLF、同级任务间空行和嵌套任务验证。
5. 普通段落、代码、任务内 Shift+Enter、部分文字选择、带链接/加粗的任务、图片和表格不被任务解析破坏。
6. 普通选区与块选择两条路径均通过；粘贴、剪切的撤销/重做以及保存后重开保持正确。

已有日志中的空段落不能直接全库删除，无法仅凭它们判断用户是否有意留白。先保证新编辑不再制造空行；历史内容按明确可识别的规则单独处理。

## 实现与验证记录

用户确认方案后，已实现：

- `EditorClipboard.ts` 统一处理语义纯文本复制、Notion/GFM 待办 HTML、Markdown 导入、内部切片以及空任务粘贴。已解析的内容跳过二次正则格式转换，避免把原样星号再次解释成斜体。
- `utils/clipboard.ts` 按内容结构生成任务、段落、嵌套列表、标题、引用、代码和表格文本；`utils/markdown.ts` 使用显式依赖 markdown-it，关闭 Markdown 原始 HTML 执行；删除旧的独立任务逐行解析器。
- 内部 HTML 沿用 ProseMirror 原生 `data-pm-slice` 和节点属性，不另造一份文档或一套历史。图片、HTML 源码和分栏宽度的内部复制均验证保持不变。
- `TaskItem.ts` 补充逐字输入复选标记的转换，支持大写 X；必要时拆分普通列表，只转换当前项。Enter、Shift+Enter、Tab、Shift+Tab、Backspace 沿用已验证的原生行为。
- 提交的 `contentText` 使用语义序列化，JSON 仍是完整文档来源，没有数据库迁移或历史内容清洗。

85 项自动化测试、类型检查、生产构建通过。Chrome 使用完整 BlockEditor 本地测试页验证实际剪贴板：七条待办从带空行文本导入后，连续三轮复制粘贴，每轮复选框 7、完成项 1、空段落 0，复制纯文本的六处分隔均为一个换行；真实剪切后一次撤销恢复七条。测试截图保存在本地忽略目录 `.runtime/editor-clipboard-browser.png`，测试页未向生产数据库写入内容。

发布按 AGENTS.md 的现行提交、推送、健康检查和仅保留当前构件规则执行；构建版本由提交 SHA 标识。
