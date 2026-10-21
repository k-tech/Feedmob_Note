import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';

const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

function continues(previous: ProseMirrorNode, next: ProseMirrorNode) {
  // Like Notion, adjacent items of one kind are always one list. A start
  // number kept from an earlier split must not keep the halves apart.
  return previous.type === next.type && LISTS.has(next.type.name);
}

/**
 * Notion has no list containers: consecutive items of one kind are one list,
 * and numbering continues. Moves, drops, conversions and Backspace can leave
 * two sibling lists of the same type; join them in the same history step.
 */
export const ListJoin = Extension.create({
  name: 'listJoin',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('listJoin'),
      appendTransaction(transactions, _old, state) {
        if (!transactions.some(tr => tr.docChanged)) return null;
        const boundaries: number[] = [];
        const scan = (parent: ProseMirrorNode, start: number) => {
          let previous: ProseMirrorNode | null = null;
          parent.forEach((child, offset) => {
            if (previous && continues(previous, child)) boundaries.push(start + offset);
            previous = child;
          });
        };
        scan(state.doc, 0);
        state.doc.descendants((node, pos) => {
          if (node.isTextblock || node.isAtom) return false;
          scan(node, pos + 1);
        });
        if (!boundaries.length) return null;
        const tr = state.tr;
        // Join from the end so earlier boundaries keep their positions.
        for (const pos of boundaries.sort((a, b) => b - a)) {
          if (canJoin(tr.doc, pos)) tr.join(pos);
        }
        return tr.docChanged ? tr : null;
      },
    })];
  },
});
