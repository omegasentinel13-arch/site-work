'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { ChevronLeft, ChevronRight, Calendar, FileDown, Layers, Users } from 'lucide-react';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

export default function WeeklyAttendanceReportPage() {
  const { selectedSite, selectedSiteId } = useSite();

  // Calculate Monday of the current week by default
  const [currentMonday, setCurrentMonday] = useState<Date>(() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // Monday = 0
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [records, setRecords] = useState<AttendanceDbRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Compute 7 dates from Monday to Sunday
  const weekDays = useMemo(() => {
    const days: { dateStr: string; label: string; dayName: string }[] = [];
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    for (let i = 0; i < 7; i++) {
      const d = new Date(currentMonday);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const parts = dateStr.split('-');
      days.push({
        dateStr,
        label: `${parts[2]}/${parts[1]}`,
        dayName: dayNames[i],
      });
    }
    return days;
  }, [currentMonday]);

  const startDateStr = weekDays[0].dateStr;
  const endDateStr = weekDays[6].dateStr;

  const fetchWeeklyAttendance = useCallback(async () => {
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
      console.error('Error fetching weekly attendance:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, startDateStr, endDateStr]);

  useEffect(() => {
    fetchWeeklyAttendance();
  }, [fetchWeeklyAttendance]);

  const shiftWeek = (weeks: number) => {
    const d = new Date(currentMonday);
    d.setDate(d.getDate() + weeks * 7);
    setCurrentMonday(d);
  };

  const setThisWeek = () => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    setCurrentMonday(d);
  };

  // Group records by Category -> Role
  const matrixData = useMemo(() => {
    const catMap = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        roles: Map<
          string,
          {
            roleId: string;
            roleName: string;
            days: Map<string, { full: number; half: number; workerDays: number; costPaise: number }>;
            totalWorkerDays: number;
            totalCostPaise: number;
          }
        >;
        totalWorkerDays: number;
        totalCostPaise: number;
      }
    >();

    for (const r of records) {
      const cId = r.category_id || 'other';
      if (!catMap.has(cId)) {
        catMap.set(cId, {
          categoryId: cId,
          categoryName: r.category_name || 'General',
          roles: new Map(),
          totalWorkerDays: 0,
          totalCostPaise: 0,
        });
      }
      const cat = catMap.get(cId)!;

      if (!cat.roles.has(r.role_id)) {
        cat.roles.set(r.role_id, {
          roleId: r.role_id,
          roleName: r.role_name || '',
          days: new Map(),
          totalWorkerDays: 0,
          totalCostPaise: 0,
        });
      }
      const role = cat.roles.get(r.role_id)!;

      role.days.set(r.date, {
        full: r.full_day_count,
        half: r.half_day_count,
        workerDays: r.worker_days,
        costPaise: r.total_cost_paise,
      });

      role.totalWorkerDays += r.worker_days;
      role.totalCostPaise += r.total_cost_paise;

      cat.totalWorkerDays += r.worker_days;
      cat.totalCostPaise += r.total_cost_paise;
    }

    return Array.from(catMap.values()).map((c) => ({
      ...c,
      roles: Array.from(c.roles.values()),
    }));
  }, [records]);

  // Daily Column Totals
  const dailyTotals = useMemo(() => {
    return weekDays.map((wd) => {
      const dayRecs = records.filter((r) => r.date === wd.dateStr);
      const workerDays = dayRecs.reduce((sum, r) => sum + r.worker_days, 0);
      const costPaise = dayRecs.reduce((sum, r) => sum + r.total_cost_paise, 0);
      return {
        dateStr: wd.dateStr,
        workerDays,
        costPaise,
      };
    });
  }, [weekDays, records]);

  const grandTotalWorkerDays = records.reduce((sum, r) => sum + r.worker_days, 0);
  const grandTotalCostPaise = records.reduce((sum, r) => sum + r.total_cost_paise, 0);

  return (
    <div className="space-y-4 sm:space-y-6 pb-16 sm:pb-8">
      {/* Header & Week Controls */}
      <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
        <div className="min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Attendance Reports
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] break-words">
            Weekly Workforce Matrix
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5 truncate">
            Week of {startDateStr} to {endDateStr}
          </p>
        </div>

        {/* Navigation buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center border border-slate-900 dark:border-[#3A3D42] rounded-lg p-1 bg-[#F8F9FA] dark:bg-[#202225]">
            <button
              onClick={() => shiftWeek(-1)}
              className="w-11 h-11 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
              title="Previous Week"
              aria-label="Previous Week"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-2 xs:px-3 text-xs font-bold text-[#0F172A] dark:text-[#F2F3F5] truncate">
              {startDateStr} – {endDateStr}
            </span>
            <button
              onClick={() => shiftWeek(1)}
              className="w-11 h-11 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
              title="Next Week"
              aria-label="Next Week"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={setThisWeek}
            className="min-h-[44px] px-3.5 flex items-center justify-center bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-900 dark:border-[#3A3D42] text-xs font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg transition-colors touch-action-manipulation shrink-0 shadow-sm"
          >
            Current Week
          </button>

          <PdfExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'WEEKLY_ATTENDANCE',
              startDate: startDateStr,
              endDate: endDateStr,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Weekly_${startDateStr}_to_${endDateStr}.pdf`}
            label="Export PDF"
          />

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'WEEKLY_ATTENDANCE',
              startDate: startDateStr,
              endDate: endDateStr,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Weekly_${startDateStr}_to_${endDateStr}.xlsx`}
            label="Export Excel"
          />
        </div>
      </div>

      {/* Grand Weekly Summary Box */}
      <div className="bg-slate-900 dark:bg-[#202225] text-white dark:text-[#F2F3F5] rounded-xl p-3.5 sm:p-5 shadow-sm border border-slate-900 dark:border-[#4A4D52] grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="min-w-0">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
            Site
          </span>
          <span className="text-base sm:text-lg font-black text-white dark:text-[#F2F3F5] truncate block mt-0.5">
            {selectedSite?.name || 'No Site Selected'}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
            Week Period
          </span>
          <span className="text-base sm:text-lg font-black text-white dark:text-[#F2F3F5] block mt-0.5 truncate">
            {startDateStr.slice(5)} to {endDateStr.slice(5)}
          </span>
        </div>
        <div>
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
            Total Worker-Days
          </span>
          <span className="text-xl sm:text-2xl font-black text-amber-400 dark:text-[#1ED760] block mt-0.5">
            {grandTotalWorkerDays}
          </span>
        </div>
        <div>
          <span className="text-[10px] sm:text-xs font-bold text-amber-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
            Weekly Labour Cost
          </span>
          <span className="text-xl sm:text-2xl font-black text-amber-400 dark:text-[#1ED760] block mt-0.5 break-words">
            {formatINR(grandTotalCostPaise)}
          </span>
        </div>
      </div>

      {/* Weekly Matrix Table */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm">
          Loading weekly attendance data...
        </div>
      ) : matrixData.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-6 sm:p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm">
          No attendance recorded for this week.
        </div>
      ) : (
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
          {/* Controlled Horizontal Scroll Affordance Bar */}
          <div className="flex items-center justify-between px-3.5 sm:px-4 py-2.5 bg-[#F8F9FA] dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] text-xs text-slate-600 dark:text-[#949BA4] font-medium">
            <span className="flex items-center gap-1.5 font-bold text-[#0F172A] dark:text-[#F2F3F5]">
              <Layers className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
              Workforce Attendance Matrix
            </span>
            <span className="inline-flex items-center text-[11px] text-slate-500 dark:text-[#949BA4] font-semibold md:hidden">
              Scroll horizontally to view all days →
            </span>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[720px] sm:min-w-[800px]">
              <thead>
                <tr className="bg-[#F8F9FA] dark:bg-[#202225] text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                  <th className="py-3 px-3 sm:px-4 sticky left-0 bg-[#F8F9FA] dark:bg-[#202225] z-20 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] table-sticky-col-shadow border-r border-slate-900 dark:border-[#3A3D42]">
                    Category / Role
                  </th>
                  {weekDays.map((wd) => (
                    <th key={wd.dateStr} className="py-3 px-2 sm:px-3 text-center border-l border-slate-900 dark:border-[#3A3D42]">
                      <div>{wd.dayName}</div>
                      <div className="text-[10px] text-slate-500 dark:text-[#949BA4] font-normal">{wd.label}</div>
                    </th>
                  ))}
                  <th className="py-3 px-3 sm:px-4 text-center border-l border-slate-900 dark:border-[#3A3D42] bg-[#F8F9FA] dark:bg-[#202225] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                    Total W-Days
                  </th>
                  <th className="py-3 px-3 sm:px-4 text-right border-l border-slate-900 dark:border-[#3A3D42] bg-[#F8F9FA] dark:bg-[#202225] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                    Weekly Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31] text-xs">
                {matrixData.map((cat) => (
                  <React.Fragment key={cat.categoryId}>
                    {/* Category Banner Row */}
                    <tr className="bg-[#F8F9FA] dark:bg-[#202225] font-black text-[#0F172A] dark:text-[#F2F3F5] border-y border-slate-900 dark:border-[#3A3D42]">
                      <td colSpan={10} className="py-2 px-3 sm:px-4 uppercase tracking-wider text-[11px]">
                        <span className="sticky left-3 sm:left-4 inline-block font-black text-[#0F172A] dark:text-[#F2F3F5]">
                          {cat.categoryName}
                        </span>
                      </td>
                    </tr>

                    {/* Role Rows */}
                    {cat.roles.map((r) => (
                      <tr key={r.roleId} className="hover:bg-slate-50 dark:hover:bg-[#2B2D31] transition-colors">
                        <td className="py-2.5 px-3 sm:px-4 font-semibold text-[#0F172A] dark:text-[#F2F3F5] sticky left-0 bg-white dark:bg-[#18191C] z-10 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] truncate table-sticky-col-shadow border-r border-slate-900 dark:border-[#3A3D42]">
                          {r.roleName}
                        </td>
                        {weekDays.map((wd) => {
                          const dayData = r.days.get(wd.dateStr);
                          return (
                            <td
                              key={wd.dateStr}
                              className={`py-2.5 px-2 text-center border-l border-slate-200 dark:border-[#2B2D31] ${
                                dayData && dayData.workerDays > 0 ? 'bg-emerald-50/60 dark:bg-[#0F291B]/40 font-bold text-[#0F172A] dark:text-[#F2F3F5]' : 'text-slate-500 dark:text-[#949BA4]'
                              }`}
                            >
                              {dayData && (dayData.full > 0 || dayData.half > 0) ? (
                                <div className="flex flex-col items-center">
                                  <span>{dayData.full}F{dayData.half > 0 ? ` + ${dayData.half}H` : ''}</span>
                                  <span className="text-[10px] text-slate-500 dark:text-[#949BA4] font-normal">
                                    ({dayData.workerDays}d)
                                  </span>
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2.5 px-3 text-center border-l border-slate-900 dark:border-[#3A3D42] font-bold text-[#0F172A] dark:text-[#F2F3F5]">
                          {r.totalWorkerDays}
                        </td>
                        <td className="py-2.5 px-3 sm:px-4 text-right border-l border-slate-900 dark:border-[#3A3D42] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                          {formatINR(r.totalCostPaise)}
                        </td>
                      </tr>
                    ))}

                    {/* Category Subtotal */}
                    <tr className="bg-[#F8F9FA]/60 dark:bg-[#202225]/60 font-bold text-slate-700 dark:text-[#B5BAC1] border-b border-slate-900 dark:border-[#3A3D42]">
                      <td className="py-2 px-3 sm:px-4 text-[11px] uppercase tracking-wide sticky left-0 bg-[#F8F9FA] dark:bg-[#202225] z-10 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] truncate table-sticky-col-shadow border-r border-slate-900 dark:border-[#3A3D42]">
                        Subtotal — {cat.categoryName}
                      </td>
                      {weekDays.map((wd) => {
                        const catDayRecs = records.filter(
                          (rec) => (rec.category_id || 'other') === cat.categoryId && rec.date === wd.dateStr
                        );
                        const catDayWorkerDays = catDayRecs.reduce((sum, rec) => sum + rec.worker_days, 0);
                        return (
                          <td key={wd.dateStr} className="py-2 px-2 text-center border-l border-slate-900 dark:border-[#3A3D42] text-xs">
                            {catDayWorkerDays > 0 ? `${catDayWorkerDays}d` : '—'}
                          </td>
                        );
                      })}
                      <td className="py-2 px-3 text-center border-l border-slate-900 dark:border-[#3A3D42] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                        {cat.totalWorkerDays}
                      </td>
                      <td className="py-2 px-3 sm:px-4 text-right border-l border-slate-900 dark:border-[#3A3D42] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                        {formatINR(cat.totalCostPaise)}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}

                {/* Grand Daily Totals Footer */}
                <tr className="bg-white dark:bg-[#202225] text-[#0F172A] dark:text-[#F2F3F5] font-black text-xs border-t-2 border-slate-900 dark:border-[#4A4D52]">
                  <td className="py-3 px-3 sm:px-4 uppercase tracking-wider sticky left-0 bg-white dark:bg-[#202225] text-[#0F172A] dark:text-[#F2F3F5] z-10 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] truncate table-sticky-col-shadow border-r border-slate-900 dark:border-[#4A4D52]">
                    Grand Daily Total
                  </td>
                  {dailyTotals.map((dt) => (
                    <td key={dt.dateStr} className="py-3 px-2 text-center border-l border-slate-900 dark:border-[#4A4D52]">
                      <div className="text-slate-900 dark:text-[#1ED760]">{dt.workerDays}d</div>
                      <div className="text-[10px] text-slate-500 dark:text-[#949BA4] font-normal">{formatINR(dt.costPaise, false)}</div>
                    </td>
                  ))}
                  <td className="py-3 px-3 text-center border-l border-slate-900 dark:border-[#4A4D52] text-slate-900 dark:text-[#1ED760] text-sm">
                    {grandTotalWorkerDays}
                  </td>
                  <td className="py-3 px-3 sm:px-4 text-right border-l border-slate-900 dark:border-[#4A4D52] text-slate-900 dark:text-[#1ED760] text-sm">
                    {formatINR(grandTotalCostPaise)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}