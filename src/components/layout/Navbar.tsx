'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useCurrentUser } from '@/lib/user-context';
import { FileText, Search, ChevronDown, PanelLeftOpen, PanelLeftClose, Shield, Loader2, LogOut } from 'lucide-react';
import { WeeklySummaryModal } from '../views/WeeklySummaryModal';
import { MineworkMark } from '@/components/brand/MineworkMark';

interface NavbarProps { onSearch?: (query: string) => void; }

const pageLabels: Record<string, string> = { '/': '工作日志', '/stream': '团队动态', '/calendar': '日志日历', '/tags': '项目标签', '/admin': '管理面板', '/settings/mcp': 'MCP 连接' };

export const Navbar: React.FC<NavbarProps> = ({ onSearch }) => {
  const pathname = usePathname();
  const { currentUser, updateCurrentUser, teams, selectedTeamId, setSelectedTeamId, isSidebarCollapsed, toggleSidebar, isMobileSidebarOpen } = useCurrentUser();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    setDisplayName(currentUser?.name || '');
    setRenameError(null);
    nameInputRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!profileRef.current?.contains(event.target as Node)) setIsUserMenuOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setIsUserMenuOpen(false); profileButtonRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', keyboard); };
  }, [isUserMenuOpen, currentUser?.id]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.altKey && event.key === '\\') { event.preventDefault(); toggleSidebar(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [toggleSidebar]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || isRenaming) return;
    const name = displayName.trim();
    if (!name) { setRenameError('请输入显示名。'); return; }
    if (name === currentUser.name) { setIsUserMenuOpen(false); profileButtonRef.current?.focus(); return; }
    setIsRenaming(true);
    setRenameError(null);
    try {
      const response = await fetch('/api/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: currentUser.id, name }) });
      if (!response.ok) throw new Error('显示名保存失败，请重试。');
      updateCurrentUser(await response.json());
      setIsUserMenuOpen(false);
      profileButtonRef.current?.focus();
    } catch (error) { setRenameError(error instanceof Error ? error.message : '显示名保存失败，请重试。'); }
    finally { setIsRenaming(false); }
  };

  return <>
    <header className="sticky top-0 z-30 flex h-14 min-w-0 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--background)] px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        <button type="button" onClick={toggleSidebar} aria-label="切换导航侧边栏" aria-expanded={isMobileSidebarOpen || !isSidebarCollapsed} className="flex min-h-10 min-w-10 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]" title="切换导航（Alt + \\）">
          {isSidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <span className="hidden items-center gap-1.5 text-[var(--muted-foreground)] sm:flex"><MineworkMark className="h-5 w-5" />Minework</span>
        <span aria-hidden="true" className="mx-1 hidden text-[var(--muted-foreground)] sm:inline">/</span>
        <span className="truncate text-[var(--foreground)]">{pageLabels[pathname] || (pathname.startsWith('/logs/') ? '日志详情' : '工作区')}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {teams.length > 0 && pathname !== '/' && !pathname.startsWith('/logs/') && <select aria-label="筛选团队" value={selectedTeamId || ''} onChange={event => setSelectedTeamId(event.target.value || null)} className="hidden min-h-9 max-w-40 cursor-pointer rounded border border-[var(--border)] bg-[var(--background)] px-2 text-xs text-[var(--muted-foreground)] sm:block">
          <option value="">全部团队</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>}
        {onSearch && <div className="relative hidden w-44 lg:block"><Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" /><input aria-label="搜索日志" type="search" value={searchQuery} onChange={event => { setSearchQuery(event.target.value); onSearch(event.target.value); }} placeholder="搜索日志…" className="h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] pl-8 pr-2 text-sm" /></div>}
        <button type="button" onClick={() => setIsSummaryModalOpen(true)} aria-label="生成工作周报" className="flex min-h-10 items-center gap-1.5 rounded px-2.5 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
          <FileText size={15} aria-hidden="true" /><span>周报</span>
        </button>
        <div ref={profileRef} className="relative">
          <button ref={profileButtonRef} type="button" onClick={() => setIsUserMenuOpen(open => !open)} aria-label={`账号设置：${currentUser?.name || '当前用户'}`} aria-haspopup="dialog" aria-expanded={isUserMenuOpen} aria-controls={isUserMenuOpen ? 'profile-settings' : undefined} className="flex min-h-10 items-center gap-1.5 rounded px-1.5 transition-colors hover:bg-[var(--muted)]">
            <span className="flex h-7 w-7 items-center justify-center rounded bg-[var(--muted)] text-xs font-medium text-[var(--foreground)]">{currentUser?.name?.[0] || 'M'}</span>
            <ChevronDown size={13} aria-hidden="true" className="text-[var(--muted-foreground)]" />
          </button>
          {isUserMenuOpen && <div id="profile-settings" role="dialog" aria-label="账号设置" onBlur={event => { if (event.relatedTarget && !profileRef.current?.contains(event.relatedTarget as Node)) setIsUserMenuOpen(false); }} className="absolute right-0 top-full mt-1 w-[min(300px,calc(100vw-24px))] rounded-md border border-[var(--border)] bg-[var(--background)] p-3 shadow-lg">
            <p className="mb-3 px-1 text-xs font-medium text-[var(--muted-foreground)]">账号设置</p>
            {currentUser && <form onSubmit={saveName} className="border-b border-[var(--border)] px-1 pb-4">
              <label htmlFor="member-display-name" className="mb-1.5 block text-xs text-[var(--muted-foreground)]">显示名</label>
              <div className="flex gap-2"><input ref={nameInputRef} id="member-display-name" value={displayName} onChange={event => setDisplayName(event.target.value)} disabled={isRenaming} aria-describedby={renameError ? 'member-name-error' : undefined} className="h-9 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-2 text-sm" /><button type="submit" disabled={isRenaming} className="rounded bg-[var(--accent)] px-3 text-xs text-[var(--accent-foreground)] disabled:opacity-50">{isRenaming ? <Loader2 size={14} className="animate-spin" aria-label="正在保存" /> : '保存'}</button></div>
              {renameError && <p id="member-name-error" role="alert" className="mt-2 text-xs text-red-600">{renameError}</p>}
            </form>}
            <div className="px-1 pt-3 text-xs text-[var(--muted-foreground)]">
              <p className="break-all">{currentUser?.email}</p>
              <p className="mt-1">{currentUser?.role === 'ADMIN' ? '管理员' : '成员'}</p>
            </div>
            <Link href="/settings/mcp" onClick={() => setIsUserMenuOpen(false)} className="popover-row mt-2"><span aria-hidden="true">⌘</span>MCP 连接</Link>
            {currentUser?.role === 'ADMIN' && <Link href="/admin" onClick={() => setIsUserMenuOpen(false)} className="popover-row mt-2"><Shield size={15} />管理面板</Link>}
            <div className="mt-3 border-t border-[var(--border)] pt-2"><button type="button" onClick={() => void signOut({ callbackUrl: '/login' })} className="popover-row"><LogOut size={15} />退出登录</button></div>
          </div>}
        </div>
      </div>
    </header>
    <WeeklySummaryModal isOpen={isSummaryModalOpen} onClose={() => setIsSummaryModalOpen(false)} />
  </>;
};
