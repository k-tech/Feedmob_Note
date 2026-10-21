import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { ReplaceStep } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { columnView, columnWeight } from './column-view';

/** Position of the innermost column containing `pos`, or -1 outside columns. */
function enclosingColumn(doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'column') return $pos.before(depth);
  }
  return -1;
}

/**
 * ↑ from the block below a row, or ↓ from the block above it, enters the
 * column under the caret (Notion), not whichever column the browser picks.
 */
function enterRowVertically(view: EditorView, direction: 'up' | 'down'): boolean {
  const { selection, doc } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty || !view.endOfTextblock(direction)) return false;
  const { $from } = selection;
  const depth = $from.depth - 1;
  if (depth < 0) return false;
  const parent = $from.node(depth), index = $from.index(depth);
  const rowIndex = direction === 'up' ? index - 1 : index + 1;
  if (rowIndex < 0 || rowIndex >= parent.childCount || parent.child(rowIndex).type.name !== 'columnList') return false;
  const row = parent.child(rowIndex);
  const rowPos = direction === 'up' ? $from.before($from.depth) - row.nodeSize : $from.after($from.depth);
  const x = view.coordsAtPos($from.pos).left;
  let best: { start: number; end: number; distance: number } | null = null;
  row.forEach((column, offset) => {
    const start = rowPos + 1 + offset;
    const dom = view.nodeDOM(start);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (!best || distance < best.distance) best = { start, end: start + column.nodeSize, distance };
  });
  if (!best) return false;
  const { start, end } = best as { start: number; end: number };
  const target = direction === 'up' ? Selection.findFrom(doc.resolve(end - 1), -1, true) : Selection.findFrom(doc.resolve(start + 1), 1, true);
  if (!target || target.from < start || target.from > end) return false;
  // Keep the caret's horizontal position on the target line where possible.
  const line = view.coordsAtPos(target.from);
  const hit = view.posAtCoords({ left: x, top: (line.top + line.bottom) / 2 });
  const caret = hit && hit.pos > start && hit.pos < end && doc.resolve(hit.pos).parent === target.$from.parent ? hit.pos : target.from;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, caret)).scrollIntoView());
  return true;
}

export const ColumnList = Node.create({
  name: 'columnList',
  group: 'block',
  content: 'column{1,}',
  isolating: true,
  draggable: true,

  addAttributes() {
    return {
      columns: {
        default: 2,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column-list"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column-list',
        class: 'column-list-wrapper',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      ArrowUp: ({ editor }) => enterRowVertically(editor.view, 'up'),
      ArrowDown: ({ editor }) => enterRowVertically(editor.view, 'down'),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('columnListAutoCleanup'),
        appendTransaction(transactions, oldState, newState) {
          // If document didn't change, do nothing
          if (!transactions.some((tr) => tr.docChanged)) return null;

          const { doc, schema } = newState;
          const columnListType = schema.nodes.columnList;
          if (!columnListType) return null;

          let tr: any = null;

          doc.descendants((node, pos) => {
            if (node.type === columnListType) {
              // Columns never nest (paste, drop and older data included): a
              // row inside a column is flattened into that column.
              const $row = doc.resolve(pos);
              let nested = false;
              for (let depth = $row.depth; depth > 0; depth--) if ($row.node(depth).type.name === 'column') nested = true;
              let nonEmptyCols = 0;
              const childBlocks: ProseMirrorNode[] = [];

              node.forEach((col) => {
                let colHasContent = false;
                col.forEach((block) => {
                  childBlocks.push(block);
                  colHasContent = true;
                });
                if (colHasContent) {
                  nonEmptyCols++;
                }
              });

              // If degenerate (<= 1 column with content), auto-unwrap into top-level blocks
              if (nested || nonEmptyCols <= 1 || node.childCount <= 1) {
                if (!tr) tr = newState.tr;
                const mappedPos = tr.mapping.map(pos);
                if (childBlocks.length === 0) {
                  tr.replaceWith(
                    mappedPos,
                    mappedPos + node.nodeSize,
                    schema.nodes.paragraph.create()
                  );
                } else {
                  tr.replaceWith(mappedPos, mappedPos + node.nodeSize, childBlocks);
                }
                return false;
              } else if (node.attrs.columns !== node.childCount) {
                if (!tr) tr = newState.tr;
                tr.setNodeMarkup(tr.mapping.map(pos), undefined, { ...node.attrs, columns: node.childCount });
              }
              return true;
            }
            return true;
          });

          return tr;
        },
      }),
      new Plugin({
        key: new PluginKey('columnBoundaryGuard'),
        // A text selection may start in one column and end in another (or
        // outside the row). Typing or deleting over it would merge the
        // columns' text and destroy the row, so such edits are refused, as
        // Notion never lets a text edit cross a column boundary. Whole-row
        // and whole-column replacements remain allowed.
        filterTransaction(tr) {
          if (!tr.docChanged || isHistoryTransaction(tr)) return true;
          return tr.steps.every((step, index) => {
            if (!(step instanceof ReplaceStep) || step.from >= step.to) return true;
            const doc = tr.docs[index];
            return enclosingColumn(doc, step.from) === enclosingColumn(doc, step.to);
          });
        },
      }),
    ];
  },
});

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  addAttributes() {
    return {
      width: {
        default: 1,
        parseHTML: element => columnWeight(element.getAttribute('data-column-width')),
        renderHTML: attributes => ({ 'data-column-width': columnWeight(attributes.width), style: `flex: ${columnWeight(attributes.width)} 1 0%` }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column',
        class: 'column-block',
      }),
      0,
    ];
  },

  addNodeView() { return columnView; },
});
