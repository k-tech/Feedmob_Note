import './dom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Slice } from '@tiptap/pm/model';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Column, ColumnList } from '../src/components/editor/extensions/ColumnsExtension';
import { EditorClipboard } from '../src/components/editor/extensions/EditorClipboard';
import { parseMarkdown } from '../src/components/editor/utils/markdown';

const CHECKLIST = [
  '- [ ] Customer A <> LG 后续 gross spend 的录入',
  '- [ ] 结合已梳理的 SOP 规范，推进日常录入的自动化',
  '- [x] Linux 系统深度调研（暂停）',
  '- [ ] 持续推进 Minework 后续功能与内容完善',
  '- [ ] 在远程服务器上做测试任务',
  '- [ ] Campaign KZ/KW <> Partner Spend 后续录入',
  '- [ ]  记录日常内容，完成后续报告',
].join('\n');
const p = (text = '') => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
function make(content: any[] = [p()]) {
  return new Editor({ extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), ColumnList, Column, EditorClipboard], content: { type: 'doc', content } });
}
function paste(editor: Editor, text: string, html = '') {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' } });
  editor.view.pasteText(text, event as ClipboardEvent);
}

test('a seven-line Markdown checklist preserves literal text, order and the third checked item', () => {
  const editor = make();
  try {
    paste(editor, CHECKLIST);
    const list = editor.state.doc.firstChild!;
    assert.equal(list.type.name, 'taskList');
    assert.equal(list.childCount, 7);
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => list.child(i).attrs.checked), [false, false, true, false, false, false, false]);
    assert.deepEqual(Array.from({ length: 7 }, (_, i) => list.child(i).textContent), CHECKLIST.split('\n').map(line => line.replace(/^- \[[ x]\]\s+/, '')));
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 7);
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]:checked').length, 1);
    assert.match(editor.getText(), /<> LG/);
    assert.ok(!editor.getText().includes('- [ ]'));
    editor.state.doc.check();
    const restored = make(editor.getJSON().content);
    try { assert.deepEqual(restored.getJSON(), editor.getJSON()); } finally { restored.destroy(); }
  } finally { editor.destroy(); }
});

test('task parsing supports uppercase X, bullet variants, CRLF, blank tasks and nested indentation', () => {
  const editor = make();
  paste(editor, '* [X] parent\r\n  + [ ] child\r\n    - [x] grandchild\r\n- [ ]');
  try {
    const list = editor.state.doc.firstChild!;
    assert.equal(list.childCount, 2);
    assert.equal(list.firstChild!.attrs.checked, true);
    const nested = list.firstChild!.child(1);
    assert.equal(nested.type.name, 'taskList');
    assert.equal(nested.firstChild!.attrs.checked, false);
    assert.equal(nested.firstChild!.child(1).firstChild!.attrs.checked, true);
    assert.equal(list.lastChild!.textContent, '');
    editor.state.doc.check();
  } finally { editor.destroy(); }
});

test('mixed prose and task lists keep surrounding text, blank lines and literal HTML intact', () => {
  const editor = make();
  try {
    paste(editor, '今日计划\n\n- [ ] <script>alert(1)</script> & A <> B\n- [x] 完成\n\n明日继续');
    assert.equal(editor.state.doc.childCount, 3);
    assert.equal(editor.state.doc.child(1).type.name, 'taskList');
    assert.equal(editor.view.dom.querySelector('script'), null);
    assert.match(editor.getText(), /<script>alert\(1\)<\/script> & A <> B/);
    assert.match(editor.getText(), /^今日计划/);
    assert.match(editor.getText(), /明日继续$/);
  } finally { editor.destroy(); }
});

test('ordinary text, code fences, indented code and code-block destinations stay literal', () => {
  const sample = make();
  try {
    assert.equal(parseMarkdown('plain text', sample.schema), null);
    const nodes = parseMarkdown('```markdown\n- [ ] literal\n```\n- [x] real', sample.schema)!;
    assert.equal(nodes.firstChild!.type.name, 'codeBlock');
    assert.equal(nodes.firstChild!.textContent, '- [ ] literal');
    assert.equal(nodes.lastChild!.type.name, 'taskList');
    assert.equal(parseMarkdown('    - [ ] code', sample.schema)!.firstChild!.type.name, 'codeBlock');
  } finally { sample.destroy(); }
  const editor = make([{ type: 'codeBlock' }]);
  try {
    paste(editor, CHECKLIST);
    assert.equal(editor.state.doc.firstChild!.type.name, 'codeBlock');
    assert.equal(editor.state.doc.firstChild!.textContent, CHECKLIST);
    assert.equal(editor.view.dom.querySelector('input[type="checkbox"]'), null);
  } finally { editor.destroy(); }
});

test('paste replaces only selected text, preserves surrounding paragraphs and undoes once', () => {
  const editor = make([p('before'), p('replace me'), p('after')]);
  try {
    editor.commands.setTextSelection({ from: 9, to: 19 });
    const before = editor.getJSON();
    paste(editor, CHECKLIST);
    assert.match(editor.getText(), /^before/);
    assert.match(editor.getText(), /after$/);
    assert.ok(!editor.getText().includes('replace me'));
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before);
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.view.dom.querySelectorAll('input[type="checkbox"]').length, 7);
  } finally { editor.destroy(); }
});

test('pasting into an empty checkbox creates peers, and pasting into a column stays in that column', () => {
  const editor = make([{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p()] }] }]);
  try {
    editor.commands.setTextSelection(3);
    paste(editor, '- [x] first\n- [ ] second');
    assert.equal(editor.state.doc.firstChild!.childCount, 2);
    assert.equal(editor.state.doc.firstChild!.firstChild!.attrs.checked, true);
    assert.equal(editor.state.doc.firstChild!.firstChild!.childCount, 1);
    editor.commands.setContent({ type: 'doc', content: [{ type: 'columnList', content: [{ type: 'column', content: [p()] }, { type: 'column', content: [p('keep right')] }] }] });
    editor.commands.setTextSelection(3);
    paste(editor, CHECKLIST);
    const row = editor.state.doc.firstChild!;
    assert.equal(row.child(0).firstChild!.type.name, 'taskList');
    assert.equal(row.child(0).firstChild!.childCount, 7);
    assert.equal(row.child(1).textContent, 'keep right');
    editor.state.doc.check();
  } finally { editor.destroy(); }
});

test('image files and read-only documents do not enter Markdown parsing', () => {
  const editor = make();
  try {
    const slice = new Slice(editor.state.doc.content, 0, 0);
    const event = { clipboardData: { files: [], getData: (type: string) => type === 'text/plain' ? '- [ ] task' : '' }, preventDefault() { throw new Error('must not intercept'); } } as any;
    event.clipboardData.files = [new window.File(['x'], 'a.png', { type: 'image/png' })];
    assert.equal(editor.view.someProp('handlePaste', fn => fn(editor.view, event, slice)), undefined);
    editor.setEditable(false);
    event.clipboardData.files = [];
    assert.equal(editor.view.someProp('handlePaste', fn => fn(editor.view, event, slice)), undefined);
  } finally { editor.destroy(); }
});


test('a single completed task pasted into a paragraph preserves its checkbox and both text fragments', () => {
  const editor = make([p('prefix suffix')]);
  try {
    editor.commands.setTextSelection(8);
    paste(editor, '- [X] done');
    assert.equal(editor.state.doc.childCount, 3);
    assert.equal(editor.state.doc.child(0).textContent, 'prefix ');
    assert.equal(editor.state.doc.child(1).firstChild!.attrs.checked, true);
    assert.equal(editor.state.doc.child(2).textContent, 'suffix');
    editor.state.doc.check();
  } finally { editor.destroy(); }
});

test('browser HTML paragraph wrappers still recognize task source without losing native rich lists', () => {
  const editor = make();
  try {
    const html = '<p>- [ ] first &lt;&gt; item</p><p>- [x] done</p>';
    const text = '- [ ] first <> item\n- [x] done';
    const event = { clipboardData: { files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' }, preventDefault() {} } as any;
    editor.view.pasteHTML(html, event);
    assert.equal(editor.state.doc.firstChild!.type.name, 'taskList');
    assert.equal(editor.state.doc.firstChild!.childCount, 2);
    assert.equal(editor.state.doc.firstChild!.firstChild!.textContent, 'first <> item');
    assert.equal(editor.state.doc.firstChild!.lastChild!.attrs.checked, true);
    editor.commands.clearContent();
    const native = '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>native</p></li></ul>';
    event.clipboardData.getData = (type: string) => type === 'text/html' ? native : type === 'text/plain' ? '- [x] native' : '';
    editor.view.pasteHTML(native, event);
    assert.equal(editor.state.doc.firstChild!.type.name, 'taskList');
    assert.equal(editor.state.doc.firstChild!.firstChild!.attrs.checked, true);
  } finally { editor.destroy(); }
});

const USER_LIST = [
  ['Capital One Shopping <> LG 后续 spend 手动录入', false], ['Binance <> Kayzen TH Spend 后续 spend 手动录入', true],
  ['结合已梳理的 SOP 规范，推进日常录入的智能体化与自动化落地', false], ['Omarchy 系统深度调研（暂停）', true],
  ['持续推进蒸馏版 Notion / Minework 后续功能与内容完善', false], ['在远程服务器上做五小时测试任务', false],
  ['Binance TH <> Remerge Spend 后续录入', false], ['完成后续实习报告', false],
] as const;
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function pasteHTML(editor: Editor, html: string, text: string) {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '' } });
  editor.view.pasteHTML(html, event as ClipboardEvent);
}

for (const [source, html] of [
  ['a rendered Markdown view (GitHub, previews)', '<ul class="contains-task-list">' + USER_LIST.map(([t, c]) => `<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled${c ? ' checked' : ''}> ${escape(t)}</li>`).join('') + '</ul>'],
  ['a chat app (checkbox inside a label)', '<ul>' + USER_LIST.map(([t, c]) => `<li><p><label><input type="checkbox"${c ? ' checked=""' : ''} disabled=""></label> <span>${escape(t)}</span></p></li>`).join('') + '</ul>'],
  ['a document using ☐ / ☑ characters', '<ul>' + USER_LIST.map(([t, c]) => `<li>${c ? '☑' : '☐'} ${escape(t)}</li>`).join('') + '</ul>'],
] as const) {
  test(`a checklist copied from ${source} pastes as tasks, not bullets`, () => {
    const editor = make();
    try {
      const text = USER_LIST.map(([t, c]) => `- [${c ? 'x' : ' '}] ${t}`).join('\n');
      pasteHTML(editor, html, text);
      const list = editor.state.doc.firstChild!;
      assert.equal(list.type.name, 'taskList');
      assert.equal(list.childCount, USER_LIST.length);
      assert.deepEqual(Array.from({ length: list.childCount }, (_, i) => [list.child(i).textContent, list.child(i).attrs.checked]), USER_LIST.map(([t, c]) => [t, c]));
      assert.equal(editor.state.doc.childCount, 1, 'the list replaces the empty line, with no blank paragraphs');
    } finally { editor.destroy(); }
  });
}

test('ordinary bullets and lists that merely contain a checkbox later stay bullets', () => {
  const editor = make();
  try {
    pasteHTML(editor, '<ul><li>普通条目</li><li>说明 <input type="checkbox"> 在中间</li></ul>', '- 普通条目\n- 说明 在中间');
    assert.equal(editor.state.doc.firstChild!.type.name, 'bulletList');
  } finally { editor.destroy(); }
});
