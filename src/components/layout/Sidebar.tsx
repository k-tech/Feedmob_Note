'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { PenSquare, Activity, CalendarDays, Hash, PanelLeftClose, Users, Shield, X } from 'lucide-react';
import { useCurrentUser } from '@/lib/user-context';
import { MineworkMark } from '@/components/brand/MineworkMark';

const navItems = [
  { label: '工作日志', href: '/', icon: PenSquare },
  { label: '团队动态', href: '/stream', icon: Activity },
  { label: '日志日历', href: '/calendar', icon: CalendarDays },
  { label: '项目标签', href: '/tags', icon: Hash },
];

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const router = useRouter();
  const { currentUser, teams, selectedTeamId, setSelectedTeamId, isSidebarCollapsed, toggleSidebar, isMobileSidebarOpen, setMobileSidebarOpen } = useCurrentUser();
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => { setMobileSidebarOpen(false); }, [pathname, setMobileSidebarOpen]);

  useEffect(() => {
    if (!isMobileSidebarOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMobileSidebarOpen(false); }
      if (event.key === 'Tab') {
        const controls = drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button, input, select, [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const closeOnDesktop = () => { if (window.matchMedia('(min-width: 768px)').matches) setMobileSidebarOpen(false); };
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnDesktop);
      previousFocus?.focus();
    };
  }, [isMobileSidebarOpen, setMobileSidebarOpen]);

  const selectTeam = (teamId: string | null) => {
    setSelectedTeamId(teamId);
    if (pathname === '/') router.push('/stream');
    setMobileSidebarOpen(false);
  };

  const content = (mobile: boolean) => (
    <>
      <div className="flex h-14 items-center justify-between gap-2 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded text-sm font-semibold" onClick={() => setMobileSidebarOpen(false)}>
          <MineworkMark className="h-7 w-7 shrink-0" />
          <span>Minework<span className="ml-1.5 font-normal text-[var(--muted-foreground)]">日志</span></span>
        </Link>
        <button type="button" onClick={mobile ? () => setMobileSidebarOpen(false) : toggleSidebar} aria-label={mobile ? '关闭导航' : '收起导航'} title={mobile ? '关闭导航' : '收起导航（Alt + \\）'} className="flex min-h-9 min-w-9 items-center justify-center rounded text-[var(--muted-foreground)] transition-colors hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)]">
          {mobile ? <X size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-6 pt-3">
        <p className="mb-2 px-2.5 text-xs font-medium text-[var(--muted-foreground)]">工作区</p>
        <nav aria-label="主要导航" className="flex flex-col gap-0.5">
          {navItems.map(({ label, href, icon: Icon }) => {
            // A single log is opened from the team feed and belongs to it.
            const active = pathname === href || (href === '/stream' && pathname.startsWith('/logs/'));
            return (
            <Link key={href} href={href} aria-current={active ? 'page' : undefined} onClick={() => setMobileSidebarOpen(false)} className={`flex min-h-10 items-center gap-2.5 rounded px-2.5 text-sm transition-colors ${active ? 'bg-[var(--sidebar-accent)] font-medium text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)]'}`}>
              <Icon size={17} strokeWidth={1.6} aria-hidden="true" /><span>{label}</span>
            </Link>
            );
          })}
          {currentUser?.role === 'ADMIN' && <Link href="/admin" aria-current={pathname === '/admin' ? 'page' : undefined} onClick={() => setMobileSidebarOpen(false)} className={`flex min-h-10 items-center gap-2.5 rounded px-2.5 text-sm transition-colors ${pathname === '/admin' ? 'bg-[var(--sidebar-accent)] font-medium text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:bg-[var(--sidebar-accent)] hover:text-[var(--foreground)]'}`}><Shield size={17} strokeWidth={1.6} aria-hidden="true" />管理面板</Link>}
        </nav>
        {teams.length > 0 && <section className="mt-8" aria-label="按团队查看日志">
          <p className="mb-2 px-2.5 text-xs font-medium text-[var(--muted-foreground)]">团队</p>
          <button type="button" onClick={() => selectTeam(null)} aria-pressed={selectedTeamId === null} className={`flex min-h-10 w-full items-center gap-2.5 rounded px-2.5 text-left text-sm transition-colors hover:bg-[var(--sidebar-accent)] ${selectedTeamId === null ? 'text-[var(--foreground)] font-medium' : 'text-[var(--muted-foreground)]'}`}>
            <Users size={16} strokeWidth={1.6} aria-hidden="true" />全部团队
          </button>
          {teams.map(team => <button key={team.id} type="button" onClick={() => selectTeam(team.id)} aria-pressed={selectedTeamId === team.id} className={`flex min-h-10 w-full items-center gap-2.5 rounded px-2.5 text-left text-sm transition-colors hover:bg-[var(--sidebar-accent)] ${selectedTeamId === team.id ? 'bg-[var(--sidebar-accent)] text-[var(--foreground)] font-medium' : 'text-[var(--muted-foreground)]'}`}>
            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: team.color || 'var(--muted-foreground)' }} /><span className="truncate">{team.name}</span>
          </button>)}
        </section>}
      </div>
      <div className="mx-4 flex items-center gap-2.5 border-t border-[var(--border)] py-4 text-xs text-[var(--muted-foreground)]">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[var(--sidebar-accent)] font-medium text-[var(--foreground)]">{currentUser?.name?.[0] || 'M'}</span>
        <div className="min-w-0"><p className="truncate text-[var(--foreground)]">{currentUser?.name || '个人工作区'}</p><p className="mt-0.5 truncate">{currentUser?.title || '记录每一天的进展'}</p></div>
      </div>
    </>
  );

  return <>
    {!isSidebarCollapsed && <aside id="workspace-sidebar" aria-label="工作区导航" className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar-background)] md:flex">{content(false)}</aside>}
    {isMobileSidebarOpen && <div className="fixed inset-0 z-50 md:hidden">
      <div aria-hidden="true" className="absolute inset-0 bg-black/25" onClick={() => setMobileSidebarOpen(false)} />
      <aside ref={drawerRef} id="mobile-workspace-sidebar" role="dialog" aria-modal="true" aria-label="工作区导航" className="relative flex h-dvh w-[min(290px,85vw)] flex-col border-r border-[var(--border)] bg-[var(--sidebar-background)] shadow-xl">{content(true)}</aside>
    </div>}
  </>;
};
