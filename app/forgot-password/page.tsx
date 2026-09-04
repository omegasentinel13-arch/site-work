'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { KeyRound, Lock, User, AlertCircle, ArrowRight, CheckCircle2, ArrowLeft } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<'REQUEST' | 'RESET' | 'SUCCESS'>('REQUEST');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/recovery/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to process recovery request');
      }

      setInfoMessage(data.message || 'If an administrator account with this username exists, a recovery code has been generated.');
      setStep('RESET');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error sending recovery code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/recovery/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          token: token.trim(),
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reset password');
      }

      setStep('SUCCESS');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error resetting password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-6 sm:py-12 overflow-y-auto">
      <div className="max-w-md w-full space-y-4 sm:space-y-6 my-auto py-4">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] mb-2 sm:mb-3 shadow-xl border border-slate-900 dark:border-[#1ED760]">
            <KeyRound className="w-8 h-8 sm:w-10 sm:h-10 text-amber-400 dark:text-[#07130B]" />
          </div>
          <h1 className="text-xl sm:text-3xl font-black tracking-tight text-slate-900 dark:text-[#F2F3F5] uppercase">
            Account Recovery
          </h1>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-slate-600 dark:text-[#949BA4] font-medium">
            Reset your administrator password using a verified recovery OTP.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl p-5 sm:p-8 border border-slate-900 dark:border-[#3A3D42]">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-[#2A1215] border border-rose-200 dark:border-rose-900/60 rounded-lg flex items-center space-x-2 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-semibold mb-3 sm:mb-4 break-words">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {step === 'REQUEST' && (
            <form onSubmit={handleRequestOTP} className="space-y-3.5 sm:space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                  Administrator Username
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
                    placeholder="Enter your username"
                    className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] mt-2"
              >
                {loading ? 'Processing...' : 'Send Recovery OTP'}
                <ArrowRight className="ml-2 w-4 h-4 shrink-0" />
              </button>

              <div className="text-center pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <Link
                  href="/login"
                  className="min-h-[44px] inline-flex items-center text-xs font-bold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] touch-action-manipulation"
                >
                  <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                  Back to Sign In
                </Link>
              </div>
            </form>
          )}

          {step === 'RESET' && (
            <form onSubmit={handleResetPassword} className="space-y-3.5 sm:space-y-4">
              <div className="p-3 bg-amber-50 dark:bg-[#241C12] border border-amber-300 dark:border-[#684C12] rounded-lg text-xs text-amber-900 dark:text-amber-200 font-medium break-words">
                {infoMessage}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                  6-Digit Recovery OTP
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="e.g. 849201"
                  className="w-full min-h-[44px] px-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] text-center text-lg font-mono font-black tracking-widest focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                  New Password (min 8 characters)
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                  Confirm New Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-base sm:text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-slate-900 dark:focus:border-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[44px] flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] mt-2"
              >
                {loading ? 'Verifying...' : 'Set New Password'}
                <CheckCircle2 className="ml-2 w-4 h-4 text-emerald-400 dark:text-[#07130B] shrink-0" />
              </button>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setStep('REQUEST')}
                  className="min-h-[44px] inline-flex items-center font-bold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] touch-action-manipulation"
                >
                  Resend OTP
                </button>
                <Link
                  href="/login"
                  className="min-h-[44px] inline-flex items-center font-bold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] touch-action-manipulation"
                >
                  Cancel
                </Link>
              </div>
            </form>
          )}

          {step === 'SUCCESS' && (
            <div className="text-center space-y-3 sm:space-y-4 py-2 sm:py-3">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] border border-slate-900 dark:border-[#1A7F3C] rounded-full mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-[#F2F3F5]">
                Password Reset Successfully
              </h2>
              <p className="text-xs text-slate-600 dark:text-[#949BA4] leading-relaxed">
                Your credentials have been securely updated and previous sessions invalidated. Please sign in with your new password.
              </p>
              <Link
                href="/login"
                className="w-full min-h-[44px] inline-flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors touch-action-manipulation"
              >
                Sign In Now
                <ArrowRight className="ml-2 w-4 h-4 shrink-0" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}