'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { History, RefreshCw, CheckCircle2, XCircle, ShieldCheck, Loader2 } from 'lucide-react';
import { RecoveryHistoryEntry } from '@/lib/backup/import/types';

interface RecoveryHistoryTableProps {
  refreshTrigger?: number;
}

export function RecoveryHistoryTable({ refreshTrigger }: RecoveryHistoryTableProps) {
  const [history, setHistory] = useState<RecoveryHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backup/import/history');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch recovery history');
      }
      setHistory(data.history || []);
    } catch (err: any) {
      setError(err.message || 'Error loading history');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory, refreshTrigger]);

  return (
    <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#33353A] flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <History className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
            Disaster Recovery &amp; Import History (Append-Only Log)
          </h3>
        </div>
        <button
          type="button"
          onClick={fetchHistory}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold uppercase bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="p-4 sm:p-5 space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {isLoading && history.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
            <span>Loading recovery ledger...</span>
          </div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No recovery operations have been executed on this system yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-[#2B2D31]">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-[#202225] text-slate-600 dark:text-zinc-400 font-bold uppercase tracking-wider">
                <tr>
                  <th className="p-2.5">Execution Time</th>
                  <th className="p-2.5">Operation ID</th>
                  <th className="p-2.5">Package ID</th>
                  <th className="p-2.5">Actor</th>
                  <th className="p-2.5">Scope</th>
                  <th className="p-2.5 text-sky-600">Inserted</th>
                  <th className="p-2.5 text-amber-600">Skipped</th>
                  <th className="p-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                {history.map((entry) => (
                  <tr key={entry.operationId} className="hover:bg-slate-50/50 dark:hover:bg-[#202225]/50 transition-colors">
                    <td className="p-2.5 font-mono text-[11px] text-slate-700 dark:text-zinc-300 whitespace-nowrap">
                      {new Date(entry.executedAt).toLocaleString()}
                    </td>
                    <td className="p-2.5 font-mono text-[11px] text-slate-900 dark:text-white font-bold">
                      {entry.operationId}
                    </td>
                    <td className="p-2.5 font-mono text-[11px] text-slate-600 dark:text-zinc-400 truncate max-w-[140px]" title={entry.packageId}>
                      {entry.packageId}
                    </td>
                    <td className="p-2.5 text-slate-800 dark:text-zinc-200">
                      {entry.actor?.username || 'admin'}
                    </td>
                    <td className="p-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#2B2D31] text-slate-700 dark:text-zinc-300">
                        {entry.scope} {entry.siteName ? `(${entry.siteName})` : ''}
                      </span>
                    </td>
                    <td className="p-2.5 font-mono font-bold text-sky-600">
                      +{entry.totalInserted}
                    </td>
                    <td className="p-2.5 font-mono font-bold text-amber-600">
                      {entry.totalSkipped}
                    </td>
                    <td className="p-2.5">
                      {entry.status === 'SUCCESS' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>SUCCESS</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-bold text-[11px]">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>FAILED</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
