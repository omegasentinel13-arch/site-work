'use client';

import React, { useState, useEffect } from 'react';
import { 
  Download, 
  Trash2, 
  Database, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  ShieldCheck, 
  Loader2, 
  FileText,
  Search
} from 'lucide-react';
import { clsx } from 'clsx';
import { StoredBackupRecord } from '@/lib/backup/types';

interface BackupHistoryTableProps {
  isAdmin: boolean;
  refreshTrigger: number;
  onInitiateRestore?: (backupId: string) => void;
  onInspectBackup?: (backupId: string) => void;
}

export function BackupHistoryTable({ isAdmin, refreshTrigger, onInitiateRestore, onInspectBackup }: BackupHistoryTableProps) {
  const [backups, setBackups] = useState<StoredBackupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchBackups = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/backup');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch backups.');
      }
      setBackups(data.backups || []);
    } catch (err: any) {
      setError(err.message || 'Error loading backups.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, [refreshTrigger]);

  const handleDelete = async (backupId: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this backup archive?')) {
      return;
    }

    try {
      setDeletingId(backupId);
      const res = await fetch(`/api/backup/${backupId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete backup.');
      }
      setBackups((prev) => prev.filter((b) => b.id !== backupId));
    } catch (err: any) {
      alert(err.message || 'Failed to delete backup.');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = backups.filter((b) => {
    const query = searchQuery.toLowerCase();
    return (
      b.fileName.toLowerCase().includes(query) ||
      b.manifest.scope.toLowerCase().includes(query) ||
      (b.manifest.siteName && b.manifest.siteName.toLowerCase().includes(query)) ||
      b.manifest.createdBy.username.toLowerCase().includes(query)
    );
  });

  return (
    <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-2xl p-5 shadow-sm space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-900/40 dark:border-[#2B2D31]">
        <div>
          <h2 className="text-base font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
            Backup Archives &amp; Disaster Recovery History
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#949BA4]">
            Managed storage of encrypted &amp; checksummed backup packages and pre-restore snapshots.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search archives..."
              className="pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] rounded-lg text-xs font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760]"
            />
          </div>

          <button
            onClick={fetchBackups}
            title="Refresh History"
            className="w-8 h-8 rounded-lg border border-slate-900 dark:border-[#4A4D52] bg-white dark:bg-[#202225] text-slate-700 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] flex items-center justify-center shadow-sm transition-colors"
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-600 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && backups.length === 0 ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-2">
          <Loader2 className="w-6 h-6 animate-spin text-slate-600 dark:text-[#1ED760]" />
          <div className="text-xs text-slate-500 font-medium">Scanning backup registry...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-xs text-slate-500 font-medium">
          {searchQuery ? 'No backups match your search filter.' : 'No backup archives created yet. Use the card above to generate a backup.'}
        </div>
      ) : (
        <div className="border border-slate-900 dark:border-[#3A3D42] rounded-xl overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] text-[10px] font-black uppercase text-slate-500 tracking-wider">
              <tr>
                <th className="p-3">Backup Target &amp; Scope</th>
                <th className="p-3">Period</th>
                <th className="p-3">Created</th>
                <th className="p-3">Size</th>
                <th className="p-3">Restorability</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 dark:divide-[#3A3D42]">
              {filtered.map((b) => {
                const isRestorable = b.manifest.restorableAsDatabase;
                const isSystem = b.manifest.scope === 'SYSTEM';

                return (
                  <tr key={b.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                    <td className="p-3">
                      <div className="flex items-center space-x-2">
                        {isSystem ? (
                          <Database className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        ) : (
                          <Layers className="w-4 h-4 text-emerald-600 dark:text-[#1ED760] shrink-0" />
                        )}
                        <div>
                          <div className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                            {isSystem ? 'System Complete' : b.manifest.siteName || 'Site Archive'}
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 truncate max-w-[200px]">
                            {b.fileName}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="space-y-1">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#2B2D31] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-[#3A3D42] inline-block">
                          {b.manifest.periodPreset}
                        </span>
                        <div className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-tight">
                          {isRestorable ? 'SYSTEM_RECOVERY' : (isSystem ? 'SYSTEM_LOGICAL' : 'SITE_LOGICAL')}
                        </div>
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="text-slate-800 dark:text-slate-200 font-medium">
                        {new Date(b.createdAt).toLocaleDateString()}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        by {b.manifest.createdBy.username}
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="font-mono font-bold text-slate-700 dark:text-slate-300">
                        {b.sizeFormatted}
                      </div>
                      <div className="flex items-center space-x-1 text-[9px] text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                        <span>SHA-256</span>
                      </div>
                    </td>

                    <td className="p-3">
                      <div className="flex flex-col space-y-1">
                        {b.isPreRestoreBackup && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-300 dark:border-purple-800 w-fit">
                            Safety Snapshot
                          </span>
                        )}
                        {isRestorable ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800 flex items-center space-x-1 w-fit">
                            <ShieldCheck className="w-3 h-3" />
                            <span>Restorable DB</span>
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 dark:bg-[#202225] dark:text-slate-400 border border-slate-200 dark:border-[#3A3D42] w-fit">
                            Logical Archive
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end space-x-1.5">
                        {/* Download Button */}
                        <a
                          href={`/api/backup/${b.id}`}
                          download={b.fileName}
                          title="Download Backup Archive"
                          className="w-8 h-8 rounded-lg border border-slate-900 dark:border-[#4A4D52] bg-white dark:bg-[#202225] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#2B2D31] flex items-center justify-center transition-colors shadow-sm"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>

                        {/* Inspect Button */}
                        <button
                          onClick={() => {
                            if (onInspectBackup) {
                              onInspectBackup(b.id);
                            } else if (onInitiateRestore) {
                              onInitiateRestore(b.id);
                            }
                          }}
                          title="Inspect Package Structure & Manifest"
                          className="px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600 text-white text-[11px] font-black uppercase tracking-wider flex items-center space-x-1 shadow-sm transition-colors"
                        >
                          <Search className="w-3 h-3" />
                          <span>Inspect</span>
                        </button>

                        {/* Delete Button (Admin only) */}
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(b.id)}
                            disabled={deletingId === b.id}
                            title="Delete Backup File"
                            className="w-8 h-8 rounded-lg border border-slate-900 dark:border-[#4A4D52] bg-white dark:bg-[#202225] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 flex items-center justify-center transition-colors shadow-sm disabled:opacity-50"
                          >
                            {deletingId === b.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
