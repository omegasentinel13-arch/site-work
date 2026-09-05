'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSite } from '@/context/site-context';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { 
  Building2, 
  LogOut, 
  ChevronDown, 
  Menu, 
  X,
  LayoutDashboard,
  ClipboardCheck,
  CalendarDays,
  BarChart3,
  IndianRupee,
  Settings,
  Layers,
  Users,
  FileText,
  History
} from 'lucide-react';
import { clsx } from 'clsx';

export function Header() {
  const { user, sites, selectedSiteId, setSelectedSiteId, logout } = useSite();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const isAdmin = user?.role === 'ADMIN';

  const scrollYRef = React.useRef(0);
  const isNavigatingRef = React.useRef(false);
  const previousPathnameRef = React.useRef(pathname);
  const drawerScrollRef = React.useRef<HTMLDivElement>(null);

  // Document body scroll lock & freeze while mobile menu is open
  useEffect(() => {
    if (!mobileMenuOpen) return;

    // 1. Capture current document scroll position
    const scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    scrollYRef.current = scrollY;
    isNavigatingRef.current = false;

    // 2. Freeze underlying document at exact scroll position
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const originalWidth = document.body.style.width;
    const originalOverflow = document.body.style.overflow;

    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';

    // 3. Explicitly reset drawer internal scroll container to top (scrollTop = 0)
    if (drawerScrollRef.current) {
      drawerScrollRef.current.scrollTo({
        top: 0,
        behavior: 'auto',
      });
    }
    const rafId = requestAnimationFrame(() => {
      if (drawerScrollRef.current) {
        drawerScrollRef.current.scrollTop = 0;
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown);

      // Restore body styling
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.width = originalWidth;
      document.body.style.overflow = originalOverflow;

      // Restore scroll position only if not navigating to a new route
      if (!isNavigatingRef.current) {
        window.scrollTo(0, scrollY);
      }
    };
  }, [mobileMenuOpen]);

  // Clean auto-close on route changes without carrying over previous route scroll position
  useEffect(() => {
    if (previousPathnameRef.current !== pathname) {
      previousPathnameRef.current = pathname;
      isNavigatingRef.current = true;
      setMobileMenuOpen(false);
    }
  }, [pathname]);

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
        { label: 'Daily Entry', href: '/attendance/daily', icon: ClipboardCheck },
        { label: 'Weekly Matrix', href: '/attendance/weekly', icon: CalendarDays },
        { label: 'Monthly Report', href: '/attendance/monthly', icon: BarChart3 },
      ],
    },
    {
      title: 'Reports',
      items: [
        { label: 'Role Breakdown', href: '/reports/role', icon: Users },
        { label: 'Category Summary', href: '/reports/category', icon: Layers },
        { label: 'Site Overview', href: '/reports/site', icon: FileText },
      ],
    },
    {
      title: 'Money',
      items: [
        { label: 'Transactions', href: '/finance', icon: IndianRupee },
        { label: 'Monthly Ledger', href: '/finance/monthly', icon: BarChart3 },
      ],
    },
  ];

  if (isAdmin) {
    navGroups.push({
      title: 'Setup & Admin',
      items: [
        { label: 'Sites', href: '/setup/sites', icon: Settings },
        { label: 'Roles & Rates', href: '/setup/roles', icon: Layers },
        { label: 'Users & Access', href: '/setup/users', icon: Users },
        { label: 'Audit Trail', href: '/setup/audit', icon: History },
        { label: 'My Account & Security', href: '/setup/account', icon: Settings },
      ],
    });
  }

  return (
    <header
      className={clsx(
        "bg-white dark:bg-[#18191C] text-slate-900 dark:text-[#F2F3F5] border-b border-slate-900 dark:border-[#3A3D42] transition-colors duration-150 shadow-sm",
        mobileMenuOpen ? "fixed top-0 inset-x-0 z-50" : "sticky top-0 z-40"
      )}
    >
      <div className="max-w-7xl mx-auto px-2.5 xs:px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-1.5 sm:gap-2">
          {/* Left: Mobile Toggle & Brand Logo */}
          <div className="flex items-center space-x-1.5 xs:space-x-2 sm:space-x-3 min-w-0">
            {/* Mobile menu toggle with actual 44x44px hit target & visible border */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden w-11 h-11 flex items-center justify-center bg-white dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] shrink-0 touch-action-manipulation"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5 text-slate-900 dark:text-[#1ED760]" /> : <Menu className="w-5 h-5" />}
            </button>

            <Link href="/" className="flex items-center space-x-1.5 sm:space-x-3 min-w-0 group">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg overflow-hidden bg-white p-0.5 border border-slate-900 dark:border-[#4A4D52] shadow-sm flex items-center justify-center shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/logo.png" alt="AB Logo" className="w-full h-full object-contain rounded-md" />
              </div>
              <div className="min-w-0">
                <span className="font-black tracking-tight text-xs sm:text-sm md:text-base uppercase text-slate-900 dark:text-[#F2F3F5] truncate block group-hover:text-slate-700 dark:group-hover:text-[#1ED760] transition-colors">
                  AB CONSTRUCTIONS
                </span>
                <span className="text-[10px] text-slate-500 dark:text-[#949BA4] hidden sm:block font-medium -mt-0.5 truncate">
                  &amp; INTERIORS
                </span>
              </div>
            </Link>
          </div>

          {/* Right: Active Site Selector, Theme Toggle & User Menu */}
          <div className="flex items-center space-x-1 xs:space-x-1.5 sm:space-x-3 shrink-0">
            {/* Active Site Dropdown with explicit border */}
            <div className="relative flex items-center bg-white dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 shadow-sm max-w-[115px] xs:max-w-[150px] sm:max-w-xs min-h-[38px] sm:min-h-0">
              <Building2 className="w-3.5 h-3.5 text-amber-600 dark:text-[#1ED760] mr-1.5 shrink-0 hidden xs:block" />
              <div className="flex flex-col text-left min-w-0 flex-1">
                <span className="text-[9px] uppercase font-bold text-slate-500 dark:text-[#949BA4] tracking-wider hidden sm:block">
                  Active Site
                </span>
                <select
                  value={selectedSiteId}
                  onChange={(e) => setSelectedSiteId(e.target.value)}
                  className="bg-transparent text-slate-900 dark:text-[#F2F3F5] font-bold text-xs sm:text-sm appearance-none pr-4 sm:pr-5 focus:outline-none cursor-pointer truncate w-full"
                  aria-label="Active Site"
                >
                  {sites.length === 0 && <option value="" className="bg-white dark:bg-[#202225] text-slate-900 dark:text-[#F2F3F5]">No Sites</option>}
                  {sites.map((s) => (
                    <option key={s.id} value={s.id} className="bg-white dark:bg-[#202225] text-slate-900 dark:text-[#F2F3F5]">
                      {s.name} {s.code ? `(${s.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-500 dark:text-[#949BA4] absolute right-1.5 sm:right-2.5 pointer-events-none shrink-0" />
            </div>

            {/* Theme Toggle Button */}
            <ThemeToggle />

            {/* User Info & Logout with visible divider */}
            <div className="flex items-center space-x-1 sm:space-x-2 border-l border-slate-900 dark:border-[#3A3D42] pl-1 xs:pl-1.5 sm:pl-3">
              <div className="hidden md:flex flex-col text-right">
                <span className="text-xs font-semibold text-slate-900 dark:text-[#F2F3F5] truncate max-w-[120px]">{user?.fullName || user?.username}</span>
                <span className="text-[9px] font-bold text-slate-600 dark:text-[#1ED760] tracking-wide uppercase">
                  {user?.role}
                </span>
              </div>
              <button
                onClick={logout}
                title="Log Out"
                className="w-9 h-9 sm:w-11 sm:h-11 hit-target-44 flex items-center justify-center bg-white dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] text-slate-700 dark:text-[#949BA4] hover:text-rose-600 dark:hover:text-rose-400 hover:border-rose-600 dark:hover:border-rose-800 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] shrink-0 touch-action-manipulation"
                aria-label="Log Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Navigation & Backdrop */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop overlay covering the viewport behind the drawer */}
          <div
            className="lg:hidden fixed inset-0 top-16 bg-black/60 backdrop-blur-sm z-40 touch-none select-none animate-in fade-in duration-200"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Full-viewport mobile drawer navigation surface */}
          <div
            className="lg:hidden fixed inset-x-0 top-16 bottom-0 z-50 bg-white dark:bg-[#18191C] border-t border-slate-900 dark:border-[#3A3D42] shadow-2xl flex flex-col animate-in slide-in-from-top-2 duration-200"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation"
          >
            <div
              ref={drawerScrollRef}
              className="flex-1 overflow-y-auto px-3 sm:px-4 py-4 space-y-4 pb-safe custom-scrollbar [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]"
              style={{
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              <div className="p-3 bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] rounded-lg flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-900 dark:text-[#F2F3F5]">{user?.fullName || user?.username}</span>
                  <span className="text-[10px] text-slate-600 dark:text-[#1ED760] uppercase font-black">{user?.role}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    isNavigatingRef.current = true;
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="min-h-[44px] px-3 flex items-center text-xs text-rose-600 dark:text-rose-400 font-bold hover:underline touch-action-manipulation"
                >
                  Sign Out
                </button>
              </div>

              {navGroups.map((group) => (
                <div key={group.title} className="space-y-1">
                  <span className="text-[10px] font-black uppercase text-slate-500 dark:text-[#949BA4] tracking-wider block px-2 mb-1">
                    {group.title}
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => {
                            isNavigatingRef.current = true;
                            setMobileMenuOpen(false);
                          }}
                          className={clsx(
                            'flex items-center space-x-2.5 px-3 py-2.5 min-h-[44px] rounded-lg text-xs font-bold transition-colors touch-action-manipulation',
                            isActive
                              ? 'bg-slate-900 text-white border border-slate-900 shadow-sm dark:bg-[rgba(30,215,96,0.12)] dark:border-[rgba(30,215,96,0.45)] dark:text-[#1ED760]'
                              : 'border border-transparent hover:border-slate-900 dark:hover:border-[#3A3D42] text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31]'
                          )}
                        >
                          <Icon className={clsx('w-4 h-4 shrink-0', isActive ? 'text-amber-400 dark:text-[#1ED760]' : 'text-slate-400 dark:text-[#949BA4]')} />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </header>
  );
}