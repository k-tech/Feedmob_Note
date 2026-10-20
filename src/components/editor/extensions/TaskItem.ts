import BaseTaskItem from '@tiptap/extension-task-item';
import { InputRule } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';

/**
 * Typing '- ' already creates a bullet; finishing '[ ] ' converts that item.
 * Notion's '[] ' and the Chinese IME's '【】 ' create an unchecked task too.
 */
export const TaskItem = BaseTaskItem.extend({
  addInputRules() {
    return [new InputRule({
      find: /^\s*(?:[-+*]\s)?[[【]([ xX]?)[\]】]\s$/,
      handler: ({ state, range, match }) => {
        if (state.selection.$from.parent.type.name !== 'paragraph') return null;
        const checked = match[1].toLowerCase() === 'x';
        const tr = state.tr.delete(range.from, range.to);
        const $pos = tr.doc.resolve(range.from);
        const itemDepth = $pos.depth - 1;
        const item = itemDepth > 0 ? $pos.node(itemDepth) : null;
        if (item?.type.name === 'taskItem') {
          tr.setNodeMarkup($pos.before(itemDepth), undefined, { ...item.attrs, checked });
          return;
        }
        if (item?.type.name === 'listItem' && $pos.index(itemDepth) === 0) {
          const listDepth = itemDepth - 1;
          const list = $pos.node(listDepth);
          const index = $pos.index(listDepth);
          const start = $pos.before(listDepth);
          const before = [], after = [];
          for (let i = 0; i < list.childCount; i++) {
            if (i < index) before.push(list.child(i));
            else if (i > index) after.push(list.child(i));
          }
          const previous = before.length ? list.copy(Fragment.fromArray(before)) : null;
          const task = state.schema.nodes.taskList.create(null, this.type.create({ checked }, item.content));
          const following = after.length ? list.type.create({ ...list.attrs, ...(list.type.name === 'orderedList' ? { start: (list.attrs.start || 1) + index + 1 } : {}) }, after) : null;
          tr.replaceWith(start, start + list.nodeSize, Fragment.fromArray([...(previous ? [previous] : []), task, ...(following ? [following] : [])]));
          tr.setSelection(TextSelection.create(tr.doc, start + (previous?.nodeSize || 0) + 3));
          return;
        }
        const blockRange = $pos.blockRange();
        const wrapping = blockRange && findWrapping(blockRange, this.type, { checked });
        if (!wrapping) return null;
        tr.wrap(blockRange, wrapping);
      },
    })];
  },
});
