'use client';

import React, { useState } from 'react';
import { useSite } from '@/context/site-context';
import { Shield, ShieldAlert, Archive, Database, History } from 'lucide-react';
import { RecoveryStatusBanner } from '@/components/backup/RecoveryStatusBanner';
import { BackupCreateCard } from '@/components/backup/BackupCreateCard';
import { BackupHistoryTable } from '@/components/backup/BackupHistoryTable';
import { BackupUploadZone } from '@/components/backup/BackupUploadZone';
import { RestoreModal } from '@/components/backup/RestoreModal';

export default function BackupAdminPage() {
  const { user, sites } = useSite();
  const isAdmin = user?.role === 'ADMIN';
  const isViewer = user?.role === 'VIEWER';

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [restoreCandidate, setRestoreCandidate] = useState<{
    backupId?: string | null;
    uploadedFile?: File | null;
  } | null>(null);

  if (isViewer) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
          Access Denied
        </h1>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          Viewer accounts are not permitted to access or generate enterprise backups, restore operations, or disaster recovery systems.
        </p>
      </div>
    );
  }

  const triggerRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Page Title & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-[#2B2D31] pb-4">
        <div>
          <div className="flex items-center space-x-2 text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider mb-1">
            <span>Enterprise Disaster Recovery</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-[#F2F3F5]">Backup &amp; Restore Center</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black uppercase text-slate-900 dark:text-[#F2F3F5] tracking-tight flex items-center space-x-2">
            <Shield className="w-6 h-6 text-amber-500 dark:text-[#1ED760]" />
            <span>Enterprise Backup &amp; Controlled Restore System</span>
          </h1>
        </div>
      </div>

      {/* 1. Recovery Engine & Lock Status Banner */}
      <RecoveryStatusBanner isAdmin={isAdmin} />

      {/* 2. Create Backup Section */}
      <BackupCreateCard
        isAdmin={isAdmin}
        sites={sites}
        onBackupCreated={triggerRefresh}
      />

      {/* 3. External Archive Upload & Sandbox Verification (Admin only) */}
      {isAdmin && (
        <BackupUploadZone
          isAdmin={isAdmin}
          onInitiateRestore={(file) => {
            setRestoreCandidate({ uploadedFile: file });
          }}
        />
      )}

      {/* 4. Backup Archives & History Table */}
      <BackupHistoryTable
        isAdmin={isAdmin}
        refreshTrigger={refreshTrigger}
        onInitiateRestore={(backupId) => {
          setRestoreCandidate({ backupId });
        }}
      />

      {/* 5. Controlled Disaster Recovery Restoration Wizard Modal */}
      {restoreCandidate && (
        <RestoreModal
          backupId={restoreCandidate.backupId}
          uploadedFile={restoreCandidate.uploadedFile}
          onClose={() => setRestoreCandidate(null)}
          onRestoreComplete={() => {
            setRestoreCandidate(null);
            triggerRefresh();
          }}
        />
      )}
    </div>
  );
}
