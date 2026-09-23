'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/context/theme-context';
import { InactivityManager } from '@/components/auth/InactivityManager';
import { getCanonicalSiteSlug } from '@/lib/site/slug';

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
  authorityTier?: string;
  recoveryEmail?: string | null;
  assignedSiteIds: string[];
}

interface SiteContextType {
  user: User | null;
  sites: Site[];
  selectedSite: Site | null;
  selectedSiteId: string;
  canonicalSlug: string;
  setSelectedSiteId: (id: string) => void;
  isLoading: boolean;
  refreshSites: () => Promise<void>;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
}

export const SiteContext = createContext<SiteContextType | undefined>(undefined);

export function SiteProvider({
  children,
  initialSiteId = '',
  initialCanonicalSlug = '',
}: {
  children: React.ReactNode;
  initialSiteId?: string;
  initialCanonicalSlug?: string;
}) {
  const router = useRouter();
  const { setActiveUser } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteId, setSelectedSiteIdState] = useState<string>(initialSiteId);
  const [canonicalSlug, setCanonicalSlug] = useState<string>(initialCanonicalSlug);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSessionAndSites = useCallback(async () => {
    try {
      setIsLoading(true);
      const userRes = await fetch('/api/auth/me');
      if (!userRes.ok) {
        const currentPath = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
        const target = currentPath && currentPath !== '/' ? `/login?next=${encodeURIComponent(currentPath)}` : '/login';
        router.replace(target);
        return;
      }
      const userData = await userRes.json();
      if (!userData.user) {
        const currentPath = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '';
        const target = currentPath && currentPath !== '/' ? `/login?next=${encodeURIComponent(currentPath)}` : '/login';
        router.replace(target);
        return;
      }
      setUser(userData.user);
      if (userData.user?.id) {
        setActiveUser(userData.user.id);
      }

      const sitesRes = await fetch('/api/sites');
      if (sitesRes.ok) {
        const sitesData = await sitesRes.json();
        const availableSites: Site[] = sitesData.sites || [];
        setSites(availableSites);

        // Synchronize selected site with URL slug if present
        let matchedSite: Site | undefined;
        if (typeof window !== 'undefined') {
          const segments = window.location.pathname.split('/').filter(Boolean);
          if (segments.length > 0) {
            const firstSeg = segments[0].toLowerCase();
            matchedSite = availableSites.find(
              (s) =>
                getCanonicalSiteSlug(s as any, availableSites as any).toLowerCase() === firstSeg ||
                s.id.toLowerCase() === firstSeg ||
                (s.code && s.code.toLowerCase().replace(/[^a-z0-9]/g, '') === firstSeg)
            );
          }
        }

        if (matchedSite) {
          setSelectedSiteIdState(matchedSite.id);
          const cSlug = getCanonicalSiteSlug(matchedSite as any, availableSites as any);
          setCanonicalSlug(cSlug);
          localStorage.setItem('site_work_selected_site', matchedSite.id);
        } else if (initialSiteId && availableSites.some((s) => s.id === initialSiteId)) {
          setSelectedSiteIdState(initialSiteId);
          const target = availableSites.find((s) => s.id === initialSiteId)!;
          setCanonicalSlug(getCanonicalSiteSlug(target as any, availableSites as any));
        } else {
          // Load saved site from localStorage or default to first site
          const savedSiteId = localStorage.getItem('site_work_selected_site');
          if (savedSiteId && availableSites.some((s) => s.id === savedSiteId)) {
            setSelectedSiteIdState(savedSiteId);
            const target = availableSites.find((s) => s.id === savedSiteId)!;
            setCanonicalSlug(getCanonicalSiteSlug(target as any, availableSites as any));
          } else if (availableSites.length > 0) {
            setSelectedSiteIdState(availableSites[0].id);
            setCanonicalSlug(getCanonicalSiteSlug(availableSites[0] as any, availableSites as any));
            localStorage.setItem('site_work_selected_site', availableSites[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Error fetching site context:', err);
    } finally {
      setIsLoading(false);
    }
  }, [router, setActiveUser, initialSiteId]);

  useEffect(() => {
    fetchSessionAndSites();
  }, [fetchSessionAndSites]);

  const setSelectedSiteId = (id: string) => {
    setSelectedSiteIdState(id);
    localStorage.setItem('site_work_selected_site', id);

    const targetSite = sites.find((s) => s.id === id);
    if (targetSite) {
      const targetSlug = getCanonicalSiteSlug(targetSite as any, sites as any);
      setCanonicalSlug(targetSlug);

      if (typeof window !== 'undefined') {
        const pathname = window.location.pathname;
        const search = window.location.search;
        const segments = pathname.split('/').filter(Boolean);

        if (segments.length > 0) {
          // Replace site slug with targetSlug
          const rest = segments.slice(1).join('/');
          const newPath = '/' + targetSlug + (rest ? '/' + rest : '') + search;
          router.push(newPath);
        } else {
          router.push('/' + targetSlug + search);
        }
      }
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setActiveUser(null);
    router.push('/login');
  };

  const selectedSite = sites.find((s) => s.id === selectedSiteId) || (sites.length > 0 ? sites[0] : null);

  return (
    <SiteContext.Provider
      value={{
        user,
        sites,
        selectedSite,
        selectedSiteId,
        canonicalSlug: canonicalSlug || (selectedSite ? getCanonicalSiteSlug(selectedSite as any, sites as any) : 'site1'),
        setSelectedSiteId,
        isLoading,
        refreshSites: fetchSessionAndSites,
        refreshUser: fetchSessionAndSites,
        logout,
      }}
    >
      <InactivityManager />
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
