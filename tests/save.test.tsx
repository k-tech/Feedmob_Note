import './dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Editor } from '@tiptap/core';
import { BlockEditor } from '../src/components/editor/BlockEditor';
import { UserProvider } from '../src/lib/user-context';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.fetch = async (url) => new Response(String(url) === '/api/me' ? JSON.stringify({ id: 'test-user', email: 'test@example.invalid', name: 'Test' }) : '[]', { status: 200 });
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function mount(onSave: (data: any) => Promise<void>, id = 'test:2099-01-01') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<UserProvider><BlockEditor documentId={id} date="2099-01-01" onSave={onSave} /></UserProvider>); await tick(); });
  await act(async () => { await tick(); });
  const editor = (container.querySelector('.tiptap') as any)?.editor as Editor;
  assert.ok(editor);
  const submit = () => Array.from(container.querySelectorAll('button')).find(button => /提交工作日志|正在保存/.test(button.textContent || ''))!;
  return { container, editor, submit, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test('save in flight never replaces new text; duplicate save is blocked; latest draft restores', async () => {
  localStorage.clear();
  let resolveSave!: () => void;
  let calls = 0;
  const app = await mount(async () => { calls++; await new Promise<void>(resolve => { resolveSave = resolve; }); });
  try {
    await act(async () => { app.editor.commands.insertContent('before'); });
    await act(async () => { app.submit().click(); app.submit().click(); });
    assert.equal(calls, 1);
    await act(async () => { app.editor.commands.insertContent(' after'); });
    const selection = app.editor.state.selection.from;
    await act(async () => { resolveSave(); await tick(); });
    assert.equal(app.editor.getText(), 'before after');
    assert.equal(app.editor.state.selection.from, selection);
    assert.ok(app.container.textContent?.includes('有未提交修改'));
    assert.ok(localStorage.getItem('minework-draft:test:2099-01-01')?.includes('before after'));
  } finally { await app.close(); }
  const restored = await mount(async () => {});
  try { assert.equal(restored.editor.getText(), 'before after'); }
  finally { await restored.close(); localStorage.clear(); }
});

test('a draft saved under the pre-rename key restores and moves to the Minework key', async () => {
  localStorage.clear();
  localStorage.setItem('feedmob-draft:test:2099-01-01', JSON.stringify({ title: '', mood: '', tagNames: [], contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'legacy draft' }] }] } }));
  const app = await mount(async () => {});
  try {
    assert.equal(app.editor.getText(), 'legacy draft');
    assert.equal(localStorage.getItem('feedmob-draft:test:2099-01-01'), null);
    assert.ok(localStorage.getItem('minework-draft:test:2099-01-01')?.includes('legacy draft'));
  } finally { await app.close(); localStorage.clear(); }
});

test('failed save is visible, keeps local draft, and can be retried successfully', async () => {
  localStorage.clear();
  let fail = true;
  const app = await mount(async () => { if (fail) throw new Error('模拟保存失败'); });
  try {
    await act(async () => { app.editor.commands.insertContent('must survive'); });
    await act(async () => { app.submit().click(); await tick(); });
    assert.match(app.container.querySelector('[role="alert"]')?.textContent ?? '', /模拟保存失败/);
    assert.equal(app.editor.getText(), 'must survive');
    assert.ok(localStorage.getItem('minework-draft:test:2099-01-01'));
    fail = false;
    await act(async () => { app.submit().click(); await tick(); });
    assert.equal(app.container.querySelector('[role="alert"]'), null);
    assert.ok(app.container.textContent?.includes('成功保存'));
    assert.equal(localStorage.getItem('minework-draft:test:2099-01-01'), null);
  } finally { await app.close(); localStorage.clear(); }
});

test('IME Enter stays in the editor; plain Enter chooses a slash command without splitting a block', async () => {
  localStorage.clear();
  const app = await mount(async () => {});
  try {
    await act(async () => { app.editor.commands.insertContent('/h2'); });
    assert.ok(app.container.querySelector('[role="listbox"]'));
    await act(async () => {
      app.editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    });
    assert.equal(app.editor.getText(), '/h2');
    await act(async () => {
      app.editor.view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    assert.equal(app.editor.state.doc.childCount, 1);
    assert.equal(app.editor.state.doc.firstChild?.type.name, 'heading');
    assert.equal(app.editor.state.doc.firstChild?.attrs.level, 2);
    assert.equal(app.editor.getText(), '');
  } finally { await app.close(); localStorage.clear(); }
});

test('selection toolbar applies formatting to selected text without adding a block', async () => {
  localStorage.clear();
  const app = await mount(async () => {});
  try {
    await act(async () => {
      app.editor.commands.insertContent('format me');
      app.editor.chain().focus().setTextSelection({ from: 1, to: 7 }).run();
      await tick();
    });
    const bold = document.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="加粗"]');
    assert.ok(bold);
    await act(async () => {
      bold.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      bold.click();
    });
    assert.equal(app.editor.state.doc.childCount, 1);
    assert.equal(app.editor.state.doc.firstChild?.firstChild?.marks[0]?.type.name, 'bold');
    assert.equal(app.editor.getText(), 'format me');
  } finally { await app.close(); localStorage.clear(); }
});

test('the drag handle preserves native mousedown and starts an editor-scoped block drag', async () => {
  localStorage.clear();
  const app = await mount(async () => {});
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  try {
    await act(async () => { app.editor.commands.insertContent('drag me'); });
    const paragraph = app.container.querySelector('.tiptap p')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => paragraph });
    await act(async () => {
      paragraph.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    const grip = app.container.querySelector<HTMLButtonElement>('button[aria-label="块操作菜单"]');
    assert.ok(grip);
    const down = new window.MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => { grip.dispatchEvent(down); });
    assert.equal(down.defaultPrevented, false, 'preventing mousedown blocks native HTML drag initiation');
    const transfer = { values: new Map<string, string>(), setData(type: string, value: string) { this.values.set(type, value); }, setDragImage() {}, effectAllowed: '' };
    const drag = new window.Event('dragstart', { bubbles: true, cancelable: true });
    Object.defineProperty(drag, 'dataTransfer', { value: transfer });
    await act(async () => { grip.dispatchEvent(drag); });
    const { getDraggedBlockPos } = await import('../src/components/editor/utils/block-drag');
    assert.equal(getDraggedBlockPos(app.editor.view), 0);
    assert.equal(transfer.values.get('application/x-minework-block'), '0');
    assert.equal(transfer.effectAllowed, 'move');
  } finally {
    if (previous) Object.defineProperty(document, 'elementFromPoint', previous);
    else delete (document as any).elementFromPoint;
    await app.close(); localStorage.clear();
  }
});

test('the right empty column can be deleted from its actual block menu, persists to the draft and undoes once', async () => {
  localStorage.clear();
  const id = 'test:delete-empty-column';
  const app = await mount(async () => {}, id);
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  const paragraph = (text = '') => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });
  try {
    await act(async () => {
      app.editor.commands.setContent({ type: 'doc', content: [
        { type: 'columnList', content: [
          { type: 'column', content: [paragraph('keep left')] },
          { type: 'column', content: [paragraph()] },
        ] }, paragraph('keep after'),
      ] }, true);
    });
    const before = app.editor.getJSON();
    const empty = app.container.querySelectorAll('[data-type="column"]')[1].querySelector('p')!;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => empty });
    await act(async () => { empty.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 10 })); });
    const menu = app.container.querySelector<HTMLButtonElement>('[aria-label="块操作菜单"]');
    assert.ok(menu);
    await act(async () => { menu.click(); });
    const remove = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="块操作"] button')).find(button => button.textContent === '删除块');
    assert.ok(remove);
    await act(async () => { remove.click(); await tick(); });
    assert.deepEqual(app.editor.getJSON().content, [paragraph('keep left'), paragraph('keep after')]);
    assert.equal(app.container.querySelector('[data-type="column-list"]'), null);
    const draft = JSON.parse(localStorage.getItem('minework-draft:' + id)!);
    assert.deepEqual(draft.contentJson, app.editor.getJSON());
    await act(async () => { app.editor.commands.undo(); });
    assert.deepEqual(app.editor.getJSON(), before);
  } finally {
    if (previous) Object.defineProperty(document, 'elementFromPoint', previous);
    else delete (document as any).elementFromPoint;
    await app.close();
    localStorage.clear();
  }
});

test('a gutter preview commits the same column drop and releases the handle for further editing', async () => {
  localStorage.clear();
  const app = await mount(async () => {}, 'gutter-drop');
  const previous = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  const rect = (el: HTMLElement, x: number, y: number, width: number, height: number) => {
    el.getBoundingClientRect = () => ({ left:x, right:x+width, top:y, bottom:y+height, width, height, x, y, toJSON:()=>({}) });
  };
  try {
    await act(async () => { app.editor.commands.setContent({type:'doc',content:['A','B','C','D'].map(text=>({type:'paragraph',content:[{type:'text',text}]}))}); });
    const before = app.editor.getJSON();
    const body = app.container.querySelector<HTMLElement>('.document-body')!;
    const paragraphs = app.container.querySelectorAll<HTMLElement>('.tiptap p');
    rect(body, 50, 80, 1100, 400); rect(app.editor.view.dom, 100, 100, 1000, 360);
    paragraphs.forEach((el,i)=>rect(el,100,100+i*60,1000,40));
    Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>paragraphs[2]});
    await act(async () => { paragraphs[2].dispatchEvent(new window.MouseEvent('mousemove',{bubbles:true,clientX:500,clientY:240})); });
    const grip = app.container.querySelector<HTMLButtonElement>('[aria-label="块操作菜单"]')!;
    assert.ok(grip);
    const transfer = {setData(){},setDragImage(){},effectAllowed:'',dropEffect:''};
    const event = (type:string,x:number,y:number) => {
      const e = new window.Event(type,{bubbles:true,cancelable:true});
      Object.defineProperties(e,{clientX:{value:x},clientY:{value:y},dataTransfer:{value:transfer}});
      return e;
    };
    await act(async()=>{grip.dispatchEvent(event('dragstart',80,240));});
    Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>body});
    await act(async()=>{body.dispatchEvent(event('dragover',76,120));});
    assert.equal(app.container.querySelector('[data-testid="block-drop-indicator"]')?.getAttribute('data-zone'),'left');
    assert.match(app.container.querySelector('[data-testid="block-drop-label"]')?.textContent ?? '',/左侧并排成列/);
    const dropEvent = event('drop',76,120);
    await act(async()=>{body.dispatchEvent(dropEvent);});
    assert.equal(dropEvent.defaultPrevented,true);
    const row = app.editor.state.doc.firstChild!;
    assert.equal(row.type.name,'columnList');
    assert.deepEqual([row.child(0).textContent,row.child(1).textContent],['C','A']);
    assert.equal(app.editor.state.doc.lastChild!.textContent,'D');
    assert.equal(app.container.querySelector('[data-testid="block-drop-indicator"]'),null);
    assert.equal(app.container.querySelector('.minework-drag-source-active'),null);
    await act(async()=>{app.editor.commands.undo();});
    assert.deepEqual(app.editor.getJSON(),before);
    const next = app.container.querySelectorAll<HTMLElement>('.tiptap p')[1];
    Object.defineProperty(document,'elementFromPoint',{configurable:true,value:()=>next});
    await act(async()=>{next.dispatchEvent(new window.MouseEvent('mousemove',{bubbles:true,clientX:500,clientY:170}));});
    assert.ok(app.container.querySelector('[data-block-handle]'),'drop must not leave isDragging stuck');
  } finally {
    if(previous) Object.defineProperty(document,'elementFromPoint',previous); else delete (document as any).elementFromPoint;
    await app.close(); localStorage.clear();
  }
});


test('images, HTML source and tables restore from local drafts and submit intact', async () => {
  localStorage.clear();
  const id = 'rich-media:2099-01-01';
  let saved: any;
  const app = await mount(async data => { saved = data; }, id);
  let original: any;
  try {
    await act(async () => {
      app.editor.commands.setContent({ type: 'doc', content: [
        { type: 'image', attrs: { src: 'https://example.com/photo.png', caption: '本周截图', blockWidth: 70 } },
        { type: 'htmlPreview', attrs: { code: '<button onclick="this.textContent=42">Run</button>', title: '结果看板', blockHeight: 450 } },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '42' }] }] }] }] },
      ] }, true);
    });
    original = app.editor.getJSON();
    assert.equal(app.container.querySelector('iframe')?.getAttribute('sandbox'), 'allow-scripts');
    assert.equal(app.container.querySelector('img.journal-image')?.getAttribute('src'), 'https://example.com/photo.png');
    assert.equal(JSON.stringify(JSON.parse(localStorage.getItem('minework-draft:' + id)!).contentJson), JSON.stringify(original));
  } finally { await app.close(); }
  const restored = await mount(async data => { saved = data; }, id);
  try {
    assert.deepEqual(restored.editor.getJSON(), original);
    await act(async () => { restored.submit().click(); await tick(); });
    assert.deepEqual(saved.contentJson, original);
    assert.match(saved.contentText, /本周截图/);
    assert.match(saved.contentText, /结果看板/);
    assert.equal(localStorage.getItem('minework-draft:' + id), null);
  } finally { await restored.close(); localStorage.clear(); }
});


test('pasted Markdown tasks remain clickable, restore from drafts and submit checked states', async () => {
  localStorage.clear();
  const id = 'markdown-tasks:2099-01-01';
  const app = await mount(async () => {}, id);
  let original: any;
  try {
    await act(async () => {
      const text = '- [ ] first <> task\n- [x] 已完成\n- [ ] 最后一项';
      const event = new window.Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (type: string) => type === 'text/plain' ? text : '' } });
      app.editor.view.pasteText(text, event as ClipboardEvent);
    });
    assert.equal(app.container.querySelectorAll('input[type="checkbox"]').length, 3);
    assert.equal(app.container.querySelectorAll('input[type="checkbox"]:checked').length, 1);
    await act(async () => { (app.container.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    original = app.editor.getJSON();
    assert.equal(app.editor.state.doc.firstChild!.firstChild!.attrs.checked, true);
  } finally { await app.close(); }
  let saved: any;
  const restored = await mount(async data => { saved = data; }, id);
  try {
    assert.deepEqual(restored.editor.getJSON(), original);
    assert.equal(restored.container.querySelectorAll('input[type="checkbox"]:checked').length, 2);
    await act(async () => { restored.submit().click(); await tick(); });
    assert.deepEqual(saved.contentJson, original);
    assert.equal(saved.contentText, '- [x] first <> task\n- [x] 已完成\n- [ ] 最后一项');
  } finally { await restored.close(); localStorage.clear(); }
});
