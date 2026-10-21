'use client';

import React, { useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { WorkLog } from '@/types';
import { useCurrentUser } from '@/lib/user-context';

const EMOJIS = ['👍', '👀', '🚀', '🎯', '❤️'];

/** Reactions and comments for one log; shared by the team feed and the log page. */
export function LogInteractions({ log, onRefresh }: { log: WorkLog; onRefresh: () => void }) {
  const { currentUser } = useCurrentUser();
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reactionCounts: Record<string, { count: number; hasReacted: boolean; users: string[] }> = {};
  for (const r of log.reactions || []) {
    reactionCounts[r.emoji] ??= { count: 0, hasReacted: false, users: [] };
    reactionCounts[r.emoji].count += 1;
    reactionCounts[r.emoji].users.push(r.user?.name || '某成员');
    if (r.userId === currentUser?.id) reactionCounts[r.emoji].hasReacted = true;
  }

  const toggleReaction = async (emoji: string) => {
    if (!currentUser) return;
    try {
      const res = await fetch(`/api/logs/${log.id}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) onRefresh();
    } catch (e) {
      console.error('Failed to toggle reaction', e);
    }
  };

  const addComment = async () => {
    const text = comment.trim();
    if (!text || !currentUser || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/logs/${log.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (res.ok) {
        setComment('');
        onRefresh();
      }
    } catch (e) {
      console.error('Failed to add comment', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="px-4 sm:px-5 py-4 bg-[var(--muted)] border-t border-[var(--border)] flex flex-col gap-3.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {EMOJIS.map((emoji) => {
            const data = reactionCounts[emoji];
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => toggleReaction(emoji)}
                aria-label={`${data?.hasReacted ? '取消' : '添加'} ${emoji} 反应${data ? `，${data.count} 人` : ''}`}
                aria-pressed={!!data?.hasReacted}
                disabled={!currentUser}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition border ${
                  data?.hasReacted
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 font-bold'
                    : 'bg-[var(--background)]  border-[var(--border)]  text-[var(--foreground)]  hover:border-[var(--border)]'
                }`}
                title={data ? data.users.join(', ') : '签阅'}
              >
                <span className="text-base">{emoji}</span>
                {data && <span className="font-medium">{data.count}</span>}
              </button>
            );
          })}
        </div>

        <div className="text-xs text-[var(--muted-foreground)] flex items-center gap-1.5 font-medium">
          <MessageSquare className="w-4 h-4" />
          <span>{log.comments?.length || 0} 条协作互动</span>
        </div>
      </div>

      {log.comments && log.comments.length > 0 && (
        <div className="flex flex-col gap-2.5 pt-3 border-t border-[var(--border)]">
          {log.comments.map((c) => (
            <div key={c.id} className="flex items-start gap-3 p-3 rounded bg-[var(--background)] border border-[var(--border)] text-sm">
              {c.user?.avatar ? (
                <img src={c.user.avatar} alt={c.user.name} className="w-7 h-7 shrink-0 rounded object-cover" />
              ) : (
                <div className="w-7 h-7 shrink-0 rounded bg-[var(--muted)] text-xs font-medium flex items-center justify-center">
                  {c.user?.name?.[0]}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[var(--foreground)] text-sm">{c.user?.name}</span>
                  <span className="text-xs text-[var(--muted-foreground)]">
                    {new Date(c.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-[var(--foreground)] mt-1 break-words leading-relaxed">{c.content}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2.5 flex-wrap pt-1">
        <input
          type="text"
          aria-label={`评论 ${log.user?.name || '成员'} 的 ${log.date} 日志`}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) addComment();
          }}
          placeholder="留下反馈或协助建议（按 Enter 发送）..."
          className="min-w-0 flex-1 text-sm px-3 py-2 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--foreground)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <button
          type="button"
          onClick={addComment}
          aria-label={isSubmitting ? '正在发送评论' : '发送评论'}
          disabled={isSubmitting || !comment.trim() || !currentUser}
          className="px-4 py-2 rounded bg-[var(--accent)] text-[var(--accent-foreground)] text-sm font-semibold hover:brightness-95 transition disabled:opacity-50 flex items-center gap-1.5"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
