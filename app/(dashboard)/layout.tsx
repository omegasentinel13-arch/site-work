import React from 'react';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/lib/auth/session';
import { getAllSites, getSiteByHistoricalSlug } from '@/lib/db/repositories/site-repo';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { resolveSiteBySlug, getCanonicalSiteSlug, getDeterministicFallbackSite } from '@/lib/site/slug';
import { isOperationalRoute } from '@/lib/site/routes';
import { SiteProvider } from '@/context/site-context';
import { Header } from '@/components/layout/Header';
import { Navigation } from '@/components/layout/Navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  // Authentication gate
  if (!session) {
    const headersList = headers();
    const currentPath = headersList.get('x-current-path');

    if (currentPath && currentPath !== '/') {
      redirect(`/login?next=${encodeURIComponent(currentPath)}`);
    } else {
      redirect('/login');
    }
  }

  const headersList = headers();
  const candidateSlug = headersList.get('x-site-slug');
  const currentPath = headersList.get('x-current-path') || '/';
  const subPath = headersList.get('x-sub-path') || '/';

  // Retrieve active sites from SQLite
  const allSites = getAllSites(false);

  // Extract query string
  const queryIndex = currentPath.indexOf('?');
  const search = queryIndex >= 0 ? currentPath.slice(queryIndex) : '';

  let activeSiteId = '';
  let activeCanonicalSlug = '';

  if (candidateSlug) {
    const resolution = resolveSiteBySlug(candidateSlug, allSites, getSiteByHistoricalSlug);

    // If site does not exist, redirect to deterministic fallback site
    if (!resolution.site) {
      const fallback = getDeterministicFallbackSite(session, allSites);
      if (fallback) {
        const fallbackSlug = getCanonicalSiteSlug(fallback, allSites);
        if (isOperationalRoute(subPath)) {
          const targetSub = subPath === '/' ? '' : subPath;
          redirect(`/${fallbackSlug}${targetSub}${search}`);
        } else {
          redirect(`/${fallbackSlug}`);
        }
      }
      redirect('/login?error=no_assigned_sites');
    }

    // Single canonical URL enforcement: if request used an alias, 307 redirect to canonical slug
    if (!resolution.isCanonical && resolution.canonicalSlug) {
      const targetSub = subPath === '/' ? '' : subPath;
      redirect(`/${resolution.canonicalSlug}${targetSub}${search}`);
    }

    // Server-side authorization check: verify user has access to this site
    try {
      validateSiteAccess(session, resolution.site.id);
    } catch {
      // User is unauthorized for this site: calculate authorized fallback site
      const fallback = getDeterministicFallbackSite(session, allSites);
      if (fallback && fallback.id !== resolution.site.id) {
        const fallbackSlug = getCanonicalSiteSlug(fallback, allSites);
        if (isOperationalRoute(subPath)) {
          // Category A (Operational): preserve sub-page and query parameters
          const targetSub = subPath === '/' ? '' : subPath;
          redirect(`/${fallbackSlug}${targetSub}${search}`);
        } else {
          // Category B (Administrative): redirect to authorized site dashboard, NEVER preserve admin sub-page
          redirect(`/${fallbackSlug}`);
        }
      }
      // Zero authorized sites safety boundary
      redirect('/login?error=no_assigned_sites');
    }

    activeSiteId = resolution.site.id;
    activeCanonicalSlug = resolution.canonicalSlug || getCanonicalSiteSlug(resolution.site, allSites);
  } else {
    // Legacy un-prefixed route requested (e.g. /attendance/daily or /)
    const targetSite = getDeterministicFallbackSite(session, allSites);
    if (targetSite) {
      const canonicalSlug = getCanonicalSiteSlug(targetSite, allSites);
      const targetSub = currentPath === '/' ? '' : currentPath;
      redirect(`/${canonicalSlug}${targetSub.startsWith('/') ? targetSub : '/' + targetSub}`);
    } else {
      redirect('/login?error=no_assigned_sites');
    }
  }

  const initialUser = {
    id: session.userId,
    username: session.username,
    fullName: session.fullName,
    role: session.role,
    authorityTier: session.authorityTier,
    assignedSiteIds: session.assignedSiteIds,
  };

  return (
    <SiteProvider
      initialSiteId={activeSiteId}
      initialCanonicalSlug={activeCanonicalSlug}
      initialUser={initialUser}
      initialSites={allSites}
    >
      <div className="min-h-screen flex flex-col bg-[#F1F5F9] dark:bg-[#111214] text-[#0F172A] dark:text-[#F2F3F5] w-full transition-colors duration-150">
        <Header />
        <Navigation />
        <main className="flex-1 w-full max-w-7xl mx-auto px-2.5 xs:px-4 sm:px-6 lg:px-8 py-3.5 sm:py-6 pb-16 pb-safe">
          {children}
        </main>
      </div>
    </SiteProvider>
  );
}