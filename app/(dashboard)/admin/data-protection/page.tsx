'use client';

import React, { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSite } from '@/context/site-context';
import {
  Shield,
  ShieldAlert,
  FileText,
  Database,
  History,
} from 'lucide-react';
import { clsx } from 'clsx';

// Domain 1: Reusable Report Center component
import { ReportCenterSection } from '@/components/reports/ReportCenterSection';

// Domain 2: Existing modular Backup & Recovery components
import { RecoveryStatusBanner } from '@/components/backup/RecoveryStatusBanner';
import { BackupCreateCard } from '@/components/backup/BackupCreateCard';
import { BackupHistoryTable } from '@/components/backup/BackupHistoryTable';
import { PackageInspectorCard } from '@/components/packages/PackageInspectorCard';
import { LogicalImportCard } from '@/components/backup/LogicalImportCard';
import { RecoveryHistoryTable } from '@/components/backup/RecoveryHistoryTable';

function DataProtectionCenterContent() {
  const { user, sites } = useSite();
  const isAdmin = user?.role === 'ADMIN';
  const isViewer = user?.role === 'VIEWER';
  const searchParams = useSearchParams();

  const tabParam = searchParams?.get('tab');
  const [activeDomain, setActiveDomain] = useState<'reports' | 'backup' | 'history'>(
    tabParam === 'backup' ? 'backup' : tabParam === 'history' ? 'history' : 'reports'
  );

  const handleTabChange = (domain: 'reports' | 'backup' | 'history') => {
    setActiveDomain(domain);
    const newUrl = domain === 'backup' ? '?tab=backup' : domain === 'history' ? '?tab=history' : '?tab=reports';
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', newUrl);
    }
  };

  // State for Backup & Recovery operations
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [inspectedBackupId, setInspectedBackupId] = useState<string | null>(null);

  const triggerRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  // RBAC guard: VIEWER role is blocked
  if (isViewer) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
          Access Denied
        </h1>
        <p className="text-xs text-slate-500 dark:text-[#949BA4] max-w-md mx-auto">
          Viewer accounts are not permitted to access or configure enterprise reports, backup, recovery, or package operations.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-3 sm:p-6 lg:p-8 pb-16">
      {/* HEADER & HERO */}
      <div className="space-y-4 border-b border-slate-200 dark:border-[#2B2D31] pb-5">
        <div className="flex items-center space-x-2 text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider">
          <span>Enterprise Governance</span>
          <span>/</span>
          <span className="text-slate-900 dark:text-[#F2F3F5]">Command Center</span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-slate-900 dark:bg-[#202225] border border-slate-800 dark:border-[#4A4D52] flex items-center justify-center text-amber-400 dark:text-[#1ED760] shadow-sm shrink-0">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-black uppercase text-slate-900 dark:text-[#F2F3F5] tracking-tight">
                REPORTS &amp; BACKUP COMMAND CENTER
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-[#949BA4]">
                Enterprise reporting engine, disaster recovery snapshots, and non-destructive package inspection
              </p>
            </div>
          </div>
        </div>

        {/* DOMAIN SWITCHER TABS */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-[#2B2D31] overflow-x-auto scrollbar-none pb-1 max-w-full">
          <button
            type="button"
            onClick={() => handleTabChange('reports')}
            className={clsx(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all border shadow-sm",
              activeDomain === 'reports'
                ? "bg-sky-600 text-white border-sky-600 dark:bg-sky-500 dark:border-sky-500 shadow-sky-500/20"
                : "bg-white dark:bg-[#202225] text-slate-700 dark:text-[#949BA4] border-slate-900 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#2B2D31]"
            )}
          >
            <FileText className="w-4 h-4" />
            <span>Report Center</span>
            <span className={clsx(
              "ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black",
              activeDomain === 'reports'
                ? "bg-white/20 text-white"
                : "bg-slate-100 dark:bg-[#2B2D31] text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-[#3A3D42]"
            )}>
              11 Reports
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('backup')}
            className={clsx(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all border shadow-sm",
              activeDomain === 'backup'
                ? "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500 shadow-emerald-500/20"
                : "bg-white dark:bg-[#202225] text-slate-700 dark:text-[#949BA4] border-slate-900 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#2B2D31]"
            )}
          >
            <Database className="w-4 h-4" />
            <span>Backup &amp; Recovery Center</span>
            <span className={clsx(
              "ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black",
              activeDomain === 'backup'
                ? "bg-white/20 text-white"
                : "bg-slate-100 dark:bg-[#2B2D31] text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-[#3A3D42]"
            )}>
              Disaster Recovery
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('history')}
            className={clsx(
              "flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all border shadow-sm",
              activeDomain === 'history'
                ? "bg-purple-600 text-white border-purple-600 dark:bg-purple-500 dark:border-purple-500 shadow-purple-500/20"
                : "bg-white dark:bg-[#202225] text-slate-700 dark:text-[#949BA4] border-slate-900 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#2B2D31]"
            )}
          >
            <History className="w-4 h-4" />
            <span>Recovery History</span>
            <span className={clsx(
              "ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-black",
              activeDomain === 'history'
                ? "bg-white/20 text-white"
                : "bg-slate-100 dark:bg-[#2B2D31] text-slate-600 dark:text-slate-300 border border-slate-300 dark:border-[#3A3D42]"
            )}>
              Audit Ledger
            </span>
          </button>
        </div>
      </div>

      {/* DOMAIN 1: REPORT CENTER */}
      {activeDomain === 'reports' && (
        <section aria-label="Report Center">
          <ReportCenterSection />
        </section>
      )}

      {/* DOMAIN 2: BACKUP & RECOVERY CENTER */}
      {activeDomain === 'backup' && (
        <section className="space-y-6" aria-label="Backup and Recovery Center">
          {/* Recovery Engine & Lock Status Banner */}
          <RecoveryStatusBanner isAdmin={isAdmin} />

          {/* Logical Backup Ingestion & Non-Destructive Recovery Card */}
          <LogicalImportCard
            isAdmin={isAdmin}
            onRecoveryExecuted={triggerRefresh}
          />

          {/* Create Backup Section */}
          <BackupCreateCard
            isAdmin={isAdmin}
            sites={sites}
            onBackupCreated={triggerRefresh}
          />

          {/* Backup Archives & History Table */}
          <BackupHistoryTable
            isAdmin={isAdmin}
            refreshTrigger={refreshTrigger}
            onInspectBackup={(backupId) => {
              setInspectedBackupId(backupId);
              if (typeof window !== 'undefined') {
                const elem = document.getElementById('package-inspector-card');
                if (elem) elem.scrollIntoView({ behavior: 'smooth' });
              }
            }}
          />

          {/* Reusable Package Inspector component */}
          <div id="package-inspector-card">
            <PackageInspectorCard
              hideHeaderBanner={false}
              title="PACKAGE INSPECTOR"
              subtitle="Inspection & Safe Preview Only — Verify package structure, checksums, and dataset counts"
              inspectBackupId={inspectedBackupId}
              onClearInspectBackupId={() => setInspectedBackupId(null)}
            />
          </div>
        </section>
      )}

      {/* DOMAIN 3: RECOVERY HISTORY */}
      {activeDomain === 'history' && (
        <section className="space-y-6" aria-label="Recovery History">
          <RecoveryHistoryTable refreshTrigger={refreshTrigger} />
        </section>
      )}
    </div>
  );
}

export default function DataProtectionCenterPage() {
  return (
    <Suspense fallback={
      <div className="max-w-7xl mx-auto p-8 text-center text-slate-400 text-sm">
        Loading Reports &amp; Backup Command Center...
      </div>
    }>
      <DataProtectionCenterContent />
    </Suspense>
  );
}
