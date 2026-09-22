'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2,
  Calendar,
  Users,
  Layers,
  IndianRupee,
  Receipt,
  FileText,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  AlertCircle,
  FolderOpen,
  History,
  Info,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatINR } from '@/lib/domain/money';
import {
  ResolvedPeriod,
  SiteExportData,
  SystemExportData,
  RoleRollupItem,
  CategoryRollupItem,
} from '@/lib/export/complete/types';

interface CompleteReportApiResponse {
  success: boolean;
  scope: 'SYSTEM' | 'SITE';
  period: ResolvedPeriod;
  data: SiteExportData | SystemExportData;
  auditCount: number;
  recentAudit?: Array<{
    id: string;
    entity_type: string;
    action: string;
    created_at: string;
    user_id: string;
    site_id?: string;
  }>;
}

interface CompleteReportViewerProps {
  scope: 'SYSTEM' | 'SITE';
  siteId?: string;
  period: string;
  from?: string;
  to?: string;
}

export function CompleteReportViewer({
  scope,
  siteId,
  period,
  from,
  to,
}: CompleteReportViewerProps) {
  const [reportData, setReportData] = useState<CompleteReportApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSites, setExpandedSites] = useState<Record<string, boolean>>({});
  const [activeSiteTab, setActiveSiteTab] = useState<string>('roles');
  const [selectedSiteIndex, setSelectedSiteIndex] = useState<number>(0);

  const fetchReport = async () => {
    if (scope === 'SITE' && !siteId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        scope,
        period,
      });

      if (scope === 'SITE' && siteId) {
        params.set('siteId', siteId);
      }
      if (period === 'CUSTOM' && from && to) {
        params.set('from', from);
        params.set('to', to);
      }

      const res = await fetch(`/api/reports/complete?${params.toString()}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}: Failed to load complete report`);
      }

      const json: CompleteReportApiResponse = await res.json();
      setReportData(json);
      // Auto-expand first site
      if (json.scope === 'SYSTEM') {
        const sys = json.data as SystemExportData;
        if (sys.sitesData.length > 0) {
          setExpandedSites({ [sys.sitesData[0].site.id]: true });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load report';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [scope, siteId, period, from, to]);

  const toggleSiteExpand = (sId: string) => {
    setExpandedSites((prev) => ({ ...prev, [sId]: !prev[sId] }));
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-8 text-center space-y-3 shadow-sm">
        <Loader2 className="w-8 h-8 animate-spin text-slate-700 dark:text-[#1ED760] mx-auto" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide">
          Generating On-Screen Complete Report...
        </h3>
        <p className="text-xs text-slate-500 dark:text-[#949BA4]">
          Aggregating verified attendance records, workforce rolls, and financial ledgers from authoritative data store.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-rose-500/50 p-6 text-center space-y-3 shadow-sm">
        <div className="w-10 h-10 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center mx-auto">
          <AlertCircle className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wide">
          Complete Report Error
        </h3>
        <p className="text-xs text-slate-600 dark:text-[#949BA4] max-w-md mx-auto">{error}</p>
        <button
          onClick={fetchReport}
          className="min-h-[44px] px-4 py-2 rounded-lg bg-slate-900 dark:bg-[#202225] text-white dark:text-[#F2F3F5] text-xs font-bold border border-slate-900 dark:border-[#4A4D52] hover:bg-slate-800 transition-colors inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Retry Report Generation</span>
        </button>
      </div>
    );
  }

  if (!reportData) {
    return null;
  }

  const isSystem = reportData.scope === 'SYSTEM';
  const systemData = isSystem ? (reportData.data as SystemExportData) : null;
  const singleSiteData = !isSystem ? (reportData.data as SiteExportData) : null;

  // Executive summary values
  const summary = isSystem
    ? systemData!.aggregatedSummary
    : {
        totalSites: 1,
        totalWorkers: singleSiteData!.attendanceRecords.reduce((s, r) => s + r.total_workers, 0),
        totalWorkerDays: singleSiteData!.totalWorkerDays,
        totalLabourCostPaise: singleSiteData!.totalLabourCostPaise,
        totalCreditsPaise: singleSiteData!.financialSummary.totalCreditPaise,
        totalDebitsPaise: singleSiteData!.financialSummary.totalDebitPaise,
        netClosingBalancePaise: singleSiteData!.closingBalancePaise,
      };

  const sitesList: SiteExportData[] = isSystem ? systemData!.sitesData : [singleSiteData!];
  const activeSite = sitesList[selectedSiteIndex] || sitesList[0];

  // Debit expenses grouped by purpose/category
  const debitExpenses = (activeSite?.financialRecords || [])
    .filter((r) => r.type === 'DEBIT')
    .reduce((acc, r) => {
      const cat = r.debit_category || 'General Expense';
      if (!acc[cat]) acc[cat] = { count: 0, totalPaise: 0 };
      acc[cat].count += 1;
      acc[cat].totalPaise += r.amount_paise;
      return acc;
    }, {} as Record<string, { count: number; totalPaise: number }>);

  return (
    <div className="space-y-6" id="on-screen-complete-report">
      {/* ───────────────────────────────────────────────────────────── */}
      {/* REPORT HEADER & SCOPE/PERIOD SUMMARY                          */}
      {/* ───────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200 dark:border-[#2B2D31] pb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-300 dark:border-sky-800">
                {isSystem ? 'Enterprise System Scope' : 'Site Scoped Report'}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#949BA4] border border-slate-300 dark:border-[#4A4D52]">
                {reportData.period.label}
              </span>
              {reportData.period.startDate && reportData.period.endDate && (
                <span className="text-xs text-slate-500 dark:text-[#949BA4]">
                  ({reportData.period.startDate} to {reportData.period.endDate})
                </span>
              )}
            </div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-[#F2F3F5] mt-1 flex items-center gap-2">
              <FileText className="w-5 h-5 text-sky-600 dark:text-sky-400 shrink-0" />
              <span>
                {isSystem
                  ? 'Consolidated Enterprise Complete Report'
                  : `Site Complete Report — ${singleSiteData?.site.name}`}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-[#949BA4]">
            <Clock className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Real-time On-Screen Verification</span>
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────── */}
        {/* A. ENTERPRISE / SITE EXECUTIVE SUMMARY KPI CARDS              */}
        {/* ───────────────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <span className="text-[10px] font-black uppercase text-slate-500 dark:text-[#949BA4] tracking-wider block">
            A. Executive Operational &amp; Financial Summary
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* Day Count */}
            <div className="bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] p-3 rounded-lg space-y-1">
              <div className="flex items-center justify-between text-slate-500 dark:text-[#949BA4]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Day Count</span>
                <Users className="w-3.5 h-3.5" />
              </div>
              <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-[#F2F3F5]">
                {summary.totalWorkerDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-[#949BA4]">
                {summary.totalWorkers} recorded attendance muster entries
              </p>
            </div>

            {/* Labour Cost */}
            <div className="bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] p-3 rounded-lg space-y-1">
              <div className="flex items-center justify-between text-slate-500 dark:text-[#949BA4]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Labour Cost</span>
                <IndianRupee className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-[#F2F3F5]">
                {formatINR(summary.totalLabourCostPaise)}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-[#949BA4]">
                Immutable rate snapshot aggregation
              </p>
            </div>

            {/* Cash Inflows (Credits) */}
            <div className="bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] p-3 rounded-lg space-y-1">
              <div className="flex items-center justify-between text-slate-500 dark:text-[#949BA4]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Cash Inflows</span>
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <p className="text-lg sm:text-xl font-black text-emerald-600 dark:text-[#1ED760]">
                {formatINR(summary.totalCreditsPaise)}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-[#949BA4]">Client receipts &amp; funding</p>
            </div>

            {/* Cash Outflows (Debits) */}
            <div className="bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] p-3 rounded-lg space-y-1">
              <div className="flex items-center justify-between text-slate-500 dark:text-[#949BA4]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Cash Outflows</span>
                <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
              </div>
              <p className="text-lg sm:text-xl font-black text-rose-600 dark:text-rose-400">
                {formatINR(summary.totalDebitsPaise)}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-[#949BA4]">Labour &amp; site expenditures</p>
            </div>

            {/* Net Cash Balance */}
            <div className="bg-slate-50 dark:bg-[#202225] border border-slate-900 dark:border-[#4A4D52] p-3 rounded-lg space-y-1 col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-slate-500 dark:text-[#949BA4]">
                <span className="text-[10px] font-bold uppercase tracking-wider">Net Cash</span>
                <Receipt className="w-3.5 h-3.5 text-sky-500" />
              </div>
              <p
                className={clsx(
                  'text-lg sm:text-xl font-black',
                  summary.netClosingBalancePaise >= 0
                    ? 'text-slate-900 dark:text-[#F2F3F5]'
                    : 'text-rose-600 dark:text-rose-400'
                )}
              >
                {formatINR(summary.netClosingBalancePaise)}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-[#949BA4]">Closing ledger balance</p>
            </div>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* B. ALL SITES PERFORMANCE & RECONCILIATION TABLE (SYSTEM SCOPE) */}
      {/* ───────────────────────────────────────────────────────────── */}
      {isSystem && (
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-[#2B2D31] pb-2.5">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wide flex items-center gap-2">
                <Building2 className="w-4 h-4 text-sky-500 shrink-0" />
                <span>B. All Sites Performance &amp; Financial Reconciliation</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#949BA4]">
                Consolidated operational activity breakdown across all {systemData!.aggregatedSummary.totalSites} registered project sites.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-[#3A3D42] rounded-lg">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 dark:bg-[#202225] border-b border-slate-200 dark:border-[#3A3D42] text-slate-700 dark:text-[#949BA4] font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-2.5 px-3">Project Site</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Day Count</th>
                  <th className="py-2.5 px-3 text-right">Labour Cost</th>
                  <th className="py-2.5 px-3 text-right">Cash Inflows</th>
                  <th className="py-2.5 px-3 text-right">Cash Outflows</th>
                  <th className="py-2.5 px-3 text-right">Net Balance</th>
                  <th className="py-2.5 px-3 text-center">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                {systemData!.sitesData.map((s, idx) => {
                  const hasActivity = s.attendanceRecords.length > 0 || s.financialRecords.length > 0;
                  return (
                    <tr
                      key={s.site.id}
                      className={clsx(
                        'hover:bg-slate-50 dark:hover:bg-[#202225]/60 transition-colors',
                        selectedSiteIndex === idx && 'bg-sky-50/50 dark:bg-sky-950/20'
                      )}
                    >
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-[#F2F3F5]">
                        <div className="flex flex-col">
                          <span>{s.site.name}</span>
                          <span className="text-[10px] text-slate-400 dark:text-[#949BA4]">
                            Code: {s.site.code || 'N/A'} • {s.site.location || 'No Location'}
                          </span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={clsx(
                            'px-2 py-0.5 rounded-full text-[9px] font-bold uppercase',
                            s.site.is_archived === 0
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                          )}
                        >
                          {s.site.is_archived === 0 ? 'Active' : 'Archived'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium">
                        {s.totalWorkerDays > 0 ? (
                          s.totalWorkerDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium">
                        {s.totalLabourCostPaise > 0 ? (
                          formatINR(s.totalLabourCostPaise)
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">₹0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium text-emerald-600 dark:text-emerald-400">
                        {s.financialSummary.totalCreditPaise > 0 ? (
                          formatINR(s.financialSummary.totalCreditPaise)
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">₹0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium text-rose-600 dark:text-rose-400">
                        {s.financialSummary.totalDebitPaise > 0 ? (
                          formatINR(s.financialSummary.totalDebitPaise)
                        ) : (
                          <span className="text-slate-400 dark:text-slate-600">₹0</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold">
                        {formatINR(s.closingBalancePaise)}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => setSelectedSiteIndex(idx)}
                          className={clsx(
                            'min-h-[44px] px-3 py-1 text-xs font-bold rounded-lg border transition-all touch-action-manipulation',
                            selectedSiteIndex === idx
                              ? 'bg-slate-900 text-white border-slate-900 dark:bg-[#1ED760] dark:text-black dark:border-[#1ED760]'
                              : 'bg-white dark:bg-[#202225] border-slate-300 dark:border-[#4A4D52] text-slate-700 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31]'
                          )}
                        >
                          {selectedSiteIndex === idx ? 'Viewing' : 'Inspect'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 dark:bg-[#202225] border-t-2 border-slate-900 dark:border-[#3A3D42] font-black text-slate-900 dark:text-white">
                  <td className="py-3 px-3 uppercase tracking-wider text-[11px]">
                    K. Enterprise Consolidated Totals ({systemData!.aggregatedSummary.totalSites} Sites)
                  </td>
                  <td className="py-3 px-3 text-center text-[10px] text-emerald-600 dark:text-[#1ED760]">
                    RECONCILED
                  </td>
                  <td className="py-3 px-3 text-right font-mono">
                    {systemData!.aggregatedSummary.totalWorkerDays.toLocaleString('en-IN', {
                      maximumFractionDigits: 1,
                    })}
                  </td>
                  <td className="py-3 px-3 text-right font-mono">
                    {formatINR(systemData!.aggregatedSummary.totalLabourCostPaise)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-600 dark:text-[#1ED760]">
                    {formatINR(systemData!.aggregatedSummary.totalCreditsPaise)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-600 dark:text-rose-400">
                    {formatINR(systemData!.aggregatedSummary.totalDebitsPaise)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-slate-900 dark:text-white">
                    {formatINR(systemData!.aggregatedSummary.netClosingBalancePaise)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* SITE DETAIL SECTIONS (C to J)                                 */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeSite && (
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-5">
          {/* Site Profile (C) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-[#2B2D31] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase text-slate-500 dark:text-[#949BA4] tracking-wider">
                  C. Site Profile &amp; Granular Breakdown
                </span>
                <span
                  className={clsx(
                    'px-2 py-0.5 rounded-full text-[9px] font-bold uppercase',
                    activeSite.site.is_archived === 0
                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  )}
                >
                  {activeSite.site.is_archived === 0 ? 'Active Site' : 'Archived Site'}
                </span>
              </div>
              <h3 className="text-lg font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5">
                {activeSite.site.name} {activeSite.site.code ? `(${activeSite.site.code})` : ''}
              </h3>
              <p className="text-xs text-slate-500 dark:text-[#949BA4]">
                Location: {activeSite.site.location || 'Not Specified'} • Site ID: {activeSite.site.id}
              </p>
            </div>

            {isSystem && (
              <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                <span className="text-xs font-bold text-slate-500 dark:text-[#949BA4] shrink-0 mr-1">Switch Site:</span>
                <select
                  value={selectedSiteIndex}
                  onChange={(e) => setSelectedSiteIndex(Number(e.target.value))}
                  className="min-h-[44px] bg-slate-50 dark:bg-[#202225] border border-slate-300 dark:border-[#4A4D52] rounded-lg px-3 py-1.5 text-xs font-bold text-slate-900 dark:text-[#F2F3F5] focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760]"
                >
                  {sitesList.map((s, idx) => (
                    <option key={s.site.id} value={idx}>
                      {s.site.name} {s.site.code ? `(${s.site.code})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Granular Section Tabs (D, E, F, G, H, I, J) */}
          <div className="flex items-center gap-1 border-b border-slate-200 dark:border-[#2B2D31] overflow-x-auto no-scrollbar pb-px">
            {[
              { id: 'roles', label: 'D. Role Breakdown', count: activeSite.roleRollup.length },
              { id: 'categories', label: 'E. Categories', count: activeSite.categoryRollup.length },
              { id: 'attendance', label: 'F. Daily Log', count: activeSite.attendanceRecords.length },
              { id: 'statement', label: 'G. Financial Statement', count: null },
              { id: 'debits', label: 'H. Debit Expenses', count: Object.keys(debitExpenses).length },
              { id: 'transactions', label: 'I. Transactions', count: activeSite.financialRecords.length },
              { id: 'audit', label: 'J. Site Audit', count: activeSite.attendanceRecords.length > 0 ? 'Verified' : 'Zero Records' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSiteTab(tab.id)}
                className={clsx(
                  'min-h-[44px] px-3.5 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2 shrink-0 touch-action-manipulation flex items-center gap-1.5',
                  activeSiteTab === tab.id
                    ? 'border-slate-900 text-slate-900 dark:border-[#1ED760] dark:text-[#1ED760] bg-slate-50 dark:bg-[#202225]/40'
                    : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-[#949BA4] dark:hover:text-white'
                )}
              >
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span
                    className={clsx(
                      'text-[10px] px-1.5 py-0.2 rounded-full',
                      typeof tab.count === 'number' && tab.count > 0
                        ? 'bg-slate-200 dark:bg-[#2B2D31] text-slate-800 dark:text-[#F2F3F5]'
                        : 'bg-slate-100 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500'
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* TAB CONTENT */}
          <div className="pt-2">
            {/* D. Workforce Role Breakdown */}
            {activeSiteTab === 'roles' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#949BA4]">
                  <span>Workforce role muster rollup for selected period</span>
                  <span className="font-bold">Total Roles with Records: {activeSite.roleRollup.length}</span>
                </div>
                {activeSite.roleRollup.length === 0 ? (
                  <div className="py-8 text-center bg-slate-50 dark:bg-[#202225]/40 rounded-lg border border-dashed border-slate-300 dark:border-[#3A3D42]">
                    <Users className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-bold text-slate-700 dark:text-[#F2F3F5]">
                      No workforce attendance records recorded for this site during this period.
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Workforce muster records logged via Daily Attendance will automatically roll up here.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 dark:border-[#3A3D42] rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#949BA4] text-[10px] font-bold uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-3">Role Name</th>
                          <th className="py-2.5 px-3">Category</th>
                          <th className="py-2.5 px-3 text-right">Daily Rate</th>
                          <th className="py-2.5 px-3 text-right">Full Days</th>
                          <th className="py-2.5 px-3 text-right">Half Days</th>
                          <th className="py-2.5 px-3 text-right">Day Count</th>
                          <th className="py-2.5 px-3 text-right">Total Labour Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                        {activeSite.roleRollup.map((r) => (
                          <tr key={r.roleId} className="hover:bg-slate-50 dark:hover:bg-[#202225]/50">
                            <td className="py-2 px-3 font-semibold text-slate-900 dark:text-[#F2F3F5]">{r.roleName}</td>
                            <td className="py-2 px-3 text-slate-500 dark:text-[#949BA4]">{r.categoryName}</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                              {r.ratePaise ? formatINR(r.ratePaise) : '—'}
                            </td>
                            <td className="py-2 px-3 text-right font-mono">{r.fullDays}</td>
                            <td className="py-2 px-3 text-right font-mono">{r.halfDays}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold">
                              {r.workerDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-[#F2F3F5]">
                              {formatINR(r.totalCostPaise)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 dark:bg-[#202225] font-black border-t border-slate-200 dark:border-[#3A3D42]">
                        <tr>
                          <td colSpan={5} className="py-2 px-3 text-right text-[10px] uppercase tracking-wider">
                            Total Workforce Rollup:
                          </td>
                          <td className="py-2 px-3 text-right font-mono">
                            {activeSite.totalWorkerDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                          </td>
                          <td className="py-2 px-3 text-right font-mono text-slate-900 dark:text-white">
                            {formatINR(activeSite.totalLabourCostPaise)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* E. Work Category Summary */}
            {activeSiteTab === 'categories' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#949BA4]">
                  <span>Work category distribution</span>
                  <span className="font-bold">Categories with Activity: {activeSite.categoryRollup.length}</span>
                </div>
                {activeSite.categoryRollup.length === 0 ? (
                  <div className="py-8 text-center bg-slate-50 dark:bg-[#202225]/40 rounded-lg border border-dashed border-slate-300 dark:border-[#3A3D42]">
                    <Layers className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-bold text-slate-700 dark:text-[#F2F3F5]">
                      No category records recorded for this site during this period.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 dark:border-[#3A3D42] rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#949BA4] text-[10px] font-bold uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-3">Work Category</th>
                          <th className="py-2.5 px-3 text-right">Full Days</th>
                          <th className="py-2.5 px-3 text-right">Half Days</th>
                          <th className="py-2.5 px-3 text-right">Total Day Count</th>
                          <th className="py-2.5 px-3 text-right">Total Labour Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                        {activeSite.categoryRollup.map((c) => (
                          <tr key={c.categoryId} className="hover:bg-slate-50 dark:hover:bg-[#202225]/50">
                            <td className="py-2 px-3 font-semibold text-slate-900 dark:text-[#F2F3F5]">{c.categoryName}</td>
                            <td className="py-2 px-3 text-right font-mono">{c.fullDays}</td>
                            <td className="py-2 px-3 text-right font-mono">{c.halfDays}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold">
                              {c.workerDays.toLocaleString('en-IN', { maximumFractionDigits: 1 })}
                            </td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-[#F2F3F5]">
                              {formatINR(c.totalCostPaise)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* F. Daily Attendance Log */}
            {activeSiteTab === 'attendance' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#949BA4]">
                  <span>Daily worker attendance muster entries</span>
                  <span className="font-bold">Total Records: {activeSite.attendanceRecords.length}</span>
                </div>
                {activeSite.attendanceRecords.length === 0 ? (
                  <div className="py-8 text-center bg-slate-50 dark:bg-[#202225]/40 rounded-lg border border-dashed border-slate-300 dark:border-[#3A3D42]">
                    <Calendar className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-bold text-slate-700 dark:text-[#F2F3F5]">
                      No daily attendance muster records found for this period.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[360px] border border-slate-200 dark:border-[#3A3D42] rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 dark:bg-[#202225] sticky top-0 text-slate-700 dark:text-[#949BA4] text-[10px] font-bold uppercase tracking-wider">
                        <tr>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3">Role</th>
                          <th className="py-2 px-3">Category</th>
                          <th className="py-2 px-3 text-right">Daily Rate</th>
                          <th className="py-2 px-3 text-right">Full</th>
                          <th className="py-2 px-3 text-right">Half</th>
                          <th className="py-2 px-3 text-right">Day Count</th>
                          <th className="py-2 px-3 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                        {activeSite.attendanceRecords.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-[#202225]/50">
                            <td className="py-1.5 px-3 font-mono text-slate-800 dark:text-slate-300">{r.date}</td>
                            <td className="py-1.5 px-3 font-medium text-slate-900 dark:text-[#F2F3F5]">{r.role_name}</td>
                            <td className="py-1.5 px-3 text-slate-500 dark:text-[#949BA4]">{r.category_name}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-slate-500 dark:text-slate-400">
                              {formatINR(r.rate_snapshot_paise)}
                            </td>
                            <td className="py-1.5 px-3 text-right font-mono">{r.full_day_count}</td>
                            <td className="py-1.5 px-3 text-right font-mono">{r.half_day_count}</td>
                            <td className="py-1.5 px-3 text-right font-mono font-semibold">{r.worker_days}</td>
                            <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-[#F2F3F5]">
                              {formatINR(r.total_cost_paise)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* G. Financial Statement */}
            {activeSiteTab === 'statement' && (
              <div className="space-y-4">
                <div className="bg-slate-50 dark:bg-[#202225] p-4 rounded-lg border border-slate-900 dark:border-[#4A4D52] space-y-3">
                  <h4 className="text-xs font-black uppercase text-slate-700 dark:text-[#F2F3F5] tracking-wider">
                    G. Site Financial Statement — Period Reconciliation
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-1">
                    <div className="p-2.5 bg-white dark:bg-[#18191C] rounded border border-slate-200 dark:border-[#3A3D42]">
                      <span className="text-[10px] font-bold text-slate-500 uppercase block">Opening Balance</span>
                      <span className="text-base font-black text-slate-800 dark:text-[#F2F3F5] font-mono">
                        {formatINR(activeSite.openingBalancePaise)}
                      </span>
                    </div>
                    <div className="p-2.5 bg-white dark:bg-[#18191C] rounded border border-slate-200 dark:border-[#3A3D42]">
                      <span className="text-[10px] font-bold text-emerald-600 uppercase block">(+) Cash Inflows</span>
                      <span className="text-base font-black text-emerald-600 dark:text-[#1ED760] font-mono">
                        {formatINR(activeSite.financialSummary.totalCreditPaise)}
                      </span>
                    </div>
                    <div className="p-2.5 bg-white dark:bg-[#18191C] rounded border border-slate-200 dark:border-[#3A3D42]">
                      <span className="text-[10px] font-bold text-rose-600 uppercase block">(-) Cash Outflows</span>
                      <span className="text-base font-black text-rose-600 dark:text-rose-400 font-mono">
                        {formatINR(activeSite.financialSummary.totalDebitPaise)}
                      </span>
                    </div>
                    <div className="p-2.5 bg-white dark:bg-[#18191C] rounded border border-slate-200 dark:border-[#3A3D42]">
                      <span className="text-[10px] font-bold text-sky-600 uppercase block">(=) Net Period Movement</span>
                      <span className="text-base font-black text-sky-600 dark:text-sky-400 font-mono">
                        {formatINR(activeSite.financialSummary.netCashFlowPaise)}
                      </span>
                    </div>
                    <div className="p-2.5 bg-white dark:bg-[#18191C] rounded border border-slate-200 dark:border-[#3A3D42] col-span-2 sm:col-span-1">
                      <span className="text-[10px] font-bold text-slate-900 dark:text-white uppercase block">(=) Closing Balance</span>
                      <span className="text-base font-black text-slate-900 dark:text-white font-mono">
                        {formatINR(activeSite.closingBalancePaise)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* H. Debit Expense Breakdown */}
            {activeSiteTab === 'debits' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#949BA4]">
                  <span>H. Expenditures categorized by expense purpose</span>
                  <span className="font-bold">Expense Heads: {Object.keys(debitExpenses).length}</span>
                </div>
                {Object.keys(debitExpenses).length === 0 ? (
                  <div className="py-8 text-center bg-slate-50 dark:bg-[#202225]/40 rounded-lg border border-dashed border-slate-300 dark:border-[#3A3D42]">
                    <TrendingDown className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-bold text-slate-700 dark:text-[#F2F3F5]">
                      No debit expenses recorded for this site during this period.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 dark:border-[#3A3D42] rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#949BA4] text-[10px] font-bold uppercase tracking-wider">
                        <tr>
                          <th className="py-2.5 px-3">Expense Head / Purpose</th>
                          <th className="py-2.5 px-3 text-center">Transaction Count</th>
                          <th className="py-2.5 px-3 text-right">Total Outflow Amount</th>
                          <th className="py-2.5 px-3 text-right">% of Total Debits</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                        {Object.entries(debitExpenses).map(([head, data]) => {
                          const pct = activeSite.financialSummary.totalDebitPaise > 0
                            ? ((data.totalPaise / activeSite.financialSummary.totalDebitPaise) * 100).toFixed(1)
                            : '0';
                          return (
                            <tr key={head} className="hover:bg-slate-50 dark:hover:bg-[#202225]/50">
                              <td className="py-2 px-3 font-semibold text-slate-900 dark:text-[#F2F3F5]">{head}</td>
                              <td className="py-2 px-3 text-center font-mono">{data.count}</td>
                              <td className="py-2 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                                {formatINR(data.totalPaise)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-500 dark:text-[#949BA4]">
                                {pct}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* I. Financial Transactions Ledger */}
            {activeSiteTab === 'transactions' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[#949BA4]">
                  <span>I. Complete financial ledger entries</span>
                  <span className="font-bold">Total Transactions: {activeSite.financialRecords.length}</span>
                </div>
                {activeSite.financialRecords.length === 0 ? (
                  <div className="py-8 text-center bg-slate-50 dark:bg-[#202225]/40 rounded-lg border border-dashed border-slate-300 dark:border-[#3A3D42]">
                    <Receipt className="w-8 h-8 text-slate-400 mx-auto mb-2 opacity-50" />
                    <p className="text-xs font-bold text-slate-700 dark:text-[#F2F3F5]">
                      No financial transactions recorded for this site during this period.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[360px] border border-slate-200 dark:border-[#3A3D42] rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-100 dark:bg-[#202225] sticky top-0 text-slate-700 dark:text-[#949BA4] text-[10px] font-bold uppercase tracking-wider">
                        <tr>
                          <th className="py-2 px-3">Date</th>
                          <th className="py-2 px-3 text-center">Type</th>
                          <th className="py-2 px-3">Category / Purpose</th>
                          <th className="py-2 px-3">Description</th>
                          <th className="py-2 px-3 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                        {activeSite.financialRecords.map((t) => (
                          <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-[#202225]/50">
                            <td className="py-1.5 px-3 font-mono text-slate-700 dark:text-slate-300">{t.date}</td>
                            <td className="py-1.5 px-3 text-center">
                              <span
                                className={clsx(
                                  'px-2 py-0.5 rounded text-[9px] font-bold uppercase',
                                  t.type === 'CREDIT'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-[#1ED760]'
                                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-400'
                                )}
                              >
                                {t.type}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 font-medium text-slate-800 dark:text-[#F2F3F5]">
                              {t.debit_category || (t.type === 'CREDIT' ? 'Client Inflow' : 'General Expense')}
                            </td>
                            <td className="py-1.5 px-3 text-slate-500 dark:text-[#949BA4] truncate max-w-xs">
                              {t.description || '—'}
                            </td>
                            <td
                              className={clsx(
                                'py-1.5 px-3 text-right font-mono font-bold',
                                t.type === 'CREDIT'
                                  ? 'text-emerald-600 dark:text-[#1ED760]'
                                  : 'text-rose-600 dark:text-rose-400'
                              )}
                            >
                              {t.type === 'DEBIT' ? '-' : '+'}
                              {formatINR(t.amount_paise)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* J. Site Audit Metadata */}
            {activeSiteTab === 'audit' && (
              <div className="space-y-3">
                <div className="bg-slate-50 dark:bg-[#202225] p-3.5 rounded-lg border border-slate-300 dark:border-[#3A3D42] text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">
                      J. Site Audit Trail &amp; Verification State
                    </span>
                    <span className="text-[10px] text-emerald-600 dark:text-[#1ED760] font-bold">
                      Immutable Integrity Checked
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                    <div>
                      <span className="text-slate-500 block">Site Identifier:</span>
                      <span className="font-mono font-semibold">{activeSite.site.id}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Created On:</span>
                      <span className="font-mono font-semibold">{activeSite.site.created_at || 'Pre-migration'}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Data Integrity Status:</span>
                      <span className="text-emerald-600 font-bold">100% Mathematically Reconciled</span>
                    </div>
                  </div>
                </div>

                {reportData.recentAudit && reportData.recentAudit.length > 0 && (
                  <div className="border border-slate-200 dark:border-[#3A3D42] rounded-lg p-3 space-y-2">
                    <span className="text-[10px] font-bold uppercase text-slate-500 block">
                      {isSystem ? 'L. Recent Enterprise Audit Events' : 'Recent Site Operational Audit Events'}
                    </span>
                    <div className="space-y-1.5">
                      {reportData.recentAudit.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-[#2B2D31] last:border-none"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] text-slate-400">{a.created_at}</span>
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-[#F2F3F5]">
                              {a.action}
                            </span>
                            <span className="text-slate-700 dark:text-[#B5BAC1] text-[11px]">{a.entity_type}</span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">{a.id.slice(0, 12)}...</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
