import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './dom';
import { Editor, type JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { documentExtensions } from '../src/components/editor/extensions/document';
import { MarkdownShortcuts } from '../src/components/editor/extensions/MarkdownShortcuts';
import { BlockKeymap } from '../src/components/editor/extensions/BlockKeymap';
import { ListJoin } from '../src/components/editor/extensions/ListJoin';

const editors: Editor[] = [];
const p = (text = '', marks?: any[]): JSONContent => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] } : {}) });
const list = (type: string, texts: string[]): JSONContent => ({ type, ...(type === 'orderedList' ? { attrs: { start: 7 } } : {}), content: texts.map(text => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', ...(type === 'taskList' ? { attrs: { checked: true } } : {}), content: [p(text)] })) });
function make(content: JSONContent[] = [p()]) {
  const editor = new Editor({ extensions: [...documentExtensions({ editable: true }), MarkdownShortcuts, BlockKeymap, ListJoin], content: { type: 'doc', content } });
  editors.push(editor);
  return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });
function caret(editor: Editor, text = '') {
  let found = -1;
  editor.state.doc.descendants((node, pos) => { if (found < 0 && node.isTextblock && node.textContent === text) found = pos + 1; });
  assert.ok(found >= 0);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found)));
}
function input(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, text, () => editor.state.tr.insertText(text, from, to)));
  if (!handled) editor.view.dispatch(editor.state.tr.insertText(text, from, to));
}
function type(editor: Editor, text: string) { for (const char of text) input(editor, char); }

for (const typeName of ['bulletList', 'orderedList', 'taskList']) {
  test(`a language fence turns one ${typeName} item into code and preserves its language`, () => {
    for (const marker of ['```ts ', '···python ', '｀｀｀c++ ']) {
      const editor = make([list(typeName, ['甲', '乙', '丙'])]);
      caret(editor, '乙');
      type(editor, marker);
      assert.deepEqual(editor.getJSON().content!.map(node => node.type), [typeName, 'codeBlock', typeName]);
      const code = editor.state.doc.child(1);
      assert.equal(code.attrs.language, marker.includes('ts') ? 'ts' : marker.includes('python') ? 'python' : 'c++');
      assert.equal(code.textContent, '乙');
      assert.equal(editor.state.doc.firstChild!.textContent, '甲');
      assert.equal(editor.state.doc.lastChild!.textContent, '丙');
      if (typeName === 'orderedList') assert.equal(editor.state.doc.lastChild!.attrs.start, 7);
      assert.equal(backspace(editor), true);
      assert.equal(editor.state.selection.$from.parent.textContent, marker + '乙');
      editor.state.doc.check();
    }
  });
}

for (const typeName of ['bulletList', 'taskList']) {
  test(`numbered Markdown in a ${typeName} item keeps the typed starting number`, () => {
    for (const marker of ['5. ', '12。 ', '3） ']) {
      const editor = make([list(typeName, ['甲', '乙', '丙'])]);
      caret(editor, '乙');
      type(editor, marker);
      const numbered = editor.state.doc.child(1);
      assert.equal(numbered.type.name, 'orderedList');
      assert.equal(numbered.attrs.start, Number.parseInt(marker));
      assert.equal(numbered.textContent, '乙');
      assert.equal(editor.state.doc.lastChild!.textContent, '丙');
      editor.state.doc.check();
    }
  });
}

test('a Markdown link preserves mixed formatting in its label and following input', () => {
  const editor = make([{ type: 'paragraph', content: [
    { type: 'text', text: '前[粗', marks: [{ type: 'bold' }] },
    { type: 'text', text: '斜', marks: [{ type: 'italic' }] },
    { type: 'text', text: '](https://example.com' },
  ] }]);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  input(editor, ')');
  const paragraph = editor.state.doc.firstChild!;
  assert.equal(paragraph.textContent, '前粗斜');
  assert.deepEqual(paragraph.child(0).marks.map(mark => mark.type.name), ['bold']);
  assert.deepEqual(paragraph.child(1).marks.map(mark => mark.type.name).sort(), ['bold', 'link']);
  assert.deepEqual(paragraph.child(2).marks.map(mark => mark.type.name).sort(), ['italic', 'link']);
  type(editor, '后');
  assert.equal(editor.state.doc.firstChild!.lastChild!.marks.some(mark => mark.type.name === 'link'), false);
});

test('a Markdown link keeps active marks even when the whole syntax arrives in one text input', () => {
  const editor = make();
  editor.commands.toggleBold();
  input(editor, '[链接](https://example.com)');
  assert.equal(editor.state.doc.textContent, '链接');
  assert.deepEqual(editor.state.doc.firstChild!.firstChild!.marks.map(mark => mark.type.name).sort(), ['bold', 'link']);
  assert.equal(editor.commands.undoInputRule(), true);
  assert.equal(editor.state.doc.textContent, '[链接](https://example.com)');
});

function backspace(editor: Editor) {
  const event = new window.KeyboardEvent('keydown', { key: 'Backspace', cancelable: true });
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)) ?? false;
}

test('Backspace after a Markdown item conversion restores the input caret before following text', () => {
  const editor = make([list('bulletList', ['甲', '乙', '丙'])]);
  caret(editor, '乙');
  type(editor, '## ');
  assert.equal(backspace(editor), true);
  assert.equal(editor.state.selection.$from.parent.textContent, '## 乙');
  assert.equal(editor.state.selection.$from.parentOffset, 3);
  type(editor, 'X');
  assert.equal(editor.state.doc.firstChild!.child(1).textContent, '## X乙');
  assert.equal(editor.state.doc.firstChild!.lastChild!.textContent, '丙');
});

test('a Markdown link uses committed label text when completing over a selection', () => {
  const editor = make([p('[旧')]);
  editor.commands.setTextSelection({ from: 2, to: 3 });
  input(editor, '新](https://example.com)');
  assert.equal(editor.state.doc.textContent, '新');
  assert.equal(editor.state.doc.firstChild!.firstChild!.marks[0].type.name, 'link');
});

test('a Markdown link preserves existing label marks and marks on a newly committed suffix', () => {
  const editor = make([p('[粗', [{ type: 'bold' }])]);
  editor.commands.setTextSelection(3);
  editor.commands.unsetBold();
  editor.commands.toggleItalic();
  input(editor, '新](https://example.com)');
  const label = editor.state.doc.firstChild!;
  assert.equal(label.textContent, '粗新');
  assert.deepEqual(label.firstChild!.marks.map(mark => mark.type.name).sort(), ['bold', 'link']);
  assert.deepEqual(label.lastChild!.marks.map(mark => mark.type.name).sort(), ['italic', 'link']);
});
