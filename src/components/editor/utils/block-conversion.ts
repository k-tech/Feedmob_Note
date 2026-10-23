import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

export const BLOCK_TYPES = [
  ['paragraph', '文本'], ['heading1', '一级标题'], ['heading2', '二级标题'], ['heading3', '三级标题'],
  ['bulletList', '无序列表'], ['orderedList', '有序列表'], ['taskList', '待办清单'], ['blockquote', '引用'], ['callout', '提示块'], ['toggle', '折叠列表'], ['codeBlock', '代码块'],
] as const;
export type BlockType = typeof BLOCK_TYPES[number][0] | 'columns';

function convertible(node: ProseMirrorNode | null | undefined): node is ProseMirrorNode {
  return !!node && (node.isTextblock || (['listItem', 'taskItem', 'toggle', 'callout', 'blockquote'].includes(node.type.name) && !!node.firstChild?.isTextblock));
}

export function canConvertBlock(editor: Editor, pos: number): boolean {
  return convertible(editor.state.doc.nodeAt(pos));
}

/**
 * Convert the block at `pos` inside `tr`, keeping neighbouring list items and
 * all nested children. No text round-trip: inline marks survive conversion.
 *
 * A list item leaving its list splits the list. Like Notion, each remaining
 * part is numbered on its own (it keeps the list's own start, not the
 * position it used to have); adjacent parts of one kind are rejoined by
 * ListJoin, so numbering continues again once they touch.
 *
 * Shared by the block menu, slash commands, Backspace and Markdown input rules.
 * Markdown may supply a list start or code language through attrs.
 * Returns the caret position for the converted block, or null when the
 * conversion is not possible (the transaction is then unusable).
 */
export function applyBlockConversion(tr: Transaction, pos: number, type: BlockType, range?: { from: number; to: number }, attrs?: Record<string, unknown>): number | null {
  const original = tr.doc.nodeAt(pos);
  if (!convertible(original)) return null;
  if (range && (range.from < pos || range.to < range.from || range.to > pos + original.nodeSize)) return null;
  const { schema } = tr.doc.type;
  if (range) tr.delete(range.from, range.to);
  const node = tr.doc.nodeAt(pos)!;
  const item = ['listItem', 'taskItem'].includes(node.type.name);
  const container = !node.isTextblock;
  const textBlock = container ? node.firstChild! : node;
  const paragraph = schema.nodes.paragraph.create(null, textBlock.content);
  const trailing = container ? Array.from({ length: node.childCount - 1 }, (_, i) => node.child(i + 1)) : [];
  try {
    let converted;
    let siblings = trailing;
    if (type === 'columns') {
      const $pos = tr.doc.resolve(pos);
      const source = item ? $pos.parent.type.createChecked($pos.parent.attrs, [node]) : node;
      converted = schema.nodes.columnList.createChecked({ columns: 2 }, [
        schema.nodes.column.createChecked(null, [source]),
        schema.nodes.column.createChecked(null, [schema.nodes.paragraph.create()]),
      ]);
      siblings = [];
    } else if (type === 'toggle') {
      converted = schema.nodes.toggle.createChecked({ collapsed: false }, [paragraph, ...trailing, ...(trailing.length ? [] : [schema.nodes.paragraph.create()])]);
      siblings = [];
    } else if (type.startsWith('heading')) converted = schema.nodes.heading.createChecked({ level: Number(type.slice(-1)) }, textBlock.content);
    else if (type === 'paragraph') converted = paragraph;
    else if (type === 'codeBlock') converted = schema.nodes.codeBlock.createChecked(attrs, textBlock.textContent ? schema.text(textBlock.textContent) : null);
    else if (['bulletList', 'orderedList', 'taskList'].includes(type)) {
      const itemType = schema.nodes[type === 'taskList' ? 'taskItem' : 'listItem'];
      converted = schema.nodes[type].createChecked(attrs, [itemType.createChecked(type === 'taskList' ? { checked: node.attrs.checked ?? false } : null, [paragraph, ...trailing])]);
      siblings = [];
    } else {
      converted = schema.nodes[type].createChecked(type === 'callout' ? { type: 'tip' } : null, [paragraph, ...trailing]);
      siblings = [];
    }
    let selectionPos = pos + 1;
    if (item) {
      const $pos = tr.doc.resolve(pos);
      const list = $pos.parent;
      const listPos = $pos.before();
      const index = $pos.index();
      const before = [], after = [];
      for (let i = 0; i < list.childCount; i++) {
        if (i < index) before.push(list.child(i));
        if (i > index) after.push(list.child(i));
      }
      const prefix = before.length ? [list.type.createChecked(list.attrs, before)] : [];
      const suffix = after.length ? [list.type.createChecked(list.attrs, after)] : [];
      tr.replaceWith(listPos, listPos + list.nodeSize, [...prefix, converted, ...siblings, ...suffix]);
      selectionPos = listPos + (prefix[0]?.nodeSize ?? 0) + 1;
    } else tr.replaceWith(pos, pos + node.nodeSize, [converted, ...siblings]);
    tr.doc.check();
    tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos)));
    return selectionPos;
  } catch { return null; }
}

export function convertBlock(editor: Editor, pos: number, type: BlockType, range?: { from: number; to: number }): boolean {
  const tr = editor.state.tr;
  if (applyBlockConversion(tr, pos, type, range) === null) return false;
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}
