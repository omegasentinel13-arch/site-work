'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSite } from '@/context/site-context';
import {
  FileText,
  FileSpreadsheet,
  Download,
  Calendar,
  Building2,
  Layers,
  Users,
  IndianRupee,
  AlertCircle,
  CheckCircle2,
  Loader2,
  BarChart3,
  Sparkles,
  ArrowRight,
  Filter,
  RefreshCw,
  Lock,
  Package,
  Archive,
  CheckSquare,
  Square,
} from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';
import { REPORT_DEFINITIONS, REPORT_LIST, ReportType, ReportScope } from '@/lib/reports/registry';
import { downloadCompleteExport } from '@/lib/export/client-complete-export';

interface PreviewData {
  reportType: string;
  reportLabel: string;
  scope: string;
  periodLabel: string;
  siteCount: number;
  siteNames: string[];
  attendanceRecordsCount: number;
  totalWorkerDays: number;
  totalLabourCostPaise: number;
  transactionCount: number;
  totalCreditsPaise: number;
  totalDebitsPaise: number;
  netCashFlowPaise: number;
  hasData: boolean;
}

export function ReportCenterSection() {
  const { user, sites, selectedSiteId } = useSite();
  const isViewer = user?.role === 'VIEWER';

  // Filter authorized sites based on role
  const authorizedSites = useMemo(() => {
    if (!user) return [];
    if (user.role === 'ADMIN') return sites;
    if (user.assignedSiteIds && user.assignedSiteIds.length > 0) {
      return sites.filter((s) => user.assignedSiteIds.includes(s.id));
    }
    return [];
  }, [user, sites]);

  // Default initial site
  const initialSiteId = useMemo(() => {
    if (selectedSiteId && authorizedSites.some((s) => s.id === selectedSiteId)) {
      return selectedSiteId;
    }
    return authorizedSites[0]?.id || '';
  }, [selectedSiteId, authorizedSites]);

  // ──────────────────────────────────────────────────────────────────────────
  // 1. DRAFT STATE (Modified during user input, applied on "Apply")
  // ──────────────────────────────────────────────────────────────────────────
  const [draftScope, setDraftScope] = useState<ReportScope>('SITE');
  const [draftSiteId, setDraftSiteId] = useState<string>(initialSiteId);
  const [draftReportType, setDraftReportType] = useState<ReportType>('COMPLETE_REPORT');
  const [draftFrom, setDraftFrom] = useState<string>('');
  const [draftTo, setDraftTo] = useState<string>('');

  // ──────────────────────────────────────────────────────────────────────────
  // 2. APPLIED STATE (Reflects actively previewed/exported parameters)
  // ──────────────────────────────────────────────────────────────────────────
  const [appliedScope, setAppliedScope] = useState<ReportScope>('SITE');
  const [appliedSiteId, setAppliedSiteId] = useState<string>(initialSiteId);
  const [appliedReportType, setAppliedReportType] = useState<ReportType>('COMPLETE_REPORT');
  const [appliedFrom, setAppliedFrom] = useState<string>('');
  const [appliedTo, setAppliedTo] = useState<string>('');

  // Sync draft site ID once sites load
  useEffect(() => {
    if (!draftSiteId && initialSiteId) {
      setDraftSiteId(initialSiteId);
      setAppliedSiteId(initialSiteId);
    }
  }, [initialSiteId, draftSiteId]);

  // Check if draft differs from applied
  const hasDraftChanges = useMemo(() => {
    return (
      draftScope !== appliedScope ||
      draftSiteId !== appliedSiteId ||
      draftReportType !== appliedReportType ||
      draftFrom !== appliedFrom ||
      draftTo !== appliedTo
    );
  }, [draftScope, appliedScope, draftSiteId, appliedSiteId, draftReportType, appliedReportType, draftFrom, appliedFrom, draftTo, appliedTo]);

  // Date validation
  const dateValidationError = useMemo(() => {
    if (draftFrom && draftTo && draftFrom > draftTo) {
      return '"From" date cannot be later than "To" date.';
    }
    return null;
  }, [draftFrom, draftTo]);

  // Active report capability definition
  const currentReportDef = useMemo(() => {
    return REPORT_DEFINITIONS[draftReportType] || REPORT_DEFINITIONS.COMPLETE_REPORT;
  }, [draftReportType]);

  // Preview & Export loading states
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isExporting, setIsExporting] = useState<'PDF' | 'EXCEL' | 'ZIP' | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Quick Preset Helper
  const applyPreset = (preset: 'THIS_MONTH' | 'THIS_YEAR' | 'ALL_TIME') => {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const y = now.getFullYear();
    const m = now.getMonth() + 1;

    if (preset === 'THIS_MONTH') {
      const lastDay = new Date(y, m, 0).getDate();
      setDraftFrom(`${y}-${pad(m)}-01`);
      setDraftTo(`${y}-${pad(m)}-${pad(lastDay)}`);
    } else if (preset === 'THIS_YEAR') {
      setDraftFrom(`${y}-01-01`);
      setDraftTo(`${y}-12-31`);
    } else if (preset === 'ALL_TIME') {
      setDraftFrom('');
      setDraftTo('');
    }
  };

  // Applicable reports based on active draftScope
  const applicableReports = useMemo(() => {
    return REPORT_LIST.filter((r) => r.supportedScopes.includes(draftScope));
  }, [draftScope]);

  // Multi-report selection state (defaults to all applicable reports for draftScope)
  const [selectedReports, setSelectedReports] = useState<ReportType[]>(() => {
    return REPORT_LIST.filter((r) => r.supportedScopes.includes('SITE')).map((r) => r.id);
  });

  // Prune incompatible reports when scope switches
  useEffect(() => {
    setSelectedReports((prev) =>
      prev.filter((id) => REPORT_DEFINITIONS[id]?.supportedScopes.includes(draftScope))
    );
  }, [draftScope]);

  const handleSelectAllApplicable = () => {
    setSelectedReports(applicableReports.map((r) => r.id));
  };

  const handleClearAllReports = () => {
    setSelectedReports([]);
  };

  const toggleReportSelection = (id: ReportType) => {
    if (!REPORT_DEFINITIONS[id]?.supportedScopes.includes(draftScope)) return;
    setSelectedReports((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // 3. FETCH PREVIEW SUMMARY
  // ──────────────────────────────────────────────────────────────────────────
  const fetchPreview = useCallback(async () => {
    if (dateValidationError) return;
    if (draftScope === 'SITE' && !draftSiteId) {
      setErrorMessage('Please select a project site.');
      return;
    }

    try {
      setIsPreviewLoading(true);
      setErrorMessage(null);

      const res = await fetch('/api/reports/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: draftScope,
          siteId: draftScope === 'SITE' ? draftSiteId : undefined,
          reportType: draftReportType,
          from: draftFrom || undefined,
          to: draftTo || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load report summary');
      }

      setPreviewData(data);
      // Promote draft to applied
      setAppliedScope(draftScope);
      setAppliedSiteId(draftSiteId);
      setAppliedReportType(draftReportType);
      setAppliedFrom(draftFrom);
      setAppliedTo(draftTo);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error calculating report preview');
      setPreviewData(null);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [dateValidationError, draftScope, draftSiteId, draftReportType, draftFrom, draftTo]);

  // Initial preview on mount
  useEffect(() => {
    if (draftSiteId) {
      fetchPreview();
    }
  }, [draftSiteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ──────────────────────────────────────────────────────────────────────────
  // 4. EXPORT HANDLERS
  // ──────────────────────────────────────────────────────────────────────────
  const handleExport = async (format: 'PDF' | 'EXCEL' | 'ZIP') => {
    if (isExporting || isViewer) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      setIsExporting(format);

      if (format === 'ZIP') {
        const isSystem = draftScope === 'ALL_SITES';
        const reportsToExport = selectedReports.length > 0 ? selectedReports : applicableReports.map((r) => r.id);
        await downloadCompleteExport({
          scope: isSystem ? 'SYSTEM' : 'SITE',
          siteId: isSystem ? undefined : draftSiteId,
          period: draftFrom && draftTo ? 'CUSTOM' : 'ALL_DATA',
          from: draftFrom || undefined,
          to: draftTo || undefined,
          format: 'FULL_REPORT_ZIP',
          reportTypes: reportsToExport,
        });
        setSuccessMessage(`Full Report ZIP (${reportsToExport.length} reports) downloaded successfully.`);
      } else if (appliedReportType === 'COMPLETE_REPORT' || appliedReportType === 'ALL_SITES_CONSOLIDATED') {
        // Complete report uses existing canonical /api/export/complete
        const isSystem = appliedReportType === 'ALL_SITES_CONSOLIDATED' || appliedScope === 'ALL_SITES';
        await downloadCompleteExport({
          scope: isSystem ? 'SYSTEM' : 'SITE',
          siteId: isSystem ? undefined : appliedSiteId,
          period: appliedFrom && appliedTo ? 'CUSTOM' : 'ALL_DATA',
          from: appliedFrom || undefined,
          to: appliedTo || undefined,
          format: format,
        });
        setSuccessMessage(`${format} export generated successfully.`);
      } else {
        // Map report type to existing PDF/Excel API contract
        const apiPath = format === 'PDF' ? '/api/export/pdf' : '/api/export/excel';

        let targetType = appliedReportType as string;
        let roleId: string | undefined = undefined;

        if (appliedReportType === 'LABOUR_WORKER') {
          targetType = 'ROLE_REPORT';
          roleId = 'ALL';
        } else if (appliedReportType === 'TRANSACTIONS') {
          targetType = 'FINANCE';
        } else if (appliedReportType === 'MASTER_LEDGER') {
          targetType = 'MONTHLY_FINANCE';
        }

        const res = await fetch(apiPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            siteId: appliedSiteId,
            type: targetType,
            startDate: appliedFrom || undefined,
            endDate: appliedTo || undefined,
            roleId,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Failed to generate ${format} report.`);
        }

        const blob = await res.blob();
        const cd = res.headers.get('content-disposition');
        let filename = `Report_${Date.now()}.${format === 'PDF' ? 'pdf' : 'xlsx'}`;
        if (cd && cd.includes('filename=')) {
          const match = cd.match(/filename="?([^";]+)"?/i);
          if (match && match[1]) filename = match[1].trim();
        }

        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => window.URL.revokeObjectURL(url), 5000);

        setSuccessMessage(`${currentReportDef.label} (${format}) downloaded successfully.`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Export generation failed');
    } finally {
      setIsExporting(null);
    }
  };

  const formatCurrency = (paise: number) => {
    return '₹' + (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  };

  return (
    <div className="space-y-6">
      {/* ───────────────────────────────────────────────────────────── */}
      {/* 1. HERO CARD: 1-CLICK COMPLETE PROJECT REPORT                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 dark:from-[#202225] dark:via-[#1E1F22] dark:to-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 text-white shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-2xl">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] sm:text-xs font-black uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>One-Click Enterprise Package</span>
            </div>
            <h2 className="text-lg sm:text-xl font-black uppercase tracking-tight text-white">
              Generate Complete Project Report
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 dark:text-zinc-400 leading-relaxed">
              Produces a comprehensive multi-discipline report package consolidating site profile, daily attendance, workforce labour rollups, financial transactions, and master ledger reconciliation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 shrink-0 pt-2 lg:pt-0">
            <button
              onClick={() => handleExport('PDF')}
              disabled={isExporting !== null || isViewer}
              className="inline-flex items-center justify-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 transition-all shadow-sm active:scale-95 min-h-[44px]"
            >
              {isExporting === 'PDF' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              <span>Complete PDF</span>
            </button>

            <button
              onClick={() => handleExport('EXCEL')}
              disabled={isExporting !== null || isViewer}
              className="inline-flex items-center justify-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-all shadow-sm active:scale-95 min-h-[44px]"
            >
              {isExporting === 'EXCEL' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span>Complete Excel</span>
            </button>

            <button
              onClick={() => handleExport('ZIP')}
              disabled={isExporting !== null || isViewer}
              className="inline-flex items-center justify-center gap-2 px-3.5 sm:px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-50 transition-all shadow-sm active:scale-95 min-h-[44px]"
            >
              {isExporting === 'ZIP' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>Full Archive (ZIP)</span>
            </button>
          </div>
        </div>

        {isViewer && (
          <div className="mt-4 pt-3 border-t border-slate-700 dark:border-[#33353A] flex items-center gap-2 text-xs text-amber-300">
            <Lock className="w-3.5 h-3.5 shrink-0" />
            <span>Viewer accounts have read-only access and are not permitted to generate downloadable report files.</span>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 2. REPORT GENERATOR CONTROLS (DRAFT -> APPLY)                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-visible">
        {/* Inverted Section Header */}
        <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 rounded-t-xl sm:rounded-t-2xl border-b border-slate-900 dark:border-[#33353A] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
              Report Generator &amp; Analytical Engine
            </h3>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold text-slate-300">
            <span className="px-2 py-0.5 rounded bg-slate-800 dark:bg-[#2B2D31] border border-slate-700 dark:border-[#3A3D42]">
              11 Standard Persisted Reports
            </span>
            {hasDraftChanges && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
                Unapplied Filter Changes
              </span>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {/* Form Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Scope Selection */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Report Scope
              </label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 dark:bg-[#2B2D31] rounded-lg border border-slate-900 dark:border-[#3A3D42]">
                <button
                  type="button"
                  onClick={() => setDraftScope('SITE')}
                  className={`py-1.5 text-xs font-bold uppercase rounded transition-all min-h-[36px] ${
                    draftScope === 'SITE'
                      ? 'bg-white dark:bg-[#18191C] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900'
                  }`}
                >
                  Single Site
                </button>
                <button
                  type="button"
                  onClick={() => setDraftScope('ALL_SITES')}
                  disabled={!currentReportDef.supportedScopes.includes('ALL_SITES')}
                  className={`py-1.5 text-xs font-bold uppercase rounded transition-all min-h-[36px] ${
                    draftScope === 'ALL_SITES'
                      ? 'bg-white dark:bg-[#18191C] text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed'
                  }`}
                  title={!currentReportDef.supportedScopes.includes('ALL_SITES') ? 'This report type is site-specific' : ''}
                >
                  All Sites
                </button>
              </div>
            </div>

            {/* Project Site Selector (When Single Site) */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Project Site
              </label>
              <select
                value={draftSiteId}
                onChange={(e) => setDraftSiteId(e.target.value)}
                disabled={draftScope === 'ALL_SITES'}
                className="w-full h-10 px-3 rounded-lg border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] text-slate-900 dark:text-white text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:opacity-50"
              >
                {draftScope === 'ALL_SITES' ? (
                  <option value="">All Authorized Sites ({authorizedSites.length})</option>
                ) : (
                  authorizedSites.map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name} {site.code ? `(${site.code})` : ''}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Report Type Selector (Exactly 11 Options) */}
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Report Type (11 Persisted Formats)
              </label>
              <select
                value={draftReportType}
                onChange={(e) => {
                  const newType = e.target.value as ReportType;
                  setDraftReportType(newType);
                  if (newType === 'ALL_SITES_CONSOLIDATED') {
                    setDraftScope('ALL_SITES');
                  } else if (!REPORT_DEFINITIONS[newType]?.supportedScopes.includes('ALL_SITES') && draftScope === 'ALL_SITES') {
                    setDraftScope('SITE');
                  }
                }}
                className="w-full h-10 px-3 rounded-lg border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] text-slate-900 dark:text-white text-xs font-bold focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              >
                {REPORT_LIST.map((r) => (
                  <option key={r.id} value={r.id}>
                    [{r.category}] {r.label} {!r.supportedScopes.includes('ALL_SITES') ? '— Single Site Only' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Range Engine with Canonical DatePicker & Presets */}
          <div className="border-t border-slate-200 dark:border-[#2B2D31] pt-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400">
                Date Range Filter
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => applyPreset('THIS_MONTH')}
                  className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#2B2D31] text-slate-700 dark:text-zinc-300 hover:bg-slate-200 transition-colors"
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('THIS_YEAR')}
                  className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#2B2D31] text-slate-700 dark:text-zinc-300 hover:bg-slate-200 transition-colors"
                >
                  This Year
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('ALL_TIME')}
                  className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-[#2B2D31] text-slate-700 dark:text-zinc-300 hover:bg-slate-200 transition-colors"
                >
                  All Recorded Dates
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  FROM DATE (START)
                </label>
                <DatePicker
                  value={draftFrom}
                  onChange={(d) => setDraftFrom(d)}
                  placeholder="Select Start Date (YYYY-MM-DD)"
                  maxDate={draftTo || undefined}
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 dark:text-zinc-400 mb-1">
                  TO DATE (END)
                </label>
                <DatePicker
                  value={draftTo}
                  onChange={(d) => setDraftTo(d)}
                  placeholder="Select End Date (YYYY-MM-DD)"
                  minDate={draftFrom || undefined}
                />
              </div>
            </div>
          </div>

          {/* Validation Alert */}
          {dateValidationError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{dateValidationError}</span>
            </div>
          )}

          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-900/60 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Action Button Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={fetchPreview}
                disabled={isPreviewLoading || !!dateValidationError}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-slate-900 dark:bg-[#202225] hover:bg-slate-800 text-white border border-slate-700 dark:border-[#4A4D52] shadow-sm disabled:opacity-50 min-h-[44px]"
              >
                {isPreviewLoading ? <Loader2 className="w-4 h-4 animate-spin text-emerald-400" /> : <Filter className="w-4 h-4 text-emerald-400" />}
                <span>Apply &amp; Preview Report</span>
              </button>

              {hasDraftChanges && (
                <button
                  type="button"
                  onClick={() => {
                    setDraftScope(appliedScope);
                    setDraftSiteId(appliedSiteId);
                    setDraftReportType(appliedReportType);
                    setDraftFrom(appliedFrom);
                    setDraftTo(appliedTo);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-zinc-200 min-h-[44px]"
                >
                  Discard Draft
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleExport('PDF')}
                disabled={isExporting !== null || isViewer || isPreviewLoading}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-white dark:bg-[#202225] text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800 hover:bg-sky-50 dark:hover:bg-sky-950/30 disabled:opacity-50 min-h-[44px]"
              >
                {isExporting === 'PDF' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-sky-500" />}
                <span>Export PDF</span>
              </button>

              <button
                type="button"
                onClick={() => handleExport('EXCEL')}
                disabled={isExporting !== null || isViewer || isPreviewLoading}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider bg-white dark:bg-[#202225] text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50 min-h-[44px]"
              >
                {isExporting === 'EXCEL' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />}
                <span>Export Excel</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 2.5 ENTERPRISE MULTI-REPORT PACKAGE (SCOPE-AWARE ZIP)       */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-3 border-b border-slate-900 dark:border-[#33353A] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Package className="w-4 h-4 text-sky-400" />
            <h3 className="text-xs sm:text-sm font-black uppercase tracking-wider text-white">
              Enterprise Multi-Report Package (Scope-Aware ZIP)
            </h3>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-bold">
            <span className="px-2 py-0.5 rounded bg-slate-800 dark:bg-[#2B2D31] border border-slate-700 dark:border-[#3A3D42] text-slate-300">
              {applicableReports.length} Applicable to Current Scope
            </span>
            <span className="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">
              {selectedReports.length} Selected
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <p className="text-xs text-slate-600 dark:text-zinc-400">
              Select any combination of standard business reports to bundle into a cryptographic ZIP package.
              Package contains canonical PDFs, Excels, and SHA-256 metadata manifest (strictly zero raw database dumps).
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleSelectAllApplicable}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 dark:bg-[#2B2D31] dark:hover:bg-[#33353A] text-slate-800 dark:text-zinc-200 border border-slate-300 dark:border-[#3A3D42] transition-colors"
              >
                Select All Applicable ({applicableReports.length})
              </button>
              <button
                type="button"
                onClick={handleClearAllReports}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:hover:text-zinc-300 transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* 11 Reports Checkbox Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {REPORT_LIST.map((report) => {
              const isApplicable = report.supportedScopes.includes(draftScope);
              const isSelected = selectedReports.includes(report.id);

              return (
                <div
                  key={report.id}
                  onClick={() => isApplicable && toggleReportSelection(report.id)}
                  className={`p-3 rounded-xl border text-left transition-all select-none ${
                    !isApplicable
                      ? 'opacity-40 bg-slate-50 dark:bg-[#202225]/40 border-dashed border-slate-300 dark:border-[#33353A] cursor-not-allowed'
                      : isSelected
                      ? 'bg-sky-50/70 dark:bg-sky-950/20 border-sky-500/50 shadow-xs cursor-pointer'
                      : 'bg-white dark:bg-[#202225] border-slate-300 dark:border-[#33353A] hover:border-slate-400 dark:hover:border-[#4A4D52] cursor-pointer'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isApplicable}
                      onChange={() => {}}
                      className="mt-0.5 rounded border-slate-400 text-sky-600 focus:ring-sky-500 disabled:opacity-30 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-xs font-black uppercase tracking-tight text-slate-900 dark:text-white truncate">
                          {report.label}
                        </span>
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-slate-100 dark:bg-[#2B2D31] text-slate-600 dark:text-zinc-400 shrink-0">
                          {report.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-2 leading-snug">
                        {report.description}
                      </p>
                      {!isApplicable && (
                        <div className="mt-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                          {draftScope === 'ALL_SITES' ? 'Single Site Only' : 'All Sites Only'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Download Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
            <div className="text-xs font-bold text-slate-600 dark:text-zinc-400">
              {selectedReports.length === 0 ? (
                <span className="text-amber-600 dark:text-amber-400">Select at least one report to generate bundle</span>
              ) : (
                <span>Ready to package {selectedReports.length} report{selectedReports.length > 1 ? 's' : ''} for {draftScope === 'ALL_SITES' ? 'all sites' : 'selected site'}</span>
              )}
            </div>

            <button
              type="button"
              onClick={() => handleExport('ZIP')}
              disabled={isExporting !== null || isViewer || selectedReports.length === 0}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 transition-all shadow-sm active:scale-95 min-h-[44px]"
            >
              {isExporting === 'ZIP' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating Full Report ZIP...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Full Report ZIP ({selectedReports.length})</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 3. SERVER-SIDE LIVE SUMMARY PREVIEW CARDS                    */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300">
              Live Aggregated Summary Preview
            </span>
            <span className="text-[10px] font-bold text-slate-400">
              ({previewData?.periodLabel || 'All Dates'})
            </span>
          </div>
          {previewData && (
            <span className="text-[10px] font-bold text-slate-500">
              {previewData.siteCount} Site{previewData.siteCount > 1 ? 's' : ''} Included
            </span>
          )}
        </div>

        {isPreviewLoading ? (
          <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center space-y-2">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-500 mx-auto" />
            <div className="text-xs font-bold text-slate-500 dark:text-zinc-400">
              Calculating real persisted metrics from database...
            </div>
          </div>
        ) : previewData ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
            {/* Sites Included */}
            <div className="bg-white dark:bg-[#18191C] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-xs">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Scope &amp; Sites
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-1">
                {previewData.siteCount}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-zinc-500 truncate" title={previewData.siteNames.join(', ')}>
                {previewData.scope === 'ALL_SITES' ? 'Consolidated' : previewData.siteNames[0] || 'Site'}
              </div>
            </div>

            {/* Attendance Records */}
            <div className="bg-white dark:bg-[#18191C] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-xs">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Attendance Logs
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-1">
                {previewData.attendanceRecordsCount}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-zinc-500">
                {previewData.totalWorkerDays} Worker-Days
              </div>
            </div>

            {/* Total Labour Wages */}
            <div className="bg-white dark:bg-[#18191C] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-xs">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Labour Wages
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-1">
                {formatCurrency(previewData.totalLabourCostPaise)}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-zinc-500">
                Accrued labour cost
              </div>
            </div>

            {/* Transactions Count */}
            <div className="bg-white dark:bg-[#18191C] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-xs">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                Transactions
              </div>
              <div className="text-lg font-black font-mono text-slate-900 dark:text-white mt-1">
                {previewData.transactionCount}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-zinc-500">
                Debits &amp; Credits
              </div>
            </div>

            {/* Cash Outflow (Debits) */}
            <div className="bg-white dark:bg-[#18191C] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-xs">
              <div className="text-[10px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400">
                Cash Outflow
              </div>
              <div className="text-lg font-black font-mono text-rose-600 dark:text-rose-400 mt-1">
                {formatCurrency(previewData.totalDebitsPaise)}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-zinc-500">
                Supplies &amp; Payments
              </div>
            </div>

            {/* Net Movement */}
            <div className={`p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-xs transition-colors ${
              previewData.netCashFlowPaise >= 0
                ? 'bg-emerald-500/10'
                : 'bg-rose-500/10'
            }`}>
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                Net Movement
              </div>
              <div className={`text-lg font-black font-mono mt-1 ${
                previewData.netCashFlowPaise >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {formatCurrency(previewData.netCashFlowPaise)}
              </div>
              <div className="text-[10px] text-slate-500 dark:text-zinc-400">
                Receipts vs Debits
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#18191C] p-6 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-xs text-slate-500">
            No report summary preview calculated yet. Click &quot;Apply &amp; Preview Report&quot; above.
          </div>
        )}
      </div>
    </div>
  );
}
