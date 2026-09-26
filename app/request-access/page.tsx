'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  User,
  Lock,
  Mail,
  Briefcase,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  ShieldAlert,
} from 'lucide-react';
import { normalizeSafeRedirectPath } from '@/lib/auth/redirect';

export const dynamic = 'force-dynamic';

function RequestAccessForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');
  const safeNext = normalizeSafeRedirectPath(nextParam);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [roleId, setRoleId] = useState('SITE_MANAGER');
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([
    { id: 'SITE_MANAGER', name: 'Engineer / Site Manager' },
    { id: 'VIEWER', name: 'Viewer / Auditor' },
  ]);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Submitted success state
  const [submittedData, setSubmittedData] = useState<{
    requestId: string;
    role: string;
    status: string;
    statusToken: string;
    typicalReviewTime: string;
  } | null>(null);

  useEffect(() => {
    async function loadRoles() {
      try {
        const res = await fetch('/api/access-requests', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.roles && Array.isArray(data.roles)) {
            setRoles(data.roles);
            if (data.roles.length > 0 && !data.roles.some((r: any) => r.id === roleId)) {
              setRoleId(data.roles[0].id);
            }
          }
        }
      } catch {}
    }
    loadRoles();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Password and Confirm Password do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          username,
          email,
          password,
          confirmPassword,
          roleId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit access request');
      }

      setSubmittedData({
        requestId: data.requestId,
        role: data.role,
        status: data.status,
        statusToken: data.statusToken,
        typicalReviewTime: data.typicalReviewTime || '24–48 hours',
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred while submitting your request.');
    } finally {
      setSubmitting(false);
    }
  };

  const loginDestination = `/login${nextParam ? `?next=${encodeURIComponent(nextParam)}` : ''}`;

  // ==========================================================================
  // Submitted Confirmation State
  // ==========================================================================
  if (submittedData) {
    return (
      <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-6 sm:py-12 overflow-y-auto">
        <div className="max-w-md w-full space-y-4 sm:space-y-6 my-auto py-4">
          <div className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-[#18191C] p-1.5 mb-2 sm:mb-3 shadow-xl overflow-hidden border border-slate-900 dark:border-[#4A4D52]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="AB Constructions &amp; Interiors Logo" className="w-full h-full object-contain rounded-xl" />
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-[#F2F3F5] uppercase">
              AB CONSTRUCTIONS &amp; INTERIORS
            </h1>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-[#949BA4] font-medium">
              Access Governance Portal
            </p>
          </div>

          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl p-6 sm:p-8 border border-slate-900 dark:border-[#3A3D42] text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 mx-auto flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-tight">
              Access Request Submitted
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
              Your request has been securely dispatched to the platform administrators for review.
            </p>

            <div className="my-6 p-4 bg-slate-50 dark:bg-[#111214] rounded-lg border border-slate-200 dark:border-zinc-800 text-left space-y-2.5 text-xs sm:text-sm">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-zinc-800">
                <span className="font-semibold text-slate-500 dark:text-zinc-400">Request Reference</span>
                <span className="font-mono font-bold text-slate-900 dark:text-[#1ED760] text-sm sm:text-base">
                  {submittedData.requestId}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500 dark:text-zinc-400">Requested Role</span>
                <span className="font-bold text-slate-900 dark:text-white">{submittedData.role}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold text-slate-500 dark:text-zinc-400">Status</span>
                <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-400">
                  <Clock className="w-3.5 h-3.5" />
                  {submittedData.status} APPROVAL
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-zinc-800">
                <span className="font-semibold text-slate-500 dark:text-zinc-400">Typical Review Time</span>
                <span className="font-medium text-slate-700 dark:text-zinc-300">{submittedData.typicalReviewTime}</span>
              </div>
            </div>

            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-zinc-400 mb-6">
              You will receive an automated email notification once your request is evaluated. Please check your inbox or spam folder.
            </p>

            <div className="space-y-3">
              <Link
                href={loginDestination}
                className="w-full min-h-[44px] flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] font-bold rounded-lg text-xs sm:text-sm shadow-sm transition-colors"
              >
                Back to Sign In
                <ArrowRight className="ml-2 w-4 h-4" />
              </Link>

              <Link
                href={`/request-access/status?token=${encodeURIComponent(submittedData.statusToken)}`}
                className="block text-xs font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white underline pt-1"
              >
                Check Request Status Online &rarr;
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Form State
  // ==========================================================================
  return (
    <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8 py-6 sm:py-12 overflow-y-auto">
      <div className="max-w-md w-full space-y-4 sm:space-y-6 my-auto py-4">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white dark:bg-[#18191C] p-1.5 mb-2 sm:mb-3 shadow-xl overflow-hidden border border-slate-900 dark:border-[#4A4D52]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="AB Constructions &amp; Interiors Logo" className="w-full h-full object-contain rounded-xl" />
          </div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-[#F2F3F5] uppercase">
            AB CONSTRUCTIONS &amp; INTERIORS
          </h1>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-[#949BA4] font-medium">
            Account Access Request Portal
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl p-5 sm:p-8 border border-slate-900 dark:border-[#3A3D42]">
          <div className="mb-4">
            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
              Request Account Access
            </h2>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Submit your information to request access. An administrator will review your application.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {error && (
              <div className="p-3 bg-rose-50 dark:bg-[#2A1215] border border-rose-200 dark:border-rose-900/60 rounded-lg flex items-center space-x-2 text-rose-700 dark:text-rose-300 text-xs sm:text-sm font-semibold break-words">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Full Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none"
                />
              </div>
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Username
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <span className="font-bold text-xs">@</span>
                </div>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. rahul_eng"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none"
                />
              </div>
              <p className="text-[10px] text-slate-500 dark:text-zinc-500 mt-1">
                Username is case-sensitive and must be at least 3 characters.
              </p>
            </div>

            {/* Email Address */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Email Address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="rahul@example.com"
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none"
                />
              </div>
            </div>

            {/* Requested Role */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Requested Role
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <Briefcase className="w-4 h-4" />
                </div>
                <select
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                  className="w-full min-h-[44px] pl-10 pr-8 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full min-h-[44px] pl-10 pr-12 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:text-zinc-400"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider mb-1">
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 dark:text-[#949BA4]">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full min-h-[44px] pl-10 pr-12 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] placeholder-slate-400 dark:placeholder-[#6B7280] text-sm font-medium focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((p) => !p)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:text-zinc-400"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] flex items-center justify-center py-2.5 px-4 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] border border-slate-900 dark:border-[#1ED760] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors disabled:opacity-50 mt-4"
            >
              {submitting ? 'Submitting Request...' : 'Submit Access Request'}
              <ArrowRight className="ml-2 w-4 h-4" />
            </button>

            {/* Back to Login */}
            <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 text-center">
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                Already have an approved account?{' '}
                <Link
                  href={loginDestination}
                  className="font-bold text-slate-900 dark:text-[#1ED760] hover:underline"
                >
                  Sign In
                </Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function RequestAccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex items-center justify-center text-sm text-slate-500 dark:text-zinc-400">
          Loading Access Request Portal...
        </div>
      }
    >
      <RequestAccessForm />
    </Suspense>
  );
}
