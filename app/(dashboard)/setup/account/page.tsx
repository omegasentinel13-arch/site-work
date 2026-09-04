'use client';

import React, { useState, useEffect } from 'react';
import { useSite } from '@/context/site-context';
import { 
  ShieldCheck, 
  User, 
  Mail, 
  AlertCircle, 
  CheckCircle2, 
  Lock
} from 'lucide-react';

export default function AccountSecurityPage() {
  const { user, refreshUser } = useSite();
  const isAdmin = user?.role === 'ADMIN';

  // Username State
  const [newUsername, setNewUsername] = useState('');
  const [usernamePassword, setUsernamePassword] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameSuccess, setUsernameSuccess] = useState('');
  const [usernameError, setUsernameError] = useState('');

  // Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Recovery Email State
  const [currentRecoveryEmail, setCurrentRecoveryEmail] = useState('');
  const [newRecoveryEmail, setNewRecoveryEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState('');
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (user) {
      setNewUsername(user.username);
      if (user.recoveryEmail) {
        setCurrentRecoveryEmail(user.recoveryEmail);
        setNewRecoveryEmail(user.recoveryEmail);
      }
    }
  }, [user]);

  // 1. Handle Change Username
  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameError('');
    setUsernameSuccess('');
    setUsernameLoading(true);

    try {
      const res = await fetch('/api/auth/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: usernamePassword,
          newUsername: newUsername.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update username');

      setUsernameSuccess('Username successfully updated to: ' + data.username);
      setUsernamePassword('');
      await refreshUser();
    } catch (err: unknown) {
      setUsernameError(err instanceof Error ? err.message : 'Error updating username');
    } finally {
      setUsernameLoading(false);
    }
  };

  // 2. Handle Change Password
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setPasswordLoading(true);

    try {
      const res = await fetch('/api/auth/account', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');

      setPasswordSuccess('Password successfully updated. Stored as secure bcrypt hash.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshUser();
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : 'Error changing password');
    } finally {
      setPasswordLoading(false);
    }
  };

  // 3. Handle Change Recovery Email
  const handleChangeRecoveryEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailSuccess('');
    setEmailLoading(true);

    try {
      const res = await fetch('/api/auth/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: emailPassword,
          newRecoveryEmail: newRecoveryEmail.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update recovery email');

      setEmailSuccess('Recovery email updated to: ' + data.recoveryEmail);
      setCurrentRecoveryEmail(data.recoveryEmail);
      setEmailPassword('');
      await refreshUser();
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : 'Error updating recovery email');
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
            Identity &amp; Account Security
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            My Account &amp; Security Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Manage your authenticated credentials, password, and OTP recovery configuration.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-slate-100 dark:bg-[#202225] px-3 py-1.5 rounded-lg border border-slate-900 dark:border-[#3A3D42] text-xs font-bold text-slate-700 dark:text-zinc-300 self-start sm:self-auto shrink-0">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-[#1ED760] shrink-0" />
          <span>Role: {user?.role}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {/* 1. Change Username Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-[#2B2D31] pb-3">
            <User className="w-5 h-5 text-slate-700 dark:text-zinc-300 shrink-0" />
            <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wide">
              Change Username
            </h2>
          </div>

          <form onSubmit={handleChangeUsername} className="space-y-3 sm:space-y-4">
            {usernameError && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{usernameError}</span>
              </div>
            )}
            {usernameSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-[#0F291B] border border-emerald-200 dark:border-[#1A7F3C]/60 rounded-lg text-emerald-700 dark:text-[#1ED760] text-xs font-semibold flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{usernameSuccess}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                New Username
              </label>
              <input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-semibold bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                Current Password (to authorize change)
              </label>
              <input
                type="password"
                required
                value={usernamePassword}
                onChange={(e) => setUsernamePassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-medium bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <button
              type="submit"
              disabled={usernameLoading}
              className="w-full min-h-[44px] inline-flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] active:bg-black dark:active:bg-[#17a34a] text-white dark:text-black text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow transition-colors disabled:opacity-50 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
            >
              {usernameLoading ? 'Saving...' : 'Update Username'}
            </button>
          </form>
        </div>

        {/* 2. Change Password Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-100 dark:border-[#2B2D31] pb-3">
            <Lock className="w-5 h-5 text-slate-700 dark:text-zinc-300 shrink-0" />
            <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wide">
              Change Password
            </h2>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-3 sm:space-y-4">
            {passwordError && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}
            {passwordSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-[#0F291B] border border-emerald-200 dark:border-[#1A7F3C]/60 rounded-lg text-emerald-700 dark:text-[#1ED760] text-xs font-semibold flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                Current Password
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-medium bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                New Password (min 8 characters)
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-medium bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-medium bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <button
              type="submit"
              disabled={passwordLoading}
              className="w-full min-h-[44px] inline-flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] active:bg-black dark:active:bg-[#17a34a] text-white dark:text-black text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow transition-colors disabled:opacity-50 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
            >
              {passwordLoading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        </div>
      </div>

      {/* 3. Recovery Email Configuration Card (Admin Only) */}
      {isAdmin && (
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-100 dark:border-[#2B2D31] pb-3 gap-2">
            <div className="flex items-center space-x-2">
              <Mail className="w-5 h-5 text-slate-700 dark:text-zinc-300 shrink-0" />
              <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-wide">
                Configured Recovery Email (OTP Password Reset)
              </h2>
            </div>
            <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">
              Current: <strong className="text-slate-900 dark:text-white">{currentRecoveryEmail || 'Not Configured'}</strong>
            </span>
          </div>

          <form onSubmit={handleChangeRecoveryEmail} className="space-y-3 sm:space-y-4 max-w-lg">
            {emailError && (
              <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{emailError}</span>
              </div>
            )}
            {emailSuccess && (
              <div className="p-3 bg-emerald-50 dark:bg-[#0F291B] border border-emerald-200 dark:border-[#1A7F3C]/60 rounded-lg text-emerald-700 dark:text-[#1ED760] text-xs font-semibold flex items-center space-x-1.5">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{emailSuccess}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                New Recovery Email Address
              </label>
              <input
                type="email"
                required
                value={newRecoveryEmail}
                onChange={(e) => setNewRecoveryEmail(e.target.value)}
                placeholder="e.g. admin@abconstructions.com"
                className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-semibold bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                Current Password (to authorize recovery email change)
              </label>
              <input
                type="password"
                required
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-medium bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>

            <button
              type="submit"
              disabled={emailLoading}
              className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] active:bg-black dark:active:bg-[#17a34a] text-white dark:text-black text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow transition-colors disabled:opacity-50 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
            >
              {emailLoading ? 'Saving...' : 'Save Recovery Email'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
