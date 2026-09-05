'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { 
  ChevronLeft, 
  ChevronRight, 
  TrendingUp, 
  TrendingDown, 
  ChevronDown
} from 'lucide-react';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

export default function MonthlyAttendanceReportPage() {
  const { selectedSite, selectedSiteId } = useSite();

  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => new Date().getMonth() + 1); // 1-indexed
  const [records, setRecords] = useState<AttendanceDbRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportLoading, setExportLoading] = useState<'excel' | 'pdf' | null>(null);

  // Expanded categories state for drill-down
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const monthLabel = `${monthNames[month - 1]} ${year}`;

  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const fetchMonthlyData = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/attendance/range?siteId=${selectedSiteId}&startDate=${startDateStr}&endDate=${endDateStr}`
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch (err) {
      console.error('Error fetching monthly attendance:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, startDateStr, endDateStr]);

  useEffect(() => {
    fetchMonthlyData();
  }, [fetchMonthlyData]);

  const shiftMonth = (delta: number) => {
    let newMonth = month + delta;
    let newYear = year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    } else if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    setMonth(newMonth);
    setYear(newYear);
  };

  const setThisMonth = () => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
  };

  const toggleCategory = (catId: string) => {
    setExpandedCategories(prev => ({ ...prev, [catId]: !(prev[catId] ?? true) }));
  };

  // High-level Monthly Metrics & Highest/Lowest Manpower Days
  const monthlyMetrics = useMemo(() => {
    const totalWorkers = records.reduce((sum, r) => sum + r.total_workers, 0);
    const totalFullDays = records.reduce((sum, r) => sum + r.full_day_count, 0);
    const totalHalfDays = records.reduce((sum, r) => sum + r.half_day_count, 0);
    const totalWorkerDays = records.reduce((sum, r) => sum + r.worker_days, 0);
    const totalCostPaise = records.reduce((sum, r) => sum + r.total_cost_paise, 0);

    // Group by Day for highest/lowest
    const dayMap = new Map<string, { workerDays: number; costPaise: number; workers: number }>();
    for (const r of records) {
      if (!dayMap.has(r.date)) {
        dayMap.set(r.date, { workerDays: 0, costPaise: 0, workers: 0 });
      }
      const day = dayMap.get(r.date)!;
      day.workerDays += r.worker_days;
      day.costPaise += r.total_cost_paise;
      day.workers += r.total_workers;
    }

    const dayEntries = Array.from(dayMap.entries()).map(([date, d]) => ({
      date,
      ...d,
    }));

    dayEntries.sort((a, b) => b.workerDays - a.workerDays);

    const highestDay = dayEntries.length > 0 ? dayEntries[0] : null;
    const lowestDay = dayEntries.length > 0 ? dayEntries[dayEntries.length - 1] : null;
    const activeDaysCount = dayEntries.length;

    return {
      totalWorkers,
      totalFullDays,
      totalHalfDays,
      totalWorkerDays,
      totalCostPaise,
      highestDay,
      lowestDay,
      activeDaysCount,
    };
  }, [records]);

  // Group by Category -> Role -> Daily records
  const categoryTree = useMemo(() => {
    const catMap = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        workerDays: number;
        costPaise: number;
        roles: Map<
          string,
          {
            roleId: string;
            roleName: string;
            fullDays: number;
            halfDays: number;
            workerDays: number;
            costPaise: number;
            dailyRecords: AttendanceDbRecord[];
          }
        >;
      }
    >();

    for (const r of records) {
      const cId = r.category_id || 'other';
      if (!catMap.has(cId)) {
        catMap.set(cId, {
          categoryId: cId,
          categoryName: r.category_name || 'General',
          workerDays: 0,
          costPaise: 0,
          roles: new Map(),
        });
      }
      const cat = catMap.get(cId)!;
      cat.workerDays += r.worker_days;
      cat.costPaise += r.total_cost_paise;

      if (!cat.roles.has(r.role_id)) {
        cat.roles.set(r.role_id, {
          roleId: r.role_id,
          roleName: r.role_name || '',
          fullDays: 0,
          halfDays: 0,
          workerDays: 0,
          costPaise: 0,
          dailyRecords: [],
        });
      }
      const role = cat.roles.get(r.role_id)!;
      role.fullDays += r.full_day_count;
      role.halfDays += r.half_day_count;
      role.workerDays += r.worker_days;
      role.costPaise += r.total_cost_paise;
      role.dailyRecords.push(r);
    }

    return Array.from(catMap.values()).map(c => ({
      ...c,
      roles: Array.from(c.roles.values()),
    }));
  }, [records]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Attendance Reports
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5]">
            Monthly Attendance Report
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            {monthLabel} ({startDateStr} to {endDateStr}) | Site: <span className="font-semibold text-slate-700 dark:text-[#B5BAC1]">{selectedSite?.name || 'No Site Selected'}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Month Navigation with explicit 44x44 touch targets */}
          <div className="flex items-center border border-slate-900 dark:border-[#3A3D42] rounded-lg p-0.5 bg-slate-50 dark:bg-[#111214] shadow-sm">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              aria-label="Previous Month"
              className="w-11 h-11 inline-flex items-center justify-center hover:bg-slate-200 active:bg-slate-300 dark:hover:bg-[#2B2D31] dark:active:bg-[#3A3D42] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation shrink-0"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-3 text-xs sm:text-sm font-bold text-slate-800 dark:text-[#F2F3F5] text-center min-w-[130px] select-none">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              aria-label="Next Month"
              className="w-11 h-11 inline-flex items-center justify-center hover:bg-slate-200 active:bg-slate-300 dark:hover:bg-[#2B2D31] dark:active:bg-[#3A3D42] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation shrink-0"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={setThisMonth}
            className="min-h-[44px] px-3.5 py-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 dark:bg-[#202225] dark:hover:bg-[#2B2D31] dark:active:bg-[#3A3D42] border border-slate-900 dark:border-[#3A3D42] text-xs sm:text-sm font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation shadow-sm"
          >
            Current Month
          </button>

          <PdfExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'MONTHLY_ATTENDANCE',
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Monthly_${monthLabel.replace(/\s+/g, '_')}.pdf`}
            label="Export PDF"
          />

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'MONTHLY_ATTENDANCE',
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Monthly_${monthLabel.replace(/\s+/g, '_')}.xlsx`}
            label="Export Excel"
          />
        </div>
      </div>

      {/* Monthly KPI Overview Box */}
      <div className="bg-slate-900 dark:bg-[#202225] text-white rounded-xl p-4 sm:p-5 border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Total Full Days
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
              {monthlyMetrics.totalFullDays}
            </span>
          </div>

          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Total Half Days
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
              {monthlyMetrics.totalHalfDays}
            </span>
          </div>

          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Total Worker-Days
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-amber-400 dark:text-[#1ED760] block mt-0.5">
              {monthlyMetrics.totalWorkerDays}
            </span>
          </div>

          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Active Work Days
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
              {monthlyMetrics.activeDaysCount} Days
            </span>
          </div>

          <div className="col-span-2 sm:col-span-1 lg:col-span-1 border-t sm:border-t-0 sm:border-l border-slate-800 dark:border-[#3A3D42] pt-2.5 sm:pt-1 sm:pl-4 p-1">
            <span className="text-[10px] sm:text-xs font-bold text-amber-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Monthly Labour Cost
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-amber-400 dark:text-[#1ED760] block truncate mt-0.5" title={formatINR(monthlyMetrics.totalCostPaise)}>
              {formatINR(monthlyMetrics.totalCostPaise)}
            </span>
          </div>
        </div>

        {/* Highest & Lowest Manpower Highlights */}
        {monthlyMetrics.highestDay && (
          <div className="pt-3 border-t border-slate-800 dark:border-[#3A3D42] grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="flex items-center space-x-2 bg-slate-800/80 dark:bg-[#18191C] p-2.5 rounded-lg border border-transparent dark:border-[#2B2D31]">
              <TrendingUp className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
              <div className="truncate">
                <span className="text-slate-400 dark:text-[#949BA4] font-semibold">Highest Manpower Day:</span>{' '}
                <span className="font-bold text-white dark:text-[#F2F3F5]">{monthlyMetrics.highestDay.date}</span>{' '}
                <span className="text-emerald-400 dark:text-[#1ED760] font-bold">
                  ({monthlyMetrics.highestDay.workerDays} w-days | {formatINR(monthlyMetrics.highestDay.costPaise)})
                </span>
              </div>
            </div>

            {monthlyMetrics.lowestDay && (
              <div className="flex items-center space-x-2 bg-slate-800/80 dark:bg-[#18191C] p-2.5 rounded-lg border border-transparent dark:border-[#2B2D31]">
                <TrendingDown className="w-4 h-4 text-rose-400 dark:text-[#F87171] shrink-0" />
                <div className="truncate">
                  <span className="text-slate-400 dark:text-[#949BA4] font-semibold">Lowest Manpower Day:</span>{' '}
                  <span className="font-bold text-white dark:text-[#F2F3F5]">{monthlyMetrics.lowestDay.date}</span>{' '}
                  <span className="text-rose-400 dark:text-[#F87171] font-bold">
                    ({monthlyMetrics.lowestDay.workerDays} w-days | {formatINR(monthlyMetrics.lowestDay.costPaise)})
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Drill-down Category & Role Breakdown */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading monthly attendance records...
        </div>
      ) : categoryTree.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm">
          No attendance recorded for {monthLabel}.
        </div>
      ) : (
        <div className="space-y-4">
          {categoryTree.map((cat) => {
            const isExpanded = expandedCategories[cat.categoryId] ?? true;

            return (
              <div
                key={cat.categoryId}
                className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] overflow-hidden shadow-sm"
              >
                {/* Category Header Bar with min 44px touch target */}
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.categoryId)}
                  aria-expanded={isExpanded}
                  className="w-full min-h-[44px] bg-slate-100 dark:bg-[#202225] hover:bg-slate-200/80 dark:hover:bg-[#2B2D31] active:bg-slate-300/80 dark:active:bg-[#3A3D42] px-4 sm:px-6 py-3 flex items-center justify-between transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation border-b border-slate-900 dark:border-[#3A3D42]"
                >
                  <div className="flex items-center space-x-2.5 sm:space-x-3">
                    <ChevronDown
                      className={`w-4 h-4 text-slate-600 dark:text-[#B5BAC1] transition-transform shrink-0 ${
                        isExpanded ? 'rotate-0' : '-rotate-90'
                      }`}
                    />
                    <span className="font-black text-[#0F172A] dark:text-[#F2F3F5] text-xs sm:text-base uppercase tracking-wider">
                      {cat.categoryName}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 sm:space-x-4 text-xs sm:text-sm font-black">
                    <span className="text-slate-600 dark:text-[#B5BAC1] font-bold whitespace-nowrap">{cat.workerDays} Worker-Days</span>
                    <span className="text-emerald-700 dark:text-[#1ED760] whitespace-nowrap">{formatINR(cat.costPaise)}</span>
                  </div>
                </button>

                {/* Role List & Drill Down — Dual Presentation (Desktop Table vs Mobile Cards) */}
                {isExpanded && (
                  <div className="p-3 sm:p-6 space-y-4">
                    {/* DESKTOP / TABLET VIEW: High-density Table */}
                    <div className="hidden md:block overflow-x-auto custom-scrollbar">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                            <th className="py-2.5 px-3">Role</th>
                            <th className="py-2.5 px-3 text-center">Full Days</th>
                            <th className="py-2.5 px-3 text-center">Half Days</th>
                            <th className="py-2.5 px-3 text-center">Worker-Days</th>
                            <th className="py-2.5 px-3 text-right">Total Cost</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-[#2B2D31]">
                          {cat.roles.map((r) => (
                            <tr key={r.roleId} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                              <td className="py-2.5 px-3 font-bold text-[#0F172A] dark:text-[#F2F3F5] text-sm whitespace-nowrap">
                                {r.roleName}
                              </td>
                              <td className="py-2.5 px-3 text-center font-medium text-slate-700 dark:text-[#B5BAC1] whitespace-nowrap">
                                {r.fullDays}
                              </td>
                              <td className="py-2.5 px-3 text-center font-medium text-slate-700 dark:text-[#B5BAC1] whitespace-nowrap">
                                {r.halfDays}
                              </td>
                              <td className="py-2.5 px-3 text-center font-black text-[#0F172A] dark:text-[#F2F3F5] whitespace-nowrap">
                                {r.workerDays}
                              </td>
                              <td className="py-2.5 px-3 text-right font-black text-emerald-700 dark:text-[#1ED760] text-sm whitespace-nowrap">
                                {formatINR(r.costPaise)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* MOBILE VIEW: Responsive Stacked Cards (< 768px) */}
                    <div className="md:hidden space-y-2.5">
                      {cat.roles.map((r) => (
                        <div
                          key={r.roleId}
                          className="bg-slate-50 dark:bg-[#111214] p-3 rounded-lg border border-slate-900 dark:border-[#3A3D42] space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-[#0F172A] dark:text-[#F2F3F5]">{r.roleName}</span>
                            <span className="text-xs font-black text-emerald-700 dark:text-[#1ED760]">
                              {formatINR(r.costPaise)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-[#B5BAC1]">
                            <span>Breakdown: <strong className="text-slate-800 dark:text-[#F2F3F5]">{r.fullDays} Full + {r.halfDays} Half</strong></span>
                            <span>Worker-Days: <strong className="text-emerald-700 dark:text-[#1ED760] font-bold">{r.workerDays}</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
