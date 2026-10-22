# Minework 编辑器 RSI 记录

## 2026-10-22 — 列表与键盘

- **起点**：上一轮因目标目录没有 `.git` 停止。本轮仓库已恢复，工作区干净，切换 main 并 `git pull --ff-only`，基于 `ec48076` 新建 `rsi/2026-10-22-lists-keyboard`。本文件此前不存在，已回顾 `AGENTS.md` 与 `docs/block-editor-review.md`。没有未合并 PR，无需避让改动。
- **范围**：有序、无序、待办列表的 Enter、空项退出、两步 Backspace、Delete、Tab/Shift+Tab、Alt+↑/↓、撤销重做及编号起点；仅使用本地隔离编辑器。
- **发现与修复（1 项，结构错误）**：
  - 复现：创建 `甲 / 乙 / 丙` 三项列表，在 `甲` 末尾按 Delete。
  - 实际：`乙` 的列表标记消失，文字留在第一项的第二段；没有接到 `甲` 后。
  - 预期：第一项成为 `甲乙`，光标停在连接处，剩余项保持顺序；子列表、行内格式与当前项勾选状态保留，编号使用原列表起点。
  - 根因：默认 `joinForward` 只合并列表项外壳。共享 `BlockKeymap.deleteAtBlockEnd` 对同一列表的相邻项调用 ProseMirror `joinTextblockForward`，一次事务合并文字边界。范围限定为当前项的末段与同级下一项，避免跨列连接。
- **回归**：新增 `tests/rsi-keyboard.test.tsx` 共 9 项。先运行三类列表合并及多段列表合并的 4 项失败测试，再修复；覆盖子列表、粗体、完成状态、自定义编号起点、空项、多段内容、单次撤销/重做、Enter/缩进和列边界。
- **浏览器**：在忽略的 `.runtime/rsi/` 用 esbuild 打包真实 `BlockEditor.tsx`，mock `@/lib/user-context`，Tailwind 编译实际样式，静态服务绑定 `127.0.0.1:4317`。Playwright + Chromium 完成 19 个场景；按键间隔 60ms，Delete 及撤销重做另用 250ms 复核。页面拒绝外部网络请求，无登录与数据库连接。脚本 `verify.mjs`、截图及检查日志留在该忽略目录供下次复用。
- **验证**：`npm test` 144/144、`npm run typecheck`、`npm run build`、`git diff --check` 通过。新克隆使用 `npm ci` 并生成 Prisma Client，未新增依赖；API 测试沿用独立临时数据库，未触碰本地日志数据。
- **遗留 / 需要确认**：多段列表项不是最后一项时，在第二段按 Shift+Tab 当前会提升整个列表项及其段落。应仅提升当前段，还是保留整项提升，需产品确认；本轮不改。此前审查中的容器内分栏、图片插入焦点、菜单打开时 Ctrl+Enter 也未纳入本轮。
- **下次优先**：按轮换进入 **Markdown 输入**；重点覆盖中文 IME 组合提交与全角符号、列表项中的输入转换、输入规则撤销重做。若本 PR 尚未合并且涉及 `BlockKeymap`，避开重叠代码或转到复制粘贴方向，并记录原因。
