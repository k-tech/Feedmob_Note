import { Extension } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { normalizeTaskHTML, parseMarkdown } from '../utils/markdown';
import { serializeClipboard } from '../utils/clipboard';

export const EditorClipboard = Extension.create({
  name: 'editorClipboard',
  priority: 1200,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: {
      clipboardTextSerializer: (slice, view) => serializeClipboard(slice, view.state),
      transformPastedHTML: normalizeTaskHTML,
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
          const { $from, empty } = selection;
          const itemDepth = $from.depth - 1;
          const emptyTask = empty && itemDepth > 0 && $from.node(itemDepth).type.name === 'taskItem'
            && $from.node(itemDepth).childCount === 1 && !$from.parent.content.size
            && fragment.childCount === 1 && fragment.firstChild!.type.name === 'taskList';
          const tr = view.state.tr;
          if (emptyTask) tr.replaceWith($from.before(itemDepth), $from.after(itemDepth), fragment.firstChild!.content);
          else tr.replaceSelection(native ? original : new Slice(fragment, 0, 0));
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
