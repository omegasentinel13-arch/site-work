'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Lock, User, AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { normalizeSafeRedirectPath } from '@/lib/auth/redirect';

export const dynamic = 'force-dynamic';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');
  const safeNext = normalizeSafeRedirectPath(nextParam);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checkingSetup, setCheckingSetup] = useState(true);

  // Check if system requires first-time Administrator onboarding
  useEffect(() => {
    async function checkSetupStatus() {
      try {
        const res = await fetch('/api/auth/setup-status', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.isSetupRequired) {
            router.replace('/setup/initial-admin');
            return;
          }
        }
      } catch (err) {
        console.error('Error checking setup status:', err);
      } finally {
        setCheckingSetup(false);
      }
    }
    checkSetupStatus();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      router.replace(safeNext);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  if (checkingSetup) {
    return (
      <div className="min-h-screen bg-[#F3F4F6] dark:bg-[#111214] flex items-center justify-center text-[#6B7280] dark:text-[#949BA4] text-sm">
        Verifying system initialization...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-6 sm:py-12 overflow-y-auto">
      <div className="max-w-md w-full space-y-4 sm:space-y-6 my-auto py-4">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-[#18191C] p-1.5 mb-2 sm:mb-3 shadow-xl overflow-hidden border border-slate-900 dark:border-[#4A4D52]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="AB Constructions &amp; Interiors Logo" className="w-full h-full object-contain rounded-xl" />
          </div>
          <h1 className="text-xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-[#F2F3F5] uppercase text-center">
            AB CONSTRUCTIONS &amp; INTERIORS
          </h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-slate-600 dark:text-[#949BA4] font-medium">
            Workforce &amp; Financial Management Utility
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl p-5 sm:p-8 border border-slate-900 dark:border-[#3A3D42]">
          <form onSubmit={handleLogin} className="space-y-3.5 sm:space-y-4">
            {error && (
              <div className="p-3 bg-rose-50 dark:bg-[#2A1215] border border-rose-200 dark:border-rose-900/60 rounded-lg flex items-center space-x-2 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-semibold break-words">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider">
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="min-h-[32px] inline-flex items-center text-xs font-bold text-slate-700 hover:text-slate-900 dark:text-[#1ED760] hover:underline touch-action-manipulation"
                >
                  Forgot Password?
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[44px] pl-10 pr-12 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center justify-center w-11 h-11 text-slate-400 hover:text-slate-600 dark:text-[#949BA4] dark:hover:text-[#F2F3F5] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] rounded-r-lg touch-action-manipulation"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    <Eye className="w-4 h-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] mt-2"
            >
              {loading ? 'Authenticating...' : 'Sign In'}
              <ArrowRight className="ml-2 w-4 h-4 shrink-0" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex items-center justify-center text-[#6B7280] dark:text-[#949BA4] text-sm">
          Loading...
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}