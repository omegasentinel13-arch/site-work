'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  Shield, 
  Clock, 
  User, 
  Building2, 
  Layers, 
  Activity, 
  FileCode, 
  GitCompare, 
  Info,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Loader2,
  Check
} from 'lucide-react';
import { SafeAuditLogItem } from '@/lib/db/repositories/audit-repo';

interface AuditDetailModalProps {
  item: SafeAuditLogItem | null;
  canRestore?: boolean;
  onRestoreSuccess?: () => void;
  onClose: () => void;
}

type TabType = 'OVERVIEW' | 'DIFF' | 'RAW';

export function AuditDetailModal({ item, canRestore = false, onRestoreSuccess, onClose }: AuditDetailModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>('OVERVIEW');
  const [showRestoreConfirm, setShowRestoreConfirm] = useState<boolean>(false);
  const [restoreLoading, setRestoreLoading] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (!item) return;

    // Reset tab to overview on new item
    setActiveTab('OVERVIEW');
    setShowRestoreConfirm(false);
    setRestoreError(null);
    setRestoreSuccess(false);
    setRestoreLoading(false);

    // Body scroll lock
    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Escape dismissal
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [item, onClose]);

  if (!item) return null;

  const beforeObj = (item.metadata?.before && typeof item.metadata.before === 'object') ? item.metadata.before : null;
  const afterObj = (item.metadata?.after && typeof item.metadata.after === 'object') ? item.metadata.after : null;

  const hasBefore = beforeObj !== null && Object.keys(beforeObj).length > 0;
  const hasAfter = afterObj !== null && Object.keys(afterObj).length > 0;
  const hasDiff = hasBefore || hasAfter;

  // Compute all unique keys present in before or after states
  const allKeys = Array.from(new Set([
    ...(beforeObj ? Object.keys(beforeObj) : []),
    ...(afterObj ? Object.keys(afterObj) : [])
  ]));

  const handleExecuteRestore = async () => {
    if (!item || !item.recovery || !item.recovery.isEligible) return;
    setRestoreLoading(true);
    setRestoreError(null);
    try {
      const res = await fetch('/api/lifecycle/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entityType: item.recovery.entityType,
          entityId: item.recovery.entityId,
          source: 'AUDIT_TRAIL',
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to restore entity');
      }

      setRestoreSuccess(true);
      setTimeout(() => {
        if (onRestoreSuccess) onRestoreSuccess();
      }, 1200);
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : 'Failed to restore entity');
    } finally {
      setRestoreLoading(false);
    }
  };

  const isPermanentlyDeleted = item.action.includes('PERMANENTLY_DELETED');
  const recoveryInfo = item.recovery;

  const modalContent = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-detail-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto"
    >
      {/* Dark translucent backdrop with blur */}
      <div
        data-testid="modal-backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm transition-opacity"
      />

      {/* Modal Dialog Card */}
      <div className="relative w-full max-w-3xl bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-xl sm:rounded-2xl shadow-2xl z-10 flex flex-col max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Canonical Inverted Section Header */}
        <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 sm:px-6 py-4 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
              <Shield className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2
                id="audit-detail-title"
                className="text-base sm:text-lg font-black tracking-tight text-white leading-tight"
              >
                AUDIT EVENT INSPECTOR
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-300 dark:text-zinc-400 font-mono">
                Event ID: <span className="text-white font-bold">{item.id}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-11 h-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation Strip */}
        <div className="flex items-center gap-1 px-4 sm:px-6 pt-3 pb-2 border-b border-slate-200 dark:border-[#2D3035] bg-slate-50/50 dark:bg-[#151619] shrink-0 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('OVERVIEW')}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all touch-action-manipulation ${
              activeTab === 'OVERVIEW'
                ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-200/60 dark:hover:bg-[#222428]'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            <span>Event Overview</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('DIFF')}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all touch-action-manipulation ${
              activeTab === 'DIFF'
                ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-200/60 dark:hover:bg-[#222428]'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>State Diff</span>
            {hasDiff && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('RAW')}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all touch-action-manipulation ${
              activeTab === 'RAW'
                ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-200/60 dark:hover:bg-[#222428]'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Sanitized Payload</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-xs sm:text-sm">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'OVERVIEW' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 bg-slate-50 dark:bg-[#111214] p-4 rounded-xl border border-slate-200/80 dark:border-[#2D3035]">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
                    Activity
                  </span>
                  <p className="font-bold text-slate-900 dark:text-white text-sm">
                    {item.actionDisplay || item.action}
                  </p>
                  <p className="text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                    {item.action}
                  </p>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
                    Recorded Timestamp
                  </span>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {item.timestamp}
                  </p>
                  <span className="inline-block text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                    UTC Recorded
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
                    Actor Identity
                  </span>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {item.actor?.name || 'System / Unauthenticated'}
                  </p>
                  <div className="flex items-center gap-2">
                    {item.actor?.role && (
                      <span className="inline-block text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-200 dark:bg-[#2A2D32] text-slate-700 dark:text-zinc-300">
                        {item.actor.role}
                      </span>
                    )}
                    {item.actor?.id && (
                      <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                        {item.actor.id}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
                    Site Authorization Scope
                  </span>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {item.site?.name || 'Global (System-Wide)'}
                  </p>
                  <span className="inline-block text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                    {item.site?.id ? `ID: ${item.site.id}` : 'Platform Scope'}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500" />
                    Module &amp; Entity Type
                  </span>
                  <p className="font-bold text-slate-900 dark:text-white">
                    {item.module}
                  </p>
                  <span className="inline-block text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                    Entity: {item.entityType}
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                    Target Entity / Resource
                  </span>
                  <p className="font-bold text-slate-900 dark:text-white break-words">
                    {item.entityName || item.entityId || '—'}
                  </p>
                  <span className="inline-block text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                    ID: {item.entityId}
                  </span>
                </div>
              </div>

              {/* Controlled Recovery & Lifecycle Status Card */}
              {recoveryInfo && recoveryInfo.isEligible ? (
                <div className="p-4 rounded-xl bg-amber-500/10 dark:bg-amber-500/10 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <RotateCcw className="w-4 h-4" />
                      Recovery Available ({recoveryInfo.currentState})
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                      Eligible for Restore
                    </span>
                  </div>
                  <p className="text-xs text-amber-950 dark:text-amber-200 leading-relaxed">
                    This entity is currently held in the {recoveryInfo.currentState === 'ARCHIVED' ? 'System Archive' : 'Recycle Bin'}. Authorized administrators can restore it back to <span className="font-semibold">{recoveryInfo.restoreDestination}</span>.
                  </p>
                  <div className="text-[11px] font-mono text-amber-800/80 dark:text-amber-300/80 flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-amber-500/20">
                    <span>Source: {recoveryInfo.sourceModule}</span>
                    <span>Target: {recoveryInfo.restoreDestination}</span>
                  </div>
                </div>
              ) : isPermanentlyDeleted ? (
                <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700 dark:text-rose-400">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    Permanent Deletion
                  </div>
                  <p className="text-xs text-rose-800 dark:text-rose-300 leading-relaxed">
                    Permanent deletion cannot be reversed from Audit Trail. This resource was permanently purged in accordance with data governance policies.
                  </p>
                </div>
              ) : null}

              {/* Forensic Guarantees Notice */}
              <div className="bg-slate-100/70 dark:bg-[#141517] p-3 rounded-lg border border-slate-200/60 dark:border-[#2B2D31] text-[11px] text-slate-600 dark:text-zinc-400 flex items-start gap-2">
                <Shield className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <p>
                  This record is cryptographically committed to the append-only audit trail. Historical entries cannot be modified or deleted.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: STATE DIFF */}
          {activeTab === 'DIFF' && (
            <div className="space-y-3">
              {!hasDiff ? (
                <div className="text-center py-8 bg-slate-50 dark:bg-[#111214] rounded-xl border border-slate-200 dark:border-[#2D3035] p-6 space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="font-bold text-slate-800 dark:text-zinc-200 text-sm">
                    No Mutation Payload
                  </p>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-md mx-auto">
                    This event represents a point-in-time notification, access check, or operation without recorded property changes.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-xs text-slate-500 dark:text-zinc-400 pb-1">
                    Comparing changed properties before and after this event execution:
                  </div>

                  <div className="border border-slate-200 dark:border-[#2D3035] rounded-xl overflow-hidden divide-y divide-slate-200 dark:divide-[#2D3035]">
                    {allKeys.map((key) => {
                      const beforeVal = beforeObj ? beforeObj[key] : undefined;
                      const afterVal = afterObj ? afterObj[key] : undefined;
                      const isChanged = JSON.stringify(beforeVal) !== JSON.stringify(afterVal);

                      return (
                        <div key={key} className="p-3 bg-white dark:bg-[#151619] hover:bg-slate-50/50 dark:hover:bg-[#1a1c20] transition-colors">
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="font-mono font-bold text-xs text-slate-800 dark:text-zinc-200">
                              {key}
                            </span>
                            {isChanged ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300">
                                Modified
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400">
                                Unchanged
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                            <div className="p-2 rounded bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 overflow-x-auto">
                              <span className="text-[10px] uppercase font-bold text-rose-600 dark:text-rose-400 block mb-0.5">
                                Before:
                              </span>
                              <span className="text-rose-900 dark:text-rose-200 break-all">
                                {beforeVal !== undefined ? JSON.stringify(beforeVal) : '<none>'}
                              </span>
                            </div>

                            <div className="p-2 rounded bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 overflow-x-auto">
                              <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block mb-0.5">
                                After:
                              </span>
                              <span className="text-emerald-900 dark:text-emerald-200 break-all">
                                {afterVal !== undefined ? JSON.stringify(afterVal) : '<none>'}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SANITIZED RAW PAYLOAD */}
          {activeTab === 'RAW' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">
                  Sanitized Audit Payload (Redacted)
                </span>
                <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Shield className="w-3.5 h-3.5" />
                  Secrets Scrubbed
                </span>
              </div>

              <pre className="p-4 bg-slate-900 text-slate-100 dark:bg-[#111214] dark:text-zinc-200 rounded-xl border border-slate-800 dark:border-[#2D3035] text-[11px] font-mono overflow-x-auto max-h-72 leading-relaxed selection:bg-emerald-500 selection:text-black">
                {JSON.stringify(
                  {
                    id: item.id,
                    timestamp: item.timestamp,
                    action: item.action,
                    actionDisplay: item.actionDisplay,
                    module: item.module,
                    entityType: item.entityType,
                    entityId: item.entityId,
                    entityName: item.entityName,
                    actor: item.actor,
                    site: item.site,
                    visibility: item.visibility,
                    metadata: item.metadata,
                  },
                  null,
                  2
                )}
              </pre>

              <p className="text-[11px] text-slate-500 dark:text-zinc-400 italic">
                * Note: Raw payloads undergo server-side redaction before delivery. Passwords, secret tokens, and sensitive cryptographic hashes are never returned over the wire.
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-100 dark:border-[#2D3035] bg-slate-50/60 dark:bg-[#151619] flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-slate-400 dark:text-zinc-500 font-mono hidden sm:inline">
            Status: Immutable Log Entry
          </span>

          <div className="flex items-center gap-2.5 justify-end">
            {/* Controlled Recovery Button */}
            {canRestore && recoveryInfo && recoveryInfo.isEligible && (
              <button
                type="button"
                onClick={() => setShowRestoreConfirm(true)}
                disabled={restoreLoading || restoreSuccess}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 touch-action-manipulation"
              >
                <RotateCcw className="w-4 h-4" />
                Restore / Recover
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-6 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-[#222428] dark:hover:bg-[#2e3035] text-white font-bold text-xs sm:text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
            >
              Close Inspector
            </button>
          </div>
        </div>

        {/* Confirmation Modal Overlay for Restore Action */}
        {showRestoreConfirm && recoveryInfo && (
          <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-white dark:bg-[#1c1d21] border border-slate-300 dark:border-[#3A3D42] rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <div className="bg-amber-600 dark:bg-amber-600/90 text-white px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <RotateCcw className="w-5 h-5 text-white" />
                  <h3 className="text-base font-black tracking-tight text-white">
                    CONFIRM CONTROLLED RESTORE
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRestoreConfirm(false)}
                  disabled={restoreLoading}
                  className="text-white/80 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4 text-xs">
                {restoreError && (
                  <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{restoreError}</span>
                  </div>
                )}

                {restoreSuccess ? (
                  <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                    <Check className="w-5 h-5 shrink-0 text-emerald-600" />
                    <span className="font-bold text-sm">Restored successfully! Updating log...</span>
                  </div>
                ) : (
                  <>
                    <p className="text-slate-700 dark:text-zinc-300 leading-relaxed">
                      You are about to restore this entity from its current lifecycle state back into active operational use.
                    </p>

                    <div className="bg-slate-50 dark:bg-[#141517] p-3.5 rounded-xl border border-slate-200 dark:border-[#2D3035] space-y-2 font-mono text-[11px]">
                      <div className="flex justify-between border-b border-slate-200 dark:border-[#24262b] pb-1.5">
                        <span className="text-slate-500 dark:text-zinc-400">Target Entity:</span>
                        <span className="font-bold text-slate-900 dark:text-white text-right max-w-[220px] truncate">
                          {recoveryInfo.entityName}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-slate-200 dark:border-[#24262b] pb-1.5">
                        <span className="text-slate-500 dark:text-zinc-400">Entity ID:</span>
                        <span className="text-slate-800 dark:text-zinc-200 text-right max-w-[220px] truncate">{recoveryInfo.entityId}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-200 dark:border-[#24262b] pb-1.5">
                        <span className="text-slate-500 dark:text-zinc-400">Type / Source:</span>
                        <span className="text-slate-800 dark:text-zinc-200">{recoveryInfo.entityType} ({recoveryInfo.sourceModule})</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-200 dark:border-[#24262b] pb-1.5">
                        <span className="text-slate-500 dark:text-zinc-400">Current State:</span>
                        <span className="font-bold text-amber-600 dark:text-amber-400">{recoveryInfo.currentState}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500 dark:text-zinc-400">Restore Destination:</span>
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 text-right max-w-[220px] truncate">
                          {recoveryInfo.restoreDestination}
                        </span>
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-100 dark:bg-[#141517] text-[11px] text-slate-600 dark:text-zinc-400 flex items-start gap-2">
                      <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      <span>
                        This action will be recorded in the append-only audit trail. Existing audit logs will not be altered.
                      </span>
                    </div>

                    <div className="pt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRestoreConfirm(false)}
                        disabled={restoreLoading}
                        className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-200 dark:border-[#3A3D42] font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-[#222428] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleExecuteRestore}
                        disabled={restoreLoading}
                        className="min-h-[40px] px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-2 shadow-sm disabled:opacity-50"
                      >
                        {restoreLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Restoring...
                          </>
                        ) : (
                          <>
                            <RotateCcw className="w-4 h-4" />
                            Confirm Restore
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : null;
}
