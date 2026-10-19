import './dom';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { closeHistory } from '@tiptap/pm/history';
import { ImageNode } from '../src/components/editor/extensions/ImageNode';
import { HtmlNode } from '../src/components/editor/extensions/HtmlNode';
import { imageSource, insertImageFiles, readImage } from '../src/components/editor/utils/image';
import { buildHtmlPreview, HTML_SANDBOX } from '../src/components/editor/utils/html-preview';
import { parseDocument } from '../src/components/editor/utils/document';

Object.defineProperty(globalThis, 'FileReader', { value: window.FileReader, configurable: true });
const gif = () => new window.File([Uint8Array.from([71,73,70,56,57,97])], 'demo.gif', { type: 'image/gif' });

test('image sources reject active/local schemes and unsupported files', async () => {
  for (const src of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,<script>1</script>', 'data:image/svg+xml;base64,PHN2Zz4=', '//evil.example/a.png']) assert.equal(imageSource(src), '');
  assert.equal(imageSource('https://example.com/a.png'), 'https://example.com/a.png');
  assert.match(await readImage(gif()), /^data:image\/gif;base64,/);
  await assert.rejects(readImage(new window.File(['x'], 'unsafe.svg', { type: 'image/svg+xml' })), /PNG/);
  await assert.rejects(readImage(new window.File([new Uint8Array(1024 * 1024 + 1)], 'big.gif', { type: 'image/gif' })), /1 MB/);
});

test('asynchronous images stay at their insertion point and deleted placeholders stay deleted', async () => {
  const editor = new Editor({ extensions: [StarterKit, ImageNode], content: '<p>tail</p>' });
  try {
    const pending = insertImageFiles(editor, [gif()], 0);
    assert.ok(editor.state.doc.firstChild!.attrs.uploadId);
    editor.commands.focus('end'); editor.commands.insertContent(' moved');
    await pending;
    assert.equal(editor.state.doc.firstChild!.type.name, 'image');
    assert.match(editor.state.doc.firstChild!.attrs.src, /^data:image\/gif;base64,/);
    assert.equal(editor.state.doc.firstChild!.attrs.uploadId, null);
    assert.match(editor.getText(), /tail moved/);
    const deleted = insertImageFiles(editor, [gif()], 0);
    editor.commands.deleteRange({ from: 0, to: 1 });
    await deleted;
    assert.equal(editor.state.doc.childCount, 2);
    assert.equal(editor.state.doc.firstChild!.attrs.uploadId, null);
    editor.state.doc.check();
  } finally { editor.destroy(); }
});

test('pasted screenshots use image blocks and invalid files leave a recoverable placeholder', async () => {
  const editor = new Editor({ extensions: [StarterKit, ImageNode] });
  try {
    let prevented = false;
    const event = { clipboardData: { files: [gif()] }, preventDefault: () => { prevented = true; } } as unknown as ClipboardEvent;
    assert.equal(editor.view.someProp('handlePaste', fn => fn(editor.view, event, null as any)), true);
    assert.equal(prevented, true);
    assert.equal(editor.state.doc.firstChild!.type.name, 'image');
    await insertImageFiles(editor, [new window.File(['x'], 'unsafe.svg', { type: 'image/svg+xml' })], editor.state.doc.content.size);
    const image = editor.state.doc.lastChild!;
    assert.equal(image.attrs.uploadId, null);
    assert.match(image.attrs.error, /PNG/);
    const recovered = parseDocument({ type: 'doc', content: [{ type: 'image', attrs: { uploadId: 'interrupted', src: '' } }] });
    assert.equal(recovered.content![0].attrs!.uploadId, null);
  } finally { editor.destroy(); }
});

test('HTML previews keep scripts inside an opaque sandbox and preserve source on HTML roundtrip', () => {
  assert.equal(HTML_SANDBOX, 'allow-scripts');
  const source = '<style>button{color:red}</style><button onclick="this.textContent=42">Run</button>';
  const html = buildHtmlPreview(source);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf(source));
  for (const rule of ["connect-src 'none'", "frame-src 'none'", "form-action 'none'", "script-src 'unsafe-inline'"]) assert.ok(html.includes(rule));
  const editor = new Editor({ extensions: [StarterKit, HtmlNode, ImageNode], content: { type: 'doc', content: [{ type: 'htmlPreview', attrs: { code: source, blockHeight: 420 } }, { type: 'image', attrs: { src: 'https://example.com/p.png', caption: '说明' } }] } });
  try {
    const before = editor.getJSON();
    editor.commands.setContent(editor.getHTML());
    assert.deepEqual(editor.getJSON(), before);
  } finally { editor.destroy(); }
});


test('completed image imports undo and redo without restoring orphaned busy placeholders', async () => {
  const editor = new Editor({ extensions: [StarterKit, ImageNode], content: '<p>keep</p>' });
  try {
    const pending = insertImageFiles(editor, [gif()], 0);
    // Simulate a file read completing after a history boundary / slow decode.
    editor.view.dispatch(closeHistory(editor.state.tr));
    await pending;
    const imported = editor.getJSON();
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.state.doc.firstChild!.type.name, 'paragraph');
    assert.equal(editor.getText(), 'keep');
    assert.equal(editor.commands.redo(), true);
    assert.deepEqual(editor.getJSON(), imported);
    assert.equal(editor.state.doc.firstChild!.attrs.uploadId, null);
    assert.match(editor.state.doc.firstChild!.attrs.src, /^data:image/);
  } finally { editor.destroy(); }
});


test('redo after undoing an unfinished file import restores its completed result', async () => {
  const editor = new Editor({ extensions: [StarterKit, ImageNode], content: '<p>keep</p>' });
  try {
    const pending = insertImageFiles(editor, [gif()], 0);
    assert.equal(editor.commands.undo(), true);
    await pending;
    assert.equal(editor.state.doc.firstChild!.type.name, 'paragraph');
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.state.doc.firstChild!.attrs.uploadId, null);
    assert.match(editor.state.doc.firstChild!.attrs.src, /^data:image/);
    editor.commands.undo(); editor.commands.redo();
    assert.equal(editor.state.doc.firstChild!.attrs.uploadId, null);
    assert.match(editor.state.doc.firstChild!.attrs.src, /^data:image/);
  } finally { editor.destroy(); }
});
