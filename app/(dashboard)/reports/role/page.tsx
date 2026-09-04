'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

interface RoleOption {
  id: string;
  name: string;
  category_name?: string;
}

export default function RoleReportPage() {
  const { selectedSite, selectedSiteId } = useSite();

  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
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

  // Fetch all roles for site
  useEffect(() => {
    if (!selectedSiteId) return;
    fetch(`/api/roles?siteId=${selectedSiteId}`)
      .then((r) => r.json())
      .then((data) => {
        const roleList: RoleOption[] = data.roles || [];
        setRoles(roleList);
        if (roleList.length > 0 && !selectedRoleId) {
          setSelectedRoleId('ALL');
        }
      });
  }, [selectedSiteId, selectedRoleId]);

  const fetchRoleAttendance = useCallback(async () => {
    if (!selectedSiteId || !selectedRoleId) return;
    setLoading(true);
    try {
      const url = selectedRoleId === 'ALL'
        ? `/api/attendance/range?siteId=${selectedSiteId}&startDate=${startDateStr}&endDate=${endDateStr}`
        : `/api/attendance/range?siteId=${selectedSiteId}&startDate=${startDateStr}&endDate=${endDateStr}&roleId=${selectedRoleId}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
      }
    } catch (err) {
      console.error('Error fetching role report:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, selectedRoleId, startDateStr, endDateStr]);

  useEffect(() => {
    fetchRoleAttendance();
  }, [fetchRoleAttendance]);

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

  const selectedRoleObj = selectedRoleId === 'ALL'
    ? { id: 'ALL', name: 'All Roles (All Workers)', category_name: 'All Categories' }
    : roles.find((r) => r.id === selectedRoleId);

  const metrics = useMemo(() => {
    const totalFullDays = records.reduce((sum, r) => sum + r.full_day_count, 0);
    const totalHalfDays = records.reduce((sum, r) => sum + r.half_day_count, 0);
    const totalWorkerDays = records.reduce((sum, r) => sum + r.worker_days, 0);
    const totalCostPaise = records.reduce((sum, r) => sum + r.total_cost_paise, 0);
    const activeDays = records.length;
    const avgDailyHeadcount = activeDays > 0 ? (totalWorkerDays / activeDays).toFixed(1) : '0';

    return {
      totalFullDays,
      totalHalfDays,
      totalWorkerDays,
      totalCostPaise,
      activeDays,
      avgDailyHeadcount,
    };
  }, [records]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            {selectedRoleId === 'ALL' ? 'Complete Workforce Breakdown' : 'Role Specific Breakdown'}
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5]">
            {selectedRoleId === 'ALL' ? 'ALL WORKERS BREAKDOWN' : (selectedRoleObj ? selectedRoleObj.name.toUpperCase() : 'ROLE REPORT')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            {monthLabel} | Site: <span className="font-semibold text-slate-700 dark:text-[#B5BAC1]">{selectedSite?.name || 'No Site Selected'}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {/* Role Picker with 44px min touch target and input-no-zoom */}
          <div className="flex items-center space-x-2 bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg px-3 py-1 min-h-[44px]">
            <Users className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
            <select
              value={selectedRoleId}
              onChange={(e) => setSelectedRoleId(e.target.value)}
              aria-label="Select role for report"
              className="bg-transparent text-sm font-bold text-[#0F172A] dark:text-[#F2F3F5] focus:outline-none cursor-pointer min-h-[40px] input-no-zoom touch-action-manipulation"
            >
              <option value="ALL" className="dark:bg-[#18191C] dark:text-[#F2F3F5]">All Roles (All Workers)</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id} className="dark:bg-[#18191C] dark:text-[#F2F3F5]">
                  {r.name} ({r.category_name})
                </option>
              ))}
            </select>
          </div>

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

          <PdfExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'ROLE_REPORT',
              roleId: selectedRoleId,
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Role_${(selectedRoleId === 'ALL' ? 'All_Workers' : (selectedRoleObj?.name || 'Role')).replace(/\s+/g, '_')}_${monthLabel.replace(/\s+/g, '_')}.pdf`}
            label="Export PDF"
            disabled={!selectedRoleId}
          />

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'ROLE_REPORT',
              roleId: selectedRoleId,
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Role_${(selectedRoleId === 'ALL' ? 'All_Workers' : (selectedRoleObj?.name || 'Role')).replace(/\s+/g, '_')}_${monthLabel.replace(/\s+/g, '_')}.xlsx`}
            label="Export Excel"
            disabled={!selectedRoleId}
          />
        </div>
      </div>

      {/* Role Summary KPI Box */}
      <div className="bg-slate-900 dark:bg-[#202225] text-white rounded-xl p-4 sm:p-5 border border-slate-900 dark:border-[#3A3D42] shadow-sm grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
            Total Full Days
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
            {metrics.totalFullDays}
          </span>
        </div>

        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
            Total Half Days
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
            {metrics.totalHalfDays}
          </span>
        </div>

        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
            Total Worker-Days
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-emerald-400 dark:text-[#1ED760] block mt-0.5">
            {metrics.totalWorkerDays}
          </span>
        </div>

        <div className="p-1">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
            Avg Daily Headcount
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
            {metrics.avgDailyHeadcount}
          </span>
        </div>

        <div className="col-span-2 sm:col-span-1 lg:col-span-1 border-t sm:border-t-0 sm:border-l border-slate-800 dark:border-[#3A3D42] pt-2.5 sm:pt-1 sm:pl-4 p-1">
          <span className="text-[10px] sm:text-xs font-bold text-emerald-400 dark:text-[#1ED760] uppercase tracking-wider block">
            {selectedRoleId === 'ALL' ? 'Total Labour Cost' : 'Total Role Cost'}
          </span>
          <span className="text-lg sm:text-xl lg:text-2xl font-black text-emerald-400 dark:text-[#1ED760] block truncate mt-0.5" title={formatINR(metrics.totalCostPaise)}>
            {formatINR(metrics.totalCostPaise)}
          </span>
        </div>
      </div>

      {/* Daily Records — Dual Presentation (Desktop Table vs Mobile Cards) */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading role attendance history...
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm">
          No attendance recorded {selectedRoleId === 'ALL' ? 'for any workers' : `for ${selectedRoleObj?.name}`} in {monthLabel}.
        </div>
      ) : (
        <>
          {/* DESKTOP / TABLET VIEW: High-density data table */}
          <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-100 dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] font-black text-sm text-[#0F172A] dark:text-[#F2F3F5] uppercase">
              Daily Attendance Log ({records.length} {selectedRoleId === 'ALL' ? 'records' : 'days'})
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                    <th className="py-2.5 px-4">Date</th>
                    {selectedRoleId === 'ALL' && <th className="py-2.5 px-4">Role & Category</th>}
                    <th className="py-2.5 px-4 text-right">Applied Rate Snapshot</th>
                    <th className="py-2.5 px-4 text-center">Attendance Breakdown</th>
                    <th className="py-2.5 px-4 text-center">Total Workers</th>
                    <th className="py-2.5 px-4 text-center">Worker-Days</th>
                    <th className="py-2.5 px-4 text-right">Daily Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                  {records.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                      <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] text-sm whitespace-nowrap">{r.date}</td>
                      {selectedRoleId === 'ALL' && (
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-bold text-[#0F172A] dark:text-[#F2F3F5] text-sm block">{r.role_name}</span>
                          <span className="text-[11px] text-slate-500 dark:text-[#949BA4] font-medium block">{r.category_name}</span>
                        </td>
                      )}
                      <td className="py-3 px-4 text-right font-semibold text-slate-600 dark:text-[#B5BAC1] whitespace-nowrap">
                        {formatINR(r.rate_snapshot_paise)}/day
                      </td>
                      <td className="py-3 px-4 text-center font-medium text-slate-700 dark:text-[#B5BAC1] whitespace-nowrap">
                        {r.full_day_count} Full Day{r.half_day_count > 0 ? ` + ${r.half_day_count} Half Day` : ''}
                      </td>
                      <td className="py-3 px-4 text-center font-bold text-slate-800 dark:text-[#F2F3F5] whitespace-nowrap">{r.total_workers}</td>
                      <td className="py-3 px-4 text-center font-black text-[#0F172A] dark:text-[#F2F3F5] whitespace-nowrap">{r.worker_days}</td>
                      <td className="py-3 px-4 text-right font-black text-emerald-700 dark:text-[#1ED760] text-sm whitespace-nowrap">
                        {formatINR(r.total_cost_paise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE VIEW: Responsive Stacked Cards (< 768px) */}
          <div className="md:hidden space-y-3">
            <div className="px-2 font-black text-xs text-slate-700 dark:text-[#B5BAC1] uppercase tracking-wide">
              Daily Attendance Log ({records.length} {selectedRoleId === 'ALL' ? 'records' : 'days'})
            </div>
            {records.map((r) => (
              <div
                key={r.id}
                className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-2.5"
              >
                {/* Top Row: Date, Role (if ALL), & Daily Cost */}
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-[#2B2D31] pb-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-bold text-[#0F172A] dark:text-[#F2F3F5]">{r.date}</span>
                    {selectedRoleId === 'ALL' && (
                      <span className="text-xs font-semibold text-slate-700 dark:text-[#B5BAC1]">
                        {r.role_name} <span className="text-slate-400 dark:text-[#6A6F78] font-normal">({r.category_name})</span>
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-black text-emerald-700 dark:text-[#1ED760]">
                    {formatINR(r.total_cost_paise)}
                  </span>
                </div>

                {/* Middle Row: Rate Snapshot & Breakdown */}
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-600 dark:text-[#B5BAC1]">
                  <span>Rate: <strong className="text-slate-800 dark:text-[#F2F3F5]">{formatINR(r.rate_snapshot_paise)}/day</strong></span>
                  <span className="bg-slate-100 dark:bg-[#111214] px-2 py-0.5 rounded font-medium text-slate-700 dark:text-[#B5BAC1] border border-slate-200 dark:border-[#2B2D31]">
                    {r.full_day_count} Full{r.half_day_count > 0 ? ` + ${r.half_day_count} Half` : ''}
                  </span>
                </div>

                {/* Bottom Row: Headcount & Worker-Days */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 dark:border-[#2B2D31] text-slate-500 dark:text-[#949BA4]">
                  <span>Total Workers: <strong className="text-slate-800 dark:text-[#F2F3F5]">{r.total_workers}</strong></span>
                  <span>Worker-Days: <strong className="text-emerald-700 dark:text-[#1ED760] font-bold">{r.worker_days}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
