# Minework deployment

- Commit and push authorized code changes before publishing a release.
- User preference (reconfirmed 2026-10-19): after a successful release, keep only the active application image and source release. Remove stopped Minework rollback/check containers, old application images, old source releases, transfer archives, temporary deployment scripts and build/configuration backups. Keep only the latest healthy running version. Do not retain historical copies of any kind, including database snapshots in `backups/` or `database-backups/`; do not relocate backups to evade cleanup.
- Preserve the active container, its bind-mounted database, current environment file and live proxy/TLS configuration. The live database is original runtime data, not a backup, and must never be deleted. Proxy/TLS files and other applications on this shared server are outside this project cleanup scope.
- Run `scripts/cleanup-releases.py --prune-build-cache` on the server to preview cleanup, inspect the plan, then use `sudo python3 /home/ubuntu/workweave/cleanup-releases.py --apply --prune-build-cache` after the new version is healthy. Inspect `/home/ubuntu/workweave` after cleanup: it should contain only `data/`, the active `releases/<version>/`, `workweave.env`, and the current reusable cleanup script. Remove temporary audit/deploy scripts after use, and check for legacy deployments outside the normal naming scheme. Some historical configuration backup directories are root-owned. The script targets `/home/ubuntu/workweave` and derives the active version from the running `workweave` container.
- `--prune-build-cache` additionally clears unused cache in the shared Docker builder. It never prunes volumes or unrelated application images/containers. Subsequent builds may need to download dependencies again.
- This latest policy supersedes older deployment reports that retained snapshots. Keep this policy in both `AGENTS.md` and the README; cleanup is a required final release step, not an optional follow-up. Verify the public version and database integrity after cleanup.
- Build and publish from the committed revision so deleted artifacts can be rebuilt. Keep credentials and runtime data out of Git.

# Minework editor

- Keep one visual editor and one JSON document. Markdown is an input/clipboard/export format; do not require a separate source mode for ordinary writing or copy/paste. See `docs/research/07_Notion_clipboard_and_single_editor.md`.
- Keep rich internal slices and node attributes intact. Serialize plain text by semantic blocks, not every nested container. Do not globally strip paragraph/code whitespace or bulk-delete historical blank paragraphs.
- Clipboard changes must cover the seven-task acceptance case through three consecutive round-trips, preserving order and completion state without growing blank lines; verify native rich HTML, Notion task HTML, nested tasks, partial selection, undo/redo and draft/save behavior.
