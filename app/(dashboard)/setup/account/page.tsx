'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSite } from '@/context/site-context';
import { 
  ShieldCheck, 
  User, 
  Mail, 
  AlertCircle, 
  CheckCircle2, 
  Lock,
  Archive,
  Trash2,
  Eye,
  EyeOff,
  ExternalLink,
  Shield,
  Building2,
  Clock,
  Activity,
  KeyRound,
  Check
} from 'lucide-react';
import { SafeAuditLogItem } from '@/lib/db/repositories/audit-repo';

interface UserProfileData {
  id: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  authorityTier: string;
  recoveryEmail: string | null;
  isActive: boolean;
  createdAt: string;
  tokenVersion: number;
  assignedSiteIds: string[];
}

export default function AccountSecurityPage() {
  const { user: contextUser, refreshUser, sites } = useSite();
  const isAdmin = contextUser?.role === 'ADMIN';

  // Server-Derived Account Profile & Activity State
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [myActivity, setMyActivity] = useState<SafeAuditLogItem[]>([]);
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true);

  // Hidden Pages state (Admin only)
  const [showHiddenPages, setShowHiddenPages] = useState(false);

  // Password Visibility Toggles
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showUsernamePassword, setShowUsernamePassword] = useState(false);
  const [showEmailPassword, setShowEmailPassword] = useState(false);

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

  // Fetch Server-Authoritative Profile & Activity (Secure session-derived identity)
  const fetchAccountData = useCallback(async () => {
    try {
      setLoadingProfile(true);
      const res = await fetch('/api/auth/account');
      if (res.ok) {
        const data = await res.json();
        setProfile(data.user);
        setMyActivity(data.activity || []);
        if (data.user?.username) {
          setNewUsername(data.user.username);
        }
        if (data.user?.recoveryEmail) {
          setCurrentRecoveryEmail(data.user.recoveryEmail);
          setNewRecoveryEmail(data.user.recoveryEmail);
        }
      }
    } catch (err) {
      console.error('Failed to load account profile:', err);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  useEffect(() => {
    fetchAccountData();
  }, [fetchAccountData]);

  // Load hidden pages preference from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('site_work_show_hidden_pages');
    if (stored === 'true') {
      setShowHiddenPages(true);
    }
  }, []);

  const handleToggleHiddenPages = () => {
    const nextVal = !showHiddenPages;
    setShowHiddenPages(nextVal);
    localStorage.setItem('site_work_show_hidden_pages', String(nextVal));
    window.dispatchEvent(new Event('storage'));
  };

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
      await fetchAccountData();
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

      setPasswordSuccess('Password successfully changed');
      setCurrentPassword('');
      newPassword && setNewPassword('');
      setConfirmPassword('');
      await fetchAccountData();
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
      await fetchAccountData();
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : 'Error updating recovery email');
    } finally {
      setEmailLoading(false);
    }
  };

  // Derived effective user (server profile takes precedence)
  const effectiveUser = profile || contextUser;
  const isKingMakerUser = effectiveUser?.authorityTier === 'KING_MAKER';
  const isPrimeUser = effectiveUser?.authorityTier === 'CLIENT_PRIME' || effectiveUser?.authorityTier === 'PRIME';
  const isGlobalAccess = isKingMakerUser || isPrimeUser || effectiveUser?.role === 'ADMIN';

  // Compute assigned sites for current user
  const userAssignedSiteIds = effectiveUser?.assignedSiteIds || [];
  const assignedSitesList = isGlobalAccess 
    ? sites 
    : sites.filter(s => userAssignedSiteIds.includes(s.id));

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      {/* ============================================================ */}
      {/* 1. CANONICAL INVERTED PROFILE HEADER BANNER                  */}
      {/* ============================================================ */}
      <div className="bg-slate-900 dark:bg-[#202225] text-white p-5 sm:p-7 rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-md flex flex-col md:flex-row md:items-center md:justify-between gap-5">
        <div className="flex items-start sm:items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center text-white shrink-0 shadow-inner">
            <User className="w-7 h-7 text-emerald-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {effectiveUser?.fullName || 'Account Profile'}
              </h1>

              {/* Authority Tier Badge */}
              {isKingMakerUser ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-sm">
                  KING MAKER &bull; Platform Authority
                </span>
              ) : isPrimeUser ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-400/20 text-purple-300 border border-purple-400/40">
                  PRIME
                </span>
              ) : effectiveUser?.role === 'ADMIN' ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-700 text-slate-200 border border-slate-600">
                  Administrator
                </span>
              ) : effectiveUser?.role === 'SITE_MANAGER' ? (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-500/20 text-sky-300 border border-sky-500/30">
                  Site Manager
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-zinc-700 text-zinc-300 border border-zinc-600">
                  Auditor / Viewer
                </span>
              )}
            </div>

            <p className="text-xs sm:text-sm text-slate-300 dark:text-zinc-400 mt-1 flex items-center gap-2">
              <span className="font-mono text-white">@{effectiveUser?.username}</span>
              <span>&bull;</span>
              <span className="font-mono text-[11px] text-slate-400">ID: {effectiveUser?.id}</span>
            </p>
          </div>
        </div>

        {/* Account Security Metric Chips */}
        <div className="flex flex-wrap items-center gap-2.5 self-start md:self-center">
          <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Session v{(profile?.tokenVersion ?? (effectiveUser as { tokenVersion?: number })?.tokenVersion) || 1}</span>
          </div>
          {effectiveUser?.recoveryEmail && (
            <div className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-medium text-slate-200 flex items-center gap-1.5">
              <Mail className="w-4 h-4 text-emerald-400" />
              <span>Recovery Configured</span>
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. PLAIN-LANGUAGE ACCESS SUMMARY & MY SITES                  */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Access Summary Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col">
          <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Personal Access Summary
              </h2>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-slate-300">
              Active Permissions
            </span>
          </div>

          <div className="p-5 space-y-4 flex-1">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2D3035] space-y-2">
              <p className="text-xs sm:text-sm text-slate-800 dark:text-zinc-200 leading-relaxed font-medium">
                {isGlobalAccess ? (
                  <>
                    You have <strong>Global Platform Authorization</strong>. You can view, govern, and coordinate all sites, users, roles, financial ledgers, and attendance records across the entire organization.
                  </>
                ) : (
                  <>
                    Your account is assigned to <strong>{assignedSitesList.length} site(s)</strong>. Your operational permissions allow you to record workforce attendance, review site ledgers, and collaborate on your assigned locations.
                  </>
                )}
              </p>
            </div>

            <div className="space-y-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
                Authorized Capabilities
              </span>
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-zinc-300">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Interactive dashboard access &amp; real-time operational feeds</span>
                </li>
                {isAdmin && (
                  <>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>User account provisioning &amp; role governance</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span>Audit trail inspection &amp; forensic event investigation</span>
                    </li>
                  </>
                )}
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Self-service credentials &amp; active session management</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* My Sites Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col">
          <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                My Authorized Sites
              </h2>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-slate-300">
              {assignedSitesList.length} Assigned
            </span>
          </div>

          <div className="p-5 space-y-3 flex-1">
            {assignedSitesList.length === 0 ? (
              <div className="text-center py-6 text-slate-500 dark:text-zinc-400 text-xs">
                No active sites assigned to this account.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto pr-1">
                {assignedSitesList.map((site) => (
                  <div
                    key={site.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-[#2D3035] bg-slate-50/70 dark:bg-[#111214] flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-xs text-slate-900 dark:text-white truncate">
                        {site.name}
                      </p>
                      <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                        {site.code || site.id}
                      </span>
                    </div>
                    <span className="w-2 h-2 rounded-full bg-emerald-500" title="Authorized" />
                  </div>
                ))}
              </div>
            )}

            {isGlobalAccess && (
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 italic pt-1">
                * As an administrator, you have automatic access to all newly registered sites.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 3. SECURITY CENTER (Safe Self-Service Actions)               */}
      {/* ============================================================ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* CARD A: Change Username */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
          <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Change Username
              </h2>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-slate-300">
              Profile
            </span>
          </div>

          <div className="p-5">
            <form onSubmit={handleChangeUsername} className="space-y-4">
              {usernameError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{usernameError}</span>
                </div>
              )}

              {usernameSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{usernameSuccess}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                  New Username
                </label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="Enter new username"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                  Current Password (Verification)
                </label>
                <div className="relative">
                  <input
                    type={showUsernamePassword ? 'text' : 'password'}
                    required
                    value={usernamePassword}
                    onChange={(e) => setUsernamePassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full min-h-[44px] pl-3.5 pr-10 py-2 rounded-lg border border-slate-200 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowUsernamePassword(!showUsernamePassword)}
                    className="w-11 h-11 absolute right-0 top-0 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
                  >
                    {showUsernamePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={usernameLoading}
                className="w-full min-h-[44px] rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 touch-action-manipulation"
              >
                {usernameLoading ? 'UPDATING...' : 'UPDATE USERNAME'}
              </button>
            </form>
          </div>
        </div>

        {/* CARD B: Change Password */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
          <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Change Password
              </h2>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-slate-300">
              Security
            </span>
          </div>

          <div className="p-5">
            <form onSubmit={handleChangePassword} className="space-y-3.5">
              {passwordError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{passwordError}</span>
                </div>
              )}

              {passwordSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{passwordSuccess}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                  Current Password
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full min-h-[44px] pl-3.5 pr-10 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    className="w-11 h-11 absolute right-0 top-0 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
                  >
                    {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                  New Password (Min. 8 characters)
                </label>
                <div className="relative">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new strong password"
                    className="w-full min-h-[44px] pl-3.5 pr-10 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="w-11 h-11 absolute right-0 top-0 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
                  >
                    {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                  Confirm New Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full min-h-[44px] pl-3.5 pr-10 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="w-11 h-11 absolute right-0 top-0 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={passwordLoading}
                className="w-full min-h-[44px] rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 touch-action-manipulation"
              >
                {passwordLoading ? 'UPDATING...' : 'UPDATE PASSWORD'}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 4. RECOVERY EMAIL & CONTINUITY (Admin Protected Action)       */}
      {/* ============================================================ */}
      {isAdmin && (
        <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
          <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Emergency Recovery Email (Administrative Continuity)
              </h2>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-slate-300">
              Recovery Channel
            </span>
          </div>

          <div className="p-5">
            <form onSubmit={handleChangeRecoveryEmail} className="space-y-4 max-w-xl">
              {emailError && (
                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{emailError}</span>
                </div>
              )}

              {emailSuccess && (
                <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{emailSuccess}</span>
                </div>
              )}

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                  Recovery Email Address
                </label>
                <input
                  type="email"
                  required
                  value={newRecoveryEmail}
                  onChange={(e) => setNewRecoveryEmail(e.target.value)}
                  placeholder="admin-recovery@example.com"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                />
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
                  This destination receives cryptographically generated OTP recovery links if password access is lost.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                  Confirm Current Password
                </label>
                <div className="relative">
                  <input
                    type={showEmailPassword ? 'text' : 'password'}
                    required
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full min-h-[44px] pl-3.5 pr-10 py-2 rounded-lg border border-slate-300 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmailPassword(!showEmailPassword)}
                    className="w-11 h-11 absolute right-0 top-0 flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-zinc-200"
                  >
                    {showEmailPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={emailLoading}
                className="min-h-[44px] px-6 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 touch-action-manipulation"
              >
                {emailLoading ? 'UPDATING...' : 'UPDATE RECOVERY EMAIL'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 5. MY RECENT ACTIVITY (Strict Session-Derived Feed)           */}
      {/* ============================================================ */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-white">
              My Recent Operational Activity
            </h2>
          </div>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-slate-300">
            Last {myActivity.length} Events
          </span>
        </div>

        <div className="p-5">
          {loadingProfile ? (
            <div className="text-center py-6 text-slate-500 text-xs font-bold">
              Loading recent activity...
            </div>
          ) : myActivity.length === 0 ? (
            <div className="text-center py-6 text-slate-500 text-xs">
              No recent activity recorded for this account.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-[#2D3035]">
              {myActivity.map((act) => (
                <div key={act.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white">
                      {act.actionDisplay || act.action}
                    </p>
                    <p className="text-[10px] font-mono text-slate-400 dark:text-zinc-500 mt-0.5">
                      Module: {act.module} &bull; Scope: {act.site?.name || 'Global'}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 shrink-0">
                    {act.timestamp}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 6. HIDDEN PAGES (Preserved Admin Tooling)                     */}
      {/* ============================================================ */}
      {isAdmin && (
        <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
          <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="w-4 h-4 text-emerald-400" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                Hidden Pages &amp; Lifecycle Tools
              </h2>
            </div>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-white/10 text-slate-300">
              Diagnostics
            </span>
          </div>

          <div className="p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2D3035]">
              <div>
                <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                  Display Hidden System Pages
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  Toggles visibility of Recycle Bin and Archive diagnostic routes in the navigation drawer.
                </p>
              </div>

              <button
                type="button"
                onClick={handleToggleHiddenPages}
                className={`min-h-[44px] px-5 py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all touch-action-manipulation shrink-0 ${
                  showHiddenPages
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 shadow-sm'
                    : 'bg-slate-200 dark:bg-[#2A2D32] text-slate-700 dark:text-zinc-300 hover:bg-slate-300 dark:hover:bg-[#34373C]'
                }`}
              >
                {showHiddenPages ? (
                  <>
                    <Eye className="w-4 h-4" />
                    <span>VISIBLE</span>
                  </>
                ) : (
                  <>
                    <EyeOff className="w-4 h-4" />
                    <span>HIDDEN</span>
                  </>
                )}
              </button>
            </div>

            {showHiddenPages && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <Link
                  href="/setup/recycle-bin"
                  className="p-3.5 rounded-xl border border-slate-300 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-50 dark:hover:bg-[#222428] transition-colors flex items-center justify-between group shadow-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <Trash2 className="w-4 h-4 text-rose-500" />
                    <div>
                      <span className="font-bold text-xs text-slate-800 dark:text-zinc-200 block group-hover:text-slate-900 dark:group-hover:text-white">
                        Global Recycle Bin
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">/setup/recycle-bin</span>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-zinc-200" />
                </Link>

                <Link
                  href="/setup/archive"
                  className="p-3.5 rounded-xl border border-slate-300 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-50 dark:hover:bg-[#222428] transition-colors flex items-center justify-between group shadow-sm"
                >
                  <div className="flex items-center gap-2.5">
                    <Archive className="w-4 h-4 text-amber-500" />
                    <div>
                      <span className="font-bold text-xs text-slate-800 dark:text-zinc-200 block group-hover:text-slate-900 dark:group-hover:text-white">
                        Global System Archive
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">/setup/archive</span>
                    </div>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-zinc-200" />
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
