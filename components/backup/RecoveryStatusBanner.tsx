'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, AlertTriangle, ShieldAlert, Activity, RefreshCw, Eye, X } from 'lucide-react';
import { clsx } from 'clsx';
import { RecoveryJournalEntry } from '@/lib/backup/types';

interface StatusData {
  isLocked: boolean;
  isRecoveryMode: boolean;
  lockState: string;
  activeOperationId: string | null;
  journalEntries: RecoveryJournalEntry[];
}

export function RecoveryStatusBanner({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock document body scroll while modal is open
  useEffect(() => {
    if (!showJournalModal) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [showJournalModal]);

  // Support closing modal with Escape key
  useEffect(() => {
    if (!showJournalModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowJournalModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showJournalModal]);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/backup/recovery/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error('Failed to load recovery status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!status && loading) {
    return (
      <div className="bg-slate-100 dark:bg-[#202225] border border-slate-300 dark:border-[#3A3D42] rounded-xl p-4 animate-pulse flex items-center justify-between">
        <div className="h-4 bg-slate-300 dark:bg-[#3A3D42] rounded w-1/3" />
        <div className="h-4 bg-slate-300 dark:bg-[#3A3D42] rounded w-20" />
      </div>
    );
  }

  const isRecovery = status?.isRecoveryMode;
  const isLocked = status?.isLocked;

  return (
    <>
      <div
        className={clsx(
          'rounded-xl border p-4 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shadow-sm',
          isRecovery
            ? 'bg-rose-50 border-rose-600 text-rose-900 dark:bg-rose-950/40 dark:border-rose-700 dark:text-rose-200'
            : isLocked
            ? 'bg-amber-50 border-amber-500 text-amber-900 dark:bg-amber-950/40 dark:border-amber-600 dark:text-amber-200'
            : 'bg-emerald-50/80 border-slate-900 text-emerald-950 dark:bg-emerald-950/20 dark:border-emerald-700/50 dark:text-emerald-300'
        )}
      >
        <div className="flex items-center space-x-3">
          <div
            className={clsx(
              'w-10 h-10 rounded-lg flex items-center justify-center shrink-0 shadow-sm',
              isRecovery
                ? 'bg-rose-600 text-white'
                : isLocked
                ? 'bg-amber-500 text-white'
                : 'bg-emerald-600 text-white'
            )}
          >
            {isRecovery ? (
              <ShieldAlert className="w-5 h-5 animate-bounce" />
            ) : isLocked ? (
              <AlertTriangle className="w-5 h-5 animate-pulse" />
            ) : (
              <ShieldCheck className="w-5 h-5" />
            )}
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-sm font-black uppercase tracking-wide">
                {isRecovery
                  ? 'CRITICAL: EMERGENCY RECOVERY MODE ACTIVE'
                  : isLocked
                  ? 'RESTORE OPERATION IN PROGRESS'
                  : 'DISASTER RECOVERY & AUDIT CONTINUITY ENGINE ONLINE'}
              </h3>
              <span
                className={clsx(
                  'px-2 py-0.5 rounded text-[10px] font-black uppercase',
                  isRecovery
                    ? 'bg-rose-600 text-white'
                    : isLocked
                    ? 'bg-amber-600 text-white'
                    : 'bg-emerald-700 text-white dark:bg-[#1ED760] dark:text-slate-950'
                )}
              >
                {status?.lockState || 'IDLE'}
              </span>
            </div>
            <p className="text-xs opacity-90 font-medium mt-0.5">
              {isRecovery
                ? 'A restore failure triggered quarantine. Safety backups are intact. Quarantine recovery CLI or manual database swap required.'
                : isLocked
                ? `System database is locked for restoration operation [${status?.activeOperationId}]. Transactions are paused.`
                : 'Append-only recovery journal active. Pre-restore safety snapshots and invariant verification fully operational.'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0 self-end md:self-auto">
          {isAdmin && (
            <button
              onClick={() => setShowJournalModal(true)}
              className="px-3 py-1.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] bg-white dark:bg-[#202225] text-slate-800 dark:text-[#F2F3F5] text-xs font-bold hover:bg-slate-100 dark:hover:bg-[#2B2D31] flex items-center space-x-1.5 shadow-sm transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Recovery Journal ({status?.journalEntries?.length || 0})</span>
            </button>
          )}

          <button
            onClick={fetchStatus}
            title="Refresh Status"
            className="w-8 h-8 rounded-lg border border-slate-900 dark:border-[#4A4D52] bg-white dark:bg-[#202225] text-slate-700 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] flex items-center justify-center shadow-sm transition-colors"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Recovery Journal Modal Portaled to Body */}
      {showJournalModal && mounted && createPortal(
        <div
          className="fixed inset-0 z-[9999] bg-black/60 dark:bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowJournalModal(false);
          }}
          aria-modal="true"
          role="dialog"
          aria-labelledby="recovery-journal-title"
        >
          <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-2xl max-w-3xl w-full max-h-[90vh] sm:max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-150 relative">
            <div className="p-4 border-b border-slate-200 dark:border-[#3A3D42] flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Activity className="w-5 h-5 text-emerald-600 dark:text-[#1ED760]" />
                <h2 id="recovery-journal-title" className="text-base font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
                  RECOVERY JOURNAL
                </h2>
              </div>
              <button
                onClick={() => setShowJournalModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                aria-label="Close recovery journal modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 flex-1 overflow-y-auto space-y-3">
              <p className="text-xs text-slate-600 dark:text-[#949BA4]">
                Recovery activity is recorded here so important recovery actions remain traceable.
              </p>

              {(!status?.journalEntries || status.journalEntries.length === 0) ? (
                <div className="text-center py-8 text-xs text-slate-500 font-medium">
                  No recovery events recorded yet. Safe baseline established.
                </div>
              ) : (
                <div className="space-y-2">
                  {[...status.journalEntries].reverse().map((entry, idx) => (
                    <div
                      key={entry.eventId || idx}
                      className="p-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#3A3D42] rounded-xl text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <span
                            className={clsx(
                              'px-2 py-0.5 rounded text-[10px] font-black uppercase',
                              entry.eventType.includes('SUCCESS')
                                ? 'bg-emerald-600 text-white'
                                : entry.eventType.includes('FAIL') || entry.eventType.includes('CRITICAL')
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-800 text-white'
                            )}
                          >
                            {entry.eventType}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">
                            Op: {entry.operationId}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                        Operator: <span className="font-bold">{entry.operator.username}</span> ({entry.operator.role})
                      </div>

                      {entry.sourceBackup && (
                        <div className="text-[10px] font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-[#18191C] p-2 rounded border">
                          <div>Source: {entry.sourceBackup.backupId} ({entry.sourceBackup.scope})</div>
                          <div className="truncate">SHA: {entry.sourceBackup.sha256}</div>
                        </div>
                      )}

                      {entry.error && (
                        <div className="text-xs text-rose-600 dark:text-rose-400 font-bold bg-rose-50 dark:bg-rose-950/30 p-2 rounded border border-rose-200 dark:border-rose-900">
                          Error: {entry.error}
                        </div>
                      )}

                      {entry.preRestoreBackupPath && (
                        <div className="text-[10px] text-slate-500 truncate font-mono">
                          Safety Backup: {entry.preRestoreBackupPath}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3 border-t border-slate-200 dark:border-[#3A3D42] flex justify-end">
              <button
                onClick={() => setShowJournalModal(false)}
                className="px-4 py-2 bg-slate-900 dark:bg-[#202225] text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
