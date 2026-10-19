import React from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';

export function TableToolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({ editor, selector: ({ editor }) => editor.isActive('table') });
  if (!active || !editor.isEditable) return null;
  const items = [
    { label: '上方加行', run: () => editor.chain().focus().addRowBefore().run() },
    { label: '下方加行', run: () => editor.chain().focus().addRowAfter().run() },
    { label: '左侧加列', run: () => editor.chain().focus().addColumnBefore().run() },
    { label: '右侧加列', run: () => editor.chain().focus().addColumnAfter().run() },
    { label: '删除行', run: () => editor.chain().focus().deleteRow().run() },
    { label: '删除列', run: () => editor.chain().focus().deleteColumn().run() },
    { label: '切换表头', run: () => editor.chain().focus().toggleHeaderRow().run() },
    { label: '合并单元格', run: () => editor.chain().focus().mergeCells().run(), disabled: !editor.can().mergeCells() },
    { label: '拆分单元格', run: () => editor.chain().focus().splitCell().run(), disabled: !editor.can().splitCell() },
    { label: '删除表格', run: () => editor.chain().focus().deleteTable().run() },
  ];
  return <div className="table-toolbar" role="toolbar" aria-label="表格操作">
    <span className="text-xs text-[var(--muted-foreground)]">表格</span>
    {items.map(item => <button key={item.label} type="button" disabled={item.disabled} onMouseDown={event => event.preventDefault()} onClick={item.run}>{item.label}</button>)}
  </div>;
}
