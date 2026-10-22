import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './dom';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { documentExtensions } from '../src/components/editor/extensions/document';
import { BlockKeymap } from '../src/components/editor/extensions/BlockKeymap';
import { ListJoin } from '../src/components/editor/extensions/ListJoin';

const editors: Editor[] = [];
const p = (text = '', marks?: any[]) => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] } : {}) });
const item = (type: string, content: any[], checked = false) => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', ...(type === 'taskList' ? { attrs: { checked } } : {}), content });
const list = (type: string, content: any[], start = 1) => ({ type, ...(type === 'orderedList' ? { attrs: { start } } : {}), content });
function make(content: any[]) {
  const editor = new Editor({ extensions: [...documentExtensions({ editable: true }), BlockKeymap, ListJoin], content: { type: 'doc', content } });
  editors.push(editor);
  return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function caret(editor: Editor, text: string, end = false) {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === text) found = pos + 1 + (end ? node.content.size : 0);
  });
  assert.ok(found >= 0, `missing ${text}`);
  editor.view.dispatch(closeHistory(editor.state.tr).setSelection(TextSelection.create(editor.state.doc, found)));
}
function key(editor: Editor, name: string, options: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', { key: name, cancelable: true, ...options });
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)) ?? false;
}

for (const type of ['bulletList', 'orderedList', 'taskList']) {
  test(`Delete joins sibling ${type} text and preserves children, marks and history`, () => {
    const children = list('bulletList', [item('bulletList', [p('子项')])]);
    const editor = make([list(type, [
      item(type, [p('甲')], true),
      item(type, [p('乙', [{ type: 'bold' }]), children]),
      item(type, [p('丙')], true),
    ], 4)]);
    const original = editor.getJSON();
    caret(editor, '甲', true);
    assert.equal(key(editor, 'Delete'), true);
    const merged = editor.state.doc.firstChild!;
    assert.equal(merged.childCount, 2);
    assert.equal(merged.firstChild!.firstChild!.textContent, '甲乙');
    assert.equal(merged.firstChild!.childCount, 2);
    assert.equal(merged.firstChild!.child(1).textContent, '子项');
    assert.equal(merged.firstChild!.firstChild!.lastChild!.marks[0].type.name, 'bold');
    assert.equal(merged.lastChild!.textContent, '丙');
    if (type === 'taskList') assert.equal(merged.firstChild!.attrs.checked, true);
    if (type === 'orderedList') assert.equal(merged.attrs.start, 4);
    assert.equal(editor.state.selection.$from.parentOffset, 1);
    editor.state.doc.check();
    const result = editor.getJSON();
    editor.commands.undo();
    assert.deepEqual(editor.getJSON(), original);
    editor.commands.redo();
    assert.deepEqual(editor.getJSON(), result);
  });

  test(`Enter, Tab and Shift+Tab retain ${type} item order`, () => {
    const editor = make([list(type, [item(type, [p('甲乙')]), item(type, [p('丙')])], 4)]);
    caret(editor, '甲乙');
    editor.commands.setTextSelection(editor.state.selection.from + 1);
    key(editor, 'Enter');
    assert.equal(editor.state.doc.firstChild!.childCount, 3);
    assert.deepEqual(Array.from({ length: 3 }, (_, i) => editor.state.doc.firstChild!.child(i).textContent), ['甲', '乙', '丙']);
    key(editor, 'Tab');
    assert.equal(editor.state.doc.firstChild!.childCount, 2);
    assert.equal(editor.state.doc.firstChild!.firstChild!.lastChild!.type.name, type);
    key(editor, 'Tab', { shiftKey: true });
    assert.equal(editor.state.doc.firstChild!.childCount, 3);
    assert.equal(editor.state.selection.$from.parent.textContent, '乙');
    editor.state.doc.check();
  });
}

test('Delete joins from the last paragraph of an item without flattening its earlier paragraph', () => {
  const editor = make([list('bulletList', [item('bulletList', [p('标题'), p('说明')]), item('bulletList', [p('下一项')])])]);
  caret(editor, '说明', true);
  key(editor, 'Delete');
  assert.equal(editor.state.doc.firstChild!.childCount, 1);
  assert.equal(editor.state.doc.firstChild!.firstChild!.childCount, 2);
  assert.equal(editor.state.doc.firstChild!.firstChild!.firstChild!.textContent, '标题');
  assert.equal(editor.state.doc.firstChild!.firstChild!.lastChild!.textContent, '说明下一项');
});

test('Delete into an empty sibling keeps its nested tasks', () => {
  const editor = make([list('taskList', [
    item('taskList', [p('甲')]),
    item('taskList', [p(), list('taskList', [item('taskList', [p('子任务')], true)])], true),
  ])]);
  caret(editor, '甲', true);
  key(editor, 'Delete');
  const merged = editor.state.doc.firstChild!.firstChild!;
  assert.equal(editor.state.doc.firstChild!.childCount, 1);
  assert.equal(merged.firstChild!.textContent, '甲');
  assert.equal(merged.attrs.checked, false);
  assert.equal(merged.lastChild!.firstChild!.attrs.checked, true);
  editor.state.doc.check();
});

test('Delete at the end of a column list does not pull text from the next column', () => {
  const editor = make([{ type: 'columnList', attrs: { columns: 2 }, content: [
    { type: 'column', content: [list('bulletList', [item('bulletList', [p('左')])])] },
    { type: 'column', content: [list('bulletList', [item('bulletList', [p('右')])])] },
  ] }]);
  const original = editor.getJSON();
  caret(editor, '左', true);
  key(editor, 'Delete');
  assert.deepEqual(editor.getJSON(), original);
});
