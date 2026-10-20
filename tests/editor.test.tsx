import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import './dom';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { Column, ColumnList } from '../src/components/editor/extensions/ColumnsExtension';
import { CalloutNode } from '../src/components/editor/extensions/CalloutNode';
import { MermaidNode } from '../src/components/editor/extensions/MermaidNode';
import { ImageNode } from '../src/components/editor/extensions/ImageNode';
import { HtmlNode } from '../src/components/editor/extensions/HtmlNode';
import { TableExtensions } from '../src/components/editor/extensions/TableExtensions';
import { EmbedNode } from '../src/components/editor/extensions/EmbedNode';
import { WhiteboardNode } from '../src/components/editor/extensions/WhiteboardNode';
import { ToggleNode } from '../src/components/editor/extensions/ToggleNode';
import { SlashCommand, slashCommandKey } from '../src/components/editor/extensions/SlashCommand';
import { SLASH_ITEMS } from '../src/components/editor/SlashCommandMenu';
import { computeBlockDropTarget, deleteBlockAtPos, duplicateBlock, moveBlock, moveBlockToDropTarget, resolveDomBlockPos, turnBlockIntoColumns, type BlockDropTarget } from '../src/components/editor/utils/block-movement';
import { startBlockDrag, getDraggedBlockPos } from '../src/components/editor/utils/block-drag';
import { parseDocument } from '../src/components/editor/utils/document';
import { BLOCK_TYPES, convertBlock } from '../src/components/editor/utils/block-conversion';
import { parseEmbedUrl } from '../src/components/editor/utils/embed-url';
import { findBlockAtPoint } from '../src/components/editor/utils/block-dom';


const editors: Editor[] = [];
const p = (text = '') => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
function make(content: any[] = [p()]) {
  const editor = new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true }), ColumnList, Column, CalloutNode, MermaidNode, WhiteboardNode, EmbedNode, ImageNode, HtmlNode, ...TableExtensions, SlashCommand, ToggleNode],
    content: { type: 'doc', content },
  });
  editors.push(editor);
  return editor;
}
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

test('deleting the empty final block in a column removes that column and unwraps the surviving content', () => {
  const richLeft = { type: 'paragraph', content: [{ type: 'text', text: 'keep left', marks: [{ type: 'bold' }] }] };
  const editor = make([{ type: 'columnList', content: [
    { type: 'column', content: [richLeft] }, { type: 'column', content: [p()] },
  ] }, p('after')]);
  const before = editor.getJSON();
  assert.equal(deleteBlockAtPos(editor, posOf(editor, '')), true);
  assert.deepEqual(editor.getJSON().content, [richLeft, p('after')]);
  editor.state.doc.check();
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(editor.getJSON(), before);
});

test('deleting an empty middle column preserves the other columns and their order', () => {
  const editor = make([{ type: 'columnList', attrs: { columns: 3 }, content: [
    { type: 'column', content: [p('left')] }, { type: 'column', content: [p()] },
    { type: 'column', content: [p('right')] },
  ] }]);
  const before = editor.getJSON();
  assert.equal(deleteBlockAtPos(editor, posOf(editor, '')), true);
  const row = editor.state.doc.firstChild!;
  assert.equal(row.attrs.columns, 2);
  assert.deepEqual([row.child(0).textContent, row.child(1).textContent], ['left', 'right']);
  editor.state.doc.check();
  editor.commands.undo();
  assert.deepEqual(editor.getJSON(), before);
});

test('deleting one empty block keeps other blocks in the same column', () => {
  const editor = make([{ type: 'columnList', content: [
    { type: 'column', content: [p('left')] }, { type: 'column', content: [p(), p('keep right')] },
  ] }]);
  assert.equal(deleteBlockAtPos(editor, posOf(editor, '')), true);
  assert.equal(editor.state.doc.firstChild!.childCount, 2);
  assert.equal(editor.state.doc.firstChild!.child(1).childCount, 1);
  assert.equal(editor.state.doc.firstChild!.child(1).textContent, 'keep right');
  editor.state.doc.check();
});
function posOf(editor: Editor, text: string) {
  let result = -1;
  editor.state.doc.descendants((node, pos) => { if (node.isTextblock && node.textContent === text) result = pos; });
  assert.ok(result >= 0, text);
  return result;
}
function drop(editor: Editor, source: number, target: number, zone: BlockDropTarget['zone']) {
  return moveBlockToDropTarget(editor, source, { zone, targetPos: target, targetNode: editor.state.doc.nodeAt(target)! } as BlockDropTarget);
}

function rect(el: HTMLElement, left: number, top: number, width: number, height: number) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}) });
}
function atPoint(element: HTMLElement, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => element });
  try { run(); } finally {
    if (previous) Object.defineProperty(document, 'elementFromPoint', previous);
    else delete (document as any).elementFromPoint;
  }
}

test('the middle of a block reorders by its vertical half; only the side rails create columns', () => {
  const editor = make([p('source'), p('between'), p('wide target')]);
  const target = editor.view.dom.querySelectorAll('p')[2] as HTMLElement;
  rect(target, 100, 200, 1000, 40);
  atPoint(target, () => {
    const sourcePos = posOf(editor, 'source');
    assert.equal(computeBlockDropTarget(editor.view, 250, 215, { sourcePos })?.zone, 'above');
    assert.equal(computeBlockDropTarget(editor.view, 600, 225, { sourcePos })?.zone, 'below');
    assert.equal(computeBlockDropTarget(editor.view, 930, 225, { sourcePos })?.zone, 'below');
    assert.equal(computeBlockDropTarget(editor.view, 960, 215, { sourcePos })?.zone, 'right');
    assert.equal(computeBlockDropTarget(editor.view, 110, 220, { sourcePos })?.zone, 'left');
  });
});

test('hovering padding in the right column addresses its block rather than the row', () => {
  const editor = make([{ type: 'columnList', content: [
    { type: 'column', content: [p('A')] }, { type: 'column', content: [p('B')] },
  ] }]);
  const columns = editor.view.dom.querySelectorAll<HTMLElement>('[data-type="column"]');
  const right = columns[1], block = right.querySelector('p')!;
  rect(editor.view.dom, 100, 100, 1000, 300);
  rect(right.querySelector<HTMLElement>('.column-content')!, 656, 100, 444, 30);
  rect(right, 656, 100, 444, 80);
  rect(block, 656, 100, 444, 30);
  atPoint(right, () => {
    const hit = findBlockAtPoint(editor.view, 900, 145);
    assert.equal(hit?.pos, posOf(editor, 'B'));
    assert.equal(hit?.dom, block);
  });
});

test('toggle title hover selects the whole toggle and its body remains independent', () => {
  const editor = make([{ type: 'toggle', content: [p('title'), p('body')] }]);
  const paragraphs = editor.view.dom.querySelectorAll<HTMLElement>('p');
  atPoint(paragraphs[0], () => assert.equal(findBlockAtPoint(editor.view, 0, 0)?.pos, 0));
  atPoint(paragraphs[1], () => assert.equal(findBlockAtPoint(editor.view, 0, 0)?.pos, posOf(editor, 'body')));
});

test('row-wide bottom guide extracts a column block with complete single-step undo', () => {
  const editor = make([{ type: 'columnList', content: [
    { type: 'column', content: [p('A')] }, { type: 'column', content: [p('B')] },
  ] }, p('C')]);
  const before = editor.getJSON();
  const row = editor.view.dom.querySelector<HTMLElement>('[data-type="column-list"]')!;
  const block = row.querySelectorAll<HTMLElement>('p')[1];
  rect(row, 100, 100, 1000, 80); rect(block, 656, 100, 444, 30);
  atPoint(block, () => {
    const target = computeBlockDropTarget(editor.view, 900, 177, { sourcePos: posOf(editor, 'B') });
    assert.equal(target?.scope, 'row');
    assert.equal(target?.zone, 'below');
    assert.equal(target?.indicator.width, 1000);
    assert.equal(moveBlockToDropTarget(editor, posOf(editor, 'B'), target!), true);
  });
  assert.deepEqual(editor.getJSON().content?.map(n => n.type), ['paragraph', 'paragraph', 'paragraph']);
  assert.equal(editor.getText(), 'A\n\nB\n\nC');
  editor.state.doc.check();
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(editor.getJSON(), before);
});

test('vertical drop within a column preserves the other column and surrounding rows', () => {
  const editor = make([{ type: 'columnList', content: [
    { type: 'column', content: [p('A')] }, { type: 'column', content: [p('B')] },
  ] }, p('C'), p('D')]);
  assert.equal(drop(editor, posOf(editor, 'C'), posOf(editor, 'A'), 'below'), true);
  const row = editor.state.doc.firstChild!;
  assert.equal(row.type.name, 'columnList');
  assert.equal(row.childCount, 2);
  assert.deepEqual(Array.from({length:row.child(0).childCount},(_,i)=>row.child(0).child(i).textContent), ['A','C']);
  assert.equal(row.child(1).textContent, 'B');
  assert.equal(editor.state.doc.lastChild!.textContent, 'D');
});

test('side drop onto existing columns extends the same group and undoes atomically', () => {
  const editor = make([{ type: 'columnList', content: [
    { type: 'column', content: [p('A')] }, { type: 'column', content: [p('B')] },
  ] }, p('C'), p('D')]);
  const before = editor.getJSON();
  assert.equal(drop(editor, posOf(editor, 'C'), posOf(editor, 'B'), 'right'), true);
  const row = editor.state.doc.firstChild!;
  assert.equal(row.childCount, 3);
  assert.equal(row.attrs.columns, 3);
  assert.deepEqual(Array.from({length:3},(_,i)=>row.child(i).textContent), ['A','B','C']);
  assert.equal(editor.state.doc.lastChild!.textContent, 'D');
  editor.state.doc.check();
  assert.equal(editor.commands.undo(), true);
  assert.deepEqual(editor.getJSON(), before);
});

test('all slash commands produce valid nodes and remove only the query', () => {
  for (const item of SLASH_ITEMS) {
    const editor = make([p('/'), p('保留的内容')]);
    editor.commands.setTextSelection(2);
    item.action(editor, { from: 1, to: 2 });
    assert.doesNotThrow(() => editor.state.doc.check(), item.title);
    assert.ok(editor.getText().includes('保留的内容'), item.title);
    assert.ok(!editor.getText().includes('/'), item.title);
    assert.equal(editor.commands.undo(), true, item.title);
    assert.equal(editor.getText(), '/\n\n保留的内容', item.title + ' can undo the entire command');
  }
});

test('slash state follows committed Chinese input, deletion, cursor movement and Escape', () => {
  const editor = make();
  editor.commands.insertContent('/');
  assert.equal(slashCommandKey.getState(editor.state)?.match?.query, '');
  editor.commands.insertContent('标题');
  assert.equal(slashCommandKey.getState(editor.state)?.match?.query, '标题');
  editor.view.dispatch(editor.state.tr.setMeta(slashCommandKey, 'close'));
  editor.commands.insertContent('一');
  assert.equal(slashCommandKey.getState(editor.state)?.match, null);
  editor.commands.setContent({ type: 'doc', content: [p('https://example.com')] });
  editor.commands.setTextSelection(20);
  assert.equal(slashCommandKey.getState(editor.state)?.match, null);
  editor.commands.setContent({ type: 'doc', content: [p('/abc'), p('second')] });
  editor.commands.setTextSelection(5);
  editor.commands.insertContent('d');
  assert.equal(slashCommandKey.getState(editor.state)?.match?.query, 'abcd');
  editor.commands.setTextSelection(2);
  assert.equal(slashCommandKey.getState(editor.state)?.match, null);
});

test('duplicate and move a task preserve checkbox, nested children and sibling order', () => {
  const task = (text: string, checked: boolean) => ({ type: 'taskItem', attrs: { checked }, content: [p(text)] });
  const editor = make([{ type: 'taskList', content: [task('one', true), task('two', false)] }]);
  editor.commands.setTextSelection(posOf(editor, 'one') + 2);
  assert.equal(duplicateBlock(editor), true);
  let list = editor.state.doc.firstChild!;
  assert.equal(list.childCount, 3);
  assert.equal(list.child(1).attrs.checked, true);
  assert.equal(list.child(1).childCount, 1);
  editor.commands.setTextSelection(posOf(editor, 'two') + 2);
  assert.equal(moveBlock(editor, 'up'), true);
  list = editor.state.doc.firstChild!;
  assert.deepEqual(Array.from({ length: list.childCount }, (_, i) => list.child(i).textContent), ['one', 'two', 'one']);
  editor.state.doc.check();
});

test('DOM and keyboard agree on task item positions', () => {
  const editor = make([{ type: 'taskList', content: [{ type: 'taskItem', content: [p('task')] }] }]);
  const li = editor.view.dom.querySelector('li')!;
  assert.equal(resolveDomBlockPos(editor.view, li), 1);
});

test('drop zones create columns without a modifier and draw the guide at the real edge', () => {
  const editor = make([p('source'), p('between'), p('target')]);
  const blocks = editor.view.dom.querySelectorAll('p');
  const targetBlock = blocks[2] as HTMLElement;
  targetBlock.getBoundingClientRect = () => ({
    top: 200, bottom: 240, left: 100, right: 1100, width: 1000, height: 40,
    x: 100, y: 200, toJSON: () => ({}),
  });

  const previousElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => targetBlock });
  try {
    const sourcePos = posOf(editor, 'source');
    const targetPos = posOf(editor, 'target');
    const left = computeBlockDropTarget(editor.view, 110, 220, { sourcePos });
    const right = computeBlockDropTarget(editor.view, 1090, 220, { sourcePos });
    const above = computeBlockDropTarget(editor.view, 600, 205, { sourcePos });

    assert.equal(left?.zone, 'left');
    assert.equal(left?.indicator.isVertical, true);
    assert.equal(left?.indicator.left, 98.25);
    assert.equal(right?.zone, 'right');
    assert.equal(right?.indicator.left, 1098.25);
    assert.equal(above?.zone, 'above');
    assert.equal(above?.indicator.isVertical, false);
    assert.equal(computeBlockDropTarget(editor.view, 600, 220, { sourcePos: targetPos }), null);
  } finally {
    if (previousElementFromPoint) Object.defineProperty(document, 'elementFromPoint', previousElementFromPoint);
    else delete (document as any).elementFromPoint;
  }
});

test('column drop guide follows the current column edge instead of an estimated future width', () => {
  const editor = make([{ type: 'columnList', content: [
    { type: 'column', content: [p('A')] },
    { type: 'column', content: [p('B')] },
  ] }]);
  const row = editor.view.dom.querySelector('[data-type="column-list"]') as HTMLElement;
  const columns = row.querySelectorAll(':scope > [data-type="column"]');
  const targetColumn = columns[1] as HTMLElement;
  const targetBlock = targetColumn.querySelector('p') as HTMLElement;
  row.getBoundingClientRect = () => ({ top: 100, bottom: 260, left: 100, right: 1100, width: 1000, height: 160, x: 100, y: 100, toJSON: () => ({}) });
  targetColumn.getBoundingClientRect = () => ({ top: 100, bottom: 260, left: 680, right: 1100, width: 420, height: 160, x: 680, y: 100, toJSON: () => ({}) });
  targetBlock.getBoundingClientRect = () => ({ top: 120, bottom: 160, left: 680, right: 1100, width: 420, height: 40, x: 680, y: 120, toJSON: () => ({}) });

  const previousElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => targetBlock });
  try {
    const result = computeBlockDropTarget(editor.view, 1090, 140, { sourcePos: posOf(editor, 'A') });
    assert.equal(result?.zone, 'right');
    assert.equal(result?.indicator.left, 1098.25);
    assert.equal(result?.indicator.top, 100);
    assert.equal(result?.indicator.height, 160);
  } finally {
    if (previousElementFromPoint) Object.defineProperty(document, 'elementFromPoint', previousElementFromPoint);
    else delete (document as any).elementFromPoint;
  }
});

test('side guide is hidden when the schema cannot accept a column row', () => {
  const editor = make([{ type: 'bulletList', content: [
    { type: 'listItem', content: [p('A')] },
    { type: 'listItem', content: [p('B')] },
  ] }]);
  const target = editor.view.dom.querySelectorAll('li')[1] as HTMLElement;
  target.getBoundingClientRect = () => ({ top: 100, bottom: 140, left: 100, right: 700, width: 600, height: 40, x: 100, y: 100, toJSON: () => ({}) });
  const previousElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
  try {
    assert.equal(computeBlockDropTarget(editor.view, 690, 120, { sourcePos: posOf(editor, 'A') - 1 }), null);
  } finally {
    if (previousElementFromPoint) Object.defineProperty(document, 'elementFromPoint', previousElementFromPoint);
    else delete (document as any).elementFromPoint;
  }
});

test('moving text preserves the caret offset and supports undo', () => {
  const editor = make([p('hello'), p('world')]);
  editor.commands.setTextSelection(4);
  moveBlock(editor, 'down');
  assert.equal(editor.state.selection.from, 11);
  assert.equal(editor.getText(), 'world\n\nhello');
  editor.commands.undo();
  assert.equal(editor.getText(), 'hello\n\nworld');
});

test('moving the only block out of a column removes the vacated column without losing content', () => {
  const editor = make([{ type: 'columnList', content: [{ type: 'column', content: [p('A')] }, { type: 'column', content: [p('B')] }] }, p('C')]);
  assert.equal(drop(editor, posOf(editor, 'A'), posOf(editor, 'C'), 'below'), true);
  assert.deepEqual(editor.getJSON().content?.map(n => n.type), ['paragraph', 'paragraph', 'paragraph']);
  assert.equal(editor.getText(), 'B\n\nC\n\nA');
  editor.state.doc.check();
  editor.commands.undo();
  assert.equal(editor.state.doc.firstChild?.type.name, 'columnList');
});

test('side drop inside a row reorders columns without leaving an empty column', () => {
  const editor = make([{ type: 'columnList', content: [{ type: 'column', content: [p('A')] }, { type: 'column', content: [p('B')] }] }]);
  assert.equal(drop(editor, posOf(editor, 'A'), posOf(editor, 'B'), 'right'), true);
  const row = editor.state.doc.firstChild!;
  assert.equal(row.childCount, 2);
  assert.equal(row.child(0).textContent, 'B');
  assert.equal(row.child(1).textContent, 'A');
});

test('reject dropping containers into their children without modifying the document', () => {
  const editor = make([{ type: 'callout', content: [p('child')] }, p('outside')]);
  const before = editor.getJSON();
  assert.equal(drop(editor, 0, posOf(editor, 'child'), 'right'), false);
  assert.deepEqual(editor.getJSON(), before);
});

test('drag state belongs to one editor and becomes invalid after edits', () => {
  const first = make([p('a')]), second = make([p('b')]);
  startBlockDrag(first.view, 0);
  assert.equal(getDraggedBlockPos(first.view), 0);
  assert.equal(getDraggedBlockPos(second.view), null);
  first.commands.insertContent('changed');
  assert.equal(getDraggedBlockPos(first.view), null);
});

test('converting to columns creates editable empty space instead of sample text', () => {
  const editor = make([p('keep')]);
  assert.equal(turnBlockIntoColumns(editor, 0), true);
  assert.equal(editor.state.doc.firstChild?.child(1).textContent, '');
  assert.equal(editor.state.doc.firstChild?.childCount, 2);
  const tasks = make([{ type: 'taskList', content: [
    { type: 'taskItem', content: [p('before')] },
    { type: 'taskItem', attrs: { checked: true }, content: [p('selected'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('nested')] }] }] },
    { type: 'taskItem', content: [p('after')] },
  ] }]);
  const original = tasks.getJSON();
  assert.equal(turnBlockIntoColumns(tasks, posOf(tasks, 'selected') - 1), true);
  assert.deepEqual(tasks.getJSON().content?.map(node => node.type), ['taskList', 'columnList', 'taskList']);
  assert.equal(tasks.state.doc.child(1).child(0).child(0).child(0).attrs.checked, true);
  assert.ok(tasks.getText().includes('nested'));
  tasks.commands.undo();
  assert.deepEqual(tasks.getJSON(), original);
});

test('legacy empty text nodes are repaired; invalid documents are rejected', () => {
  assert.deepEqual(parseDocument(JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }] })), { type: 'doc', content: [{ type: 'paragraph', content: [] }] });
  assert.throws(() => parseDocument('{broken'));
  assert.throws(() => parseDocument({ type: 'not-a-document' }));
});

test('type conversion preserves neighbouring list items and nested children for every target', () => {
  for (const [type] of BLOCK_TYPES) {
    const editor = make([{ type: 'bulletList', content: [
      { type: 'listItem', content: [p('before')] },
      { type: 'listItem', content: [p('convert'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('nested')] }] }] },
      { type: 'listItem', content: [p('after')] },
    ] }]);
    const before = editor.getJSON();
    assert.equal(convertBlock(editor, posOf(editor, 'convert') - 1, type), true, type);
    editor.state.doc.check();
    for (const text of ['before', 'convert', 'nested', 'after']) assert.ok(editor.getText().includes(text), type + ': ' + text);
    assert.equal(editor.commands.undo(), true);
    assert.deepEqual(editor.getJSON(), before, type + ' undo');
  }
});

test('list items drag within lists and out into standalone lists without losing checkbox state', () => {
  const editor = make([{ type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: true }, content: [p('A')] },
    { type: 'taskItem', attrs: { checked: false }, content: [p('B')] },
  ] }, p('C')]);
  assert.equal(drop(editor, posOf(editor, 'A') - 1, posOf(editor, 'B') - 1, 'below'), true);
  assert.equal(editor.state.doc.firstChild?.child(1).attrs.checked, true);
  assert.equal(drop(editor, posOf(editor, 'A') - 1, posOf(editor, 'C'), 'below'), true);
  assert.equal(editor.state.doc.lastChild?.firstChild?.attrs.checked, true);
  editor.state.doc.check();
});

test('embed URLs validate protocols and hosts and normalize supported providers', () => {
  assert.throws(() => parseEmbedUrl('javascript:alert(1)'));
  assert.throws(() => parseEmbedUrl('not a url'));
  assert.equal(parseEmbedUrl('https://evil.test/?q=figma.com').type, 'bookmark');
  assert.equal(parseEmbedUrl('https://figma.com.evil.test/').type, 'bookmark');
  assert.equal(parseEmbedUrl('https://youtu.be/dQw4w9WgXcQ?t=3').embedUrl, 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(parseEmbedUrl('https://www.loom.com/share/abc123').embedUrl, 'https://www.loom.com/embed/abc123');
  assert.equal(parseEmbedUrl('https://example.test/video.mp4?token=sample').isVideoFile, true);
});

test('slash heading inside a task converts only that item and undoes in one step', () => {
  const editor = make([{ type: 'taskList', content: [
    { type: 'taskItem', content: [p('before')] },
    { type: 'taskItem', content: [p('/h2')] },
    { type: 'taskItem', content: [p('after')] },
  ] }]);
  const original = editor.getJSON();
  const from = posOf(editor, '/h2') + 1;
  editor.commands.setTextSelection(from + 3);
  SLASH_ITEMS.find(item => item.id === 'h2')!.action(editor, { from, to: from + 3 });
  assert.deepEqual(editor.getJSON().content?.map(node => node.type), ['taskList', 'heading', 'taskList']);
  assert.equal(editor.state.doc.child(1).attrs.level, 2);
  editor.commands.undo();
  assert.deepEqual(editor.getJSON(), original);
});

test('converting a folded toggle preserves rich title and nested body, and undo restores the fold', () => {
  const editor = make([{ type: 'toggle', attrs: { collapsed: true }, content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'title', marks: [{ type: 'bold' }] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('detail')] }] },
  ] }, p('neighbor')]);
  assert.equal(convertBlock(editor, 0, 'heading2'), true);
  assert.deepEqual(editor.getJSON().content?.map(n => n.type), ['heading', 'taskList', 'paragraph']);
  assert.equal(editor.state.doc.firstChild?.firstChild?.marks[0]?.type.name, 'bold');
  assert.equal(editor.state.doc.child(1).firstChild?.attrs.checked, true);
  assert.equal(editor.commands.undo(), true);
  assert.equal(editor.state.doc.firstChild?.type.name, 'toggle');
  assert.equal(editor.state.doc.firstChild?.attrs.collapsed, true);
  editor.state.doc.check();
});


test('rich blocks survive JSON reload and movement into columns', () => {
  const editor = make([
    { type: 'image', attrs: { src: 'https://example.com/screenshot.png', alt: '截图', caption: '进度', blockWidth: 60 } },
    { type: 'htmlPreview', attrs: { code: '<style>h1{color:green}</style><h1>42</h1>', title: '仪表盘', blockHeight: 420 } },
    p('tail'),
  ]);
  const before = editor.getJSON();
  const restored = make(before.content);
  assert.deepEqual(restored.getJSON(), before);
  assert.match(editor.getText(), /截图.*进度/);
  assert.match(editor.getText(), /仪表盘/);
  assert.equal(drop(editor, 0, editor.state.doc.firstChild!.nodeSize, 'left'), true);
  editor.state.doc.check();
  assert.equal(editor.state.doc.firstChild?.type.name, 'columnList');
  editor.commands.undo();
  assert.deepEqual(editor.getJSON(), before);
});

test('tables add and remove rows/columns, merge/split and address the whole table for dragging', () => {
  const editor = make();
  SLASH_ITEMS.find(item => item.id === 'table')!.action(editor);
  editor.commands.insertContent('Metric');
  editor.commands.addRowAfter();
  editor.commands.addColumnAfter();
  let table = editor.state.doc.firstChild!;
  assert.equal(table.type.name, 'table');
  assert.equal(table.childCount, 4);
  assert.equal(table.firstChild!.childCount, 4);
  editor.commands.deleteRow();
  editor.commands.deleteColumn();
  table = editor.state.doc.firstChild!;
  assert.equal(table.childCount, 3);
  assert.equal(table.firstChild!.childCount, 3);
  const row = table.firstChild!;
  editor.commands.setCellSelection({ anchorCell: 2, headCell: 2 + row.firstChild!.nodeSize });
  assert.equal(editor.commands.mergeCells(), true);
  assert.equal(editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.colspan, 2);
  assert.equal(editor.commands.splitCell(), true);
  assert.equal(editor.state.doc.firstChild!.firstChild!.childCount, 3);
  const paragraph = editor.view.dom.querySelector('td p, th p') as HTMLElement;
  atPoint(paragraph, () => assert.equal(findBlockAtPoint(editor.view, 0, 0)?.node.type.name, 'table'));
  const serialized = editor.getJSON();
  assert.deepEqual(make(serialized.content).getJSON(), serialized);
  editor.state.doc.check();
});
