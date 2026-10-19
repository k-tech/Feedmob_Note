import React, { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Code2, Eye, Upload } from 'lucide-react';
import { ResizableBlock, blockSizeAttributes } from '../ResizableBlock';
import { buildHtmlPreview, HTML_SANDBOX } from '../utils/html-preview';

export const HTML_EXAMPLE = `<style>\n.card { padding: 24px; border-radius: 12px; background: #edf8f5; color: #164f42; }\nbutton { padding: 8px 16px; margin-top: 12px; cursor: pointer; }\n</style>\n<div class="card">\n  <h2>今日进展</h2>\n  <p>把 HTML、CSS 和交互示例放进日志。</p>\n  <button onclick="this.textContent='已完成 ✓'">查看效果</button>\n</div>`;
function HtmlComponent(props: NodeViewProps) {
  const { node, updateAttributes, editor, getPos } = props;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  return <ResizableBlock {...props} className="media-block html-block">
    <div className="media-block-toolbar"><span><Code2 size={15} />HTML 预览</span><div className="flex gap-1">
      <label className="quiet-button media-file-button"><Upload size={14} />导入 HTML<input type="file" accept=".html,.htm,text/html" aria-label="导入 HTML 文件" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        if (file.size > 512 * 1024) { setError('HTML 文件不能超过 512 KB。'); return; }
        const original = node;
        try {
          const code = await file.text();
          if (editor.isDestroyed) return;
          const pos = getPos();
          if (typeof pos !== 'number' || editor.state.doc.nodeAt(pos) !== original) return;
          updateAttributes({ code, title: file.name }); setError('');
        } catch { setError('读取 HTML 文件失败，请重试。'); }
      }} /></label>
      <button type="button" className="quiet-button" onClick={() => setEditing(!editing)} aria-expanded={editing}>{editing ? <Eye size={14} /> : <Code2 size={14} />}{editing ? '收起代码' : '编辑代码'}</button>
    </div></div>
    {editing && <div className="media-settings"><textarea aria-label="HTML 源码" spellCheck={false} value={node.attrs.code || ''} onChange={event => updateAttributes({ code: event.target.value })} className="html-source" /><p className="media-hint">支持 HTML、CSS 和内联 JavaScript；修改即时保存到草稿。外部脚本、网络请求和登录态不可用。</p></div>}
    {error && <p role="alert" className="media-error">{error}</p>}
    <iframe title={node.attrs.title || 'HTML 内容预览'} srcDoc={buildHtmlPreview(node.attrs.code || '')} sandbox={HTML_SANDBOX} referrerPolicy="no-referrer" className="resizable-block-body html-preview" />
    <input className="media-caption" aria-label="HTML 说明" placeholder="添加 HTML 说明…" value={node.attrs.title || ''} onChange={event => updateAttributes({ title: event.target.value })} />
  </ResizableBlock>;
}
export const HtmlNode = Node.create({
  name: 'htmlPreview', group: 'block', atom: true, draggable: true,
  addAttributes() { return { ...blockSizeAttributes, code: { default: '' }, title: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-type="html-preview"]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'html-preview' })]; },
  renderText({ node }) { return node.attrs.title || '[HTML 预览]'; },
  addNodeView() { return ReactNodeViewRenderer(HtmlComponent); },
});
