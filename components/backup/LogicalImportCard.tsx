'use client';

import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileCheck,
  ShieldCheck,
  AlertTriangle,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Layers,
  Info,
} from 'lucide-react';
import { AnalysisReport, RecoveryExecutionResult } from '@/lib/backup/import/types';
import { ConflictCenterCard } from './ConflictCenterCard';

interface LogicalImportCardProps {
  isAdmin: boolean;
  onRecoveryExecuted?: () => void;
}

export function LogicalImportCard({ isAdmin, onRecoveryExecuted }: LogicalImportCardProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [analysisReport, setAnalysisReport] = useState<AnalysisReport | null>(null);
  const [executionResult, setExecutionResult] = useState<RecoveryExecutionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setAnalysisReport(null);
      setExecutionResult(null);
      setErrorMessage(null);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedFile) return;
    setIsAnalyzing(true);
    setErrorMessage(null);
    setExecutionResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch('/api/backup/import/analyze', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to analyze backup package');
      }

      setAnalysisReport(data.report);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error analyzing package');
      setAnalysisReport(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExecuteRecovery = async () => {
    if (!analysisReport || !isAdmin) return;
    setIsExecuting(true);
    setErrorMessage(null);
    setShowConfirmModal(false);

    try {
      const res = await fetch('/api/backup/import/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: analysisReport }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to execute recovery');
      }

      setExecutionResult(data.result);
      if (onRecoveryExecuted) onRecoveryExecuted();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error executing recovery');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ───────────────────────────────────────────────────────────── */}
      {/* SAFETY BANNER                                                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-emerald-950/80 rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 text-white shadow-sm">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5 sm:mt-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-emerald-400">
              Zero-Data-Loss Safety Invariant
            </h3>
            <p className="text-xs text-slate-300 dark:text-zinc-400 mt-0.5">
              NO EXISTING DATA WILL BE OVERWRITTEN — ALL RECOVERIES ARE INSERT-ONLY.
              Incoming records with identical identities are verified; conflicting records are skipped to preserve active production data.
            </p>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 1. INGESTION & ANALYSIS PANEL                                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#33353A] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <UploadCloud className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
              INSPECTION &amp; RECOVERY SPACE
            </h3>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 dark:bg-[#2B2D31] border border-slate-700 dark:border-[#3A3D42] text-slate-300">
            SAFE RECOVERY
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <p className="text-xs text-slate-600 dark:text-[#949BA4]">
            Check a backup before recovery, review what it contains, and safely prepare it for restoration.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              accept=".zip"
              onChange={handleFileChange}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 dark:bg-[#202225] dark:hover:bg-[#2B2D31] text-slate-900 dark:text-white border border-slate-900 dark:border-[#3A3D42] transition-colors min-h-[44px]"
            >
              <UploadCloud className="w-4 h-4 text-emerald-500" />
              <span>{selectedFile ? selectedFile.name : 'Select Backup ZIP Package'}</span>
            </button>

            {selectedFile && (
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={isAnalyzing}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-all shadow-sm active:scale-95 min-h-[44px]"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Analyzing Package &amp; Dependencies...</span>
                  </>
                ) : (
                  <>
                    <FileCheck className="w-4 h-4" />
                    <span>Analyze Backup Package</span>
                  </>
                )}
              </button>
            )}
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 2. ANALYSIS REPORT & CLASSIFICATION COUNTERS                  */}
      {/* ───────────────────────────────────────────────────────────── */}
      {analysisReport && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            {/* Header */}
            <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#33353A] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-sky-400" />
                <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
                  Package Analysis: {analysisReport.packageId}
                </h4>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold">
                <span className="px-2 py-0.5 rounded bg-slate-800 dark:bg-[#2B2D31] text-slate-300 border border-slate-700 dark:border-[#3A3D42]">
                  Scope: {analysisReport.scope} {analysisReport.siteName ? `(${analysisReport.siteName})` : ''}
                </span>
                {analysisReport.isTampered ? (
                  <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    Tampered / Checksum Mismatch
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Checksums Validated
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 sm:p-5 space-y-5">
              {/* 5 Classifications Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {/* 1. Matched Exact */}
                <div className="bg-slate-50 dark:bg-[#202225] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42]">
                  <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Matched Exact
                  </div>
                  <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                    {analysisReport.totalMatchedExact}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Identical records
                  </div>
                </div>

                {/* 2. New Records */}
                <div className="bg-slate-50 dark:bg-[#202225] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42]">
                  <div className="text-[10px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400">
                    New Records
                  </div>
                  <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                    {analysisReport.totalNewRecords}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Ready to insert
                  </div>
                </div>

                {/* 3. Conflicts */}
                <div className="bg-slate-50 dark:bg-[#202225] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42]">
                  <div className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Conflicts
                  </div>
                  <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                    {analysisReport.totalConflicts}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Skipped (Keep active)
                  </div>
                </div>

                {/* 4. Dependency Blocked */}
                <div className="bg-slate-50 dark:bg-[#202225] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42]">
                  <div className="text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
                    Dependency Blocked
                  </div>
                  <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                    {analysisReport.totalDependencyBlocked}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Missing parent FK
                  </div>
                </div>

                {/* 5. Unresolved Historical */}
                <div className="bg-slate-50 dark:bg-[#202225] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42]">
                  <div className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400">
                    Historical
                  </div>
                  <div className="text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
                    {analysisReport.totalUnresolvedHistorical}
                  </div>
                  <div className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                    Historical reference
                  </div>
                </div>
              </div>

              {/* Table Analysis Summary Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-[#2B2D31]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-100 dark:bg-[#202225] text-slate-600 dark:text-zinc-400 font-bold uppercase tracking-wider">
                    <tr>
                      <th className="p-2.5">Table</th>
                      <th className="p-2.5">Incoming</th>
                      <th className="p-2.5 text-emerald-600">Matched Exact</th>
                      <th className="p-2.5 text-sky-600">New Records</th>
                      <th className="p-2.5 text-amber-600">Conflicts</th>
                      <th className="p-2.5 text-rose-600">Blocked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                    {analysisReport.tableSummaries.map((ts) => (
                      <tr key={ts.table}>
                        <td className="p-2.5 font-mono font-bold text-slate-900 dark:text-white">{ts.table}</td>
                        <td className="p-2.5 font-mono">{ts.totalIncoming}</td>
                        <td className="p-2.5 font-mono text-emerald-600 font-bold">{ts.matchedExact}</td>
                        <td className="p-2.5 font-mono text-sky-600 font-bold">{ts.newRecords}</td>
                        <td className="p-2.5 font-mono text-amber-600 font-bold">{ts.conflicts}</td>
                        <td className="p-2.5 font-mono text-rose-600 font-bold">{ts.dependencyBlocked}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Execute Recovery Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <div className="text-xs font-bold text-slate-600 dark:text-zinc-400">
                  {analysisReport.totalNewRecords === 0 ? (
                    <span className="text-slate-500">Database is up-to-date. No new records to insert.</span>
                  ) : (
                    <span>Ready to safely insert {analysisReport.totalNewRecords} new record{analysisReport.totalNewRecords > 1 ? 's' : ''}.</span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setShowConfirmModal(true)}
                  disabled={isExecuting || !isAdmin || analysisReport.isTampered || analysisReport.totalNewRecords === 0}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-all shadow-sm active:scale-95 min-h-[44px]"
                >
                  {isExecuting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Executing Safe Recovery...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" />
                      <span>Execute Safe Recovery ({analysisReport.totalNewRecords} Records)</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Conflict Center (If Conflicts Exist) */}
          {analysisReport.conflicts.length > 0 && (
            <ConflictCenterCard conflicts={analysisReport.conflicts} />
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 3. EXECUTION SUCCESS SUMMARY                                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      {executionResult && (
        <div className="p-4 rounded-xl sm:rounded-2xl border border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-black text-sm uppercase">
            <CheckCircle2 className="w-5 h-5" />
            <span>Recovery Executed Successfully</span>
          </div>
          <div className="text-xs text-slate-700 dark:text-zinc-300 space-y-1">
            <div>Operation ID: <code>{executionResult.operationId}</code></div>
            <div>Total Records Inserted: <strong>{executionResult.totalInserted}</strong></div>
            <div>Total Records Skipped: <strong>{executionResult.totalSkipped}</strong></div>
            <div>Quarantined Inactive Users: <strong>{executionResult.quarantinedUsersCount}</strong></div>
            <div>King Maker Prime Admin Protected: <strong>YES</strong></div>
            <div>Audit Log Event: <code>BACKUP_IMPORTED</code> (Log ID: <code>{executionResult.auditLogId}</code>)</div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 4. CONFIRMATION MODAL                                         */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showConfirmModal && analysisReport && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] max-w-lg w-full p-6 space-y-4 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-500 shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase text-slate-900 dark:text-white">
                  Confirm Safe Logical Recovery
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  Transactional INSERT-ONLY execution
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#33353A] space-y-2 text-xs text-slate-700 dark:text-zinc-300">
              <div className="font-bold text-slate-900 dark:text-white">Guaranteed Execution Safeguards:</div>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600 dark:text-zinc-400">
                <li><strong>{analysisReport.totalNewRecords}</strong> new records will be inserted.</li>
                <li><strong>{analysisReport.totalConflicts}</strong> conflicting records will be <strong>SKIPPED</strong>. Existing data remains unchanged.</li>
                <li>Zero passwords, recovery tokens, or secrets will be imported.</li>
                <li>Any new staff accounts will be quarantined in inactive state.</li>
                <li>Prime Administrator identity is immutable.</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteRecovery}
                className="px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white shadow-md active:scale-95"
              >
                Confirm &amp; Execute Recovery
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
