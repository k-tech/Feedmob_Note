import React, { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { Plugin } from '@tiptap/pm/state';
import { ImagePlus, Settings } from 'lucide-react';
import { ResizableBlock, blockSizeAttributes } from '../ResizableBlock';
import { IMAGE_ACCEPT, imageSource, insertImageFiles, resolveImageImports } from '../utils/image';
import { getDraggedBlockPos } from '../utils/block-drag';

function ImageComponent(props: NodeViewProps) {
  const { node, editor, updateAttributes, getPos } = props;
  const src = imageSource(node.attrs.src);
  const [editing, setEditing] = useState(!src);
  const [url, setUrl] = useState(node.attrs.src || '');
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => { setUrl(node.attrs.src || ''); setEditing(!imageSource(node.attrs.src)); setFailed(false); }, [node.attrs.src]);
  const applyUrl = () => {
    const next = imageSource(url);
    if (!next) { setError('请输入完整的 http:// 或 https:// 图片链接。'); return; }
    updateAttributes({ src: next, error: '', uploadId: null }); setError(''); setEditing(false);
  };
  const editable = editor.isEditable;
  if (!editable && !src) return null;
  return <ResizableBlock {...props} allowHeight={false} className={`media-block image-block${editable ? '' : ' is-read-only'}`}>
    {editable && <div className="media-block-toolbar"><span><ImagePlus size={15} />图片</span><button type="button" className="icon-button" aria-label="修改图片" aria-expanded={editing} onClick={() => setEditing(!editing)}><Settings size={15} /></button></div>}
    {src && <figure><img src={src} alt={node.attrs.alt || ''} loading="lazy" referrerPolicy="no-referrer" onLoad={() => setFailed(false)} onError={() => setFailed(true)} className="journal-image" />{failed && <p role="alert" className="media-error">图片无法加载，请检查链接或选择本地图片。</p>}</figure>}
    {editable && editing && <div className="media-settings">
      <label className="quiet-button media-file-button"><ImagePlus size={16} />选择图片<input type="file" accept={IMAGE_ACCEPT} multiple aria-label="选择本地图片" disabled={!!node.attrs.uploadId} onChange={event => {
        const files = Array.from(event.target.files || []); event.target.value = '';
        const pos = getPos();
        if (files.length && typeof pos === 'number') {
          void insertImageFiles(editor, files, pos, node.nodeSize);
        }
      }} /></label>
      <p className="media-hint">也可粘贴截图、拖入图片；大图自动压缩，GIF 最多 1 MB。</p>
      <div className="media-input-row"><input aria-label="图片链接" placeholder="https://… 图片链接" value={url} onChange={event => setUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); applyUrl(); } }} /><button type="button" className="primary-button" onClick={applyUrl}>插入图片</button></div>
      <input aria-label="图片替代文字" placeholder="替代文字（图片无法显示时使用）" value={node.attrs.alt || ''} onChange={event => updateAttributes({ alt: event.target.value })} />
    </div>}
    {node.attrs.uploadId && <p role="status" className="media-hint px-3 pb-3">正在处理图片…</p>}
    {(error || node.attrs.error) && <p role="alert" className="media-error">{error || node.attrs.error}</p>}
    {src && (editable ? <input className="media-caption" aria-label="图片说明" placeholder="添加图片说明…" value={node.attrs.caption || ''} onChange={event => updateAttributes({ caption: event.target.value })} />
      : node.attrs.caption && <p className="media-caption">{node.attrs.caption}</p>)}
  </ResizableBlock>;
}

export const ImageNode = Node.create({
  name: 'image', group: 'block', atom: true, draggable: true,
  addAttributes() { return { ...blockSizeAttributes, src: { default: '' }, alt: { default: '' }, caption: { default: '' }, uploadId: { default: null, rendered: false }, error: { default: '', rendered: false } }; },
  parseHTML() { return [{ tag: 'img[src]', getAttrs: element => imageSource((element as HTMLElement).getAttribute('src')) ? null : false }]; },
  renderHTML({ HTMLAttributes }) { return ['img', mergeAttributes(HTMLAttributes, { src: imageSource(HTMLAttributes.src) })]; },
  renderText({ node }) { return [node.attrs.alt, node.attrs.caption].filter(Boolean).join(' · ') || '[图片]'; },
  addNodeView() { return ReactNodeViewRenderer(ImageComponent); },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some(tr => tr.docChanged)) return null;
        const tr = resolveImageImports(editor, state.tr);
        return tr.docChanged ? tr : null;
      },
      props: {
        handlePaste(view, event) {
          const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
          if (!editor.isEditable || !files.length) return false;
          event.preventDefault(); void insertImageFiles(editor, files); return true;
        },
        handleDrop(view, event, _slice, moved) {
          if (moved || getDraggedBlockPos(view) !== null || !editor.isEditable) return false;
          const files = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
          if (!files.length) return false;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          if (pos === undefined) return false;
          event.preventDefault(); void insertImageFiles(editor, files, pos); return true;
        },
      },
    })];
  },
});
