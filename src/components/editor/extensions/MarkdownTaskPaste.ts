import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { parseMarkdownTasks } from '../utils/markdown-tasks';

export const MarkdownTaskPaste = Extension.create({
  name: 'markdownTaskPaste',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({ props: {
      handlePaste(view, event, original) {
        const clipboard = event.clipboardData;
        const { selection, schema } = view.state;
        if (!editor.isEditable || !clipboard || clipboard.files.length || selection.$from.parent.type.spec.code || selection.$from.marks().some(mark => mark.type.spec.code)) return false;
        const target = event.target;
        if (target instanceof Element && target.closest('input, textarea, [contenteditable="false"]')) return false;
        // Native rich lists, code blocks, tables, images and inline formatting
        // should continue through ProseMirror's normal clipboard handling.
        if (clipboard.getData('text/html')) {
          let rich = false;
          original.content.descendants(node => {
            if (!['paragraph', 'text', 'hardBreak'].includes(node.type.name) || node.marks.length) rich = true;
          });
          if (rich) return false;
        }
        const content = parseMarkdownTasks(clipboard.getData('text/plain'));
        if (!content || !schema.nodes.taskList || !schema.nodes.taskItem) return false;
        try {
          const fragment = Fragment.fromArray(content.map(node => schema.nodeFromJSON(node)));
          fragment.forEach(node => node.check());
          const tr = view.state.tr;
          const { $from, empty } = selection;
          const itemDepth = $from.depth - 1;
          // Pasting into an empty existing checkbox should create peer tasks,
          // rather than putting the whole new list under an empty parent task.
          if (empty && itemDepth > 0 && $from.node(itemDepth).type.name === 'taskItem' && $from.node(itemDepth).childCount === 1 && !$from.parent.content.size && fragment.childCount === 1 && fragment.firstChild!.type.name === 'taskList') {
            tr.replaceWith($from.before(itemDepth), $from.after(itemDepth), fragment.firstChild!.content);
          } else tr.replaceSelection(new Slice(fragment, 0, 0));
          tr.doc.check();
          event.preventDefault();
          view.dispatch(closeHistory(tr).setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView());
          return true;
        } catch { return false; } // Unsupported insertion context: preserve native paste.
      },
    } })];
  },
});
