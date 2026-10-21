import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { WorkLog } from '@/types';

/** Author, team, mood and submission time of a log. */
export function LogByline({ log }: { log: WorkLog }) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap min-w-0">
      {log.user?.avatar ? (
        <img src={log.user.avatar} alt={log.user.name} className="w-8 h-8 shrink-0 rounded object-cover ring-2 ring-[var(--border)]" />
      ) : (
        <div className="w-8 h-8 shrink-0 rounded bg-[var(--sidebar-accent)] text-[var(--foreground)] flex items-center justify-center font-medium text-sm">
          {log.user?.name?.[0] || 'U'}
        </div>
      )}
      <div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-medium text-sm text-[var(--foreground)]">{log.user?.name}</span>
          <span className="text-xs px-2.5 py-1 rounded bg-[var(--muted)] text-[var(--foreground)] font-medium">
            {log.user?.team?.name || log.user?.title || log.user?.role}
          </span>
          {log.mood && <span className="text-lg">{log.mood}</span>}
        </div>
        <div className="text-xs text-[var(--muted-foreground)] mt-1 flex items-center gap-2">
          <span className="font-semibold">{log.date}</span>
          <span>•</span>
          <span>{new Date(log.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 提交</span>
        </div>
      </div>
    </div>
  );
}

/** Blocker status and project tags. */
export function LogBadges({ log }: { log: WorkLog }) {
  if (!log.hasBlocker && !log.tags?.length) return null;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {log.hasBlocker && (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-4 h-4" />
          <span>包含阻塞点</span>
        </div>
      )}
      {log.tags?.map(({ tag }) => (
        <span key={tag.id} className="px-2.5 py-1 rounded text-xs font-medium bg-[var(--muted)] text-[var(--foreground)]">
          #{tag.name}
        </span>
      ))}
    </div>
  );
}
