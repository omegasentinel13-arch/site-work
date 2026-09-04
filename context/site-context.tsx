'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/context/theme-context';

export interface Site {
  id: string;
  name: string;
  code: string | null;
  location: string | null;
  is_archived: number;
}

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  recoveryEmail?: string | null;
  assignedSiteIds: string[];
}

interface SiteContextType {
  user: User | null;
  sites: Site[];
  selectedSite: Site | null;
  selectedSiteId: string;
  setSelectedSiteId: (id: string) => void;
  isLoading: boolean;
  refreshSites: () => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

const SiteContext = createContext<SiteContextType | undefined>(undefined);

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setActiveUser } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteIdState] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchSessionAndSites = useCallback(async () => {
    try {
      setIsLoading(true);
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) {
        router.push('/login');
        return;
      }
      const userData = await userRes.json();
      setUser(userData.user);
      if (userData.user?.id) {
        setActiveUser(userData.user.id);
      }

      const sitesRes = await fetch('/api/sites');
      if (sitesRes.ok) {
        const sitesData = await sitesRes.json();
        setSites(sitesData.sites || []);

        // Load saved site from localStorage or default to first site
        const savedSiteId = localStorage.getItem('site_work_selected_site');
        const availableSites: Site[] = sitesData.sites || [];

        if (savedSiteId && availableSites.some(s => s.id === savedSiteId)) {
          setSelectedSiteIdState(savedSiteId);
        } else if (availableSites.length > 0) {
          setSelectedSiteIdState(availableSites[0].id);
          localStorage.setItem('site_work_selected_site', availableSites[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching site context:', err);
    } finally {
      setIsLoading(false);
    }
  }, [router, setActiveUser]);

  useEffect(() => {
    fetchSessionAndSites();
  }, [fetchSessionAndSites]);

  const setSelectedSiteId = (id: string) => {
    setSelectedSiteIdState(id);
    localStorage.setItem('site_work_selected_site', id);
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setActiveUser(null);
    router.push('/login');
  };

  const selectedSite = sites.find(s => s.id === selectedSiteId) || (sites.length > 0 ? sites[0] : null);

  return (
    <SiteContext.Provider
      value={{
        user,
        sites,
        selectedSite,
        selectedSiteId,
        setSelectedSiteId,
        isLoading,
        refreshSites: fetchSessionAndSites,
        refreshUser: fetchSessionAndSites,
        logout,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
}

export function useSite() {
  const context = useContext(SiteContext);
  if (!context) {
    throw new Error('useSite must be used within a SiteProvider');
  }
  return context;
}
