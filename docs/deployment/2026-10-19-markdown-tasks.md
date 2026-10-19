# Markdown task-list paste — 2026-10-19

Pasting `- [ ]` / `- [x]` text previously preserved the markers as literal characters: Tiptap's task-item input rules do not parse a whole clipboard document. A dedicated paste extension now converts Markdown task lines into existing taskList/taskItem nodes, preserving checked state, order and literal task text. No new dependency or database migration is required.

The parser supports unchecked/checked/uppercase-X items, `-`/`*`/`+` markers, nested indentation, mixed paragraphs and CRLF input. Angle brackets and HTML-like text become text nodes without HTML interpretation. Pasting into an empty task item creates peers; column placement, selected-text replacement and single-step undo use the existing ProseMirror document model.

Image clipboard files, code destinations, fenced/indented code and structured/formatted native HTML use the original paste behavior. Generic browser paragraph wrappers around raw Markdown still convert. Existing saved plain text is left intact; users can refresh and re-paste it.

Validation: 75 tests pass, including seven-item conversion, checkbox counts/state, nesting, literal HTML, native rich clipboard preservation, code exclusions, selected-text replacement/undo, columns, clickable checkboxes, draft recovery and submission. Type checking and the production build pass. A browser test using the user's exact seven lines produced seven checkboxes with only the third checked and struck through; local fixture submission and reload retained the result. User-provided task text and the screenshot stay in the ignored local harness and are not included in committed fixtures or production log data.

Publish from the pushed revision, check candidate and public build metadata and editor bundle, preserve the current environment/database/proxy configuration, then preview/apply release cleanup after health and database integrity checks.
