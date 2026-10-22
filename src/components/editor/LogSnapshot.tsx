'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { Check, Copy, Download, X } from 'lucide-react';
import { LogDocument } from './LogDocument';

interface LogSnapshotProps {
  content: JSONContent;
  title: string;
  mood: string;
  date: string;
  tags: string[];
  author?: string;
  onClose: () => void;
}

/** Card width in CSS pixels: readable when a group chat scales it to a phone. */
const CARD_WIDTH = 760;
/** Stay under browsers' canvas limits for very long logs. */
const MAX_CANVAS_SIDE = 16000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Wait until the read-only document, its images and diagrams have rendered. */
async function settle(root: HTMLElement) {
  for (let i = 0; i < 60 && !root.querySelector('.tiptap'); i++) await sleep(50);
  // Off-screen lazy images would never load; the card is captured as a whole.
  root.querySelectorAll<HTMLImageElement>('img[loading="lazy"]').forEach(image => { image.loading = 'eager'; });
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const diagrams = Array.from(root.querySelectorAll('.mermaid-viewport')).some(view => !view.querySelector('svg') && !view.textContent?.trim());
    const images = Array.from(root.querySelectorAll('img')).some(image => !image.complete);
    if (!diagrams && !images) break;
    await sleep(100);
  }
  await document.fonts?.ready;
  // The image is drawn from a clone, which copies attributes but not the
  // live `checked` state of task checkboxes.
  root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(box => box.toggleAttribute('checked', box.checked));
  await sleep(50);
}

/**
 * The day's log as one long image, for posting to the team chat. Renders the
 * current (possibly unsubmitted) document with the read-only renderer used by
 * the team feed, off-screen at a fixed width, and offers copy and download.
 */
export function LogSnapshot({ content, title, mood, date, tags, author, onClose }: LogSnapshotProps) {
  const card = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const root = card.current;
        if (!root) return;
        await settle(root);
        const { toBlob } = await import('html-to-image');
        const height = root.scrollHeight;
        const pixelRatio = Math.max(1, Math.min(2, MAX_CANVAS_SIDE / height));
        const blob = await toBlob(root, {
          pixelRatio,
          backgroundColor: getComputedStyle(root).backgroundColor,
          // Embedded pages cannot be drawn; their blocks show a labelled frame.
          filter: node => !(node instanceof HTMLIFrameElement),
          imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        });
        if (!blob) throw new Error('empty image');
        if (!cancelled) setImage({ url: URL.createObjectURL(blob), blob });
      } catch (cause) {
        console.error('Log snapshot failed', cause);
        if (!cancelled) setError('截图生成失败，请稍后重试。');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const fileName = `Minework-工作日志-${date}.png`;
  const copy = async () => {
    if (!image) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('浏览器不允许直接复制图片，请使用“下载图片”。');
    }
  };

  return (
    <div className="snapshot-overlay" role="dialog" aria-modal="true" aria-label="日志截图" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="snapshot-panel popover-panel">
        <div className="snapshot-panel-head">
          <span className="font-medium">日志截图</span>
          <button type="button" className="icon-button" aria-label="关闭截图" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="snapshot-preview">
          {error ? <p role="alert" className="p-6 text-sm">{error}</p>
            : image ? <img src={image.url} alt={`${date} 工作日志截图`} />
            : <p role="status" className="p-10 text-center text-sm text-[var(--muted-foreground)]">正在生成截图…</p>}
        </div>
        <div className="snapshot-panel-foot">
          <span className="text-xs text-[var(--muted-foreground)]">复制后可直接粘贴到群聊；HTML 预览和视频等嵌入内容在图中显示为占位框。</span>
          <div className="flex gap-2">
            <a className={`quiet-button${image ? '' : ' pointer-events-none opacity-50'}`} href={image?.url} download={fileName} aria-disabled={!image}><Download size={15} />下载图片</a>
            <button type="button" className="primary-button" disabled={!image} onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? '已复制' : '复制图片'}</button>
          </div>
        </div>
      </div>

      {/* The captured card, rendered off-screen at a fixed width. */}
      <div className="snapshot-stage" aria-hidden="true">
        <div ref={card} className="snapshot-card" style={{ width: CARD_WIDTH }}>
          <div className="snapshot-card-head">
            {mood && <div className="snapshot-card-icon">{mood}</div>}
            <h1>{title || `${date} 工作日志`}</h1>
            <div className="snapshot-card-meta">
              {author && <span>{author}</span>}
              <span>{date}</span>
              {tags.map(tag => <span key={tag} className="snapshot-card-tag">#{tag}</span>)}
            </div>
          </div>
          <LogDocument content={content} className="is-capture" />
          <div className="snapshot-card-foot">Minework 工作日志 · {date}</div>
        </div>
      </div>
    </div>
  );
}
