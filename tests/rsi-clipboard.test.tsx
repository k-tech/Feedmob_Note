import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './dom';
import { Editor, type JSONContent } from '@tiptap/core';
import { documentExtensions } from '../src/components/editor/extensions/document';
import { EditorClipboard } from '../src/components/editor/extensions/EditorClipboard';
import { ListJoin } from '../src/components/editor/extensions/ListJoin';

const editors: Editor[] = [];
const p = (text = ''): JSONContent => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
function make(content: JSONContent[] = [p()]) {
  const editor = new Editor({ extensions: [...documentExtensions({ editable: true }), EditorClipboard, ListJoin], content: { type: 'doc', content } });
  editors.push(editor);
  return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function paste(editor: Editor, text: string, html = '') {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' } });
  if (html) editor.view.pasteHTML(html, event as ClipboardEvent);
  else editor.view.pasteText(text, event as ClipboardEvent);
}
function copy(editor: Editor) {
  editor.commands.selectAll();
  return editor.view.serializeForClipboard(editor.state.selection.content());
}
const word = (marker: string, text: string, level = 1) => `<p class="MsoListParagraph" style="mso-list:l0 level${level} lfo1"><span style="mso-list:Ignore">${marker}<span>&nbsp; </span></span>${text}</p>`;

for (const text of ['*literal*', '`ticks`', '*literal* `ticks`']) {
  test(`plain-text clipboard preserves literal ${text} through three round-trips`, () => {
    const editor = make([p(text)]);
    const original = editor.getJSON();
    for (let round = 0; round < 3; round++) {
      const clipboard = copy(editor);
      editor.commands.clearContent();
      paste(editor, clipboard.text);
      assert.deepEqual(editor.getJSON(), original);
    }
  });
}

test('plain HTML wrappers decode escaped Markdown once and paste undo/redo is atomic', () => {
  const editor = make([p('保留')]);
  const original = editor.getJSON();
  editor.commands.selectAll();
  paste(editor, '\\*字面\\*\n\\`代码符号\\`', '<p>\\*字面\\*</p><p>\\`代码符号\\`</p>');
  assert.deepEqual(editor.getJSON().content, [p('*字面*'), p('`代码符号`')]);
  const result = editor.getJSON();
  editor.commands.undo();
  assert.deepEqual(editor.getJSON(), original);
  editor.commands.redo();
  assert.deepEqual(editor.getJSON(), result);
});

test('Word/WPS list-kind switches preserve every root list, order, start and inline marks', () => {
  const editor = make();
  paste(editor, '5. 编号\n• 圆点\n2. 后续', word('5.', '<strong>编号</strong>') + word('•', '圆点') + word('2.', '后续'));
  const doc = editor.state.doc;
  assert.deepEqual(editor.getJSON().content!.map(node => node.type), ['orderedList', 'bulletList', 'orderedList']);
  assert.deepEqual([doc.child(0).textContent, doc.child(1).textContent, doc.child(2).textContent], ['编号', '圆点', '后续']);
  assert.equal(doc.child(0).attrs.start, 5);
  assert.equal(doc.child(2).attrs.start, 2);
  assert.equal(doc.firstChild!.firstChild!.firstChild!.firstChild!.marks[0].type.name, 'bold');
  doc.check();
});

test('Word/WPS nested list-kind switches retain their parent and following root item', () => {
  const editor = make();
  paste(editor, '', word('1.', '父项') + word('•', '圆点子项', 2) + word('3.', '编号子项', 2) + word('2.', '后项'));
  const list = editor.state.doc.firstChild!;
  assert.equal(list.type.name, 'orderedList');
  assert.equal(list.childCount, 2);
  const parent = list.firstChild!;
  assert.deepEqual(Array.from({ length: parent.childCount }, (_, i) => parent.child(i).type.name), ['paragraph', 'bulletList', 'orderedList']);
  assert.equal(parent.child(2).attrs.start, 3);
  assert.equal(list.lastChild!.textContent, '后项');
  editor.state.doc.check();
});

test('plain-text copy escapes only asterisks and backticks, without adding blank lines', () => {
  const lines = ['# 普通标题文字', '> 普通引用文字', '- 普通短横线', '+ 普通加号', '1. 普通编号文字', '', 'snake_case [标签] *字面* `反引号`'];
  const editor = make(lines.map(p));
  assert.equal(copy(editor).text, lines.slice(0, -1).join('\n') + '\nsnake_case [标签] \\*字面\\* \\`反引号\\`');
});

test('escaped-only clipboard text retains paragraph whitespace, blank blocks and literal backslashes', () => {
  const editor = make(['  *literal*  ', '', 'C:\\notes\\*', '`ticks`'].map(p));
  const original = editor.getJSON();
  for (let round = 0; round < 3; round++) {
    const clipboard = copy(editor);
    editor.commands.clearContent();
    paste(editor, clipboard.text);
    assert.deepEqual(editor.getJSON(), original);
  }
});
