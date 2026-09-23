'use client';

import React, { useRef, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSite } from '@/context/site-context';
import { 
  LayoutDashboard, 
  ClipboardCheck, 
  CalendarDays, 
  BarChart3, 
  IndianRupee, 
  Building2,
  Layers, 
  Users, 
  History,
  ShieldCheck,
  Shield,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { clsx } from 'clsx';

export function Navigation() {
  const pathname = usePathname();
  const { user, canonicalSlug } = useSite();
  const isAdmin = user?.role === 'ADMIN';
  const isSiteManager = user?.role === 'SITE_MANAGER';
  const isViewer = user?.role === 'VIEWER';

  const getHref = (subPath: string) => {
    const slug = canonicalSlug || 'site1';
    return subPath === '/' ? `/${slug}` : `/${slug}${subPath}`;
  };

  const isItemActive = (subPath: string) => {
    const targetHref = getHref(subPath);
    return pathname === targetHref || pathname === subPath;
  };

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const isNavigatingRef = useRef(false);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Complete dashboard navigation item hierarchy in exact defined order
  const navGroups = [
    {
      title: 'Overview',
      items: [
        { label: 'Dashboard', href: '/', icon: LayoutDashboard },
      ],
    },
    {
      title: 'Attendance',
      items: [
        { label: 'Daily Attendance', href: '/attendance/daily', icon: ClipboardCheck },
        { label: 'Weekly Attendance', href: '/attendance/weekly', icon: CalendarDays },
        { label: 'Monthly Attendance', href: '/attendance/monthly', icon: BarChart3 },
        { label: 'Analytics', href: '/reports/role', icon: Users, legacyLabel: 'Role Breakdown' },
      ],
    },
    {
      title: 'Money',
      items: [
        { label: 'Transactions', href: '/finance', icon: IndianRupee },
      ],
    },
  ];

  if (isAdmin) {
    navGroups.push({
      title: 'Setup & Admin',
      items: [
        { label: 'Sites', href: '/setup/sites', icon: Building2 },
        { label: 'Roles', href: '/setup/roles', icon: Layers },
        { label: 'Users & Access', href: '/setup/users', icon: Users },
        { label: 'Audit Trail', href: '/setup/audit-trail', icon: History },
        { label: 'Reports & Backup', href: '/admin/data-protection', icon: Shield },
        { label: 'My Account', href: '/setup/account', icon: ShieldCheck },
      ],
    });
  } else if (isSiteManager) {
    navGroups.push({
      title: 'Governance',
      items: [
        { label: 'Reports & Backup', href: '/admin/data-protection', icon: Shield },
        { label: 'My Account', href: '/setup/account', icon: ShieldCheck },
      ],
    });
  } else if (isViewer) {
    navGroups.push({
      title: 'Account',
      items: [
        { label: 'My Account', href: '/setup/account', icon: ShieldCheck },
      ],
    });
  }

  // Update arrow availability states based on scroll position & container width
  const updateScrollState = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    const maxScroll = scrollWidth - clientWidth;
    const hasOverflow = maxScroll > 2;

    setCanScrollLeft(hasOverflow && scrollLeft > 2);
    setCanScrollRight(hasOverflow && scrollLeft < maxScroll - 2);
  }, []);

  // Ensure active navigation item is scrolled into view without causing layout shifts
  const ensureActiveItemVisible = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = scrollContainerRef.current;
    const activeEl = itemRefs.current.get(pathname) || itemRefs.current.get(getHref(pathname));
    if (!container || !activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const itemRect = activeEl.getBoundingClientRect();

    // Only scroll if item is actually outside the container's visible bounds
    const isOffLeft = itemRect.left < containerRect.left + 8;
    const isOffRight = itemRect.right > containerRect.right - 8;

    if (isOffLeft || isOffRight) {
      const targetScroll = activeEl.offsetLeft - (container.clientWidth / 2) + (activeEl.offsetWidth / 2);
      container.scrollTo({
        left: Math.max(0, targetScroll),
        behavior,
      });
    }
  }, [pathname]);

  // Setup event listeners and ResizeObserver with constant-width layout
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    updateScrollState();
    ensureActiveItemVisible('auto');

    const handleScroll = () => {
      updateScrollState();
    };

    el.addEventListener('scroll', handleScroll, { passive: true });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateScrollState();
        ensureActiveItemVisible('auto');
      });
      resizeObserver.observe(el);
    }

    window.addEventListener('resize', updateScrollState, { passive: true });

    return () => {
      el.removeEventListener('scroll', handleScroll);
      if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('resize', updateScrollState);
    };
  }, [updateScrollState, ensureActiveItemVisible, isAdmin]);

  // Reveal active route when pathname changes
  useEffect(() => {
    ensureActiveItemVisible('smooth');
    updateScrollState();
  }, [pathname, ensureActiveItemVisible, updateScrollState]);

  // Scroll Actions: Move and reveal hidden navigation segments
  const handleScrollLeft = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollAmount = Math.max(180, Math.floor(el.clientWidth * 0.75));
    el.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
  };

  const handleScrollRight = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const scrollAmount = Math.max(180, Math.floor(el.clientWidth * 0.75));
    el.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  };

  // Prevent duplicate clicks on the already active route
  const handleItemClick = (e: React.MouseEvent, href: string) => {
    if (pathname === href) {
      e.preventDefault();
      return;
    }
    if (isNavigatingRef.current) {
      e.preventDefault();
      return;
    }
    isNavigatingRef.current = true;
    setTimeout(() => {
      isNavigatingRef.current = false;
    }, 350);
  };

  return (
    <nav 
      className="hidden lg:block bg-white dark:bg-[#18191C] border-b border-slate-900 dark:border-[#3A3D42] sticky top-16 z-30 shadow-sm w-full transition-colors duration-150"
      aria-label="Main Navigation"
    >
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-6">
        <div className="flex items-center py-1.5 gap-1.5">
          {/* Left Navigation Arrow: Reveals hidden previous navigation segment (STABLE FOOTPRINT + 44x44 HIT AREA) */}
          <button
            type="button"
            onClick={handleScrollLeft}
            disabled={!canScrollLeft}
            aria-label="Show previous navigation items"
            title="Show previous navigation items"
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] hit-target-44 relative z-10 touch-action-manipulation',
              canScrollLeft
                ? 'opacity-100 cursor-pointer bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 dark:active:bg-[#3A3D42] border-slate-900 dark:border-[#4A4D52] text-slate-700 dark:text-[#F2F3F5] shadow-sm'
                : 'opacity-20 cursor-not-allowed bg-slate-50 dark:bg-[#111214]/60 border-slate-300 dark:border-[#2B2D31] text-slate-300 dark:text-[#6B7280] pointer-events-none'
            )}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Navigation Items Viewport & Track */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-x-auto no-scrollbar scroll-smooth flex items-center space-x-1 sm:space-x-1.5 py-0.5"
          >
            {navGroups.map((group, gIdx) => (
              <React.Fragment key={group.title}>
                {gIdx > 0 && <div className="h-4 w-px bg-slate-300 dark:bg-[#3A3D42] mx-1 shrink-0" />}
                <div className="flex items-center space-x-1 shrink-0">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const href = getHref(item.href);
                    const isActive = isItemActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={href}
                        onClick={(e) => handleItemClick(e, href)}
                        ref={(el) => {
                          if (el) {
                            itemRefs.current.set(href, el);
                            itemRefs.current.set(item.href, el);
                          } else {
                            itemRefs.current.delete(href);
                            itemRefs.current.delete(item.href);
                          }
                        }}
                        aria-current={isActive ? 'page' : undefined}
                        className={clsx(
                          'flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-all shrink-0 whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                          isActive
                            ? 'bg-slate-900 text-white border border-slate-900 shadow-sm dark:bg-[rgba(30,215,96,0.12)] dark:border-[rgba(30,215,96,0.45)] dark:text-[#1ED760]'
                            : 'border border-transparent hover:border-slate-900 dark:hover:border-[#3A3D42] text-slate-700 dark:text-[#B5BAC1] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 dark:active:bg-[#3A3D42]'
                        )}
                      >
                        <Icon 
                          className={clsx(
                            'w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 transition-colors', 
                            isActive ? 'text-amber-400 dark:text-[#1ED760]' : 'text-slate-400 dark:text-[#949BA4]'
                          )} 
                        />
                        <span>{item.label}</span>
                        {(item as { legacyLabel?: string }).legacyLabel && (
                          <span className="sr-only">({(item as { legacyLabel?: string }).legacyLabel})</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* Right Navigation Arrow: Reveals hidden next navigation segment (STABLE FOOTPRINT + 44x44 HIT AREA) */}
          <button
            type="button"
            onClick={handleScrollRight}
            disabled={!canScrollRight}
            aria-label="Show more navigation items"
            title="Show more navigation items"
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] hit-target-44 relative z-10 touch-action-manipulation',
              canScrollRight
                ? 'opacity-100 cursor-pointer bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 dark:active:bg-[#3A3D42] border-slate-900 dark:border-[#4A4D52] text-slate-700 dark:text-[#F2F3F5] shadow-sm'
                : 'opacity-20 cursor-not-allowed bg-slate-50 dark:bg-[#111214]/60 border-slate-300 dark:border-[#2B2D31] text-slate-300 dark:text-[#6B7280] pointer-events-none'
            )}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  );
}