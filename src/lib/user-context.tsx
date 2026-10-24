'use client';

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { User, Team } from '@/types';

interface UserContextType {
  currentUser: User | null;
  users: User[];
  teams: Team[];
  updateCurrentUser: (user: User) => void;
  selectedTeamId: string | null;
  setSelectedTeamId: (teamId: string | null) => void;
  refreshUsers: () => Promise<void>;
  isLoading: boolean;
  loadError: string | null;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  isFullWidth: boolean;
  toggleFullWidth: () => void;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const identityRef = useRef<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [isFullWidth, setIsFullWidth] = useState(false);

  useEffect(() => {
    try {
      // Preferences saved before the Minework rename used the feedmob_ prefix.
      const preference = (name: string) => (localStorage.getItem('minework_' + name) ?? localStorage.getItem('feedmob_' + name)) === 'true';
      setIsSidebarCollapsed(preference('sidebar_collapsed'));
      setIsFullWidth(preference('editor_full_width'));
    } catch { /* Preferences are optional when browser storage is disabled. */ }
  }, []);

  const toggleSidebar = () => {
    if (window.matchMedia('(max-width: 767px)').matches) {
      setMobileSidebarOpen(prev => !prev);
      return;
    }
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('minework_sidebar_collapsed', String(next)); } catch {}
      }
      return next;
    });
  };

  const toggleFullWidth = () => {
    setIsFullWidth((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem('minework_editor_full_width', String(next)); } catch {}
      }
      return next;
    });
  };

  const fetchUsersAndTeams = async () => {
    try {
      setIsLoading(true);
      setLoadError(null);
      const meRes = await fetch('/api/me', { cache: 'no-store' });
      if (!meRes.ok) throw new Error('无法读取当前登录账号，请重新登录或重试。');
      const me = await meRes.json();
      if (!me || typeof me.id !== 'string' || typeof me.email !== 'string') throw new Error('当前登录账号数据异常。');
      const [usersRes, teamsRes] = await Promise.all([fetch('/api/users'), fetch('/api/teams')]);
      if (!usersRes.ok || !teamsRes.ok) throw new Error('无法读取工作区成员与团队，请重试。');
      const [usersData, teamsData] = await Promise.all([usersRes.json(), teamsRes.json()]);
      if (!Array.isArray(usersData) || !Array.isArray(teamsData)) throw new Error('工作区数据格式异常，请重试。');
      identityRef.current = me.id;
      setCurrentUser(me);
      setUsers(usersData.some((user: User) => user.id === me.id) ? usersData : [...usersData, me]);
      setTeams(teamsData);
    } catch (err) {
      console.error('Failed to load users/teams', err);
      setLoadError(err instanceof Error ? err.message : '工作区加载失败，请重试。');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsersAndTeams();
  }, []);

  const updateCurrentUser = (user: User) => {
    if (user.id !== identityRef.current) return;
    setCurrentUser(user);
    setUsers(prev => prev.map(item => item.id === user.id ? user : item));
  };

  return (
    <UserContext.Provider
      value={{
        currentUser,
        users,
        teams,
        updateCurrentUser,
        selectedTeamId,
        setSelectedTeamId,
        refreshUsers: fetchUsersAndTeams,
        isLoading,
        loadError,
        isSidebarCollapsed,
        toggleSidebar,
        isMobileSidebarOpen,
        setMobileSidebarOpen,
        isFullWidth,
        toggleFullWidth,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}


export function useCurrentUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useCurrentUser must be used within a UserProvider');
  }
  return context;
}
