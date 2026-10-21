'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileText } from 'lucide-react';
import { WorkLog } from '@/types';
import { LogDocument } from '@/components/editor/LogDocument';
import { LogInteractions } from './LogInteractions';
import { LogBadges, LogByline } from './LogMeta';

interface StreamFeedProps {
  logs: WorkLog[];
  onRefresh: () => void;
}

/** Height of a card's document preview before "展开全文"; keep in sync with .log-preview. */
const PREVIEW_HEIGHT = 420;

export const StreamFeed: React.FC<StreamFeedProps> = ({ logs, onRefresh }) => {
  if (logs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 bg-[var(--background)] rounded-md border border-[var(--border)] text-[var(--muted-foreground)]">
        <FileText className="w-7 h-7 shrink-0 mb-3" aria-hidden="true" />
        <p className="text-sm font-medium">暂无符合条件的团队日志</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {logs.map(log => <LogCard key={log.id} log={log} onRefresh={onRefresh} />)}
    </div>
  );
};

const logHref = (log: Pick<WorkLog, 'id'>) => `/logs/${log.id}`;

function LogCard({ log, onRefresh }: { log: WorkLog; onRefresh: () => void }) {
  const href = logHref(log);
  return (
    <article
      aria-label={`${log.user?.name || '成员'} 的 ${log.date} 日志`}
      className={`bg-[var(--background)] rounded-md border transition ${
        log.hasBlocker ? 'border-red-200 dark:border-red-900/60 shadow-red-500/5' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 sm:px-5 py-4 border-b border-[var(--border)]">
        <LogByline log={log} />
        <div className="flex items-center gap-2 flex-wrap">
          <LogBadges log={log} />
          <Link href={href} className="quiet-button log-open-link" aria-label="打开完整日志">
            <ArrowUpRight size={15} />打开
          </Link>
        </div>
      </div>

      <div className="px-4 sm:px-5 pt-4 pb-3">
        <h3 className="mb-2 text-base font-semibold">
          <Link href={href} className="log-card-title">{log.title || `${log.user?.name || '成员'} 的工作日志`}</Link>
        </h3>
        <LogPreview log={log} href={href} />
      </div>

      <LogInteractions log={log} onRefresh={onRefresh} />
    </article>
  );
}

/**
 * The submitted document, rendered like the editor but read-only. Cards
 * mount the renderer only near the viewport and clip long logs, so a long
 * feed with HTML previews and diagrams stays light.
 */
function LogPreview({ log, href }: { log: WorkLog; href: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = frame.current;
    if (!element || visible) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '600px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  // Media and diagrams load after mount; re-measure whenever the content grows.
  useEffect(() => {
    const content = frame.current?.firstElementChild;
    if (!content) return;
    const measure = () => setOverflowing(content.scrollHeight > PREVIEW_HEIGHT + 24);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [visible]);

  const clipped = overflowing && !expanded;
  return (
    <>
      <div ref={frame} className={`log-preview${clipped ? ' is-clipped' : ''}${expanded ? ' is-expanded' : ''}`}>
        {visible
          ? <LogDocument content={log.contentJson} fallbackText={log.contentText} />
          : <div className="log-document is-fallback">{log.contentText || '（暂无详细文本）'}</div>}
      </div>
      {overflowing && (
        <div className="log-preview-actions">
          <button type="button" className="quiet-button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? '收起' : '展开全文'}
          </button>
          <Link href={href} className="quiet-button">在单独页面打开</Link>
        </div>
      )}
    </>
  );
}
