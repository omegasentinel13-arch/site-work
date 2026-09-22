'use client';

import React, { useState, useRef, useId, useEffect } from 'react';
import {
  PackageInspectionResult,
  PackageClassification,
  PackageAction,
} from '@/lib/packages/types';
import {
  inspectPackage,
  isPackageInspectionInProgress,
} from '@/lib/packages/client-package-inspector';
import {
  PackageSearch,
  UploadCloud,
  FileArchive,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  FileText,
  FileSpreadsheet,
  FileCode,
  Database,
  ShieldCheck,
  ShieldAlert,
  Info,
  Building2,
  Calendar,
  Layers,
  ArrowRight,
  RotateCcw,
} from 'lucide-react';
import { clsx } from 'clsx';

export interface PackageInspectorCardProps {
  className?: string;
  title?: string;
  subtitle?: string;
  hideHeaderBanner?: boolean;
  inspectBackupId?: string | null;
  onClearInspectBackupId?: () => void;
  onInspectionComplete?: (result: PackageInspectionResult) => void;
}

type InspectionState = 'IDLE' | 'FILE_SELECTED' | 'INSPECTING' | 'RESULT' | 'ERROR';

export function PackageInspectorCard({
  className,
  title = 'IMPORT & LOAD PACKAGE',
  subtitle = 'Inspection & Safe Preview Only',
  hideHeaderBanner = false,
  inspectBackupId,
  onClearInspectBackupId,
  onInspectionComplete,
}: PackageInspectorCardProps) {
  const [state, setState] = useState<InspectionState>('IDLE');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [clientValidationError, setClientValidationError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [inspectionResult, setInspectionResult] = useState<PackageInspectionResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  useEffect(() => {
    if (inspectBackupId) {
      handleInspectBackupId(inspectBackupId);
    }
  }, [inspectBackupId]);

  const handleInspectBackupId = async (backupId: string) => {
    setState('INSPECTING');
    setErrorMessage(null);
    setSelectedFile(null);
    setClientValidationError(null);

    try {
      const result = await inspectPackage({ backupId });
      setInspectionResult(result);
      setState('RESULT');
      if (onInspectionComplete) {
        onInspectionComplete(result);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during package inspection.');
      setState('ERROR');
    }
  };

  // Handle file selection from drag/drop or input
  const handleFileChoose = (file: File) => {
    setSelectedFile(file);
    setErrorMessage(null);
    setInspectionResult(null);

    // Client-side quick validation for UX only
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setClientValidationError('Selected file is not a .zip archive. Please provide a valid ZIP file.');
      setState('FILE_SELECTED');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setClientValidationError('Selected file exceeds maximum upload size (100 MB).');
      setState('FILE_SELECTED');
      return;
    }

    setClientValidationError(null);
    setState('FILE_SELECTED');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileChoose(e.dataTransfer.files[0]);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setClientValidationError(null);
    setInspectionResult(null);
    setErrorMessage(null);
    setState('IDLE');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (onClearInspectBackupId) {
      onClearInspectBackupId();
    }
  };

  const handleInspect = async () => {
    if (!selectedFile || clientValidationError || isPackageInspectionInProgress()) {
      return;
    }

    setState('INSPECTING');
    setErrorMessage(null);

    try {
      const result = await inspectPackage({ file: selectedFile });
      setInspectionResult(result);
      setState('RESULT');
      if (onInspectionComplete) {
        onInspectionComplete(result);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred during package inspection.');
      setState('ERROR');
    }
  };

  // Format file size
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div
      className={clsx(
        'bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-2xl p-5 sm:p-6 shadow-sm space-y-5',
        className
      )}
    >
      {/* 1. Header Banner (if not hidden) */}
      {!hideHeaderBanner && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-900/40 dark:border-[#2B2D31]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-900 dark:bg-[#202225] border border-slate-800 dark:border-[#4A4D52] flex items-center justify-center text-amber-400 dark:text-[#1ED760] shadow-sm shrink-0">
              <PackageSearch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black uppercase text-slate-900 dark:text-[#F2F3F5] tracking-wide">
                {title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#949BA4]">
                {subtitle}
              </p>
            </div>
          </div>
          {state !== 'IDLE' && state !== 'INSPECTING' && (
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[44px] px-3.5 py-2 text-xs font-bold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white border border-slate-900 dark:border-[#3A3D42] rounded-lg bg-slate-50 dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition flex items-center justify-center gap-1.5 self-start sm:self-auto"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Inspect Another</span>
            </button>
          )}
        </div>
      )}

      {/* 2. Safety Callout Banner */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border border-slate-900 dark:border-amber-800/40 rounded-xl p-3.5 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold">Inspection &amp; Safe Preview Only:</span>{' '}
          No database data is imported, restored, or modified during inspection. Upload any SITE WORK package to verify its structure, authenticity, and eligible safe actions.
        </div>
      </div>

      {/* 3. IDLE State: Upload Zone */}
      {state === 'IDLE' && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={clsx(
            'border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center min-h-[220px]',
            isDragOver
              ? 'border-slate-900 dark:border-white bg-slate-50 dark:bg-[#202225]'
              : 'border-slate-900 dark:border-[#3A3D42] hover:border-slate-700 dark:hover:border-slate-500 bg-slate-50/50 dark:bg-[#1E1F22]'
          )}
          onClick={() => fileInputRef.current?.click()}
          role="region"
          aria-label="Package ZIP upload drop zone"
        >
          <input
            id={fileInputId}
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleFileChoose(e.target.files[0]);
              }
            }}
          />

          <div className="w-14 h-14 rounded-2xl bg-white dark:bg-[#2B2D31] border border-slate-900 dark:border-[#3A3D42] flex items-center justify-center text-slate-700 dark:text-[#F2F3F5] mb-3.5 shadow-sm">
            <UploadCloud className="w-7 h-7" />
          </div>

          <p className="text-sm font-bold text-slate-900 dark:text-[#F2F3F5]">
            Drag &amp; drop package ZIP archive here
          </p>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-1 mb-4">
            Authoritative .zip packages up to 100 MB
          </p>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
            className="min-h-[44px] px-5 py-2.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs sm:text-sm font-bold hover:bg-slate-800 dark:hover:bg-slate-100 transition shadow-sm flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white"
          >
            <FileArchive className="w-4 h-4" />
            <span>Browse Files</span>
          </button>
        </div>
      )}

      {/* 4. FILE_SELECTED State */}
      {state === 'FILE_SELECTED' && selectedFile && (
        <div className="space-y-4">
          <div className="bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-white dark:bg-[#2B2D31] border border-slate-900 dark:border-[#4A4D52] flex items-center justify-center text-slate-700 dark:text-[#F2F3F5] shrink-0">
                <FileArchive className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-[#F2F3F5] truncate">
                  {selectedFile.name}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-[#949BA4]">
                  <span>{formatBytes(selectedFile.size)}</span>
                  <span>•</span>
                  <span className="uppercase font-semibold">ZIP Archive</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="min-h-[44px] px-3 text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white transition self-end sm:self-auto"
            >
              Change File
            </button>
          </div>

          {clientValidationError && (
            <div className="p-3.5 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-800 dark:text-rose-300 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <span>{clientValidationError}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[44px] px-4 py-2 text-xs sm:text-sm font-bold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white border border-slate-900 dark:border-[#3A3D42] rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!!clientValidationError}
              onClick={handleInspect}
              className={clsx(
                'min-h-[44px] px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2 shadow-sm',
                clientValidationError
                  ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-100'
              )}
            >
              <PackageSearch className="w-4 h-4" />
              <span>Inspect Package</span>
            </button>
          </div>
        </div>
      )}

      {/* 5. INSPECTING State */}
      {state === 'INSPECTING' && (
        <div className="p-10 text-center space-y-4 bg-slate-50/50 dark:bg-[#202225]/50 border border-slate-900 dark:border-[#3A3D42] rounded-xl flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-slate-900 dark:text-white" />
          <div className="space-y-1">
            <p className="text-sm font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide">
              Inspecting Package...
            </p>
            <p className="text-xs text-slate-500 dark:text-[#949BA4] max-w-md mx-auto">
              Verifying ZIP checksums, structure, manifest signatures, path safety, and classification...
            </p>
          </div>
        </div>
      )}

      {/* 6. RESULT State */}
      {state === 'RESULT' && inspectionResult && (
        <div className="space-y-5">
          {/* Classification Header Banner */}
          <div className="p-4 rounded-xl border bg-slate-50 dark:bg-[#202225] border-slate-900 dark:border-[#3A3D42] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 dark:text-[#949BA4] uppercase">
                  Classification:
                </span>
                <span
                  className={clsx(
                    'px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wider',
                    inspectionResult.classification === 'REPORT_EXPORT' &&
                      'bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800',
                    inspectionResult.classification === 'SITE_LOGICAL_BACKUP' &&
                      'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800',
                    inspectionResult.classification === 'SYSTEM_LOGICAL_BACKUP' &&
                      'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-300 dark:border-blue-800',
                    inspectionResult.classification === 'SYSTEM_RECOVERY_BACKUP' &&
                      'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800',
                    inspectionResult.classification === 'CORRUPT_OR_UNRECOGNIZED' &&
                      'bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                  )}
                >
                  {inspectionResult.classification.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {inspectionResult.isValid ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span>Valid Archive</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                    <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                    <span>Invalid Package</span>
                  </span>
                )}
              </div>
            </div>

            {/* Core Metadata Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 text-xs">
              <div className="p-2.5 rounded-lg bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42]">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BA4] block uppercase">
                  Scope
                </span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5] text-xs">
                  {inspectionResult.scope === 'SYSTEM'
                    ? 'Entire System / Enterprise'
                    : inspectionResult.scope === 'SITE'
                    ? 'Single Site'
                    : 'Unknown'}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42]">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BA4] block uppercase">
                  Target Site
                </span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5] text-xs truncate block">
                  {inspectionResult.siteName || inspectionResult.siteId || 'All Sites'}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42]">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BA4] block uppercase">
                  Period Window
                </span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5] text-xs truncate block">
                  {inspectionResult.periodLabel || inspectionResult.periodPreset || 'All History'}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42]">
                <span className="text-[10px] font-bold text-slate-500 dark:text-[#949BA4] block uppercase">
                  Archive Size
                </span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5] text-xs">
                  {formatBytes(inspectionResult.contentsSummary.totalBytes)} ({inspectionResult.contentsSummary.totalFiles} files)
                </span>
              </div>
            </div>
          </div>

          {/* Contents Summary Card */}
          <div className="border border-slate-900 dark:border-[#3A3D42] rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-black uppercase text-slate-900 dark:text-[#F2F3F5] tracking-wide flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-500" />
              <span>Package Contents Summary</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-100 dark:border-[#2B2D31] flex items-center gap-2">
                <FileText
                  className={clsx(
                    'w-4 h-4',
                    inspectionResult.contentsSummary.hasPdf ? 'text-rose-500' : 'text-slate-300 dark:text-slate-600'
                  )}
                />
                <div>
                  <span className="block font-bold text-slate-800 dark:text-[#F2F3F5]">PDF Document</span>
                  <span className="text-[10px] text-slate-500">
                    {inspectionResult.contentsSummary.hasPdf ? 'Included' : 'None'}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-100 dark:border-[#2B2D31] flex items-center gap-2">
                <FileSpreadsheet
                  className={clsx(
                    'w-4 h-4',
                    inspectionResult.contentsSummary.hasExcel ? 'text-emerald-500' : 'text-slate-300 dark:text-slate-600'
                  )}
                />
                <div>
                  <span className="block font-bold text-slate-800 dark:text-[#F2F3F5]">Excel Sheet</span>
                  <span className="text-[10px] text-slate-500">
                    {inspectionResult.contentsSummary.hasExcel ? 'Included' : 'None'}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-100 dark:border-[#2B2D31] flex items-center gap-2">
                <FileCode
                  className={clsx(
                    'w-4 h-4',
                    inspectionResult.contentsSummary.hasJson ? 'text-amber-500' : 'text-slate-300 dark:text-slate-600'
                  )}
                />
                <div>
                  <span className="block font-bold text-slate-800 dark:text-[#F2F3F5]">JSON Data</span>
                  <span className="text-[10px] text-slate-500">
                    {inspectionResult.contentsSummary.hasJson ? 'Included' : 'None'}
                  </span>
                </div>
              </div>

              <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-100 dark:border-[#2B2D31] flex items-center gap-2">
                <Database
                  className={clsx(
                    'w-4 h-4',
                    inspectionResult.contentsSummary.hasDatabaseSnapshot ? 'text-blue-500' : 'text-slate-300 dark:text-slate-600'
                  )}
                />
                <div>
                  <span className="block font-bold text-slate-800 dark:text-[#F2F3F5]">SQLite DB</span>
                  <span className="text-[10px] text-slate-500">
                    {inspectionResult.contentsSummary.hasDatabaseSnapshot ? 'Snapshot Present' : 'None'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Rejection Reasons (for corrupt/unrecognized) */}
          {inspectionResult.rejectionReasons && inspectionResult.rejectionReasons.length > 0 && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-900 dark:text-rose-300 uppercase">
                <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                <span>Rejection Reasons ({inspectionResult.rejectionReasons.length})</span>
              </div>
              <ul className="list-disc pl-5 text-xs text-rose-800 dark:text-rose-300 space-y-1">
                {inspectionResult.rejectionReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
              <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold pt-1">
                No actions available for invalid or unrecognized packages.
              </p>
            </div>
          )}

          {/* Safe Actions & Guidance */}
          <div className="border border-slate-900 dark:border-[#3A3D42] rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-black uppercase text-slate-900 dark:text-[#F2F3F5] tracking-wide flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
              <span>Available Safe Actions</span>
            </h3>

            {/* Classification 1: REPORT_EXPORT */}
            {inspectionResult.classification === 'REPORT_EXPORT' && (
              <div className="space-y-3 text-xs">
                <p className="text-slate-600 dark:text-[#949BA4]">
                  This package is a verified complete analytical report export. It contains generated PDF, Excel, and JSON reports.
                </p>
                <div className="flex flex-wrap gap-2">
                  <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] text-slate-700 dark:text-[#B5BAC1] font-bold text-xs flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>View / Preview Report Data</span>
                  </div>
                  <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] text-slate-700 dark:text-[#B5BAC1] font-bold text-xs flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                    <span>Download / Extract Formats</span>
                  </div>
                </div>
              </div>
            )}

            {/* Classification 2: SITE_LOGICAL_BACKUP */}
            {inspectionResult.classification === 'SITE_LOGICAL_BACKUP' && (
              <div className="space-y-3 text-xs">
                <p className="text-slate-600 dark:text-[#949BA4]">
                  This package contains logical table records for site <span className="font-bold text-slate-900 dark:text-white">{inspectionResult.siteName || inspectionResult.siteId}</span>.
                </p>
                <div className="flex flex-wrap gap-2">
                  <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] text-slate-700 dark:text-[#B5BAC1] font-bold text-xs flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Preview Logical Data (Safe Mode)</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-[#949BA4]">
                  Logical site reconciliation and imports are disabled in this inspection-only stage.
                </p>
              </div>
            )}

            {/* Classification 3: SYSTEM_RECOVERY_BACKUP */}
            {inspectionResult.classification === 'SYSTEM_RECOVERY_BACKUP' && (
              <div className="space-y-3 text-xs">
                <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl space-y-1.5">
                  <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-300">
                    <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>Eligible for Controlled Recovery</span>
                  </div>
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    This package contains a valid full database snapshot. To simulate or execute database recovery, please use the dedicated <span className="font-black">Backup &amp; Recovery → Controlled Restore</span> workflow. The package inspector will not execute database changes.
                  </p>
                </div>
              </div>
            )}

            {/* Classification 4: CORRUPT_OR_UNRECOGNIZED */}
            {inspectionResult.classification === 'CORRUPT_OR_UNRECOGNIZED' && (
              <div className="text-xs text-slate-500 dark:text-[#949BA4]">
                <span>No actions available. Package failed security or manifest integrity checks.</span>
              </div>
            )}
          </div>

          {/* Reset / Inspect Another Button */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[44px] px-5 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs sm:text-sm font-bold hover:bg-slate-800 dark:hover:bg-slate-100 transition shadow-sm flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Inspect Another Package</span>
            </button>
          </div>
        </div>
      )}

      {/* 7. ERROR State */}
      {state === 'ERROR' && (
        <div className="space-y-4">
          <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl flex items-start gap-3">
            <XCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <h4 className="font-bold text-rose-900 dark:text-rose-300 uppercase tracking-wide">
                Inspection Failed
              </h4>
              <p className="text-rose-800 dark:text-rose-300">
                {errorMessage || 'Unable to inspect package. Please check the archive and try again.'}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="min-h-[44px] px-5 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs sm:text-sm font-bold hover:bg-slate-800 dark:hover:bg-slate-100 transition shadow-sm"
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
