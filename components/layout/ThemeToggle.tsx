'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from '@/context/theme-context';
import { Sun, Moon } from 'lucide-react';
import { clsx } from 'clsx';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted ? theme === 'dark' : false;
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={clsx(
        'w-9 h-9 sm:w-11 sm:h-11 hit-target-44 flex items-center justify-center rounded-lg transition-colors shrink-0 touch-action-manipulation',
        'bg-white dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] shadow-sm',
        'hover:bg-slate-100 dark:hover:bg-[#2B2D31] hover:border-slate-900 dark:hover:border-[#1ED760]/50',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
        className
      )}
    >
      {mounted ? (
        isDark ? (
          <Moon className="w-4 h-4 sm:w-5 sm:h-5 text-[#1ED760] transition-transform duration-200" />
        ) : (
          <Sun className="w-4 h-4 sm:w-5 sm:h-5 text-amber-500 transition-transform duration-200" />
        )
      ) : (
        <span className="w-4 h-4 sm:w-5 sm:h-5 inline-block" aria-hidden="true" />
      )}
    </button>
  );
}