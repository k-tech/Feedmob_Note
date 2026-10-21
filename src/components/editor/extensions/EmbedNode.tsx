import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ResizableBlock, blockSizeAttributes } from '../ResizableBlock';
import { parseEmbedUrl } from '../utils/embed-url';
import React, { useState, useEffect } from 'react';
import { ExternalLink, Globe, Layout, Play, Settings } from 'lucide-react';

const EmbedComponent = (props: NodeViewProps) => {
  const { node, updateAttributes, editor } = props;
  const editable = editor.isEditable;
  const [isEditing, setIsEditing] = useState(!node.attrs.src);
  const [url, setUrl] = useState(node.attrs.src || '');
  const [type, setType] = useState<'figma' | 'video' | 'bookmark'>(node.attrs.type || 'bookmark');

  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setUrl(node.attrs.src || '');
    setType(node.attrs.type || 'bookmark');
    setIsEditing(!node.attrs.src);
  }, [node.attrs.src, node.attrs.type]);
  const handleSave = () => {
    try {
      const parsed = parseEmbedUrl(url);
      setError(null);
      setUrl(parsed.src);
      setType(parsed.type);
      updateAttributes({ src: parsed.src, type: parsed.type });
      setIsEditing(false);
    } catch { setError('请输入有效的 http:// 或 https:// 链接。'); }
  };
  let preview: ReturnType<typeof parseEmbedUrl> | null = null;
  try { preview = parseEmbedUrl(node.attrs.src || ''); } catch {}

  return (
    <ResizableBlock {...props} allowHeight={!!preview && (preview.type !== 'bookmark')} className="my-4 border border-[var(--border)] rounded-md overflow-hidden bg-[var(--muted)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--muted)] text-sm text-[var(--foreground)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2 font-medium">
          {type === 'figma' && <Layout className="w-4 h-4 text-[var(--muted-foreground)]" />}
          {type === 'video' && <Play className="w-4 h-4 text-[var(--muted-foreground)]" />}
          {type === 'bookmark' && <Globe className="w-4 h-4 text-[var(--muted-foreground)]" />}
          <span>{type === 'figma' ? 'Figma 设计稿' : type === 'video' ? '视频' : '外部书签'}</span>
        </div>
        {editable && <button
          type="button"
          onClick={() => setIsEditing(!isEditing)}
          aria-label={isEditing ? '收起链接设置' : '修改嵌入链接'}
          aria-expanded={isEditing}
          className="p-1.5 hover:bg-[var(--muted)] rounded text-[var(--muted-foreground)]"
        >
          <Settings className="w-4 h-4" />
        </button>}
      </div>

      {editable && isEditing ? (
        <div className="p-4 bg-[var(--background)] flex flex-col gap-2">
          <div className="flex gap-2">
            <input
              type="text"
              aria-label="嵌入链接"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); handleSave(); } }}
              placeholder="输入链接 (如 Figma 原型、GitHub PR、YouTube 视频或文档链接)..."
              className="min-w-0 flex-1 text-sm px-3.5 py-2 rounded border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] outline-none"
            />
            <button
              type="button"
              onClick={handleSave}
              className="primary-button shrink-0"
            >
              嵌入
            </button>
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="p-2.5 bg-[var(--background)]">
          {!preview ? <p role="alert" className="p-3 text-red-600">{editable ? '链接无效，请点击设置修改。' : '未设置有效链接。'}</p> : preview.isVideoFile ? (
            <video src={preview.src} controls className="resizable-block-body embed-video w-full" />
          ) : preview.type === 'figma' || preview.type === 'video' ? (
            <div className="resizable-block-body embed-frame w-full rounded-md overflow-hidden border border-[var(--border)]">
              <iframe
                src={preview.embedUrl}
                title="嵌入内容预览"
                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                referrerPolicy="strict-origin-when-cross-origin"
                loading="lazy"
                className="w-full h-full"
                allowFullScreen
              />
            </div>
          ) : (
            <a
              href={preview.src}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between p-3.5 rounded-md border border-[var(--border)] hover:bg-[var(--muted)] transition group"
            >
              <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
                <Globe className="w-4.5 h-4.5 text-[var(--muted-foreground)] shrink-0" />
                <div className="truncate">
                  <div className="text-sm font-medium text-[var(--foreground)] truncate group-hover:text-[var(--muted-foreground)]">
                    {url}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-0.5">点击在外部浏览器中打开链接</div>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-[var(--muted-foreground)] group-hover:text-[var(--foreground)] shrink-0" />
            </a>
          )}
        </div>
      )}
    </ResizableBlock>
  );
};


export const EmbedNode = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      ...blockSizeAttributes,
      src: { default: '' },
      type: { default: 'bookmark' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embed"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedComponent);
  },
});
