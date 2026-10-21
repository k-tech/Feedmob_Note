import './dom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LogDocument } from '../src/components/editor/LogDocument';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

async function render(content: unknown, fallbackText?: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<LogDocument content={content} fallbackText={fallbackText} />); await tick(); });
  await act(async () => { await tick(); });
  return { container, rerender: async (next: unknown) => { await act(async () => { root.render(<LogDocument content={next} />); await tick(); }); },
    close: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test('a submitted log renders its blocks read-only, without any editing controls', async () => {
  const doc = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '今日进展' }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('完成')] }] },
    { type: 'callout', attrs: { type: 'tip' }, content: [p('提示内容')] },
    { type: 'columnList', content: [{ type: 'column', content: [p('左')] }, { type: 'column', content: [p('右')] }] },
    { type: 'htmlPreview', attrs: { code: '<b>页面</b>', title: '示例页面' } },
    { type: 'image', attrs: { src: '' } },
  ] };
  const view = await render(JSON.stringify(doc));
  try {
    const { container } = view;
    assert.equal(container.querySelector('h2')?.textContent, '今日进展');
    assert.equal(container.querySelector('[contenteditable="true"]'), null);
    assert.ok(container.querySelector('iframe[sandbox]'), 'HTML preview renders as a sandboxed page');
    assert.ok(container.textContent?.includes('示例页面'));
    assert.ok((container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked);
    assert.equal(container.querySelectorAll('[data-type="column"]').length, 2);
    // No author controls: source editing, captions inputs, uploads, resize or column buttons.
    assert.ok(!container.textContent?.includes('编辑代码'));
    assert.ok(!container.textContent?.includes('导入 HTML'));
    assert.equal(container.querySelector('textarea, input:not([type="checkbox"]), select'), null);
    assert.equal(container.querySelector('.block-resize-side, .block-resize-corner'), null);
    assert.equal(container.querySelector('.column-add-block:not([hidden]), .column-resize-handle:not([hidden])'), null);
    assert.equal(container.querySelector('.image-block'), null, 'an unset image is not shown to readers');
    assert.ok(container.textContent?.includes('提示'));
  } finally { await view.close(); }
});

test('a changed document replaces the view; an unreadable one shows the text summary', async () => {
  const view = await render({ type: 'doc', content: [p('第一版')] });
  try {
    await view.rerender({ type: 'doc', content: [p('第二版')] });
    assert.ok(view.container.textContent?.includes('第二版'));
  } finally { await view.close(); }
  const broken = await render('{not json', '纯文本摘要');
  try { assert.equal(broken.container.textContent, '纯文本摘要'); }
  finally { await broken.close(); }
});
