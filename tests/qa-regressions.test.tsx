import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './dom';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { documentExtensions } from '../src/components/editor/extensions/document';
import { BlockKeymap } from '../src/components/editor/extensions/BlockKeymap';
import { MarkdownShortcuts } from '../src/components/editor/extensions/MarkdownShortcuts';
import { ListJoin } from '../src/components/editor/extensions/ListJoin';
import { EditorClipboard } from '../src/components/editor/extensions/EditorClipboard';
import { SLASH_ITEMS } from '../src/components/editor/SlashCommandMenu';
import { moveBlock, moveBlockToDropTarget, turnBlockIntoColumns, type BlockDropTarget } from '../src/components/editor/utils/block-movement';
import { parseMarkdown } from '../src/components/editor/utils/markdown';

// Regressions found by the 2026-10-21 exploratory QA pass, one test per report.
const editors: Editor[] = [];
const p = (text = '') => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
const list = (type: string, items: string[], attrs?: object) => ({ type, ...(attrs ? { attrs } : {}), content: items.map(text => ({ type: type === 'taskList' ? 'taskItem' : 'listItem', content: [p(text)] })) });
const row = (...cols: any[][]) => ({ type: 'columnList', attrs: { columns: cols.length }, content: cols.map(content => ({ type: 'column', content })) });

function make(content: any[] = [p()]) {
  const editor = new Editor({
    extensions: [...documentExtensions({ editable: true }), BlockKeymap, MarkdownShortcuts, ListJoin, EditorClipboard],
    content: { type: 'doc', content },
  });
  editors.push(editor);
  return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function posOf(editor: Editor, text: string, at: 'start' | 'end' = 'start') {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === text) found = pos + 1 + (at === 'end' ? node.content.size : 0);
  });
  assert.ok(found >= 0, `missing ${text}`);
  return found;
}
function caret(editor: Editor, text: string, at: 'start' | 'end' = 'start') {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOf(editor, text, at))));
}
function key(editor: Editor, name: string, options: KeyboardEventInit = {}) {
  const event = new window.KeyboardEvent('keydown', { key: name, cancelable: true, ...options });
  return editor.view.someProp('handleKeyDown', handler => handler(editor.view, event)) ?? false;
}
function type(editor: Editor, text: string) {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', handler => handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
  }
}
function paste(editor: Editor, text: string, html = '') {
  const event = new window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (kind: string) => kind === 'text/html' ? html : kind === 'text/plain' ? text : '' } });
  if (html) editor.view.pasteHTML(html, event as ClipboardEvent);
  else editor.view.pasteText(text, event as ClipboardEvent);
}
/** Document outline with visible numbering, e.g. "1.a 2.b ¶x". */
function outline(editor: Editor): string {
  const out: string[] = [];
  const walk = (node: any, prefix = '') => {
    if (node.type.name === 'orderedList') { let n = node.attrs.start ?? 1; node.forEach((item: any) => out.push(`${prefix}${n++}.${item.firstChild.textContent}`)); }
    else if (node.type.name === 'bulletList') node.forEach((item: any) => out.push(`${prefix}•${item.firstChild.textContent}`));
    else if (node.type.name === 'taskList') node.forEach((item: any) => out.push(`${prefix}${item.attrs.checked ? '☑' : '☐'}${item.firstChild.textContent}`));
    else if (node.type.name === 'columnList') out.push('[' + Array.from({ length: node.childCount }, (_, i) => node.child(i).textContent).join('|') + ']');
    else if (node.type.name === 'heading') out.push(`h${node.attrs.level}:${node.textContent}`);
    else if (node.type.name === 'codeBlock') out.push(`code:${node.textContent}`);
    else if (node.type.name === 'toggle') out.push(`toggle:${node.firstChild.textContent}/${node.childCount - 1}${node.attrs.collapsed ? ' collapsed' : ''}`);
    else out.push(`¶${node.textContent}`);
  };
  editor.state.doc.forEach(node => walk(node));
  return out.join(' ');
}

test('Backspace on the first numbered item leaves the rest numbered from 1', () => {
  const editor = make([list('orderedList', ['a', 'b', 'c'])]);
  caret(editor, 'a');
  key(editor, 'Backspace');
  assert.equal(outline(editor), '¶a 1.b 2.c');
});

test('Backspace at the start of a code block never merges the code into the line above', () => {
  const editor = make([p('a'), { type: 'codeBlock', content: [{ type: 'text', text: 'x = 1' }] }]);
  caret(editor, 'x = 1');
  assert.equal(key(editor, 'Backspace'), true);
  assert.equal(outline(editor), '¶a code:x = 1');
  const blank = make([p(), { type: 'codeBlock', content: [{ type: 'text', text: 'y' }] }]);
  caret(blank, 'y');
  key(blank, 'Backspace');
  assert.equal(outline(blank), 'code:y', 'an empty line above is removed instead');
});

test('Alt+↑ / Alt+↓ on an edge list item moves only that item', () => {
  const up = make([p('x'), list('orderedList', ['a', 'b'])]);
  caret(up, 'a');
  moveBlock(up as any, 'up');
  assert.equal(outline(up), '1.a ¶x 1.b');
  assert.equal(up.state.selection.$from.parent.textContent, 'a');
  const down = make([list('bulletList', ['a', 'b']), p('y')]);
  caret(down, 'b');
  moveBlock(down as any, 'down');
  assert.equal(outline(down), '•a ¶y •b');
  moveBlock(down as any, 'up');
  assert.equal(outline(down), '•a •b ¶y', 'moving back rejoins the list');
});

test('Markdown typed at the start of a list item turns that item into the typed type', () => {
  const numbered = make([list('bulletList', ['a', 'b', 'c'])]);
  caret(numbered, 'b');
  type(numbered, '1. ');
  assert.equal(outline(numbered), '•a 1.b •c');
  const heading = make([list('orderedList', ['a', 'b'])]);
  caret(heading, 'b');
  type(heading, '## ');
  assert.equal(outline(heading), '1.a h2:b');
  const literal = make([list('orderedList', ['a'])]);
  caret(literal, 'a');
  type(literal, '2. ');
  assert.equal(outline(literal), '1.2. a', 'the list\'s own marker stays literal');
});

test('Delete at the end of a list pulls the next paragraph into the last item', () => {
  const editor = make([list('bulletList', ['a']), p('后')]);
  caret(editor, 'a', 'end');
  assert.equal(key(editor, 'Delete'), true);
  assert.equal(outline(editor), '•a后');
  assert.equal(editor.state.selection.$from.parentOffset, 1);
});

test('a Markdown list pasted into an empty or finished list item continues as sibling items', () => {
  const empty = make([list('orderedList', ['甲', ''])]);
  empty.view.dispatch(empty.state.tr.setSelection(TextSelection.create(empty.state.doc, empty.state.doc.firstChild!.nodeSize - 3)));
  paste(empty, '1. 乙\n2. 丙');
  assert.equal(outline(empty), '1.甲 2.乙 3.丙');
  const end = make([list('bulletList', ['条目', '下一项'])]);
  caret(end, '条目', 'end');
  paste(end, '- 一\n- 二');
  assert.equal(outline(end), '•条目 •一 •二 •下一项');
  const tasks = make([list('taskList', ['任务'])]);
  caret(tasks, '任务', 'end');
  paste(tasks, '- [ ] 甲\n- [x] 乙');
  assert.equal(outline(tasks), '☐任务 ☐甲 ☑乙');
});

test('columns never nest: slash, "turn into columns" and pasted rows stay in one row', () => {
  const slash = make([row([p('左')], [p('右')])]);
  caret(slash, '右', 'end');
  SLASH_ITEMS.find(item => item.id === 'columns')!.action(slash as any);
  assert.equal(slash.state.doc.firstChild!.childCount, 3);
  assert.equal(outline(slash), '[左|右|]');
  const turn = make([row([p('左')], [p('右')])]);
  assert.equal(turnBlockIntoColumns(turn as any, posOf(turn, '左') - 1), true);
  assert.equal(outline(turn), '[左||右]');
  const pasted = make([row([p('左')], [p('右')])]);
  caret(pasted, '右', 'end');
  paste(pasted, '', '<div data-type="column-list"><div data-type="column"><p>A</p></div><div data-type="column"><p>B</p></div></div>');
  let nested = false;
  pasted.state.doc.firstChild!.descendants(node => { if (node.type.name === 'columnList') nested = true; });
  assert.equal(nested, false);
  assert.match(pasted.state.doc.firstChild!.lastChild!.textContent, /A.*B/);
});

test('an edit across two columns is refused instead of merging the row away', () => {
  const editor = make([row([p('左左')], [p('右右')])]);
  const before = editor.getJSON();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, posOf(editor, '左左') + 1, posOf(editor, '右右') + 1)));
  editor.view.dispatch(editor.state.tr.insertText('x'));
  assert.deepEqual(editor.getJSON(), before);
  editor.commands.selectAll();
  editor.commands.deleteSelection();
  assert.equal(editor.state.doc.textContent, '', 'select-all still clears the document');
});

function drop(editor: Editor, source: number, target: number, zone: BlockDropTarget['zone']) {
  return moveBlockToDropTarget(editor as any, source, { zone, targetPos: target, targetNode: editor.state.doc.nodeAt(target)! } as BlockDropTarget);
}
const itemPos = (editor: Editor, text: string) => posOf(editor, text) - 2;

test('text dropped between list items splits the list; a bullet stays a bullet in a numbered list', () => {
  const editor = make([list('orderedList', ['一', '二', '三']), p('段落')]);
  assert.equal(drop(editor, posOf(editor, '段落') - 1, itemPos(editor, '一'), 'below'), true);
  assert.equal(outline(editor), '1.一 ¶段落 1.二 2.三');
  const bullet = make([list('orderedList', ['一', '二']), list('bulletList', ['圆点'])]);
  assert.equal(drop(bullet, itemPos(bullet, '圆点'), itemPos(bullet, '一'), 'below'), true);
  assert.equal(outline(bullet), '1.一 •圆点 1.二');
});

test('a numbered item dragged out of its list starts at 1', () => {
  const editor = make([list('orderedList', ['一', '二', '三']), p('段落')]);
  assert.equal(drop(editor, itemPos(editor, '二'), posOf(editor, '段落') - 1, 'below'), true);
  assert.equal(outline(editor), '1.一 2.三 ¶段落 1.二');
});

test('pasted HTML from Notion/GitHub toggles, Word lists, code and Google Docs keeps its structure', () => {
  const toggle = make();
  paste(toggle, '标题\n正文', '<details><summary>标题</summary><p>正文</p></details>');
  // The caret lands in the body after pasting, which opens the toggle by design.
  assert.equal(outline(toggle).replace(' collapsed', ''), 'toggle:标题/1');
  const word = make();
  paste(word, '', '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>'
    + '<p class=MsoListParagraphCxSpFirst style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span>&nbsp;&nbsp; </span></span>第一项<o:p></o:p></p>'
    + '<p class=MsoListParagraphCxSpLast style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.<span>&nbsp;&nbsp; </span></span>第二项<o:p></o:p></p>'
    + '<p class=MsoNormal><o:p>&nbsp;</o:p></p></body></html>');
  assert.equal(outline(word).replace(/ ¶$/, ''), '1.第一项 2.第二项');
  const code = make();
  paste(code, '', '<pre><code class="language-bash">npm i\nnpm run dev\n</code></pre>');
  assert.equal(outline(code), 'code:npm i\nnpm run dev');
  const docs = make();
  paste(docs, '', '<b id="docs-internal-guid-1"><p>一</p><br><p>二</p></b>');
  let breaks = 0;
  docs.state.doc.descendants(node => { if (node.type.name === 'hardBreak') breaks++; });
  assert.equal(breaks, 0);
});

test('an inline Markdown image does not leave an empty paragraph behind', () => {
  const editor = make();
  const fragment = parseMarkdown('![图](https://a.com/x.png) 和 [链接](https://a.com)', editor.schema)!;
  const types: string[] = [];
  fragment.forEach(node => types.push(node.type.name + (node.isTextblock ? `:${node.textContent}` : '')));
  assert.deepEqual(types, ['image', 'paragraph:和 链接']);
});

test('moving a toggle or callout body line past its title takes it out of the container', () => {
  const toggle = make([{ type: 'toggle', content: [p('T'), p('tb')] }]);
  caret(toggle, 'tb');
  moveBlock(toggle as any, 'up');
  assert.equal(outline(toggle), '¶tb toggle:T/0');
  const callout = make([{ type: 'callout', content: [p('首行'), p('末行')] }, p('后')]);
  caret(callout, '末行');
  moveBlock(callout as any, 'down');
  assert.deepEqual(callout.getJSON().content!.map(n => n.type), ['callout', 'paragraph', 'paragraph']);
  assert.equal(callout.state.doc.child(1).textContent, '末行');
});

test('slash commands in a callout\'s first line convert that line, not the callout', () => {
  const editor = make([{ type: 'callout', attrs: { type: 'tip' }, content: [p('/h2')] }]);
  const from = posOf(editor, '/h2');
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from + 3)));
  SLASH_ITEMS.find(item => item.id === 'h2')!.action(editor as any, { from, to: from + 3 });
  const callout = editor.state.doc.firstChild!;
  assert.equal(callout.type.name, 'callout');
  assert.equal(callout.firstChild!.type.name, 'heading');
});

test('a block inserted from an empty bullet replaces the bullet instead of nesting under it', () => {
  const editor = make([list('bulletList', ['甲', '/divider'])]);
  const from = posOf(editor, '/divider');
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from + 8)));
  SLASH_ITEMS.find(item => item.id === 'divider')!.action(editor as any, { from, to: from + 8 });
  const types = editor.getJSON().content!.map(n => n.type);
  assert.deepEqual(types.slice(0, 2), ['bulletList', 'horizontalRule']);
  assert.equal(editor.state.doc.firstChild!.childCount, 1);
});

test('the Chinese IME slash "、" opens the block menu at a line start but not mid-sentence', async () => {
  const { findSlashMatch } = await import('../src/components/editor/extensions/SlashCommand');
  const at = (text: string) => {
    const editor = make([p(text)]);
    caret(editor, text, 'end');
    return findSlashMatch(editor.state)?.query ?? null;
  };
  assert.equal(at('、h2'), 'h2');
  assert.equal(at('列表 、todo'), 'todo');
  assert.equal(at('苹果、香蕉'), null);
});

test('Shift+Enter inside a code block adds a line instead of leaving the block', () => {
  const editor = make([{ type: 'codeBlock', content: [{ type: 'text', text: 'a' }] }]);
  caret(editor, 'a', 'end');
  assert.equal(key(editor, 'Enter', { shiftKey: true }), true);
  assert.equal(outline(editor), 'code:a\n');
});

test('embeds accept a bare domain like typed links do', async () => {
  const { parseEmbedUrl } = await import('../src/components/editor/utils/embed-url');
  assert.equal(parseEmbedUrl('example.com/page').src, 'https://example.com/page');
  assert.throws(() => parseEmbedUrl('javascript:alert(1)'));
});
