import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import Link from '@tiptap/extension-link';
import { TextSelection } from '@tiptap/pm/state';
import { TaskItem } from '../src/components/editor/extensions/TaskItem';
import { Column, ColumnList } from '../src/components/editor/extensions/ColumnsExtension';
import { CalloutNode } from '../src/components/editor/extensions/CalloutNode';
import { ToggleNode } from '../src/components/editor/extensions/ToggleNode';
import { BlockKeymap } from '../src/components/editor/extensions/BlockKeymap';
import { MarkdownShortcuts, normalizeTypedLink } from '../src/components/editor/extensions/MarkdownShortcuts';
import { SLASH_ITEMS } from '../src/components/editor/SlashCommandMenu';
import { ListJoin } from '../src/components/editor/extensions/ListJoin';
import { moveBlockToDropTarget, type BlockDropTarget } from '../src/components/editor/utils/block-movement';

const editors: Editor[] = [];
const p = (text = '') => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const h = (text: string, level = 2) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const list = (type: string, ...items: string[]) => ({ type, content: items.map(text => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', content: [p(text)] })) });
const columns = (...cols: any[][]) => ({ type: 'columnList', attrs: { columns: cols.length }, content: cols.map(content => ({ type: 'column', content })) });

function make(content: any[] = [p()]) {
  const editor = new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), ColumnList, Column, CalloutNode, ToggleNode,
      Link.extend({ inclusive: () => false }), BlockKeymap, MarkdownShortcuts, ListJoin],
    content: { type: 'doc', content },
  });
  editors.push(editor);
  return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function caret(editor: Editor, text: string, at: 'start' | 'end' = 'start') {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === text) found = pos + 1 + (at === 'end' ? node.content.size : 0);
  });
  assert.ok(found >= 0, `missing block ${text}`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, found)));
}
function key(editor: Editor, name: string, options: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', { key: name, cancelable: true, ...options });
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)) ?? false;
}
/** Type like a keyboard: each character goes through the input-rule path. */
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}
const shape = (editor: Editor) => editor.getJSON().content!.map(function describe(node: any): string {
  if (node.type === 'text') return node.text;
  const name = node.type + (node.attrs?.level ? node.attrs.level : '') + (node.attrs?.checked ? '✓' : '');
  return node.content ? `${name}(${node.content.map(describe).join(',')})` : name;
});

for (const [input, expected] of [
  ['## 标题', 'heading2(标题)'], ['＃＃ 全角', 'heading2(全角)'], ['》 引用', 'blockquote(paragraph(引用))'],
  ['[] 待办', 'taskList(taskItem(paragraph(待办)))'], ['【】 待办', 'taskList(taskItem(paragraph(待办)))'],
  ['[x] 完成', 'taskList(taskItem✓(paragraph(完成)))'], ['1。 步骤', 'orderedList(listItem(paragraph(步骤)))'],
  ['－ 条目', 'bulletList(listItem(paragraph(条目)))'], ['··· ', 'codeBlock'],
] as const) {
  test(`typing "${input}" converts the block in place`, () => {
    const editor = make();
    caret(editor, '');
    type(editor, input);
    assert.deepEqual(shape(editor), [expected]);
  });
}

test('typing a Markdown link creates a non-inclusive link and rejects script URLs', () => {
  const editor = make();
  caret(editor, '');
  type(editor, '见[文档](docs.example.com/a)后');
  const [, link, after] = editor.getJSON().content![0].content!;
  assert.equal(link.text, '文档');
  assert.equal(link.marks![0].attrs!.href, 'https://docs.example.com/a');
  assert.equal(after.text, '后');
  assert.equal(after.marks, undefined);
  assert.equal(normalizeTypedLink('javascript:alert(1)'), null);
  const image = make();
  caret(image, '');
  type(image, '![图](https://a.com/x.png)');
  assert.equal(image.state.doc.textContent, '![图](https://a.com/x.png)');
});

test('``` + Enter, with or without a language, opens a code block', () => {
  const editor = make([p('```ts')]);
  caret(editor, '```ts', 'end');
  assert.equal(key(editor, 'Enter'), true);
  const code = editor.state.doc.firstChild!;
  assert.equal(code.type.name, 'codeBlock');
  assert.equal(code.attrs.language, 'ts');
  assert.equal(code.textContent, '');
});

test('Backspace at the start of a heading, list item, task or quote first turns it into text', () => {
  const cases: [any[], string, string[]][] = [
    [[p('上一段'), h('标题')], '标题', ['paragraph(上一段)', 'paragraph(标题)']],
    [[p('上一段'), list('bulletList', '条目')], '条目', ['paragraph(上一段)', 'paragraph(条目)']],
    [[list('bulletList', '一', '二', '三')], '二', ['bulletList(listItem(paragraph(一)))', 'paragraph(二)', 'bulletList(listItem(paragraph(三)))']],
    [[p('上一段'), list('taskList', '待办')], '待办', ['paragraph(上一段)', 'paragraph(待办)']],
    [[p('上一段'), { type: 'blockquote', content: [p('引用')] }], '引用', ['paragraph(上一段)', 'paragraph(引用)']],
  ];
  for (const [content, target, expected] of cases) {
    const editor = make(content);
    const before = JSON.stringify(editor.getJSON());
    caret(editor, target);
    assert.equal(key(editor, 'Backspace'), true);
    assert.deepEqual(shape(editor), expected, target);
    editor.commands.undo();
    assert.equal(JSON.stringify(editor.getJSON()), before);
  }
});

test('a second Backspace on plain text merges with the block above as usual', () => {
  const editor = make([p('上一段'), h('标题')]);
  caret(editor, '标题');
  key(editor, 'Backspace');
  key(editor, 'Backspace');
  assert.deepEqual(shape(editor), ['paragraph(上一段标题)']);
});

test('Backspace at the start of a column never deletes or moves its text', () => {
  const editor = make([columns([p('左')], [p('右')])]);
  caret(editor, '右');
  assert.equal(key(editor, 'Backspace'), true);
  assert.deepEqual(shape(editor), ['columnList(column(paragraph(左)),column(paragraph(右)))']);
});

test('Backspace in an empty column block removes the column and returns to the previous text', () => {
  const editor = make([columns([p('左')], [p()]), p('后')]);
  caret(editor, '');
  assert.equal(key(editor, 'Backspace'), true);
  assert.deepEqual(shape(editor), ['paragraph(左)', 'paragraph(后)']);
  const { $from } = editor.state.selection;
  assert.equal($from.parent.textContent, '左');
  assert.equal($from.parentOffset, 1);
});

test('Backspace after a column row merges into the last column instead of nesting the paragraph', () => {
  const editor = make([columns([p('左')], [p('右')]), p('后')]);
  caret(editor, '后');
  assert.equal(key(editor, 'Backspace'), true);
  assert.deepEqual(shape(editor), ['columnList(column(paragraph(左)),column(paragraph(右后)))']);
  assert.equal(editor.state.selection.$from.parentOffset, 1);
  const empty = make([columns([p('左')], [p('右')]), p()]);
  caret(empty, '');
  key(empty, 'Backspace');
  assert.deepEqual(shape(empty), ['columnList(column(paragraph(左)),column(paragraph(右)))']);
});

test('Tab never leaves the editor; text nests under the list or toggle above and Shift+Tab restores it', () => {
  const plain = make([p('一'), p('二')]);
  caret(plain, '二');
  assert.equal(key(plain, 'Tab'), true);
  assert.deepEqual(shape(plain), ['paragraph(一)', 'paragraph(二)']);

  const editor = make([list('bulletList', '条目'), p('说明')]);
  caret(editor, '说明', 'end');
  assert.equal(key(editor, 'Tab'), true);
  assert.deepEqual(shape(editor), ['bulletList(listItem(paragraph(条目),paragraph(说明)))']);
  assert.equal(editor.state.selection.$from.parent.textContent, '说明');
  assert.equal(key(editor, 'Tab', { shiftKey: true }), true);
  assert.deepEqual(shape(editor), ['bulletList(listItem(paragraph(条目)))', 'paragraph(说明)']);

  const toggle = make([{ type: 'toggle', attrs: { collapsed: true }, content: [p('标题'), p('正文')] }, p('补充')]);
  caret(toggle, '补充');
  key(toggle, 'Tab');
  const node = toggle.state.doc.firstChild!;
  assert.equal(node.childCount, 3);
  assert.equal(node.attrs.collapsed, false);
});

test('Tab in a code block indents with spaces and Shift+Tab removes them', () => {
  const editor = make([{ type: 'codeBlock', content: [{ type: 'text', text: 'a' }] }]);
  caret(editor, 'a');
  key(editor, 'Tab');
  assert.equal(editor.state.doc.textContent, '  a');
  key(editor, 'Tab', { shiftKey: true });
  assert.equal(editor.state.doc.textContent, 'a');
});

test('slash commands insert two, three and four columns', () => {
  for (const [id, count] of [['columns', 2], ['columns3', 3], ['columns4', 4]] as const) {
    const editor = make();
    SLASH_ITEMS.find(item => item.id === id)!.action(editor as any);
    const row = editor.state.doc.firstChild!;
    assert.equal(row.type.name, 'columnList');
    assert.equal(row.childCount, count);
    assert.equal(row.attrs.columns, count);
  }
});

test('adjacent lists of one kind join after a move, so numbering continues as in Notion', () => {
  const editor = make([list('orderedList', '一', '二'), p('间隔'), list('orderedList', '三')]);
  const target = editor.state.doc.firstChild!.nodeSize;
  assert.equal(moveBlockToDropTarget(editor, target, { zone: 'below', targetPos: target + editor.state.doc.child(1).nodeSize, targetNode: editor.state.doc.child(2) } as BlockDropTarget), true);
  assert.deepEqual(shape(editor), ['orderedList(listItem(paragraph(一)),listItem(paragraph(二)),listItem(paragraph(三)))', 'paragraph(间隔)']);
  editor.commands.undo();
  assert.equal(editor.state.doc.childCount, 3);
  const renumbered = make([list('orderedList', '一'), { type: 'orderedList', attrs: { start: 5 }, content: [{ type: 'listItem', content: [p('五')] }] }]);
  renumbered.commands.insertContentAt(1, 'x');
  assert.equal(renumbered.state.doc.childCount, 2);
});

test('Backspace twice inside a list rejoins the split list', () => {
  const editor = make([list('bulletList', '一', '二', '三')]);
  caret(editor, '二');
  key(editor, 'Backspace');
  key(editor, 'Backspace');
  assert.deepEqual(shape(editor), ['bulletList(listItem(paragraph(一二)),listItem(paragraph(三)))']);
});

test('Backspace on text after a quote or collapsed toggle continues the last visible line', () => {
  const quote = make([{ type: 'blockquote', content: [p('引用')] }, p('后')]);
  caret(quote, '后');
  key(quote, 'Backspace');
  assert.deepEqual(shape(quote), ['blockquote(paragraph(引用后))']);
  const toggle = make([{ type: 'toggle', attrs: { collapsed: true }, content: [p('标题'), p('隐藏')] }, p()]);
  caret(toggle, '');
  key(toggle, 'Backspace');
  assert.deepEqual(shape(toggle), ['toggle(paragraph(标题),paragraph(隐藏))']);
  assert.equal(toggle.state.selection.$from.parent.textContent, '标题');
  assert.equal(toggle.state.doc.firstChild!.attrs.collapsed, true);
});

test('the log template uses Done and Todo sections', () => {
  const editor = make();
  SLASH_ITEMS.find(item => item.id === 'template')!.action(editor as any);
  const headings: string[] = [];
  editor.state.doc.descendants(node => { if (node.type.name === 'heading') headings.push(node.textContent); });
  assert.deepEqual(headings, ['Done', 'Todo']);
});
