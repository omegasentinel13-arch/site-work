'use client';

import React, { useState } from 'react';
import { Archive, Download, CheckCircle2, AlertCircle, Loader2, FileSpreadsheet, FileText, Database, Layers } from 'lucide-react';
import { clsx } from 'clsx';
import { DatePicker } from '@/components/ui/DatePicker';
import { BackupScope } from '@/lib/backup/types';
import { PeriodPreset } from '@/lib/export/complete';

interface SiteOption {
  id: string;
  name: string;
  code?: string | null;
}

interface BackupCreateCardProps {
  isAdmin: boolean;
  sites: SiteOption[];
  onBackupCreated?: () => void;
}

export function BackupCreateCard({ isAdmin, sites, onBackupCreated }: BackupCreateCardProps) {
  const [scope, setScope] = useState<BackupScope>(isAdmin ? 'SYSTEM' : 'SITE');
  const [siteId, setSiteId] = useState<string>(sites[0]?.id || '');
  const [period, setPeriod] = useState<PeriodPreset>('ALL_DATA');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdBackup, setCreatedBackup] = useState<{
    backupId: string;
    fileName: string;
    sizeBytes: number;
    zipSha256: string;
    manifest: any;
  } | null>(null);

  const handleCreate = async () => {
    if (loading) return;
    try {
      setLoading(true);
      setError(null);
      setCreatedBackup(null);

      if (scope === 'SITE' && !siteId) {
        throw new Error('Please select a project site.');
      }

      if (period === 'CUSTOM') {
        if (!from || !to) {
          throw new Error('Please provide both Start and End dates for custom range.');
        }
        if (from > to) {
          throw new Error('Start date cannot be later than End date.');
        }
      }

      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope,
          siteId: scope === 'SITE' ? siteId : undefined,
          period,
          from: period === 'CUSTOM' ? from : undefined,
          to: period === 'CUSTOM' ? to : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate backup.');
      }

      setCreatedBackup(data.backup);
      if (onBackupCreated) {
        onBackupCreated();
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const isRestorableDb = scope === 'SYSTEM' && period === 'ALL_DATA';

  return (
    <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-2xl p-5 shadow-sm space-y-5">
      <div className="flex items-center space-x-3 pb-3 border-b border-slate-900/40 dark:border-[#2B2D31]">
        <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-[#202225] border border-slate-800 dark:border-[#4A4D52] flex items-center justify-center text-amber-400 dark:text-[#1ED760] shadow-sm">
          <Archive className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-base font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
            Create Enterprise Backup Archive
          </h2>
          <p className="text-xs text-slate-500 dark:text-[#949BA4]">
            Generate cryptographically verified snapshots with manifest, checksums, reports, and isolated datasets.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-600 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {createdBackup && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-500/50 rounded-xl space-y-3">
          <div className="flex items-center space-x-2 text-emerald-800 dark:text-emerald-300">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span className="text-sm font-bold">Backup Generated Successfully!</span>
          </div>
          <div className="text-xs space-y-1 font-mono text-slate-700 dark:text-slate-300">
            <div><span className="font-bold">File:</span> {createdBackup.fileName}</div>
            <div><span className="font-bold">ID:</span> {createdBackup.backupId}</div>
            <div><span className="font-bold">Size:</span> {(createdBackup.sizeBytes / (1024 * 1024)).toFixed(2)} MB</div>
            <div className="truncate"><span className="font-bold">SHA-256:</span> {createdBackup.zipSha256}</div>
          </div>
          <div className="flex items-center space-x-3 pt-2">
            <a
              href={`/api/backup/${createdBackup.backupId}`}
              download={createdBackup.fileName}
              className="px-4 py-2 bg-emerald-600 dark:bg-[#1ED760] text-white dark:text-slate-950 rounded-lg text-xs font-black uppercase tracking-wide flex items-center space-x-2 hover:bg-emerald-700 dark:hover:bg-[#1bb952] transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" />
              <span>Download Archive (.ZIP)</span>
            </a>
            <button
              onClick={() => setCreatedBackup(null)}
              className="px-3 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Scope Selection */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
            1. Backup Scope
          </label>
          <div className="grid grid-cols-2 gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => setScope('SYSTEM')}
                className={clsx(
                  'p-3 rounded-xl border text-left flex flex-col justify-between transition-all min-h-[70px]',
                  scope === 'SYSTEM'
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-[#1ED760] dark:bg-[rgba(30,215,96,0.12)] dark:text-[#1ED760] shadow-sm'
                    : 'border-slate-900 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#202225] text-slate-700 dark:text-slate-300 hover:border-slate-700'
                )}
              >
                <div className="flex items-center space-x-1.5">
                  <Database className="w-4 h-4" />
                  <span className="text-xs font-black uppercase">System-Wide</span>
                </div>
                <span className="text-[10px] opacity-80 mt-1">All sites & full database</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setScope('SITE')}
              className={clsx(
                'p-3 rounded-xl border text-left flex flex-col justify-between transition-all min-h-[70px]',
                scope === 'SITE'
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-[#1ED760] dark:bg-[rgba(30,215,96,0.12)] dark:text-[#1ED760] shadow-sm'
                  : 'border-slate-900 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#202225] text-slate-700 dark:text-slate-300 hover:border-slate-700',
                !isAdmin && 'col-span-2'
              )}
            >
              <div className="flex items-center space-x-1.5">
                <Layers className="w-4 h-4" />
                <span className="text-xs font-black uppercase">Site-Scoped</span>
              </div>
              <span className="text-[10px] opacity-80 mt-1">Isolated site datasets & reports</span>
            </button>
          </div>

          {scope === 'SITE' && (
            <div className="pt-2">
              <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block mb-1">
                Target Project Site
              </label>
              <select
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] rounded-xl text-xs font-bold text-slate-900 dark:text-[#F2F3F5] focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760]"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.code ? `(${s.code})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Period Selection */}
        <div className="space-y-2">
          <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
            2. Historical Period
          </label>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodPreset)}
            className="w-full px-3 py-2.5 bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] rounded-xl text-xs font-bold text-slate-900 dark:text-[#F2F3F5] focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760]"
          >
            <option value="ALL_DATA">All Historical Data (Complete Snapshot)</option>
            <option value="THIS_MONTH">This Month</option>
            <option value="LAST_MONTH">Last Month</option>
            <option value="THIS_YEAR">This Year</option>
            <option value="CUSTOM">Custom Date Window</option>
          </select>

          {period === 'CUSTOM' && (
            <div className="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">From</span>
                <DatePicker
                  value={from}
                  onChange={(val) => setFrom(val)}
                  aria-label="Backup Range From Date"
                  variant="full"
                />
              </div>
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">To</span>
                <DatePicker
                  value={to}
                  onChange={(val) => setTo(val)}
                  aria-label="Backup Range To Date"
                  variant="full"
                />
              </div>
            </div>
          )}

          {/* Formats info */}
          <div className="pt-2">
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 block mb-1">
              Recovery Archive Format:
            </span>
            <div className="text-xs text-slate-700 dark:text-slate-300 font-medium">
              Pure recovery archive containing validated JSON datasets, SHA-256 checksum catalog, and manifest.{isRestorableDb ? ' Includes standalone SQLite snapshot for complete disaster recovery.' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* Invariant Explanation Banner */}
      <div
        className={clsx(
          'p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-xs flex items-start space-x-2',
          isRestorableDb
            ? 'bg-blue-50/60 text-blue-950 dark:bg-blue-950/20 dark:text-blue-300'
            : 'bg-slate-100 text-slate-700 dark:bg-[#202225] dark:text-slate-300'
        )}
      >
        <div className="shrink-0 mt-0.5">
          {isRestorableDb ? (
            <Database className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          ) : (
            <Layers className="w-4 h-4 text-slate-500" />
          )}
        </div>
        <div>
          <span className="font-bold">
            {isRestorableDb
              ? 'Full Disaster Recovery Candidate (Restorable DB):'
              : 'Audit & Logical Dataset Archive:'}
          </span>{' '}
          {isRestorableDb
            ? 'This configuration generates a native SQLite standalone snapshot (site_work.db) with WAL merged into memory and secrets scrubbed. It is eligible for atomic disaster recovery restoration.'
            : scope === 'SITE'
            ? 'Strict Site Isolation Active: Includes JSON tables for Attendance, Financial Transactions, Utilized Roles, Categories, Rates, Supply Items, Lifecycle, and Site Audit Trail. SQLite binary database is excluded to prevent data leakage.'
            : 'Date-scoped system archive contains complete JSON entity tables and audit logs. Full database restore requires "All Historical Data" to ensure referential integrity.'}
        </div>
      </div>

      {/* Pre-Creation Package Specification Box */}
      <div className="bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-900/30 dark:border-[#2B2D31] pb-2">
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Pre-Creation Package Specification
          </span>
          <span className={clsx(
            'px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider',
            isRestorableDb
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
              : 'bg-slate-200 text-slate-800 dark:bg-[#2B2D31] dark:text-slate-300 border border-slate-900 dark:border-[#3A3D42]'
          )}>
            {isRestorableDb ? 'SYSTEM_RECOVERY_BACKUP' : (scope === 'SITE' ? 'SITE_LOGICAL_BACKUP' : 'SYSTEM_LOGICAL_BACKUP')}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Scope Target</div>
            <div className="font-bold text-slate-900 dark:text-[#F2F3F5] truncate">
              {scope === 'SYSTEM' ? 'Entire System (All Sites)' : (sites.find((s) => s.id === siteId)?.name || 'Selected Site')}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Period Window</div>
            <div className="font-bold text-slate-900 dark:text-[#F2F3F5]">
              {period === 'ALL_DATA' ? 'All Historical Data' : period}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Database Restore</div>
            <div className={clsx(
              'font-black',
              isRestorableDb ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
            )}>
              {isRestorableDb ? 'ELIGIBLE (YES)' : 'INELIGIBLE (NO)'}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-slate-500 uppercase">Included Formats</div>
            <div className="font-semibold text-slate-700 dark:text-slate-300 truncate">
              {[
                isRestorableDb ? 'SQLite DB' : null,
                'JSON Datasets',
                'SHA-256',
              ].filter(Boolean).join(' + ')}
            </div>
          </div>
        </div>
      </div>

      <div className="pt-2 flex justify-end">
        <button
          type="button"
          onClick={handleCreate}
          disabled={loading}
          className="px-6 py-3 bg-slate-900 dark:bg-[#1ED760] text-white dark:text-slate-950 rounded-xl text-xs font-black uppercase tracking-wider flex items-center space-x-2 hover:bg-slate-800 dark:hover:bg-[#1bb952] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed hit-target-44"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Packaging Secure Archive...</span>
            </>
          ) : (
            <>
              <Archive className="w-4 h-4" />
              <span>Generate Enterprise Backup</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
