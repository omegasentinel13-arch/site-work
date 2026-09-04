'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { CategoryRecord } from '@/lib/db/repositories/role-repo';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

export default function CategoryReportPage() {
  const { selectedSite, selectedSiteId } = useSite();

  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [records, setRecords] = useState<AttendanceDbRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const monthLabel = `${monthNames[month - 1]} ${year}`;
  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  // Fetch categories
  useEffect(() => {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((data) => {
        const catList: CategoryRecord[] = data.categories || [];
        setCategories(catList);
        if (catList.length > 0 && !selectedCategoryId) {
          setSelectedCategoryId(catList[0].id);
        }
      });
  }, [selectedCategoryId]);

  const fetchCategoryAttendance = useCallback(async () => {
    if (!selectedSiteId || !selectedCategoryId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/attendance/range?siteId=${selectedSiteId}&startDate=${startDateStr}&endDate=${endDateStr}&categoryId=${selectedCategoryId}`
      );
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch (err) {
      console.error('Error fetching category report:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, selectedCategoryId, startDateStr, endDateStr]);

  useEffect(() => {
    fetchCategoryAttendance();
  }, [fetchCategoryAttendance]);

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

  const selectedCategoryObj = categories.find((c) => c.id === selectedCategoryId);

  // Group by Role in Category
  const roleBreakdown = useMemo(() => {
    const roleMap = new Map<
      string,
      {
        roleId: string;
        roleName: string;
        full: number;
        half: number;
        totalWorkers: number;
        workerDays: number;
        costPaise: number;
      }
    >();

    for (const r of records) {
      if (!roleMap.has(r.role_id)) {
        roleMap.set(r.role_id, {
          roleId: r.role_id,
          roleName: r.role_name || '',
          full: 0,
          half: 0,
          totalWorkers: 0,
          workerDays: 0,
          costPaise: 0,
        });
      }
      const item = roleMap.get(r.role_id)!;
      item.full += r.full_day_count;
      item.half += r.half_day_count;
      item.totalWorkers += r.total_workers;
      item.workerDays += r.worker_days;
      item.costPaise += r.total_cost_paise;
    }

    return Array.from(roleMap.values());
  }, [records]);

  const totalFull = records.reduce((sum, r) => sum + r.full_day_count, 0);
  const totalHalf = records.reduce((sum, r) => sum + r.half_day_count, 0);
  const totalWorkerDays = records.reduce((sum, r) => sum + r.worker_days, 0);
  const totalCostPaise = records.reduce((sum, r) => sum + r.total_cost_paise, 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Category Breakdown
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5]">
            {selectedCategoryObj ? selectedCategoryObj.name.toUpperCase() : 'CATEGORY REPORT'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            {monthLabel} | Site: <span className="font-semibold text-slate-700 dark:text-[#B5BAC1]">{selectedSite?.name || 'No Site Selected'}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Category Dropdown with 44px min touch target */}
          <div className="flex items-center space-x-2 bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg px-3 py-1 min-h-[44px]">
            <Layers className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              aria-label="Select category for report"
              className="bg-transparent text-sm font-bold text-[#0F172A] dark:text-[#F2F3F5] focus:outline-none cursor-pointer min-h-[40px] input-no-zoom touch-action-manipulation"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id} className="dark:bg-[#18191C] dark:text-[#F2F3F5]">
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month Navigator with explicit 44x44 touch targets */}
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

          <PdfExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'CATEGORY_REPORT',
              categoryId: selectedCategoryId,
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Category_${(selectedCategoryObj?.name || 'Category').replace(/\s+/g, '_')}_${monthLabel.replace(/\s+/g, '_')}.pdf`}
            label="Export PDF"
            disabled={!selectedCategoryId}
          />

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'CATEGORY_REPORT',
              categoryId: selectedCategoryId,
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Category_${(selectedCategoryObj?.name || 'Category').replace(/\s+/g, '_')}_${monthLabel.replace(/\s+/g, '_')}.xlsx`}
            label="Export Excel"
            disabled={!selectedCategoryId}
          />
        </div>
      </div>

      {/* Category Summary KPI Box */}
      <div className="bg-slate-900 dark:bg-[#202225] text-white rounded-xl p-4 sm:p-5 border border-slate-900 dark:border-[#3A3D42] shadow-sm grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
            Category Full Days
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
            {totalFull}
          </span>
        </div>
        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
            Category Half Days
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
            {totalHalf}
          </span>
        </div>
        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
            Total Worker-Days
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-emerald-400 dark:text-[#1ED760] block mt-0.5">
            {totalWorkerDays}
          </span>
        </div>
        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-emerald-400 dark:text-[#1ED760] uppercase tracking-wider block">
            Category Total Cost
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-emerald-400 dark:text-[#1ED760] block truncate mt-0.5" title={formatINR(totalCostPaise)}>
            {formatINR(totalCostPaise)}
          </span>
        </div>
      </div>

      {/* Role Breakdown in Category — Dual Presentation (Table vs Cards) */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading category records...
        </div>
      ) : roleBreakdown.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm">
          No attendance recorded for {selectedCategoryObj?.name} in {monthLabel}.
        </div>
      ) : (
        <>
          {/* DESKTOP / TABLET VIEW: Crisp table */}
          <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-100 dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] font-black text-sm text-[#0F172A] dark:text-[#F2F3F5] uppercase">
              Role-Wise Attendance & Cost Breakdown ({roleBreakdown.length} roles)
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4 text-center">Full Days</th>
                    <th className="py-2.5 px-4 text-center">Half Days</th>
                    <th className="py-2.5 px-4 text-center">Total Workers</th>
                    <th className="py-2.5 px-4 text-center">Worker-Days</th>
                    <th className="py-2.5 px-4 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                  {roleBreakdown.map((r) => (
                    <tr key={r.roleId} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                      <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] text-sm whitespace-nowrap">{r.roleName}</td>
                      <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-[#B5BAC1] whitespace-nowrap">{r.full}</td>
                      <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-[#B5BAC1] whitespace-nowrap">{r.half}</td>
                      <td className="py-3 px-4 text-center font-bold text-slate-800 dark:text-[#F2F3F5] whitespace-nowrap">{r.totalWorkers}</td>
                      <td className="py-3 px-4 text-center font-black text-[#0F172A] dark:text-[#F2F3F5] whitespace-nowrap">{r.workerDays}</td>
                      <td className="py-3 px-4 text-right font-black text-emerald-700 dark:text-[#1ED760] text-sm whitespace-nowrap">
                        {formatINR(r.costPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE VIEW: Responsive Cards (< 768px) */}
          <div className="md:hidden space-y-3">
            <div className="px-2 font-black text-xs text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wide">
              Role-Wise Breakdown ({roleBreakdown.length} roles)
            </div>
            {roleBreakdown.map((r) => (
              <div
                key={r.roleId}
                className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-2.5"
              >
                {/* Top: Role Name & Cost */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-[#2B2D31] pb-2">
                  <span className="text-sm font-bold text-[#0F172A] dark:text-[#F2F3F5]">{r.roleName}</span>
                  <span className="text-sm font-black text-emerald-700 dark:text-[#1ED760]">
                    {formatINR(r.costPaise)}
                  </span>
                </div>

                {/* Middle: Days Breakdown */}
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600 dark:text-[#B5BAC1]">
                  <span>Breakdown:</span>
                  <span className="bg-slate-100 dark:bg-[#111214] px-2 py-0.5 rounded font-medium text-slate-700 dark:text-[#B5BAC1] border border-slate-200 dark:border-[#2B2D31]">
                    {r.full} Full{r.half > 0 ? ` + ${r.half} Half` : ''}
                  </span>
                </div>

                {/* Bottom: Workers & Worker-Days */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-[#2B2D31] text-slate-500 dark:text-[#949BA4]">
                  <span>Total Workers: <strong className="text-slate-800 dark:text-[#F2F3F5]">{r.totalWorkers}</strong></span>
                  <span>Worker-Days: <strong className="text-emerald-700 dark:text-[#1ED760] font-bold">{r.workerDays}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
