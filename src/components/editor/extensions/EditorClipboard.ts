import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin, Selection, type Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { normalizePastedHTML, parseMarkdown } from '../utils/markdown';
import { serializeClipboard } from '../utils/clipboard';

const LISTS = ['bulletList', 'orderedList', 'taskList'];

/**
 * A whole list pasted with the caret in an empty list item, or at the end of
 * one, continues as sibling items (Notion) rather than nesting under the
 * item. The current list is split at that point when needed; ListJoin then
 * merges the pasted list with neighbours of the same kind.
 */
function insertListAsItems(tr: Transaction, fragment: Fragment): boolean {
  const { selection } = tr;
  const pasted = fragment.childCount === 1 ? fragment.firstChild! : null;
  if (!pasted || !LISTS.includes(pasted.type.name) || !selection.empty) return false;
  const { $from } = selection;
  const itemDepth = $from.depth - 1;
  if (itemDepth < 1 || $from.index(itemDepth) !== 0) return false;
  const item = $from.node(itemDepth);
  if (!['listItem', 'taskItem'].includes(item.type.name)) return false;
  const emptyItem = item.childCount === 1 && !$from.parent.content.size;
  if (!emptyItem && $from.parentOffset !== $from.parent.content.size) return false;
  const listDepth = itemDepth - 1;
  const list = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  const index = $from.index(listDepth);
  const items = Array.from({ length: list.childCount }, (_, i) => list.child(i));
  const before = items.slice(0, emptyItem ? index : index + 1);
  const after = items.slice(index + 1);
  const parts = [
    ...(before.length ? [list.type.create(list.attrs, before)] : []),
    pasted,
    ...(after.length ? [list.type.create(list.attrs, after)] : []),
  ];
  const $list = tr.doc.resolve(listPos);
  if (!$list.parent.canReplace($list.index(), $list.index() + 1, Fragment.fromArray(parts))) return false;
  tr.replaceWith(listPos, listPos + list.nodeSize, parts);
  const pastedEnd = listPos + (before.length ? parts[0].nodeSize : 0) + pasted.nodeSize;
  tr.setSelection(Selection.near(tr.doc.resolve(pastedEnd), -1));
  return true;
}

export const EditorClipboard = Extension.create({
  name: 'editorClipboard',
  priority: 1200,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: {
      clipboardTextSerializer: (slice, view) => serializeClipboard(slice, view.state),
      transformPastedHTML: normalizePastedHTML,
      handlePaste(view, event, original) {
        const clipboard = event.clipboardData;
        const { selection, schema } = view.state;
        if (!editor.isEditable || !clipboard || clipboard.files.length || selection.$from.parent.type.spec.code || selection.$from.marks().some(mark => mark.type.spec.code)) return false;
        const target = event.target;
        if (target instanceof Element && target.closest('input, textarea, [contenteditable="false"]')) return false;
        try {
          const html = clipboard.getData('text/html');
          let rich = false;
          original.content.descendants(node => {
            if (!['paragraph', 'text', 'hardBreak'].includes(node.type.name) || node.marks.length) rich = true;
          });
          // Internal slices and external rich text retain native slice openness,
          // attributes and marks. Only plain wrappers are Markdown candidates.
          const native = !!html && (rich || html.includes('data-pm-slice'));
          const fragment = native ? original.content : parseMarkdown(clipboard.getData('text/plain'), schema);
          if (!fragment) return false;
          const tr = view.state.tr;
          const closed = !native || (original.openStart === 0 && original.openEnd === 0);
          if (!(closed && insertListAsItems(tr, fragment))) tr.replaceSelection(native ? original : new Slice(fragment, 0, 0));
          tr.doc.check();
          event.preventDefault();
          // Content is already parsed. Tiptap's regex paste rules must not run
          // again and turn escaped literal asterisks into formatting.
          view.dispatch(closeHistory(tr).setMeta('paste', true).setMeta('uiEvent', 'editorPaste').scrollIntoView());
          return true;
        } catch { return false; }
      },
    } })];
  },
});
