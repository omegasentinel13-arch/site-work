'use client';

import React, { useState, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import {
  downloadCompleteExport,
  isCompleteExportInProgress,
} from '@/lib/export/client-complete-export';
import { CompleteReportViewer } from './CompleteReportViewer';
import {
  FileArchive,
  Download,
  FileSpreadsheet,
  FileCode,
  ShieldCheck,
  AlertCircle,
  Building2,
  Calendar,
  Layers,
  CheckCircle2,
  Loader2,
  Lock,
} from 'lucide-react';
import { clsx } from 'clsx';
import { DatePicker } from '@/components/ui/DatePicker';

export type PeriodPreset =
  | 'ALL_DATA'
  | 'TODAY'
  | 'LAST_7_DAYS'
  | 'LAST_30_DAYS'
  | 'THIS_MONTH'
  | 'PREVIOUS_MONTH'
  | 'THIS_YEAR'
  | 'PREVIOUS_YEAR'
  | 'CUSTOM';

export interface CompleteExportSectionProps {
  hideHeaderBanner?: boolean;
}

export function CompleteExportSection({ hideHeaderBanner = false }: CompleteExportSectionProps) {
  const { user, sites, selectedSiteId, isLoading } = useSite();
  const isAdmin = user?.role === 'ADMIN';
  const isViewer = user?.role === 'VIEWER';

  // State
  const [scope, setScope] = useState<'SYSTEM' | 'SITE'>('SYSTEM');
  const [targetSiteId, setTargetSiteId] = useState<string>('');
  const [period, setPeriod] = useState<PeriodPreset>('ALL_DATA');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');

  // Sync default scope and site once user/sites load
  React.useEffect(() => {
    if (user) {
      if (user.role === 'ADMIN') {
        setScope('SYSTEM');
      } else {
        setScope('SITE');
      }
    }
  }, [user]);

  React.useEffect(() => {
    if (!targetSiteId && sites.length > 0) {
      setTargetSiteId(selectedSiteId || sites[0].id);
    }
  }, [sites, selectedSiteId, targetSiteId]);

  const [includePdf, setIncludePdf] = useState(true);
  const [includeExcel, setIncludeExcel] = useState(true);
  const [includeJson, setIncludeJson] = useState(true);

  const [isExporting, setIsExporting] = useState(false);
  const [activeFormat, setActiveFormat] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Available sites based on user role
  const authorizedSites = useMemo(() => {
    if (isAdmin) return sites;
    if (!user?.assignedSiteIds) return [];
    return sites.filter((s) => user.assignedSiteIds.includes(s.id));
  }, [isAdmin, sites, user]);

  // Selected site record
  const currentSite = useMemo(() => {
    return sites.find((s) => s.id === targetSiteId) || authorizedSites[0];
  }, [sites, targetSiteId, authorizedSites]);

  // Trigger export
  const handleExport = async (formatOverride?: 'ZIP' | 'PDF' | 'EXCEL' | 'JSON') => {
    if (isExporting || isCompleteExportInProgress()) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    // Validation
    if (scope === 'SITE' && !targetSiteId) {
      setErrorMsg('Please select a project site for site-level export.');
      return;
    }

    if (period === 'CUSTOM') {
      if (!customFrom || !customTo) {
        setErrorMsg('Please select both Start Date and End Date for custom period.');
        return;
      }
      if (customFrom > customTo) {
        setErrorMsg('Start Date cannot be after End Date.');
        return;
      }
    }

    const selectedFormats: Array<'PDF' | 'EXCEL' | 'JSON'> = [];
    if (includePdf) selectedFormats.push('PDF');
    if (includeExcel) selectedFormats.push('EXCEL');
    if (includeJson) selectedFormats.push('JSON');

    if (!formatOverride || formatOverride === 'ZIP') {
      if (selectedFormats.length === 0) {
        setErrorMsg('Please select at least one format to include in the ZIP package.');
        return;
      }
    }

    setIsExporting(true);
    setActiveFormat(formatOverride || 'ZIP');

    try {
      await downloadCompleteExport({
        scope,
        siteId: scope === 'SITE' ? (targetSiteId || currentSite?.id) : undefined,
        period,
        from: period === 'CUSTOM' ? customFrom : undefined,
        to: period === 'CUSTOM' ? customTo : undefined,
        format: formatOverride || 'ZIP',
        formats: selectedFormats,
      });
      setSuccessMsg(
        formatOverride && formatOverride !== 'ZIP'
          ? `${formatOverride} file generated and downloaded successfully.`
          : 'Complete Archive (ZIP) generated and downloaded successfully.'
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed. Please try again.';
      setErrorMsg(msg);
    } finally {
      setIsExporting(false);
      setActiveFormat(null);
    }
  };

  // Loading guard
  if (isLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  // Block VIEWER accounts
  if (isViewer) {
    return (
      <div className="max-w-3xl mx-auto py-8 px-4">
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-6 sm:p-8 shadow-sm text-center space-y-4">
          <div className="inline-flex p-3 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-black text-slate-900 dark:text-[#F2F3F5]">
            Access Restricted — Complete Export System
          </h1>
          <p className="text-sm text-slate-600 dark:text-[#949BA4] max-w-md mx-auto">
            The Enterprise Complete / Overall Export feature is strictly restricted to Administrators and Engineers.
            Viewer accounts do not have permission to generate consolidated operational reports.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5 sm:space-y-6">
      {/* Page Header (Optional) */}
      {!hideHeaderBanner && (
        <div className="bg-white dark:bg-[#18191C] p-4 sm:p-6 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
                Enterprise Reporting Suite
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-[#86EFAC] border border-emerald-300 dark:border-emerald-800">
                Task 1 Production
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] mt-1 flex items-center gap-2">
              <FileArchive className="w-6 h-6 text-slate-700 dark:text-slate-300 shrink-0" />
              Complete / Overall Report Export
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-[#949BA4] mt-1">
              Consolidate all operational workforce deployments, attendance logs, and financial transaction ledgers into single-click packages.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#3A3D42] text-xs font-medium text-slate-700 dark:text-[#B5BAC1]">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Role: <strong>{user?.role === 'ADMIN' ? 'Administrator' : 'Engineer'}</strong></span>
            </div>
          </div>
        </div>
      )}

      {/* Status Alerts */}
      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs sm:text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
          <div className="flex-1">
            <strong className="font-bold block">Export Failed</strong>
            <span>{errorMsg}</span>
          </div>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 text-xs sm:text-sm flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          <div className="flex-1">
            <strong className="font-bold block">Download Ready</strong>
            <span>{successMsg}</span>
          </div>
        </div>
      )}

      {/* Main Configuration Form */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
        {/* Left 2 Cols: Controls */}
        <div className="lg:col-span-2 space-y-5">
          {/* Card 1: Scope & Target */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide flex items-center gap-2 border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <Building2 className="w-4 h-4 text-slate-500 dark:text-[#949BA4]" />
              1. Export Scope &amp; Target Selection
            </h2>

            {isAdmin && (
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-[#B5BAC1] block mb-2">
                  Target Scope
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setScope('SYSTEM')}
                    className={clsx(
                      "min-h-[44px] px-3.5 py-2.5 rounded-lg border text-xs sm:text-sm font-bold text-left transition-all flex items-center justify-between",
                      scope === 'SYSTEM'
                        ? "bg-slate-900 dark:bg-[#2B2D31] text-white border-slate-900 dark:border-white shadow-sm"
                        : "bg-white dark:bg-[#18191C] text-slate-700 dark:text-[#B5BAC1] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225]"
                    )}
                  >
                    <div>
                      <span className="block font-black">Entire System</span>
                      <span className="text-[11px] font-normal opacity-80">All Managed Sites</span>
                    </div>
                    {scope === 'SYSTEM' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setScope('SITE')}
                    className={clsx(
                      "min-h-[44px] px-3.5 py-2.5 rounded-lg border text-xs sm:text-sm font-bold text-left transition-all flex items-center justify-between",
                      scope === 'SITE'
                        ? "bg-slate-900 dark:bg-[#2B2D31] text-white border-slate-900 dark:border-white shadow-sm"
                        : "bg-white dark:bg-[#18191C] text-slate-700 dark:text-[#B5BAC1] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225]"
                    )}
                  >
                    <div>
                      <span className="block font-black">Specific Project Site</span>
                      <span className="text-[11px] font-normal opacity-80">Selected Site Only</span>
                    </div>
                    {scope === 'SITE' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  </button>
                </div>
              </div>
            )}

            {scope === 'SITE' && (
              <div>
                <label htmlFor="site-select" className="text-xs font-bold text-slate-700 dark:text-[#B5BAC1] block mb-1.5">
                  Project Site Selection
                </label>
                <div className="relative">
                  <select
                    id="site-select"
                    value={targetSiteId}
                    onChange={(e) => setTargetSiteId(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-[#3A3D42] bg-white dark:bg-[#202225] text-slate-900 dark:text-[#F2F3F5] text-xs sm:text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-white transition"
                  >
                    {authorizedSites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.code ? `(${s.code})` : ''} — {s.is_archived ? 'Archived' : 'Active'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Card 2: Period Selection */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide flex items-center gap-2 border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <Calendar className="w-4 h-4 text-slate-500 dark:text-[#949BA4]" />
              2. Reporting Period Window
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(
                [
                  { key: 'ALL_DATA', label: 'All Recorded Data', sub: 'Complete History' },
                  { key: 'TODAY', label: 'Today', sub: 'Single Day' },
                  { key: 'LAST_7_DAYS', label: 'Past 7 Days', sub: 'Trailing Week' },
                  { key: 'LAST_30_DAYS', label: 'Past 30 Days', sub: 'Trailing Month' },
                  { key: 'THIS_MONTH', label: 'Current Month', sub: 'Calendar Month' },
                  { key: 'PREVIOUS_MONTH', label: 'Previous Month', sub: 'Past Calendar Month' },
                  { key: 'THIS_YEAR', label: 'Current Year', sub: 'Calendar Year' },
                  { key: 'PREVIOUS_YEAR', label: 'Previous Year', sub: 'Past Calendar Year' },
                  { key: 'CUSTOM', label: 'Custom Range', sub: 'Specific Dates' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => setPeriod(preset.key)}
                  className={clsx(
                    "min-h-[44px] p-2.5 rounded-lg border text-left transition-all",
                    period === preset.key
                      ? "bg-slate-900 dark:bg-[#2B2D31] text-white border-slate-900 dark:border-white shadow-sm font-bold"
                      : "bg-white dark:bg-[#18191C] text-slate-700 dark:text-[#B5BAC1] border-slate-200 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225]"
                  )}
                >
                  <span className="block text-xs font-bold leading-tight">{preset.label}</span>
                  <span className="block text-[10px] opacity-75 mt-0.5">{preset.sub}</span>
                </button>
              ))}
            </div>

            {period === 'CUSTOM' && (
              <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-[#3A3D42] grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <label htmlFor="custom-from-date" className="text-[11px] font-bold text-slate-700 dark:text-[#B5BAC1] block mb-1">
                    Start Date (From)
                  </label>
                  <DatePicker
                    id="custom-from-date"
                    value={customFrom}
                    onChange={(val) => setCustomFrom(val)}
                    aria-label="Start Date (From)"
                    variant="full"
                  />
                </div>
                <div>
                  <label htmlFor="custom-to-date" className="text-[11px] font-bold text-slate-700 dark:text-[#B5BAC1] block mb-1">
                    End Date (To)
                  </label>
                  <DatePicker
                    id="custom-to-date"
                    value={customTo}
                    onChange={(val) => setCustomTo(val)}
                    aria-label="End Date (To)"
                    variant="full"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Card 3: Formats Inclusion */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
            <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide flex items-center gap-2 border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <Layers className="w-4 h-4 text-slate-500 dark:text-[#949BA4]" />
              3. ZIP Archive Formats Included
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* PDF checkbox */}
              <label className={clsx(
                "min-h-[44px] p-3 rounded-lg border flex items-center gap-3 cursor-pointer select-none transition-all",
                includePdf
                  ? "border-slate-900 dark:border-white bg-slate-50 dark:bg-[#202225]"
                  : "border-slate-200 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] opacity-70"
              )}>
                <input
                  type="checkbox"
                  checked={includePdf}
                  onChange={(e) => setIncludePdf(e.target.checked)}
                  className="w-4 h-4 rounded text-slate-900 focus:ring-0 cursor-pointer"
                />
                <div>
                  <span className="block text-xs font-bold text-slate-900 dark:text-[#F2F3F5]">Consolidated PDF</span>
                  <span className="block text-[10px] text-slate-500 dark:text-[#949BA4]">Multi-section presentation</span>
                </div>
              </label>

              {/* Excel checkbox */}
              <label className={clsx(
                "min-h-[44px] p-3 rounded-lg border flex items-center gap-3 cursor-pointer select-none transition-all",
                includeExcel
                  ? "border-slate-900 dark:border-white bg-slate-50 dark:bg-[#202225]"
                  : "border-slate-200 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] opacity-70"
              )}>
                <input
                  type="checkbox"
                  checked={includeExcel}
                  onChange={(e) => setIncludeExcel(e.target.checked)}
                  className="w-4 h-4 rounded text-slate-900 focus:ring-0 cursor-pointer"
                />
                <div>
                  <span className="block text-xs font-bold text-slate-900 dark:text-[#F2F3F5]">Multi-Sheet Excel</span>
                  <span className="block text-[10px] text-slate-500 dark:text-[#949BA4]">Workbooks (.xlsx)</span>
                </div>
              </label>

              {/* JSON checkbox */}
              <label className={clsx(
                "min-h-[44px] p-3 rounded-lg border flex items-center gap-3 cursor-pointer select-none transition-all",
                includeJson
                  ? "border-slate-900 dark:border-white bg-slate-50 dark:bg-[#202225]"
                  : "border-slate-200 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] opacity-70"
              )}>
                <input
                  type="checkbox"
                  checked={includeJson}
                  onChange={(e) => setIncludeJson(e.target.checked)}
                  className="w-4 h-4 rounded text-slate-900 focus:ring-0 cursor-pointer"
                />
                <div>
                  <span className="block text-xs font-bold text-slate-900 dark:text-[#F2F3F5]">Structured JSON</span>
                  <span className="block text-[10px] text-slate-500 dark:text-[#949BA4]">Canonical audit data</span>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Right 1 Col: Summary & Action Panel */}
        <div className="space-y-5">
          {/* Summary Preview Box */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
            <h2 className="text-sm font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              Export Manifest Preview
            </h2>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4]">Target Scope</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                  {scope === 'SYSTEM' ? 'Enterprise (All Sites)' : 'Single Site'}
                </span>
              </div>

              {scope === 'SITE' && (
                <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-[#2B2D31]">
                  <span className="text-slate-500 dark:text-[#949BA4]">Selected Site</span>
                  <span className="font-bold text-slate-900 dark:text-[#F2F3F5] truncate max-w-[150px]" title={currentSite?.name}>
                    {currentSite?.name || 'None'}
                  </span>
                </div>
              )}

              <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4]">Period Window</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                  {period === 'ALL_DATA' ? 'All Recorded Data' : period.replace(/_/g, ' ')}
                </span>
              </div>

              <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4]">Formats Selected</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                  {[includePdf && 'PDF', includeExcel && 'Excel', includeJson && 'JSON'].filter(Boolean).join(', ') || 'None'}
                </span>
              </div>

              <div className="flex justify-between items-center py-1.5 border-b border-slate-100 dark:border-[#2B2D31]">
                <span className="text-slate-500 dark:text-[#949BA4]">Archive Structure</span>
                <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                  ZIP + manifest.json + README
                </span>
              </div>
            </div>

            {/* Primary Download Button */}
            <div className="pt-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => handleExport('ZIP')}
                className={clsx(
                  "w-full min-h-[48px] px-4 py-3 rounded-xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-md transition-all",
                  isExporting && activeFormat === 'ZIP'
                    ? "bg-slate-700 text-white cursor-wait"
                    : "bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white dark:bg-emerald-600 dark:hover:bg-emerald-500"
                )}
              >
                {isExporting && activeFormat === 'ZIP' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Packaging Archive...</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Download Complete Archive (ZIP)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Standalone Exports Card */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-3">
            <h2 className="text-xs font-black text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wide">
              Standalone Format Downloads
            </h2>

            <div className="space-y-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={() => handleExport('PDF')}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225] text-slate-900 dark:text-[#F2F3F5] text-xs font-bold flex items-center justify-between transition disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <FileArchive className="w-4 h-4 text-rose-500" />
                  <span>Consolidated PDF</span>
                </div>
                {isExporting && activeFormat === 'PDF' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={() => handleExport('EXCEL')}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225] text-slate-900 dark:text-[#F2F3F5] text-xs font-bold flex items-center justify-between transition disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  <span>Multi-Sheet Excel</span>
                </div>
                {isExporting && activeFormat === 'EXCEL' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={() => handleExport('JSON')}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-lg border border-slate-300 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225] text-slate-900 dark:text-[#F2F3F5] text-xs font-bold flex items-center justify-between transition disabled:opacity-50"
              >
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-sky-500" />
                  <span>Structured JSON</span>
                </div>
                {isExporting && activeFormat === 'JSON' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* ON-SCREEN COMPLETE REPORT VIEW */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="pt-4 border-t border-slate-200 dark:border-[#2B2D31]">
        <div className="mb-4">
          <h3 className="text-sm sm:text-base font-black uppercase text-slate-900 dark:text-[#F2F3F5] tracking-wide flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-500" />
            <span>Complete Business Report (On-Screen View)</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-[#949BA4]">
            Authoritative live analytics, workforce rollups, daily attendance records, and financial reconciliation for{' '}
            <strong className="text-slate-900 dark:text-white">
              {scope === 'SYSTEM' ? 'Enterprise (All Sites)' : (currentSite?.name || 'Selected Site')}
            </strong>.
          </p>
        </div>

        <CompleteReportViewer
          scope={scope}
          siteId={scope === 'SITE' ? (targetSiteId || currentSite?.id) : undefined}
          period={period}
          from={customFrom}
          to={customTo}
        />
      </div>
    </div>
  );
}
