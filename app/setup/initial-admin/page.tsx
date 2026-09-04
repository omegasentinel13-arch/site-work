'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Lock, User, Mail, AlertCircle, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function InitialAdminSetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState('admin');
  const [fullName, setFullName] = useState('Head Administrator');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('omegasentinel13@gmail.com');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isSetupCompleted, setIsSetupCompleted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function checkSetup() {
      try {
        const res = await fetch('/api/auth/setup-status', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (!data.isSetupRequired) {
            setIsSetupCompleted(true);
            return;
          }
        }
      } catch (err) {
        console.error('Error checking setup status:', err);
      } finally {
        setChecking(false);
      }
    }
    checkSetup();
  }, [router]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/setup-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          fullName: fullName.trim(),
          password,
          confirmPassword,
          recoveryEmail: recoveryEmail.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to complete administrator setup');
      }

      router.replace('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error setting up administrator');
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex items-center justify-center text-slate-600 dark:text-[#949BA4] text-sm">
        Verifying system initialization status...
      </div>
    );
  }

  if (isSetupCompleted) {
    return (
      <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-6 sm:py-12 overflow-y-auto">
        <div className="max-w-md w-full space-y-4 sm:space-y-6 my-auto py-4">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-900 dark:bg-[#1ED760] text-emerald-400 dark:text-[#07130B] mb-2 sm:mb-3 shadow-xl border border-slate-900 dark:border-[#1ED760]">
              <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10 text-emerald-400 dark:text-[#07130B]" />
            </div>
            <h1 className="text-xl sm:text-3xl font-black tracking-tight text-[#0F172A] dark:text-[#F2F3F5] uppercase">
              Setup Already Completed
            </h1>
            <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-slate-600 dark:text-[#949BA4] font-medium">
              The primary administrator account for this system is already configured and active.
            </p>
          </div>

          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl p-5 sm:p-8 border border-slate-900 dark:border-[#3A3D42] text-center space-y-5">
            <div className="p-3.5 bg-emerald-50 dark:bg-[#071F12] border border-emerald-300 dark:border-emerald-800/60 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs sm:text-sm font-semibold">
              First-time setup has already been completed. Additional initial administrators cannot be created.
            </div>

            <Link
              href="/login"
              className="w-full min-h-[44px] flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
            >
              Proceed to Sign In
              <ArrowRight className="ml-2 w-4 h-4 shrink-0" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-6 sm:py-12 overflow-y-auto">
      <div className="max-w-md w-full space-y-4 sm:space-y-6 my-auto py-4">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-900 dark:bg-[#1ED760] text-amber-400 dark:text-[#07130B] mb-2 sm:mb-3 shadow-xl border border-slate-900 dark:border-[#1ED760]">
            <ShieldCheck className="w-8 h-8 sm:w-10 sm:h-10" />
          </div>
          <h1 className="text-xl sm:text-3xl font-black tracking-tight text-[#0F172A] dark:text-[#F2F3F5] uppercase">
            Initial System Setup
          </h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-slate-600 dark:text-[#949BA4] font-medium">
            Create your primary Administrator account to secure this installation.
          </p>
        </div>

        {/* Setup Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl p-5 sm:p-8 border border-slate-900 dark:border-[#3A3D42]">
          <form onSubmit={handleSetup} className="space-y-3.5 sm:space-y-4">
            {error && (
              <div className="p-3 bg-rose-50 dark:bg-[#2A1215] border border-rose-300 dark:border-rose-900/60 rounded-lg flex items-center space-x-2 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-semibold break-words">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Admin Username *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-[#949BA4]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-[#0F172A] dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Full Name
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Head Administrator"
                className="w-full min-h-[44px] px-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-[#0F172A] dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Password (min 8 characters) *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-[#949BA4]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-[#0F172A] dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Confirm Password *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-[#949BA4]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-[#0F172A] dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Recovery Email Address *
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 dark:text-[#949BA4]">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  placeholder="omegasentinel13@gmail.com"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-[#0F172A] dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>
              <span className="text-[11px] text-slate-500 dark:text-[#949BA4] block mt-1 leading-snug">
                Used for cryptographically secure OTP password recovery. Can be changed later in Settings.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[44px] flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] mt-2"
            >
              {loading ? 'Initializing Setup...' : 'Complete Admin Setup'}
              <ArrowRight className="ml-2 w-4 h-4 shrink-0" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}