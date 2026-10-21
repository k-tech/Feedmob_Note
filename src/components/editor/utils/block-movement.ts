import { Editor } from '@tiptap/react';
import { Fragment, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, NodeSelection, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { convertBlock } from './block-conversion';
import { findBlockAtPoint, findColumnGap, resolveDomBlockPos } from './block-dom';
export { resolveDomBlockPos } from './block-dom';

/**
 * Custom MIME type used for block drag & drop.
 * IMPORTANT: never put plain text into dataTransfer for block drags —
 * ProseMirror's default drop handler would insert that text into the
 * document (this was the "random number" bug: block positions like "23"
 * being inserted as text on drop).
 */
export const BLOCK_DRAG_MIME = 'application/x-feedmob-block';

/**
 * Resolve the block containing (or adjacent to) the current selection.
 * Used by keyboard shortcuts (Alt+↑/↓, Ctrl+D).
 */
export function getBlockPosFromSelection(editor: Editor): number | null {
  const { state } = editor;
  const { $from } = state.selection;

  if (state.selection instanceof NodeSelection) return state.selection.from;
  // A list item (including its checkbox and nested children) is one block.
  for (let depth = $from.depth; depth > 0; depth--) {
    if (['listItem', 'taskItem'].includes($from.node(depth).type.name)) return $from.before(depth);
  }

  // A container's first text block and its body move together. Body paragraphs remain
  // individually addressable, just like blocks in a column.
  if ($from.depth >= 2 && ['toggle', 'callout', 'blockquote'].includes($from.node($from.depth - 1).type.name) && $from.index($from.depth - 1) === 0) {
    return $from.before($from.depth - 1);
  }

  if ($from.depth >= 1 && ($from.node($from.depth)?.isBlock ?? false)) {
    return $from.before($from.depth);
  }
  // Depth 0 (gap cursor / node selection at top level): use an adjacent block.
  const after = $from.nodeAfter;
  if (after && after.isBlock) return $from.pos;
  const before = $from.nodeBefore;
  if (before && before.isBlock) return $from.pos - before.nodeSize;
  return null;
}

/**
 * The line a slash command acts on. Unlike block actions, the first line of a
 * callout or quote is its own line (only a toggle's title must stay its
 * paragraph); a list item still converts as a whole item.
 */
export function getLinePosFromSelection(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock || $from.depth < 1) return getBlockPosFromSelection(editor);
  for (let depth = $from.depth; depth > 0; depth--) {
    if (['listItem', 'taskItem'].includes($from.node(depth).type.name)) return $from.before(depth);
  }
  const container = $from.node($from.depth - 1);
  if (container?.type.name === 'toggle' && $from.index($from.depth - 1) === 0) return $from.before($from.depth - 1);
  return $from.before($from.depth);
}

/**
 * Checks if the given position (or current selection) is inside a columnList.
 * Also accepts the position of the columnList itself (hovering the row gap).
 */
export function getEnclosingColumnList(
  editor: Editor,
  fromPos?: number
): { node: ProseMirrorNode; pos: number; nodeSize: number } | null {
  const { state } = editor;
  const pos = fromPos ?? state.selection.from;
  if (pos < 0 || pos > state.doc.content.size) return null;

  try {
    const at = state.doc.nodeAt(pos);
    if (at && at.type.name === 'columnList') {
      return { node: at, pos, nodeSize: at.nodeSize };
    }
    const $pos = state.doc.resolve(pos);
    for (let d = $pos.depth; d >= 1; d--) {
      const node = $pos.node(d);
      if (node.type.name === 'columnList') {
        return { node, pos: $pos.before(d), nodeSize: node.nodeSize };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Unwraps a columnList back into sequential top-level blocks.
 */
export function unwrapColumnList(editor: Editor, pos?: number): boolean {
  const colList = getEnclosingColumnList(editor, pos);
  if (!colList) return false;

  const { state, view } = editor;
  const { tr } = state;

  const extractedBlocks: ProseMirrorNode[] = [];
  colList.node.forEach((col) => {
    col.forEach((block) => {
      extractedBlocks.push(block);
    });
  });

  if (extractedBlocks.length === 0) {
    tr.replaceWith(colList.pos, colList.pos + colList.nodeSize, state.schema.nodes.paragraph.create());
  } else {
    tr.replaceWith(colList.pos, colList.pos + colList.nodeSize, extractedBlocks);
  }

  view.dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * Move the block at `blockPos` up/down **within its own parent**. When the
 * block sits at the parent's edge (or is a bare column, whose siblings are
 * horizontal), the enclosing block moves instead — so blocks nested in
 * lists / callouts / columns swap with their siblings in context instead of
 * teleporting to an unrelated top-level position.
 */
export function moveBlockAtPos(
  editor: Editor,
  blockPos: number,
  direction: 'up' | 'down'
): boolean {
  const { state, view } = editor;
  const node = state.doc.nodeAt(blockPos);
  if (!node || !node.isBlock) return false;

  const $pos = state.doc.resolve(blockPos);
  const parent = $pos.parent;
  const depth = $pos.depth; // parent depth; 0 when the parent is the doc
  const index = $pos.index();

  // Columns are horizontal siblings — a vertical move relocates the whole row.
  const isColumnMove = node.type.name === 'column';
  const atEdge =
    direction === 'up' ? index === 0 : index === parent.childCount - 1;

  // The first body line of a toggle/callout/quote never swaps with its title
  // line, and the last one never drags the container along: they leave the
  // container instead (Notion).
  const titled = ['toggle', 'callout', 'blockquote'].includes(parent.type.name);
  if (titled && depth > 0 && ((direction === 'up' && index === 1) || (direction === 'down' && index > 0 && index === parent.childCount - 1))) {
    const containerPos = $pos.before(depth);
    const offset = state.selection.from >= blockPos && state.selection.to <= blockPos + node.nodeSize ? state.selection.from - blockPos : 1;
    const tr = state.tr;
    let insertAt: number;
    if (direction === 'up') { tr.delete(blockPos, blockPos + node.nodeSize).insert(containerPos, node); insertAt = containerPos; }
    else { const after = $pos.after(depth); tr.insert(after, node).delete(blockPos, blockPos + node.nodeSize); insertAt = after - node.nodeSize; }
    try { tr.doc.check(); } catch { return false; }
    try { tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + offset))); } catch {}
    view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
    return true;
  }

  // A list item at its list's edge leaves the list past the neighbouring
  // block, as Notion moves one item, not the whole list. ListJoin rejoins it
  // with a list of the same kind it lands next to.
  if (atEdge && ['listItem', 'taskItem'].includes(node.type.name) && parent.childCount > 1 && depth > 0) {
    if (moveListItemOut(editor, blockPos, direction)) return true;
  }

  if (isColumnMove || atEdge) {
    if (depth <= 0) return false; // top-level block already at the doc edge
    return moveBlockAtPos(editor, $pos.before(depth), direction);
  }

  // Position arithmetic inside the parent (avoid relying on resolvedPos
  // start()/index() semantics): offset of this block within the parent…
  let offset = 0;
  for (let i = 0; i < index; i++) offset += parent.child(i).nodeSize;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  let siblingPos = blockPos - offset;
  for (let i = 0; i < targetIndex; i++) {
    siblingPos += parent.child(i).nodeSize;
  }
  // The parent keeps other children (we only move at non-edge indices), so
  // the deletion never empties the parent and position mapping stays simple.
  const tr = state.tr;
  const sibling = parent.child(targetIndex);
  const safeInsert = direction === 'up' ? siblingPos : blockPos + sibling.nodeSize;
  const replaceFrom = Math.min(blockPos, siblingPos);
  const replaceTo = Math.max(blockPos + node.nodeSize, siblingPos + sibling.nodeSize);
  const replacement = direction === 'up' ? [node, sibling] : [sibling, node];
  if (!parent.canReplace(Math.min(index, targetIndex), Math.max(index, targetIndex) + 1, Fragment.fromArray(replacement))) return false;
  // Swap atomically: deleting a required first paragraph can cause schema
  // auto-filling and silently introduce an extra paragraph.
  tr.replaceWith(replaceFrom, replaceTo, replacement);
  if (!tr.docChanged) return false;

  try {
    const offset = state.selection.from >= blockPos && state.selection.to <= blockPos + node.nodeSize
      ? state.selection.from - blockPos : 1;
    tr.setSelection(state.selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, safeInsert)
      : TextSelection.near(tr.doc.resolve(Math.min(safeInsert + offset, tr.doc.content.size))));
  } catch {}

  view.dispatch(tr);
  editor.commands.focus();
  return true;
}

function moveListItemOut(editor: Editor, itemPos: number, direction: 'up' | 'down'): boolean {
  const { state, view } = editor;
  const item = state.doc.nodeAt(itemPos)!;
  const $item = state.doc.resolve(itemPos);
  const list = $item.parent;
  const listPos = $item.before();
  const $list = state.doc.resolve(listPos);
  const container = $list.parent;
  const listIndex = $list.index();
  const neighborIndex = direction === 'up' ? listIndex - 1 : listIndex + 1;
  if (neighborIndex < 0 || neighborIndex >= container.childCount) return false;
  const neighbor = container.child(neighborIndex);
  const single = list.type.create(list.attrs, [item]);
  const rest = list.type.create(list.attrs, direction === 'up'
    ? Array.from({ length: list.childCount - 1 }, (_, i) => list.child(i + 1))
    : Array.from({ length: list.childCount - 1 }, (_, i) => list.child(i)));
  const replacement = direction === 'up' ? [single, neighbor, rest] : [rest, neighbor, single];
  const from = direction === 'up' ? listPos - neighbor.nodeSize : listPos;
  const to = direction === 'up' ? listPos + list.nodeSize : listPos + list.nodeSize + neighbor.nodeSize;
  const start = Math.min(listIndex, neighborIndex), end = Math.max(listIndex, neighborIndex) + 1;
  if (!container.canReplace(start, end, Fragment.fromArray(replacement))) return false;
  const tr = state.tr.replaceWith(from, to, replacement);
  const offset = Math.max(1, state.selection.from - itemPos);
  const singlePos = direction === 'up' ? from : from + rest.nodeSize + neighbor.nodeSize;
  try { tr.setSelection(TextSelection.near(tr.doc.resolve(singlePos + 1 + offset))); } catch {}
  view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return true;
}

/**
 * Move the block around the current selection up/down (Alt+↑/↓).
 */
export function moveBlock(editor: Editor, direction: 'up' | 'down'): boolean {
  const pos = getBlockPosFromSelection(editor);
  if (pos === null) return false;
  return moveBlockAtPos(editor, pos, direction);
}

/**
 * Duplicate the block at `blockPos`.
 */
export function duplicateBlockAtPos(editor: Editor, blockPos: number): boolean {
  const { state, view } = editor;
  const node = state.doc.nodeAt(blockPos);
  if (!node || !node.isBlock) return false;

  const $pos = state.doc.resolve(blockPos);
  if (!$pos.parent.canReplace($pos.index() + 1, $pos.index() + 1, Fragment.from(node))) return false;
  const tr = closeHistory(state.tr);
  const insertPos = blockPos + node.nodeSize;
  tr.insert(insertPos, node);
  try {
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(insertPos + 1, tr.doc.content.size)))
    );
  } catch {}

  view.dispatch(tr);
  return true;
}

/**
 * Duplicate the block around the current selection (Ctrl+D).
 */
export function duplicateBlock(editor: Editor): boolean {
  const pos = getBlockPosFromSelection(editor);
  if (pos === null) return false;
  return duplicateBlockAtPos(editor, pos);
}

/** Delete complete sibling blocks, removing any column or list they empty. */
export function deleteBlockRange(editor: Editor, from: number, to: number): boolean {
  const { state, view } = editor;
  if (from < 0 || to > state.doc.content.size || from >= to) return false;
  let $from = state.doc.resolve(from), $to = state.doc.resolve(to);
  if (!$from.sameParent($to)) return false;
  for (let pos = from; pos < to;) {
    const node = state.doc.nodeAt(pos);
    if (!node?.isBlock || pos + node.nodeSize > to) return false;
    pos += node.nodeSize;
  }

  let replacement = Fragment.empty;
  while (!$from.parent.canReplace($from.index(), $to.index(), replacement)) {
    // An explicit deletion must remove an emptied column, not let block+
    // synthesize the same empty paragraph again. Do not globally remove empty
    // columns: a newly created column is intentional editable space.
    const removeWrapper = ['column', 'columnList', 'bulletList', 'orderedList', 'taskList'].includes($from.parent.type.name);
    const paragraph = state.schema.nodes.paragraph?.create();
    if (!removeWrapper && paragraph) {
      const filler = Fragment.from(paragraph);
      if ($from.parent.canReplace($from.index(), $to.index(), filler)) {
        replacement = filler;
        break;
      }
    }
    if ($from.depth === 0) return false;
    from = $from.before();
    to = $from.after();
    $from = state.doc.resolve(from);
    $to = state.doc.resolve(to);
  }

  const tr = closeHistory(state.tr).replaceWith(from, to, replacement);
  tr.doc.check();
  if (tr.doc.eq(state.doc)) return false;
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Delete the block at `blockPos` through the same path as block selections. */
export function deleteBlockAtPos(editor: Editor, blockPos: number): boolean {
  const node = blockPos >= 0 && blockPos < editor.state.doc.content.size
    ? editor.state.doc.nodeAt(blockPos) : null;
  return !!node?.isBlock && deleteBlockRange(editor, blockPos, blockPos + node.nodeSize);
}

/**
 * Delete the block around the current selection.
 */
export function deleteBlock(editor: Editor): boolean {
  const pos = getBlockPosFromSelection(editor);
  if (pos === null) return false;
  return deleteBlockAtPos(editor, pos);
}

/**
 * Insert an empty paragraph directly above/below the block at `blockPos`.
 */
export function insertParagraphNear(
  editor: Editor,
  blockPos: number,
  side: 'above' | 'below'
): boolean {
  const { state, view } = editor;
  const node = state.doc.nodeAt(blockPos);
  if (!node || !node.isBlock) return false;
  const paraType = state.schema.nodes.paragraph;
  if (!paraType) return false;

  const insertPos = side === 'above' ? blockPos : blockPos + node.nodeSize;
  const tr = state.tr;
  const newBlock = ['listItem', 'taskItem'].includes(node.type.name)
    ? node.type.createChecked(null, [paraType.create()]) : paraType.create();
  const $insert = state.doc.resolve(insertPos);
  if (!$insert.parent.canReplaceWith($insert.index(), $insert.index(), newBlock.type)) return false;
  tr.insert(insertPos, newBlock);
  try {
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(insertPos + 1, tr.doc.content.size)))
    );
  } catch {}

  view.dispatch(tr);
  editor.commands.focus();
  return true;
}

/**
 * Inside a column, "more columns" means more columns in the same row:
 * columns never nest. Adds `count` empty columns after the column containing
 * the transaction's selection and puts the caret in the first one.
 */
export function addColumnsInRow(tr: Transaction, count: number, at = tr.selection.from): boolean {
  const $at = tr.doc.resolve(at);
  let depth = $at.depth;
  while (depth > 0 && $at.node(depth).type.name !== 'column') depth--;
  if (depth === 0) return false;
  const { column, paragraph } = tr.doc.type.schema.nodes;
  const after = $at.after(depth);
  tr.insert(after, Array.from({ length: count }, () => column.create(null, paragraph.create())));
  tr.setSelection(TextSelection.near(tr.doc.resolve(after + 2)));
  return true;
}

/**
 * Wrap the block at `blockPos` into a 2-column row (handle menu action).
 */
export function turnBlockIntoColumns(editor: Editor, blockPos: number): boolean {
  const { state, view } = editor;
  const node = state.doc.nodeAt(blockPos);
  if (!node || !node.isBlock) return false;
  const inRow = state.tr;
  if (addColumnsInRow(inRow, 1, blockPos)) { view.dispatch(inRow.scrollIntoView()); editor.commands.focus(); return true; }
  if (['listItem', 'taskItem'].includes(node.type.name)) return convertBlock(editor, blockPos, 'columns');
  if (['columnList', 'column'].includes(node.type.name)) return false;

  const { schema } = state;
  const columnType = schema.nodes.column;
  const columnListType = schema.nodes.columnList;
  const paraType = schema.nodes.paragraph;
  if (!columnType || !columnListType || !paraType) return false;

  const rightPara = paraType.create();
  const tr = state.tr;
  tr.replaceWith(
    blockPos,
    blockPos + node.nodeSize,
    columnListType.create(
      { columns: 2 },
      [columnType.create(null, [node]), columnType.create(null, [rightPara])]
    )
  );
  view.dispatch(tr);
  return true;
}

const LIST_ITEMS = new Set(['listItem', 'taskItem']);
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

function insideColumn(doc: ProseMirrorNode, pos: number) {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth--) if ($pos.node(depth).type.name === 'column') return true;
  return false;
}

export type DropZone = 'above' | 'below' | 'left' | 'right';

export interface BlockDropTarget {
  zone: DropZone;
  targetPos: number;
  targetNode: ProseMirrorNode;
  rect: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
  scope?: 'block' | 'column' | 'row';
  label?: string;
  highlight?: { top: number; left: number; width: number; height: number };
  indicator: {
    top: number;
    left: number;
    width: number;
    height: number;
    isVertical: boolean;
  };
}

/**
 * Notion-style zones: the vertical half of a block decides above/below.
 * Only a narrow left rail or the right quarter of a block creates columns,
 * so an ordinary reorder drag never turns into an accidental column row.
 */
const LEFT_SIDE_ZONE = 32;
const RIGHT_SIDE_RATIO = 0.25;
const RIGHT_SIDE_MIN = 40;
const RIGHT_SIDE_MAX = 160;
const ROW_EDGE_ZONE = 7;
const GUIDE_SIZE = 3.5;

function canDropAround(sourcePos: number, source: ProseMirrorNode, targetPos: number, target: ProseMirrorNode, zone: DropZone) {
  if (sourcePos === targetPos) return false;
  if (targetPos > sourcePos && targetPos < sourcePos + source.nodeSize) return false;
  // A block can leave its own column row through the group's upper/lower edge.
  if (sourcePos > targetPos && sourcePos < targetPos + target.nodeSize) {
    return target.type.name === 'columnList' && (zone === 'above' || zone === 'below');
  }
  return true;
}

/** Shared by the hover preview and the actual drop, including column gutters. */
export function computeBlockDropTarget(
  view: EditorView,
  clientX: number,
  clientY: number,
  options?: { sourcePos?: number }
): BlockDropTarget | null {
  let hit = findBlockAtPoint(view, clientX, clientY, true);
  if (!hit) return null;
  const gap = hit.row ? findColumnGap(view, hit.row, clientX, clientY, options?.sourcePos) : null;
  if (gap) hit = gap.hit;
  let { pos: targetPos, node: targetNode, dom } = hit;
  let rect = dom.getBoundingClientRect();
  let scope: 'block' | 'column' | 'row' = hit.column ? 'column' : 'block';
  const rowRect = hit.row?.getBoundingClientRect();
  let zone: DropZone;

  // The group's outer top/bottom edge extracts a block to the parent level.
  // A guide within the column retains that column's local scope.
  if (hit.row && rowRect && (clientY <= rowRect.top + ROW_EDGE_ZONE || clientY >= rowRect.bottom - ROW_EDGE_ZONE)) {
    const rowPos = resolveDomBlockPos(view, hit.row);
    if (rowPos === null) return null;
    targetPos = rowPos;
    targetNode = view.state.doc.nodeAt(rowPos)!;
    rect = rowRect;
    scope = 'row';
    zone = clientY < (rect.top + rect.bottom) / 2 ? 'above' : 'below';
  } else {
    const leftBand = Math.min(LEFT_SIDE_ZONE, rect.width / 5);
    const rightBand = Math.min(rect.width / 3, Math.max(RIGHT_SIDE_MIN, Math.min(RIGHT_SIDE_MAX, rect.width * RIGHT_SIDE_RATIO)));
    const columnRect = hit.column?.getBoundingClientRect();
    if (gap) zone = gap.zone;
    else if (columnRect && clientX >= columnRect.left && clientX <= columnRect.right && clientY > rect.bottom) zone = 'below';
    else if (columnRect && clientX >= columnRect.left && clientX <= columnRect.right && clientY < rect.top) zone = 'above';
    else if (clientX < rect.left) zone = 'left';
    else if (clientX > rect.right) zone = 'right';
    else if (clientX <= rect.left + leftBand) zone = 'left';
    else if (clientX >= rect.right - rightBand) zone = 'right';
    else zone = clientY < rect.top + rect.height / 2 ? 'above' : 'below';
  }

  const sourcePos = options?.sourcePos;
  if (sourcePos !== undefined) {
    const source = view.state.doc.nodeAt(sourcePos);
    if (!source || !canDropAround(sourcePos, source, targetPos, targetNode, zone)) return null;
    if ((zone === 'left' || zone === 'right') && ['column', 'columnList'].includes(source.type.name)) return null;
    if ((zone === 'left' || zone === 'right') && hit.column) {
      const $source = view.state.doc.resolve(sourcePos), $target = view.state.doc.resolve(targetPos);
      // Reinserting a sole-column block into its existing gutter is a no-op.
      if ($source.parent.type.name === 'column' && $source.parent.childCount === 1 && $target.parent.type.name === 'column'
        && $source.depth === $target.depth && $source.node($source.depth - 1) === $target.node($target.depth - 1)) {
        const sourceIndex = $source.index($source.depth - 1), targetIndex = $target.index($target.depth - 1);
        if (sourceIndex === targetIndex + (zone === 'right' ? 1 : -1)) return null;
      }
    }
    // A whole row never lands inside a column: columns do not nest.
    if (source.type.name === 'columnList' && insideColumn(view.state.doc, targetPos)) return null;
    if (zone === 'above' || zone === 'below') {
      const $target = view.state.doc.resolve(targetPos);
      const $source = view.state.doc.resolve(sourcePos);
      const index = $target.index() + (zone === 'below' ? 1 : 0);
      const isItem = LIST_ITEMS.has(source.type.name);
      const portableType = isItem ? $source.parent.type : source.type;
      const direct = (!isItem || $source.parent.type === $target.parent.type) && $target.parent.canReplaceWith(index, index, source.type);
      // Text dropped between list items splits the list there (Notion).
      const splitsList = LIST_TYPES.has($target.parent.type.name) && $target.depth > 0
        && $target.node($target.depth - 1).canReplaceWith($target.index($target.depth - 1), $target.index($target.depth - 1), portableType);
      if (!direct && !splitsList && !$target.parent.canReplaceWith(index, index, portableType)) return null;
      if ($source.parent === $target.parent && (
        (zone === 'below' && targetPos + targetNode.nodeSize === sourcePos) ||
        (zone === 'above' && sourcePos + source.nodeSize === targetPos)
      )) return null;
    }
  }

  let indicator = {
    top: (zone === 'above' ? rect.top : rect.bottom) - GUIDE_SIZE / 2,
    left: rect.left, width: rect.width, height: GUIDE_SIZE, isVertical: false,
  };
  let highlight = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  let label = scope === 'row' ? `移到整行${zone === 'above' ? '上方' : '下方'}`
    : scope === 'column' ? `在此列${zone === 'above' ? '上方' : '下方'}插入`
    : `移到块${zone === 'above' ? '上方' : '下方'}`;

  if (zone === 'left' || zone === 'right') {
    let edge = zone === 'left' ? rect.left : rect.right;
    let top = rect.top, height = rect.height;
    if (hit.column && hit.row && rowRect) {
      const cols = Array.from(hit.row.children).filter(el => el.matches('[data-type="column"]'));
      const index = cols.indexOf(hit.column);
      const colRect = hit.column.getBoundingClientRect();
      const neighbor = cols[index + (zone === 'left' ? -1 : 1)];
      const neighborRect = neighbor?.getBoundingClientRect();
      edge = zone === 'left'
        ? (neighborRect ? (neighborRect.right + colRect.left) / 2 : colRect.left)
        : (neighborRect ? (colRect.right + neighborRect.left) / 2 : colRect.right);
      top = rowRect.top; height = rowRect.height;
      highlight = { top: rowRect.top, left: rowRect.left, width: rowRect.width, height: rowRect.height };
      label = gap ? '放到两列之间并排成列' : `在当前列${zone === 'left' ? '左侧' : '右侧'}新增列`;
    } else {
      let $target = view.state.doc.resolve(targetPos);
      const rowType = view.state.schema.nodes.columnList;
      // A list item cannot sit in a column alone; the whole list goes beside.
      if (LIST_TYPES.has($target.parent.type.name) && $target.depth > 0) {
        const listPos = $target.before();
        const listDom = view.nodeDOM(listPos);
        const source = sourcePos === undefined ? null : view.state.doc.nodeAt(sourcePos);
        if (!(listDom instanceof HTMLElement) || (source && sourcePos! > listPos && sourcePos! < listPos + $target.parent.nodeSize)) return null;
        targetPos = listPos;
        targetNode = $target.parent;
        rect = listDom.getBoundingClientRect();
        $target = view.state.doc.resolve(listPos);
        edge = zone === 'left' ? rect.left : rect.right;
        top = rect.top; height = rect.height;
        highlight = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
      }
      if (!rowType || !$target.parent.canReplaceWith($target.index(), $target.index() + 1, rowType)) return null;
      label = `放到${zone === 'left' ? '左侧' : '右侧'}并排成列`;
    }
    indicator = { top, left: edge - GUIDE_SIZE / 2, width: GUIDE_SIZE, height: Math.max(24, height), isVertical: true };
  }

  return {
    zone, targetPos, targetNode, scope, label, highlight,
    rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
    indicator,
  };
}

/**
 * Move the dragged block to the computed drop target.
 *
 * Position-math rules that keep this safe:
 * - vertical moves (above/below): delete the source first, then map the
 *   insertion boundary through the deletion — the boundary is always outside
 *   the deleted range, so mapping is exact.
 * - column moves (left/right): ALWAYS delete the source first, then re-resolve
 *   the target row in the updated doc and rebuild its columns. Never delete
 *   "by mapped position" after a replaceWith — positions inside a replaced
 *   range collapse to its boundary and the delete would hit the wrong block
 *   (this was the duplicated-block / eaten-next-row corruption bug).
 */
export function moveBlockToDropTarget(
  editor: Editor,
  sourcePos: number,
  dropTarget: BlockDropTarget
): boolean {
  const { state, view } = editor;
  const { doc, schema } = state;
  const sourceNode = doc.nodeAt(sourcePos);
  if (!sourceNode || !sourceNode.isBlock) return false;

  const { zone, targetPos } = dropTarget;
  const targetNode = doc.nodeAt(targetPos);
  if (!targetNode || !targetNode.eq(dropTarget.targetNode)) return false;
  if (!canDropAround(sourcePos, sourceNode, targetPos, targetNode, zone)) return false;
  const leavingTargetRow = targetNode.type.name === 'columnList' && sourcePos > targetPos && sourcePos < targetPos + targetNode.nodeSize;

  const tr = closeHistory(state.tr);
  try {
    // Remove a vacated column itself so schema auto-fill does not leave a ghost column.
    const sourceParent = doc.resolve(sourcePos);
    const isListItem = ['listItem', 'taskItem'].includes(sourceNode.type.name);
    // An item leaving its list starts its own list, numbered from the list's
    // own start like any split (see applyBlockConversion).
    const portableNode = isListItem ? sourceParent.parent.type.createChecked(sourceParent.parent.attrs, [sourceNode]) : sourceNode;
    const sourceListType = sourceParent.parent.type;
    if (isListItem && sourceParent.parent.childCount === 1) {
      tr.delete(sourceParent.before(), sourceParent.after());
    } else if (sourceParent.parent.type.name === 'column' && sourceParent.parent.childCount === 1 && sourceParent.node(sourceParent.depth - 1).childCount > 1) {
      tr.delete(sourceParent.before(), sourceParent.after());
    } else {
      tr.delete(sourcePos, sourcePos + sourceNode.nodeSize);
    }
    const mappedTarget = tr.mapping.map(targetPos);
    const targetNow = tr.doc.nodeAt(mappedTarget);
    if (!targetNow || (leavingTargetRow ? targetNow.type !== targetNode.type : !targetNow.eq(targetNode))) return false;

    if (zone === 'above' || zone === 'below') {
      let insertion = zone === 'above' ? mappedTarget : mappedTarget + targetNow.nodeSize;
      const $insert = tr.doc.resolve(insertion);
      const parent = $insert.parent, index = $insert.index();
      // A bullet stays a bullet in a numbered list (and vice versa): items
      // only join a list of their own kind.
      const sameKind = !isListItem || parent.type === sourceListType;
      let insertNode = sameKind && parent.canReplaceWith(index, index, sourceNode.type) ? sourceNode : portableNode;
      if (!parent.canReplaceWith(index, index, insertNode.type) && LIST_TYPES.has(parent.type.name)) {
        // Split the list at the drop point and insert between the halves.
        if (index === 0) insertion = $insert.before();
        else if (index === parent.childCount) insertion = $insert.after();
        else { tr.split(insertion); insertion += 1; }
        insertNode = portableNode;
      }
      const $at = tr.doc.resolve(insertion);
      if (!$at.parent.canReplaceWith($at.index(), $at.index(), insertNode.type)) return false;
      tr.insert(insertion, insertNode);
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertion + 1)));
    } else {
      const { column: columnType, columnList: rowType } = schema.nodes;
      if (!columnType || !rowType || sourceNode.type === columnType || sourceNode.type === rowType) return false;
      const newColumn = columnType.createChecked(null, [portableNode]);
      const $target = tr.doc.resolve(mappedTarget);
      let columnDepth = $target.depth;
      while (columnDepth > 0 && $target.node(columnDepth).type !== columnType) columnDepth--;
      if (columnDepth > 0) {
        const row = $target.node(columnDepth - 1);
        const rowPos = $target.before(columnDepth - 1);
        const cols: ProseMirrorNode[] = [];
        row.forEach(col => cols.push(col));
        const index = $target.index(columnDepth - 1) + (zone === 'right' ? 1 : 0);
        cols.splice(index, 0, newColumn);
        tr.replaceWith(rowPos, rowPos + row.nodeSize, rowType.createChecked({ ...row.attrs, columns: cols.length }, cols));
        let insertedPos = rowPos + 2;
        for (let i = 0; i < index; i++) insertedPos += cols[i].nodeSize;
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertedPos + 1)));
      } else {
        if (targetNow.type === rowType || targetNow.type === columnType) return false;
        const targetColumn = columnType.createChecked(null, [targetNow]);
        const cols = zone === 'left' ? [newColumn, targetColumn] : [targetColumn, newColumn];
        const row = rowType.createChecked({ columns: 2 }, cols);
        if (!$target.parent.canReplaceWith($target.index(), $target.index() + 1, rowType)) return false;
        tr.replaceWith(mappedTarget, mappedTarget + targetNow.nodeSize, row);
        tr.setSelection(TextSelection.near(tr.doc.resolve(mappedTarget + 3 + (zone === 'right' ? targetColumn.nodeSize : 0))));
      }
    }
    tr.doc.check();
    if (tr.doc.eq(doc)) return false;
    view.dispatch(tr.scrollIntoView());
    return true;
  } catch {
    // No dispatch on failure: retain the exact original document and undo stack.
    return false;
  }
}
