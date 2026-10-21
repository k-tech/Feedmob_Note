'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, PenSquare } from 'lucide-react';
import { WorkLog } from '@/types';
import { useCurrentUser } from '@/lib/user-context';
import { LogDocument } from '@/components/editor/LogDocument';
import { LogInteractions } from '@/components/views/LogInteractions';
import { LogBadges, LogByline } from '@/components/views/LogMeta';

/** A teammate's log as its author wrote it, with reactions and comments. */
export default function LogPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser, isFullWidth } = useCurrentUser();
  const [log, setLog] = useState<WorkLog | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/logs/${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || '日志加载失败，请稍后重试。');
      setLog(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '日志加载失败，请稍后重试。');
    }
  }, [id]);

  useEffect(() => { setLog(null); void load(); }, [load]);

  return (
    <div className={`document-canvas log-page ${isFullWidth ? 'is-full-width' : ''}`}>
      <div className="mb-6 flex items-center justify-between gap-3">
        <Link href="/stream" className="quiet-button"><ArrowLeft size={15} />团队动态</Link>
        {log && currentUser?.id === log.userId && (
          <Link href={`/?date=${log.date}`} className="quiet-button"><PenSquare size={15} />编辑这篇日志</Link>
        )}
      </div>
      {error ? <p role="alert" className="rounded border border-[var(--border)] p-4 text-sm">{error}</p>
        : !log ? <p className="py-20 text-center text-sm text-[var(--muted-foreground)]">正在加载日志...</p>
        : <>
          {log.mood && <div className="log-page-icon" aria-hidden="true">{log.mood}</div>}
          <h1 className="log-page-title">{log.title || `${log.user?.name || '成员'} 的工作日志`}</h1>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-5">
            <LogByline log={log} />
            <LogBadges log={log} />
          </div>
          <LogDocument content={log.contentJson} fallbackText={log.contentText} className="log-page-body" />
          <section aria-label="签阅与评论" className="mt-10 overflow-hidden rounded-md border border-[var(--border)]">
            <LogInteractions log={log} onRefresh={load} />
          </section>
        </>}
    </div>
  );
}
