# Rich journal blocks — 2026-10-19

The slash picker now exposes 23 commands, adding images, HTML previews, tables, and tip/info/goal callouts to the previous 17 commands.

Images support local selection, pasted screenshots, file drops, remote URLs, captions, alternative text and width resizing. Raster files are embedded in the existing document JSON; static images are resized to at most 1800 pixels and 1 MB, with 8 MB input and 1 MB animated GIF limits. Asynchronous imports address identifiable placeholders, so moving the cursor or deleting a block cannot redirect an image to another location. Replacement errors retain the preceding image. Submission and version refresh wait for imports to finish; interrupted draft placeholders remain editable after reload.

HTML previews accept source edits and `.html` import, preserve source in the document, and render HTML/CSS/inline JavaScript inside an opaque `allow-scripts` iframe. An early CSP blocks external scripts, fetches, nested frames, forms and objects. The parent session and document are inaccessible. External images/media are allowed without a referrer. This supports self-contained UI examples, rather than applications requiring remote APIs or authenticated resources.

Tables use the existing Tiptap extensions with a contextual operation toolbar, row/column editing, header toggle, cell merge/split and horizontal overflow. Block handles address a complete table rather than its structural cells. Empty cell placeholders stay quiet. Existing drafts, columns, block dimensions and manual submission continue to apply; no database migration or new persistent filesystem mount is required.

Validation:

- 63 automated tests pass, covering all slash commands, file validation, asynchronous image placement/deletion, pasted screenshots, HTML/JSON round trips, table edits/merge/split, column movement, draft restoration, submission and isolated SQLite persistence.
- Fixed obsolete authentication and column geometry fixtures in the existing tests; no production authentication behavior changed.
- TypeScript checking and production Next.js build pass.
- Browser checks cover a real local PNG file selection, HTML source editing and button interaction, parent-document isolation, blocked network requests, and table insertion/tab navigation.

Release uses committed source and the existing environment, proxy and database mount. Candidate health and built-asset checks precede the swap; database integrity/counts and public version checks follow. After health is confirmed, preview and apply the established release cleanup, preserving the active source/image and independent database snapshots.
