# Minework（工作日志系统）

> 🚀 **专为 Feedmob 团队量身打造的“Notion 蒸馏版”极简工作日志与团队时序聚合大盘。**  
> 以块编辑和团队日志为中心，支持本地 SQLite 存储。

线上地址：[minework.techmob.net](https://minework.techmob.net/)。采用 FeedMob 图标的像素风格品牌标识，支持 FeedMob Google 账号登录。

---

## ✨ 核心特性

- ⚡ **Block 沉浸式键盘流**：
  - `/` 斜杠指令面板（支持拼音/英文实时搜索过滤，按 Escape / Backspace / 点击外部自动关闭）。
  - **原子 Block 体系**：标题、正文、☑️ 待办事项 (Task List)、⚠️ 卡点阻塞高亮块 (Blocker Callout)、📊 Mermaid 架构流程图、🎨 交互草图白板 (Whiteboard)、🔗 Figma/视频/网页嵌入。
  - **就近出现的块操作手柄**：悬浮左侧 `+` 快速加块（支持 Alt 上插）与 `⠿` 6点拖拽手柄。
  - **🔲 双栏/多栏同行并排 (Multi-column)**：支持将两个或多个 Block 并排在同一行显示。竖线表示左右新增列，列内横线表示上下插入，整行上/下的全宽横线可将块拖回普通行。每列有独立手柄，落点配有高亮和说明。
  - **键盘极速移动**：光标停留在任意块内，按下 `Alt + ↑` / `Alt + ↓` 即可上下移动 Block，`Ctrl + Enter` 一键提交。
- 🌊 **团队时序大盘 (Team Stream Feed)**：
  - 一屏聚合各业务研发小组每日日志卡片，高亮 Blocker 阻碍点。
  - 支持表情签阅（👍 👀 🚀 🎯 ❤️）与单层即时协作评论。
- 📅 **时间线与日历 (Timeline & Calendar)**：
  - 月度打卡网格与人员头像聚合，点击任意日期快速定位、补填与回溯。
- 🏷️ **项目与标签透视 (Tag Matrix)**：
  - 跨人员、跨周期一键透视特定项目（如 `#TikTok-Campaign`、`#Auth-Refactor`）的历史推进脉络。
- 📋 **一键聚合周报 (Weekly Summary Generator)**：
  - 按时间跨度与部门一键抽取全员日志生成标准 Markdown 周报，支持一键复制与 `.md` 文件下载。

---

## 🛠️ 技术栈

- **前端框架**：Next.js 15 (React 19 + App Router) + TypeScript + Tailwind CSS
- **编辑器内核**：Tiptap (ProseMirror 工业级基座)
- **图表与白板**：Mermaid.js + HTML5 Canvas
- **数据与存储**：Prisma ORM + SQLite (开发/单机零配置，支持一键切 PostgreSQL)

---

## 🚀 快速启动

### 1. 安装依赖与初始化数据库
```bash
# 进入项目目录
cd Feedmob_Note

# 安装依赖
npm ci

# 初始化 SQLite 数据库并写入种子数据
npm run db:push
npm run db:seed
```

### 2. 启动开发服务器
```bash
npm run dev
```
打开浏览器访问 [http://localhost:3000](http://localhost:3000) 即可开始使用。

### 3. 生产打包与构建
```bash
npm run build
npm run start
```

---

## 📁 目录结构

```text
feedmob_note/
├── prisma/
│   ├── schema.prisma              # 数据库模型 (User / Team / WorkLog / Tag / Comment / Reaction)
│   └── seed.js                    # 示例数据脚本
├── src/
│   ├── app/                       # Next.js App Router 路由与页面
│   ├── components/
│   │   ├── editor/                # Tiptap Block 编辑器与扩展
│   │   ├── views/                 # 多维投影组件 (StreamFeed, CalendarView, TagMatrixView)
│   │   └── layout/                # Navbar 与 Sidebar
│   ├── lib/                       # Prisma 单例与用户上下文
│   └── types/                     # TypeScript 类型定义
└── docs/research/                 # Notion 深度评测与蒸馏架构报告
```


## 2026-10-13：Notion 交互与 UI 蒸馏

保留 Tiptap / ProseMirror 内核和现有日志 JSON，统一了纸面正文、温和侧栏、菜单、排版和焦点样式。调研过程及实际 REA 证据见 [Notion REA 蒸馏报告](docs/research/05_Notion_REA蒸馏.md)。2026-10-19 进一步通过真实 Notion 七项待办复制实验及公开分包的 REA 静态分析，落实了 [单编辑器与剪贴板改进方案](docs/research/07_Notion_clipboard_and_single_editor.md)：保留一个连续编辑界面，统一复制、粘贴与空行规则，Markdown 作为交换格式。

- `/` 搜索文本、标题、待办、折叠等 17 种块命令；菜单按用途分组。
- `Esc` 选中整块；`Shift + ↑/↓` 扩展同级块选区；`Cmd/Ctrl + D` 批量复制；`Alt + ↑/↓` 整组移动；`Backspace/Delete` 批量删除。每次操作可以单独撤销。
- `/toggle` 添加折叠块，富文本标题与正文一起保存。收起时光标不会留在隐藏正文里；标题回车会展开。
- `Cmd/Ctrl + /` 打开当前块菜单。手机底部也有“块操作”入口。
- 选中文字后可格式化或设置链接；链接面板会验证地址并保留选区。
- 页面选项包含标准/全宽、模板与撤销；标题自动换行；日历链接可以打开对应日期。
- 草稿保存在此浏览器，点击“提交工作日志”或 `Cmd/Ctrl + Enter` 才提交到服务端。

多块鼠标框选/整组拖动、数据库块和多人同步仍未实现。当前多块选择通过键盘操作，拖动针对单块。

验证命令：`npm run typecheck`、`npm test`、`npm run build`。开发初始化 `npm run db:push` 会预创建 SQLite 文件（已有文件不会被截断）；`db:seed` 会清空数据库，仅用于首次初始化或明确重置。


## 2026-10-16：独立分栏与区块尺寸

- 每列按自己的内容向下堆叠，列末尾的“＋ 添加区块”会在当前列继续编辑。短列下方的空白也可以点击或接收拖入的区块。整行之后的正文仍排在最高列下方。
- 悬停列间空隙，拖动竖线调整相邻列宽；双击均分。聚焦竖线后，可用左右方向键微调、Home 均分。手机按列顺序纵向显示。
- 嵌入内容、Mermaid 图表和白板支持两侧调宽、右下角调宽高；书签只调宽。聚焦尺寸手柄后，方向键微调，Home 或双击右下角恢复默认。
- 尺寸保存在日志 JSON 和本地草稿中；一次拖动只产生一次可撤销的修改，Escape 取消当前拖动。文字块的高度由内容和列宽自然决定。

设计依据：Notion 的 [分栏说明](https://www.notion.com/help/columns-headings-and-dividers) 与 [媒体尺寸说明](https://www.notion.com/help/images-files-and-media)。


## 发布产物保留策略

代码先 commit 并 push，发布成功后，服务器仅保留当前运行的 Minework 镜像与对应源码目录。旧回退容器、旧镜像、旧源码、上传包和构建备份均清理；恢复历史版本时从 Git 中重建。仅保留正在使用的日志数据库原件、当前运行配置和必要的代理/TLS 配置。按 2026-10-19 再次确认的要求，历史备份全部删除，包括 `backups/` 和 `database-backups/` 中的数据库快照；不再把快照转移到其他目录保留。凭据与业务数据不进入 Git，同机其他项目不属于此清理范围。

将 [清理脚本](scripts/cleanup-releases.py) 放到服务器 `/home/ubuntu/workweave/cleanup-releases.py`：

```bash
# 先查看计划
python3 /home/ubuntu/workweave/cleanup-releases.py --prune-build-cache

# 发布完成、确认当前服务正常后执行
sudo python3 /home/ubuntu/workweave/cleanup-releases.py --apply --prune-build-cache
```

每次发布健康验证通过后必须清理，并复查项目目录只剩 `data/`、当前版本的 `releases/<version>/`、`workweave.env` 和当前清理脚本；临时审计/发布脚本用完即删，还要核查旧部署系统留下的同项目实例。清理后验证数据库完整性和公开版本接口。此规则同时写在 [AGENTS.md](AGENTS.md) 中。

`--prune-build-cache` 可清理 Docker 共享构建器中未使用的构建缓存，不删除其他应用的镜像、容器或数据卷。下一次构建可能需要重新下载依赖。

## 网站版本更新提示

页面每分钟及切回标签页时检查新版本。有更新时显示“Minework 有新版本”，点击“刷新更新”会先保存本地草稿再刷新；正在提交、使用输入法或草稿无法写入时会提示稍后处理。首次启用此功能时，已有标签页需先手动刷新一次。

## 登录身份与管理员

Google 登录后固定本人身份，只能修改自己的日志、个人资料，并以本人身份评论或签阅。其他成员的日志通过团队动态、日历等入口查看。

管理员可从侧栏或右上角账号菜单进入 `/admin` 管理面板，管理成员资料、角色、所属团队以及团队信息。管理权限由后端校验，管理员也不能冒用他人提交日志。角色变更在后续请求中即时生效；不能移除自己的管理员权限或最后一位公司管理员。

## Minework MCP

账号菜单 → **MCP 连接**（`/settings/mcp`），生成个人密钥并选择权限，有效期 7 / 30 / 90 天，最多 10 个有效密钥。明文只返回一次，数据库只保存 SHA-256 摘要；可随时撤销。

- 地址：`https://minework.techmob.net/mcp`
- 传输：Streamable HTTP（无状态，JSON 响应；不保留 SSE 会话）
- 认证：`Authorization: Bearer <个人密钥>`，每次请求校验所属账号、撤销和到期状态。
- 当前为个人密钥认证，适用于支持认证请求头的 MCP 客户端；尚未实现 OAuth 授权服务器，不适用于只支持浏览器 OAuth 的连接入口。
- SDK：官方 TypeScript SDK v1 维护分支，协议协商由 SDK 处理。[官方传输文档](https://ts.sdk.modelcontextprotocol.io/index.html)。

| 权限 | 工具 |
| --- | --- |
| 所有密钥 | `whoami` |
| `logs:read` | `get_my_log`, `list_my_logs`, `list_tags` |
| `logs:write` | `append_my_log`（自动附带本人读取权限） |
| `team:read` | `team_feed`（与网站团队动态可见范围一致） |
| `tags:write` | `set_my_log_tags`, `list_tags`（自动附带本人读取权限） |

写入只能操作密钥所属账号。先 `get_my_log(date)` 取得 `revision`，再把它作为写工具的 `expectedRevision`；不存在的日志返回 `missing`。追加工具保留原有文档区块，只增加纯文本段落；遇到版本冲突或超时，先重读核对上次操作是否成功，避免重复追加。标签工具设置完整标签列表，不改动其他成员或全局标签颜色。

MCP 读取的是已提交版本，不含浏览器本地草稿。AI 追加会立即提交；回到网页前请核对旧草稿，避免后续网页提交覆盖 AI 新记录。

Codex 的 `config.toml` 示例（真实密钥通过启动进程环境变量提供，不提交 Git）：

```toml
[mcp_servers.minework]
url = "https://minework.techmob.net/mcp"
bearer_token_env_var = "MINEWORK_MCP_TOKEN"
```

已有数据库发布时，使用新镜像在当前数据库挂载下执行 `node scripts/migrate-mcp.mjs`。该脚本仅添加 `McpToken` 表及索引，可重复执行，不清空日志或用户。新开发环境也可使用 `npm run db:push`；不要在生产执行 seed。


## 2026-10-19：图片、HTML 预览与表格

斜杠菜单由 17 项扩展到 23 项，可按中文、英文或拼音搜索：

- `/图片`、`/image`：选择本地图片、粘贴截图、拖入文件或添加图片链接。支持 PNG / JPG / WebP / GIF、说明文字、替代文字及拖动调宽；选择新文件会替换当前图片。静态大图自动压缩到最长边 1800 像素、最多 1 MB，原文件最多 8 MB；GIF 最多 1 MB 并保留动画。图片内嵌在日志 JSON 中，无需新增上传目录或数据库迁移。
- `/html`：直接粘贴 HTML 源码或导入 `.html` 文件（最多 512 KB），在日志中实时预览 HTML、CSS 和内联 JavaScript；支持说明及调宽高。预览使用隔离 iframe，不能读取登录信息或父页面，也不能执行外部脚本、发起网络请求、嵌套页面或提交表单。需要远程 CDN、登录态或后端接口的完整网站不适用于此预览。
- `/表格`、`/table`：三行三列起步，首行为表头；在表格内显示操作栏，可增删行列、切换表头、合并/拆分单元格及删除表格。Tab 在单元格间移动，表格手柄拖动整个表格。
- `/提示`、`/说明`、`/目标`：直接插入对应类型的高亮块。

新块沿用本地草稿、手动提交、撤销、分栏和尺寸保存机制。图片处理中会暂缓提交和版本刷新；中断后重新打开可继续选择文件。多张图片占满浏览器草稿空间时会沿用现有的保存错误提示，请及时提交到服务器。团队动态卡片仍显示文本摘要，其中包含图片说明和 HTML 标题。

验证：65 项测试通过，覆盖文件类型、异步图片定位/删除、粘贴、JSON/HTML 往返、表格操作、分栏、草稿恢复及数据库提交；同时运行类型检查、生产构建和浏览器实际交互检查。

## 2026-10-19：粘贴 Markdown 待办列表

粘贴 `- [ ] 待办`、`- [x] 已完成`（也支持大写 `X`、`*` / `+` 列表符号、缩进子任务）会自动生成可勾选的待办块，保留顺序和完成状态。可与普通段落混合粘贴，在分栏中仍留在当前列；粘贴进空待办时会生成同级任务。转换可整体撤销，保存与草稿恢复均保留勾选状态。

此前只有输入规则和原生富文本粘贴，没有 Markdown 待办的整段粘贴解析，因此这些符号会显示为原文。旧日志中的纯文本不会自动改写，刷新到新版后重新粘贴即可转换。后续的统一剪贴板实现见下文。

## 2026-10-19：统一复制粘贴与单编辑器

- 复制任务列表时每项一行，保留 `- [ ]` / `- [x]` 和子任务缩进，修复每项之间额外出现三行空白的问题。任务之间的 Markdown 分隔空行不再生成空段落；正文、任务内换行和代码内容分别保留。
- 从 Notion 复制待办直接粘贴，可恢复复选框及勾选状态，同时保留加粗、链接等格式。内部富文本复制沿用 ProseMirror 切片，保留图片、HTML、分栏属性和选区边界；剪切和撤销继续使用编辑器原生机制。
- 输入 `- [ ] `、`- [x] ` 或 `[X] ` 后直接转换为任务；已有普通列表只转换正在输入的项目，不改变相邻项目。Enter 新建任务，空任务 Enter 退出；Shift+Enter 块内换行；Tab / Shift+Tab 调整层级。
- 整段粘贴同时支持常用 Markdown 标题、普通/有序列表、引用、代码围栏、表格、加粗、斜体、删除线和链接。Markdown 中的 HTML 保持文字，执行 HTML 仍需显式插入隔离预览块。代码块内粘贴不做 Markdown 转换。
- 日志依然使用同一份 JSON 和同一个编辑界面；提交时的文本摘要使用语义序列化，包含任务状态。标准 Markdown 对外交换不承诺完整保存白板、分栏宽度等自定义信息，内部富文本复制保留这些信息。

验证：85 项自动化测试、类型检查和生产构建通过。Chrome 中实际执行七项待办连续三轮复制粘贴，每轮均为七项、第三项完成、零空段落；复制到纯文本区域恰好七行，剪切后一次撤销恢复全部七项。保留已有日志内容，不批量删除历史空段落。
