'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  activeUserId: string | null;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setActiveUser: (userId: string | null) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ACTIVE_THEME_COOKIE = 'site_work_active_theme';
export const USER_THEME_PREFIX = 'site_work_theme_';

export function getSavedUserTheme(userId: string): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(`${USER_THEME_PREFIX}${userId}`);
    return saved === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function saveUserTheme(userId: string, theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${USER_THEME_PREFIX}${userId}`, theme);
    document.cookie = `${ACTIVE_THEME_COOKIE}=${theme}; path=/; max-age=31536000; SameSite=Lax`;
  } catch {}
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [activeUserId, setActiveUserId] = useState<string | null>(null);

  // Initial client hydration: inspect active theme cookie, strictly default to light
  useEffect(() => {
    try {
      const match = document.cookie.match(/(?:^|;\s*)site_work_active_theme=([^;]+)/);
      const cookieTheme = match ? decodeURIComponent(match[1]) : null;

      if (cookieTheme === 'dark') {
        setThemeState('dark');
        document.documentElement.classList.add('dark');
      } else {
        setThemeState('light');
        document.documentElement.classList.remove('dark');
      }
    } catch {
      setThemeState('light');
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const setActiveUser = useCallback((userId: string | null) => {
    setActiveUserId(userId);
    if (!userId) {
      // Logged out / unauthenticated: return to clean Light Theme
      setThemeState('light');
      document.documentElement.classList.remove('dark');
      try {
        document.cookie = `${ACTIVE_THEME_COOKIE}=light; path=/; max-age=31536000; SameSite=Lax`;
      } catch {}
      return;
    }

    // User authenticated: load this specific user's persisted theme
    const userTheme = getSavedUserTheme(userId);
    setThemeState(userTheme);
    if (userTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    try {
      document.cookie = `${ACTIVE_THEME_COOKIE}=${userTheme}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);

    if (activeUserId) {
      saveUserTheme(activeUserId, newTheme);
    } else {
      try {
        document.cookie = `${ACTIVE_THEME_COOKIE}=${newTheme}; path=/; max-age=31536000; SameSite=Lax`;
      } catch {}
    }

    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [activeUserId]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, activeUserId, toggleTheme, setTheme, setActiveUser }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}