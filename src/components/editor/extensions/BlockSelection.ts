import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, Selection, SelectionRange, TextSelection, type EditorState, type SelectionBookmark } from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { closeHistory } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { deleteBlockRange, getBlockPosFromSelection, insertParagraphNear } from '../utils/block-movement';
import { slashCommandKey } from './SlashCommand';

export interface SelectedBlockRange {
  from: number;
  to: number;
  anchor: number;
  head: number;
  parent: ProseMirrorNode;
  startIndex: number;
  endIndex: number;
  positions: number[];
}

function siblingRange(doc: ProseMirrorNode, anchor: number, head: number): SelectedBlockRange | null {
  if (anchor < 0 || head < 0 || anchor > doc.content.size || head > doc.content.size) return null;
  const $anchor = doc.resolve(anchor), $head = doc.resolve(head);
  const anchorNode = $anchor.nodeAfter, headNode = $head.nodeAfter;
  if (!anchorNode?.isBlock || !headNode?.isBlock || !$anchor.sameParent($head)) return null;
  const from = Math.min(anchor, head);
  const to = Math.max(anchor + anchorNode.nodeSize, head + headNode.nodeSize);
  const positions: number[] = [];
  for (let pos = from; pos < to;) {
    const node = doc.nodeAt(pos);
    if (!node?.isBlock) return null;
    positions.push(pos);
    pos += node.nodeSize;
  }
  return { from, to, anchor, head, parent: $anchor.parent,
    startIndex: doc.resolve(from).index(), endIndex: doc.resolve(to).index(), positions };
}

/** Whole sibling nodes are selected, while anchor/head retain expansion direction. */
export class BlockRangeSelection extends Selection {
  readonly blockAnchor: number;
  readonly blockHead: number;
  constructor(doc: ProseMirrorNode, anchor: number, head: number) {
    const range = siblingRange(doc, anchor, head);
    if (!range) throw new RangeError('Block selection requires sibling block boundaries');
    super(doc.resolve(range.from), doc.resolve(range.to), [new SelectionRange(doc.resolve(range.from), doc.resolve(range.to))]);
    this.blockAnchor = anchor;
    this.blockHead = head;
  }
  eq(other: Selection): boolean {
    return other instanceof BlockRangeSelection && other.blockAnchor === this.blockAnchor && other.blockHead === this.blockHead;
  }
  map(doc: ProseMirrorNode, mapping: Mappable): Selection {
    const anchor = mapping.mapResult(this.blockAnchor, 1), head = mapping.mapResult(this.blockHead, 1);
    if (!anchor.deleted && !head.deleted && siblingRange(doc, anchor.pos, head.pos)) {
      return new BlockRangeSelection(doc, anchor.pos, head.pos);
    }
    return Selection.near(doc.resolve(Math.min(anchor.pos, doc.content.size)));
  }
  toJSON() { return { type: 'mineworkBlockRange', anchor: this.blockAnchor, head: this.blockHead }; }
  static fromJSON(doc: ProseMirrorNode, json: { anchor: number; head: number }): Selection {
    return new BlockRangeSelection(doc, json.anchor, json.head);
  }
  getBookmark(): SelectionBookmark { return new BlockBookmark(this.blockAnchor, this.blockHead); }
}
BlockRangeSelection.prototype.visible = false;
Selection.jsonID('mineworkBlockRange', BlockRangeSelection);

class BlockBookmark implements SelectionBookmark {
  constructor(readonly anchor: number, readonly head: number) {}
  map(mapping: Mappable) { return new BlockBookmark(mapping.map(this.anchor, 1), mapping.map(this.head, 1)); }
  resolve(doc: ProseMirrorNode): Selection {
    return siblingRange(doc, this.anchor, this.head)
      ? new BlockRangeSelection(doc, this.anchor, this.head)
      : Selection.near(doc.resolve(Math.min(Math.max(this.anchor, 0), doc.content.size)));
  }
}

export function selectedBlockRange(state: EditorState): SelectedBlockRange | null {
  const { selection, doc } = state;
  if (selection instanceof BlockRangeSelection) return siblingRange(doc, selection.blockAnchor, selection.blockHead);
  if (selection instanceof NodeSelection && selection.node.isBlock) return siblingRange(doc, selection.from, selection.from);
  return null;
}

export function selectBlockAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node?.isBlock || !NodeSelection.isSelectable(node)) return false;
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, pos)));
  return true;
}

export function duplicateSelectedBlocks(editor: Editor): boolean {
  const range = selectedBlockRange(editor.state);
  if (!range) return false;
  const fragment = editor.state.doc.slice(range.from, range.to).content;
  if (!range.parent.canReplace(range.endIndex, range.endIndex, fragment)) return false;
  const tr = closeHistory(editor.state.tr).insert(range.to, fragment);
  const offset = range.to - range.from;
  tr.setSelection(range.positions.length === 1 ? NodeSelection.create(tr.doc, range.from + offset)
    : new BlockRangeSelection(tr.doc, range.anchor + offset, range.head + offset));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Remove a complete range once; required content is repaired before dispatch. */
export function deleteSelectedBlocks(editor: Editor): boolean {
  const range = selectedBlockRange(editor.state);
  return !!range && deleteBlockRange(editor, range.from, range.to);
}

/** Swap a selected group with one adjacent sibling without splitting it. */
export function moveSelectedBlocks(editor: Editor, direction: 'up' | 'down'): boolean {
  const range = selectedBlockRange(editor.state);
  if (!range) return false;
  const up = direction === 'up';
  const neighborIndex = up ? range.startIndex - 1 : range.endIndex;
  if (neighborIndex < 0 || neighborIndex >= range.parent.childCount) return false;
  const neighbor = range.parent.child(neighborIndex);
  const selected = editor.state.doc.slice(range.from, range.to).content;
  const fragment = up ? selected.append(Fragment.from(neighbor)) : Fragment.from(neighbor).append(selected);
  const startIndex = up ? neighborIndex : range.startIndex;
  const endIndex = up ? range.endIndex : neighborIndex + 1;
  if (!range.parent.canReplace(startIndex, endIndex, fragment)) return false;
  const from = up ? range.from - neighbor.nodeSize : range.from;
  const to = up ? range.to : range.to + neighbor.nodeSize;
  const offset = up ? -neighbor.nodeSize : neighbor.nodeSize;
  const tr = closeHistory(editor.state.tr).replaceWith(from, to, fragment);
  tr.setSelection(range.positions.length === 1 ? NodeSelection.create(tr.doc, range.anchor + offset)
    : new BlockRangeSelection(tr.doc, range.anchor + offset, range.head + offset));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function extendBlockSelection(editor: Editor, direction: -1 | 1): boolean {
  const range = selectedBlockRange(editor.state);
  if (!range) return false;
  const $head = editor.state.doc.resolve(range.head);
  const index = $head.index(), nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= range.parent.childCount) return true;
  const nextPos = direction === 1 ? range.head + $head.nodeAfter!.nodeSize
    : range.head - range.parent.child(nextIndex).nodeSize;
  editor.view.dispatch(editor.state.tr.setSelection(nextPos === range.anchor
    ? NodeSelection.create(editor.state.doc, nextPos)
    : new BlockRangeSelection(editor.state.doc, range.anchor, nextPos)).scrollIntoView());
  return true;
}

/** Call first in editorProps.handleKeyDown when the host has its own shortcuts. */
export function handleBlockSelectionKeyDown(editor: Editor, event: KeyboardEvent): boolean {
  if (!editor.isEditable || event.defaultPrevented || event.isComposing || editor.view.composing || event.keyCode === 229) return false;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, button, [contenteditable="false"], .cm-editor, .monaco-editor')) return false;
  const selected = selectedBlockRange(editor.state);
  if (event.key === 'Escape') {
    if (slashCommandKey.getState(editor.state)?.match) return false;
    if (selected) {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(selected.anchor + 1))));
    } else {
      const pos = getBlockPosFromSelection(editor as Parameters<typeof getBlockPosFromSelection>[0]);
      if (pos === null || !selectBlockAt(editor, pos)) return false;
    }
  } else if (selected && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    extendBlockSelection(editor, event.key === 'ArrowUp' ? -1 : 1);
  } else if (selected && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    // An edge is a handled no-op. Never fall through and move just one node.
    moveSelectedBlocks(editor, event.key === 'ArrowUp' ? 'up' : 'down');
  } else if (selected && !event.altKey && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
    if (!duplicateSelectedBlocks(editor)) return false;
  } else if (selected && !event.metaKey && !event.ctrlKey && !event.altKey && ['Delete', 'Backspace'].includes(event.key)) {
    if (!deleteSelectedBlocks(editor)) return false;
  } else if (selected && event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
    const node = editor.state.doc.nodeAt(selected.anchor);
    if (selected.positions.length === 1 && node?.isAtom && !node.isTextblock) {
      // A divider/embed has no text cursor inside it. Enter opens a real
      // paragraph below instead of snapping back to the selected atom.
      const after = selected.anchor + node.nodeSize;
      if (editor.state.doc.nodeAt(after)?.isTextblock) {
        editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, after + 1)));
      } else if (!insertParagraphNear(editor, selected.anchor, 'below')) return false;
    } else editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(selected.anchor + 1))));
  } else return false;
  event.preventDefault();
  return true;
}

export const BlockSelection = Extension.create({
  name: 'blockSelection',
  priority: 1100,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      props: {
        handleKeyDown: (_view, event) => handleBlockSelectionKeyDown(editor, event),
        decorations(state) {
          const range = selectedBlockRange(state);
          if (!range) return null;
          return DecorationSet.create(state.doc, range.positions.map(pos =>
            Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, { class: 'block-selected' })));
        },
      },
    })];
  },
});
