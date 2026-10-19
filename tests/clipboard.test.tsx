import './dom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { TaskItem } from '../src/components/editor/extensions/TaskItem';
import Link from '@tiptap/extension-link';
import { EditorClipboard } from '../src/components/editor/extensions/EditorClipboard';
import { BlockSelection, BlockRangeSelection } from '../src/components/editor/extensions/BlockSelection';
import { Column, ColumnList } from '../src/components/editor/extensions/ColumnsExtension';
import { HtmlNode } from '../src/components/editor/extensions/HtmlNode';
import { ImageNode } from '../src/components/editor/extensions/ImageNode';
import { TableExtensions } from '../src/components/editor/extensions/TableExtensions';
import { serializeBlocks } from '../src/components/editor/utils/clipboard';

const TASKS = ['Capital One Shopping <> LG 后续 gross spend 的录入', '结合已梳理的 SOP 规范，推进日常录入的智能体化与自动化落地', 'Omarchy 系统深度调研（暂停）', '持续推进蒸馏版 Notion （Minework）后续功能与内容完善', '在远程服务器上做五小时测试任务', 'Binance KZ/KW <> Remerge Spend 后续录入', '记录日常内容，完成后续实习报告'];
const SOURCE = TASKS.map((text, i) => `- [${i === 2 ? 'x' : ' '}] ${text}`).join('\n');
const p = (text = '') => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
function make(content: any[] = [p()]) {
  return new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), Link, ColumnList, Column, HtmlNode, ImageNode, ...TableExtensions, BlockSelection, EditorClipboard], content: { type: 'doc', content } });
}
function paste(editor: Editor, text: string, html = '') {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' } });
  if (html) editor.view.pasteHTML(html, event as ClipboardEvent);
  else editor.view.pasteText(text, event as ClipboardEvent);
}
function copy(editor: Editor) {
  return editor.view.serializeForClipboard(editor.state.selection.content());
}
function key(editor: Editor, name: string, options: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', { key: name, cancelable: true, ...options });
  editor.view.someProp('handleKeyDown', fn => fn(editor.view, event));
}
function assertTasks(editor: Editor) {
  const list = editor.state.doc.firstChild!;
  assert.equal(editor.state.doc.childCount, 1);
  assert.equal(list.type.name, 'taskList');
  assert.equal(list.childCount, 7);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => list.child(i).textContent), TASKS);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => list.child(i).attrs.checked), [false, false, true, false, false, false, false]);
  editor.state.doc.check();
}

test('seven user tasks round-trip three times through plain text and native HTML without growing blank lines', () => {
  for (const rich of [false, true]) {
    const editor = make();
    try {
      paste(editor, SOURCE.replace(/\n/g, '\r\n\r\n'));
      for (let round = 0; round < 3; round++) {
        assertTasks(editor);
        editor.commands.selectAll();
        const clipboard = copy(editor);
        assert.equal(clipboard.text, SOURCE);
        assert.equal((clipboard.text.match(/\n/g) || []).length, 6);
        editor.commands.clearContent();
        paste(editor, clipboard.text, rich ? clipboard.dom.innerHTML : '');
      }
      assertTasks(editor);
      const restored = make(editor.getJSON().content);
      try { assertTasks(restored); } finally { restored.destroy(); }
    } finally { editor.destroy(); }
  }
});

test('real Notion list shape restores checks and keeps bold text, links, nested lists and neighboring prose', () => {
  const editor = make();
  try {
    paste(editor, SOURCE, '<p>before</p><ul><li>[ ]  <strong>first</strong> <a href="https://example.com">link</a><ul><li>[x] child</li></ul></li><li><p><strong>[X]</strong>  done</p></li><li>ordinary</li><li>[ ] last</li></ul><p>after</p><!-- notionvc: sample -->');
    assert.equal(editor.state.doc.firstChild!.textContent, 'before');
    const list = editor.state.doc.child(1);
    assert.equal(list.type.name, 'taskList');
    assert.equal(list.childCount, 2);
    assert.equal(list.lastChild!.attrs.checked, true);
    assert.equal(list.firstChild!.firstChild!.firstChild!.marks[0].type.name, 'bold');
    assert.equal(list.firstChild!.child(1).firstChild!.attrs.checked, true);
    assert.ok(editor.getHTML().includes('href="https://example.com"'));
    assert.equal(editor.state.doc.child(2).type.name, 'bulletList');
    assert.equal(editor.state.doc.child(3).type.name, 'taskList');
    assert.equal(editor.state.doc.lastChild!.textContent, 'after');
    editor.state.doc.check();
  } finally { editor.destroy(); }
});

test('partial selection copies just selected text while complete block selections share semantic serialization', () => {
  const editor = make();
  try {
    paste(editor, '- [x] first\n- [ ] second');
    editor.commands.setTextSelection({ from: 4, to: 7 });
    assert.equal(copy(editor).text, 'irs');
    const list = editor.state.doc.firstChild!;
    editor.view.dispatch(editor.state.tr.setSelection(new BlockRangeSelection(editor.state.doc, 1, 1 + list.firstChild!.nodeSize)));
    // Selecting taskItem siblings omits the list container from the Slice.
    assert.equal(copy(editor).text, '- [x] first\n- [ ] second');
    editor.commands.selectAll();
    assert.equal(copy(editor).text, '- [x] first\n- [ ] second');
  } finally { editor.destroy(); }
});

test('nested tasks, continuation paragraphs, literal Markdown and hard breaks retain meaning in text round-trips', () => {
  const editor = make();
  try {
    paste(editor, '- [ ] parent\n  continued  \n  next line\n\n  second paragraph\n  - [x] child\n- [ ] tail');
    const before = editor.getJSON();
    editor.commands.selectAll();
    const text = copy(editor).text;
    editor.commands.clearContent();
    paste(editor, text);
    assert.deepEqual(editor.getJSON(), before);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('*literal* [brackets]')] }] }] });
    editor.commands.selectAll();
    const literal = copy(editor).text;
    editor.commands.clearContent(); paste(editor, literal);
    assert.equal(editor.state.doc.firstChild!.firstChild!.textContent, '*literal* [brackets]');
    assert.equal(editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.marks.length, 0);
  } finally { editor.destroy(); }
});

test('common Markdown uses the same editor: headings, quotes, lists, tables, formatting and fenced code', () => {
  const editor = make();
  try {
    paste(editor, '# Title\n\n> quoted\n\n1. first\n2. second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n**bold** and [link](https://example.com)\n\n```js\n- [ ] literal\n```');
    const types: string[] = [];
    editor.state.doc.forEach(node => types.push(node.type.name));
    assert.deepEqual(types, ['heading', 'blockquote', 'orderedList', 'table', 'paragraph', 'codeBlock']);
    assert.equal(editor.state.doc.lastChild!.textContent, '- [ ] literal');
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 0);
    assert.equal(editor.state.doc.child(4).firstChild!.marks[0].type.name, 'bold');
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.state.doc.content.size, 2);
    assert.equal(editor.commands.redo(), true);
  } finally { editor.destroy(); }
});

test('internal rich slices keep custom block attributes, column widths, tables and images', () => {
  const editor = make([{ type: 'columnList', content: [{ type: 'column', attrs: { width: 2 }, content: [{ type: 'htmlPreview', attrs: { title: 'HTML sample', code: '<b>test</b>', blockWidth: 80, blockHeight: 320 } }] }, { type: 'column', attrs: { width: 1 }, content: [{ type: 'image', attrs: { src: 'https://example.com/image.png', caption: 'caption', alt: 'alt', blockWidth: 75 } }] }] }]);
  try {
    const before = editor.getJSON();
    editor.commands.selectAll(); const clipboard = copy(editor);
    assert.ok(clipboard.dom.querySelector('[data-pm-slice]'));
    const restored = make();
    try { paste(restored, clipboard.text, clipboard.dom.innerHTML); assert.deepEqual(restored.getJSON(), before); }
    finally { restored.destroy(); }
  } finally { editor.destroy(); }
});

test('native task keys: Enter creates a peer, Shift Enter stays within it, Tab nests and Shift Tab lifts', () => {
  const editor = make();
  try {
    paste(editor, '- [x] first\n- [ ] second');
    editor.commands.setTextSelection(8);
    key(editor, 'Enter');
    assert.equal(editor.state.doc.firstChild!.childCount, 3);
    assert.equal(editor.state.doc.firstChild!.child(1).attrs.checked, false);
    key(editor, 'Enter', { shiftKey: true });
    assert.equal(editor.state.doc.firstChild!.childCount, 3);
    assert.equal(editor.state.doc.firstChild!.child(1).firstChild!.firstChild!.type.name, 'hardBreak');
    key(editor, 'Tab');
    assert.equal(editor.state.doc.firstChild!.childCount, 2);
    assert.equal(editor.state.doc.firstChild!.firstChild!.child(1).type.name, 'taskList');
    key(editor, 'Tab', { shiftKey: true });
    assert.equal(editor.state.doc.firstChild!.childCount, 3);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', content: [p()] }] }] });
    editor.commands.setTextSelection(3); key(editor, 'Enter');
    assert.equal(editor.state.doc.firstChild!.type.name, 'paragraph');
  } finally { editor.destroy(); }
});

test('native rich task paste into an empty checkbox creates peers and undoes in one step', () => {
  const source = make(); const editor = make([{ type: 'taskList', content: [{ type: 'taskItem', content: [p()] }] }]);
  try {
    paste(source, SOURCE); source.commands.selectAll(); const clipboard = copy(source);
    editor.commands.setTextSelection(3); const before = editor.getJSON();
    paste(editor, clipboard.text, clipboard.dom.innerHTML); assertTasks(editor);
    assert.equal(editor.commands.undo(), true); assert.deepEqual(editor.getJSON(), before);
    assert.equal(editor.commands.redo(), true); assertTasks(editor);
    assert.equal(serializeBlocks(editor.state.doc.content), SOURCE);
  } finally { source.destroy(); editor.destroy(); }
});

test('typed checkbox shortcuts match pasted tasks and convert only the current bullet', () => {
  function type(editor: Editor, text: string) {
    for (const char of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp('handleTextInput', fn => fn(editor.view, from, to, char, () => editor.state.tr.insertText(char)));
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char));
    }
  }
  for (const prefix of ['- [ ] ', '- [x] ', '[X] ', '* [ ] ']) {
    const editor = make();
    try {
      type(editor, prefix + 'task');
      assert.equal(editor.state.doc.firstChild!.type.name, 'taskList');
      assert.equal(editor.state.doc.firstChild!.firstChild!.attrs.checked, /[xX]/.test(prefix));
      assert.equal(editor.state.doc.firstChild!.textContent, 'task');
    } finally { editor.destroy(); }
  }
  const editor = make([{ type: 'bulletList', content: [{ type: 'listItem', content: [p('before')] }, { type: 'listItem', content: [p()] }, { type: 'listItem', content: [p('after')] }] }]);
  try {
    let pos = 0;
    editor.state.doc.descendants((node, at) => { if (node.type.name === 'paragraph' && !node.content.size) pos = at + 1; });
    editor.commands.setTextSelection(pos); type(editor, '[x] task');
    assert.equal(editor.state.doc.child(0).textContent, 'before');
    assert.equal(editor.state.doc.child(1).type.name, 'taskList');
    assert.equal(editor.state.doc.child(1).firstChild!.attrs.checked, true);
    assert.equal(editor.state.doc.child(2).textContent, 'after');
    editor.state.doc.check();
  } finally { editor.destroy(); }
});

test('Backspace merges task text without empty containers, rich HTML is not formatted twice, and code paste stays literal', () => {
  const editor = make();
  try {
    paste(editor, '- [ ] first\n- [x] second');
    editor.commands.setTextSelection(3 + editor.state.doc.firstChild!.firstChild!.nodeSize);
    key(editor, 'Backspace');
    assert.equal(editor.state.doc.firstChild!.childCount, 1);
    assert.equal(editor.state.doc.firstChild!.textContent, 'firstsecond');
    editor.commands.clearContent();
    paste(editor, '*literal*', '<p><strong>*literal*</strong> <a href="https://example.com">link</a></p>');
    assert.equal(editor.state.doc.firstChild!.textContent, '*literal* link');
    assert.equal(editor.state.doc.firstChild!.firstChild!.marks[0].type.name, 'bold');
    editor.commands.setContent({ type: 'doc', content: [{ type: 'codeBlock' }] });
    editor.commands.setTextSelection(1); paste(editor, SOURCE);
    assert.equal(editor.state.doc.firstChild!.textContent, SOURCE);
    assert.equal(copy(editor).text, '');
  } finally { editor.destroy(); }
});

test('embedded image bytes stay out of text summaries and formatted text keeps boundary spaces', () => {
  const editor = make([{ type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', caption: '截图' } }, { type: 'paragraph', content: [{ type: 'text', text: 'bold ', marks: [{ type: 'bold' }] }, { type: 'text', text: 'tail' }] }]);
  try {
    editor.commands.selectAll(); const clipboard = copy(editor);
    assert.equal(clipboard.text, '[图片：截图]\n\n**bold** tail');
    assert.ok(!serializeBlocks(editor.state.doc.content).includes('base64'));
    assert.ok(clipboard.dom.innerHTML.includes('data:image/png;base64,'));
    editor.commands.clearContent(); paste(editor, '**bold** tail');
    assert.equal(editor.state.doc.firstChild!.firstChild!.marks[0].type.name, 'bold');
    assert.equal(editor.state.doc.firstChild!.textContent, 'bold tail');
  } finally { editor.destroy(); }
});
