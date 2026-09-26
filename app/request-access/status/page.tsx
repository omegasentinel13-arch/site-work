'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowLeft,
  Search,
  Shield,
} from 'lucide-react';

export const dynamic = 'force-dynamic';

function StatusContent() {
  const searchParams = useSearchParams();
  const tokenParam = searchParams.get('token') || '';

  const [tokenInput, setTokenInput] = useState(tokenParam);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusData, setStatusData] = useState<{
    id: string;
    requesterFullName: string;
    requestedUsername: string;
    requestedRole: string;
    status: 'PENDING' | 'APPROVED' | 'DENIED' | 'CANCELLED' | 'EXPIRED';
    createdAt: string;
    reviewedAt: string | null;
    typicalReviewTime: string;
  } | null>(null);

  const fetchStatus = async (token: string) => {
    if (!token.trim()) return;
    setLoading(true);
    setError('');
    setStatusData(null);

    try {
      const res = await fetch(`/api/access-requests/status?token=${encodeURIComponent(token.trim())}`, {
        cache: 'no-store',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to retrieve access request status');
      }
      setStatusData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error checking request status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tokenParam) {
      fetchStatus(tokenParam);
    }
  }, [tokenParam]);

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
            Access Request Status Lookup
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl p-6 sm:p-8 border border-slate-900 dark:border-[#3A3D42]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              fetchStatus(tokenInput);
            }}
            className="space-y-3 mb-6"
          >
            <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wider">
              Request Status Token
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Enter your security token"
                className="flex-1 min-h-[42px] px-3 py-2 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-slate-900 dark:text-[#F2F3F5] text-xs font-mono focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || !tokenInput.trim()}
                className="min-h-[42px] px-4 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] font-bold rounded-lg text-xs shadow-sm disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                {loading ? 'Checking...' : 'Check'}
              </button>
            </div>
          </form>

          {error && (
            <div className="p-3 mb-4 bg-rose-50 dark:bg-[#2A1215] border border-rose-200 dark:border-rose-900/60 rounded-lg flex items-center space-x-2 text-rose-700 dark:text-rose-300 text-xs font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {statusData && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 dark:bg-[#111214] rounded-lg border border-slate-200 dark:border-zinc-800 space-y-2.5 text-xs sm:text-sm">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-zinc-800">
                  <span className="font-semibold text-slate-500 dark:text-zinc-400">Request ID</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-[#1ED760] text-sm">
                    {statusData.id}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-500 dark:text-zinc-400">Requester</span>
                  <span className="font-bold text-slate-900 dark:text-white">{statusData.requesterFullName}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-500 dark:text-zinc-400">Username</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">@{statusData.requestedUsername}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-slate-500 dark:text-zinc-400">Requested Role</span>
                  <span className="font-bold text-slate-900 dark:text-white">{statusData.requestedRole}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-zinc-800">
                  <span className="font-semibold text-slate-500 dark:text-zinc-400">Status</span>
                  {statusData.status === 'PENDING' && (
                    <span className="inline-flex items-center gap-1 font-bold text-amber-700 dark:text-amber-400">
                      <Clock className="w-3.5 h-3.5" />
                      PENDING APPROVAL
                    </span>
                  )}
                  {statusData.status === 'APPROVED' && (
                    <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      APPROVED
                    </span>
                  )}
                  {statusData.status === 'DENIED' && (
                    <span className="inline-flex items-center gap-1 font-bold text-rose-700 dark:text-rose-400">
                      <XCircle className="w-3.5 h-3.5" />
                      NOT APPROVED
                    </span>
                  )}
                </div>
              </div>

              {statusData.status === 'APPROVED' && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-300 text-xs">
                  Your account has been activated! You can now log in using your username and password.
                </div>
              )}

              {statusData.status === 'PENDING' && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-800 dark:text-amber-300 text-xs">
                  Your request is awaiting administrator review. Typical review window is 24–48 hours.
                </div>
              )}

              {statusData.status === 'DENIED' && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/40 rounded-lg text-rose-800 dark:text-rose-300 text-xs">
                  Your request was not approved by an administrator. Please speak with your organization manager.
                </div>
              )}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-slate-100 dark:border-zinc-800/80 text-center">
            <Link
              href="/login"
              className="inline-flex items-center text-xs font-bold text-slate-700 hover:text-slate-900 dark:text-zinc-300 dark:hover:text-white"
            >
              <ArrowLeft className="w-3.5 h-3.5 mr-1" />
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RequestStatusPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F1F5F9] dark:bg-[#111214] flex items-center justify-center text-sm text-slate-500">
          Loading status...
        </div>
      }
    >
      <StatusContent />
    </Suspense>
  );
}
