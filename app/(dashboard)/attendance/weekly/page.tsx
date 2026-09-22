'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';
import { DatePicker } from '@/components/ui/DatePicker';

// --- Date Utility Functions (local timezone safe) ---

function parseDateISO(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function formatDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, days: number): Date {
  const res = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  res.setDate(res.getDate() + days);
  return res;
}

function diffInCalendarDays(d2: Date, d1: Date): number {
  const t1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const t2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.round((t2 - t1) / (1000 * 60 * 60 * 24));
}

function getMondayOfCurrentWeek(ref: Date = new Date()): Date {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), 0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // Monday = 0, Sunday = 6
  d.setDate(d.getDate() - day);
  return d;
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr || '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export default function WeeklyAttendanceReportPage() {
  const { selectedSite, selectedSiteId } = useSite();

  // Default date range: Monday of current week through Sunday of current week (7 days)
  const [startDateStr, setStartDateStr] = useState<string>(() => {
    const mon = getMondayOfCurrentWeek();
    return formatDateISO(mon);
  });

  const [endDateStr, setEndDateStr] = useState<string>(() => {
    const mon = getMondayOfCurrentWeek();
    return formatDateISO(addDays(mon, 6));
  });

  const [records, setRecords] = useState<AttendanceDbRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Maximum To Date is strictly From Date + 6 days (maximum 7 calendar days inclusive)
  const maxToDateStr = useMemo(() => {
    if (!startDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) return undefined;
    return formatDateISO(addDays(parseDateISO(startDateStr), 6));
  }, [startDateStr]);

  // Validate range: inclusiveDays must be between 1 and 7
  const isValidRange = useMemo(() => {
    if (!startDateStr || !endDateStr) return false;
    const startD = parseDateISO(startDateStr);
    const endD = parseDateISO(endDateStr);
    const diff = diffInCalendarDays(endD, startD);
    return diff >= 0 && diff <= 6;
  }, [startDateStr, endDateStr]);

  // Compute array of calendar days within the selected range (1 to 7 days inclusive)
  const weekDays = useMemo(() => {
    const days: { dateStr: string; label: string; dayName: string }[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    if (!isValidRange) return days;

    const startD = parseDateISO(startDateStr);
    const endD = parseDateISO(endDateStr);
    const totalDays = diffInCalendarDays(endD, startD) + 1;

    for (let i = 0; i < totalDays; i++) {
      const curD = addDays(startD, i);
      const dateStr = formatDateISO(curD);
      const parts = dateStr.split('-');
      days.push({
        dateStr,
        label: `${parts[2]}/${parts[1]}`,
        dayName: dayNames[curD.getDay()],
      });
    }
    return days;
  }, [startDateStr, endDateStr, isValidRange]);

  // Handlers for From / To date changes with strict 7-day constraint
  const handleFromDateChange = (newFromDate: string) => {
    if (!newFromDate || !/^\d{4}-\d{2}-\d{2}$/.test(newFromDate)) return;
    setStartDateStr(newFromDate);

    const fromD = parseDateISO(newFromDate);
    const currentToD = parseDateISO(endDateStr);
    const diff = diffInCalendarDays(currentToD, fromD);

    // If existing To Date is before new From Date, or exceeds 6 days after From Date, adjust To Date
    if (diff < 0) {
      setEndDateStr(formatDateISO(addDays(fromD, 6)));
    } else if (diff > 6) {
      setEndDateStr(formatDateISO(addDays(fromD, 6)));
    }
  };

  const handleToDateChange = (newToDate: string) => {
    if (!newToDate || !/^\d{4}-\d{2}-\d{2}$/.test(newToDate)) return;
    const fromD = parseDateISO(startDateStr);
    const toD = parseDateISO(newToDate);
    const diff = diffInCalendarDays(toD, fromD);

    if (diff < 0) {
      // Prevent To < From
      return;
    }
    if (diff > 6) {
      // Clamp to maximum 7 days
      setEndDateStr(formatDateISO(addDays(fromD, 6)));
      return;
    }
    setEndDateStr(newToDate);
  };

  // Shift current range by N weeks (7 days)
  const shiftWeek = (weeks: number) => {
    const currentStart = parseDateISO(startDateStr);
    const currentEnd = parseDateISO(endDateStr);
    const span = diffInCalendarDays(currentEnd, currentStart);
    const newStart = addDays(currentStart, weeks * 7);
    const newEnd = addDays(newStart, span);
    setStartDateStr(formatDateISO(newStart));
    setEndDateStr(formatDateISO(newEnd));
  };

  // Reset to current week Monday -> Sunday
  const setThisWeek = () => {
    const mon = getMondayOfCurrentWeek();
    const sun = addDays(mon, 6);
    setStartDateStr(formatDateISO(mon));
    setEndDateStr(formatDateISO(sun));
  };

  // Fetch weekly attendance data from authoritative endpoint
  const fetchWeeklyAttendance = useCallback(async () => {
    if (!selectedSiteId || !isValidRange) return;
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
  }, [selectedSiteId, startDateStr, endDateStr, isValidRange]);

  useEffect(() => {
    fetchWeeklyAttendance();
  }, [fetchWeeklyAttendance]);

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
      <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col gap-4">
        {/* Top bar: Title + Action buttons */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 sm:gap-4">
          <div className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
              Attendance Reports
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] break-words">
              Weekly Attendance
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5 truncate">
              Selected Range: {formatDisplayDate(startDateStr)} to {formatDisplayDate(endDateStr)} ({weekDays.length} {weekDays.length === 1 ? 'Day' : 'Days'})
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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

        {/* Date Range Selection Controls (Custom SITE WORK DatePicker) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* FROM DATE */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#D1D5DB] shrink-0">
                From:
              </span>
              <DatePicker
                id="weekly-from-date"
                value={startDateStr}
                onChange={handleFromDateChange}
                formatDisplay={formatDisplayDate}
                aria-label="From Date"
                className="w-36 sm:w-44"
              />
            </div>

            {/* TO DATE */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#D1D5DB] shrink-0">
                To:
              </span>
              <DatePicker
                id="weekly-to-date"
                value={endDateStr}
                minDate={startDateStr}
                maxDate={maxToDateStr}
                onChange={handleToDateChange}
                formatDisplay={formatDisplayDate}
                aria-label="To Date"
                className="w-36 sm:w-44"
              />
            </div>

            {/* Range indicator badge */}
            <div className="inline-flex items-center px-2.5 py-1.5 rounded-lg bg-[#F8F9FA] dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] text-xs font-bold text-slate-800 dark:text-[#F2F3F5] shrink-0">
              {weekDays.length} {weekDays.length === 1 ? 'Day' : 'Days'} (Max 7)
            </div>
          </div>

          {/* Quick Week Controls: Previous Week, Current Week, Next Week */}
          <div className="flex items-center gap-2">
            <div className="flex items-center border border-slate-900 dark:border-[#3A3D42] rounded-lg p-1 bg-[#F8F9FA] dark:bg-[#202225]">
              <button
                onClick={() => shiftWeek(-1)}
                className="w-9 h-9 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                title="Previous Week"
                aria-label="Previous Week"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => shiftWeek(1)}
                className="w-9 h-9 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-md text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                title="Next Week"
                aria-label="Next Week"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={setThisWeek}
              className="min-h-[40px] px-3 flex items-center justify-center bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-900 dark:border-[#3A3D42] text-xs font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg transition-colors touch-action-manipulation shrink-0 shadow-sm"
            >
              Current Week
            </button>
          </div>
        </div>
      </div>

      {/* Grand Weekly Summary Box (Dark Navy / Blue inverted treatment) */}
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
            {formatDisplayDate(startDateStr)} – {formatDisplayDate(endDateStr)}
          </span>
        </div>
        <div>
          <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
            Total Day Count
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
          <div className="flex items-center justify-between px-3.5 sm:px-4 py-2.5 sm:py-3 bg-slate-900 dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] text-xs text-white dark:text-[#F2F3F5] font-semibold shadow-sm">
            <span className="flex items-center gap-1.5 font-bold text-white dark:text-[#F2F3F5]">
              <Layers className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
              Workforce Attendance Matrix
            </span>
            <span className="inline-flex items-center text-[11px] text-slate-300 dark:text-[#949BA4] font-semibold md:hidden">
              Scroll horizontally to view all days →
            </span>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[720px] sm:min-w-[800px]">
              <thead>
                <tr className="bg-[#F8F9FA] dark:bg-[#202225] text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                  <th className="py-3 px-3 sm:px-4 sticky left-0 bg-[#F8F9FA] dark:bg-[#202225] z-20 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] table-sticky-col-shadow border-r border-black dark:border-[#3A3D42]">
                    Category / Role
                  </th>
                  {weekDays.map((wd) => (
                    <th key={wd.dateStr} className="py-3 px-2 sm:px-3 text-center border-l border-black dark:border-[#3A3D42]">
                      <div className="font-black text-slate-900 dark:text-[#F2F3F5]">{wd.dayName}</div>
                      <div className="text-[10px] text-slate-500 dark:text-[#949BA4] font-normal">{wd.label}</div>
                    </th>
                  ))}
                  <th className="py-3 px-3 sm:px-4 text-center border-l border-black dark:border-[#3A3D42] bg-[#F8F9FA] dark:bg-[#202225] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                    Total Day Count
                  </th>
                  <th className="py-3 px-3 sm:px-4 text-right border-l border-black dark:border-[#3A3D42] bg-[#F8F9FA] dark:bg-[#202225] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                    Weekly Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31] text-xs">
                {matrixData.map((cat) => (
                  <React.Fragment key={cat.categoryId}>
                    {/* Category Banner Row (Dark navy/blue outer treatment + white typography) */}
                    <tr className="bg-slate-900 dark:bg-[#202225] text-white border-y border-slate-900 dark:border-[#3A3D42]">
                      <td colSpan={weekDays.length + 3} className="py-2.5 px-3 sm:px-4 uppercase tracking-wider text-xs font-black text-white dark:text-[#F2F3F5]">
                        <span className="sticky left-3 sm:left-4 inline-flex items-center gap-2 font-black text-white dark:text-[#F2F3F5]">
                          <Layers className="w-3.5 h-3.5 text-emerald-400 dark:text-[#1ED760] shrink-0 inline-block" />
                          {cat.categoryName}
                        </span>
                      </td>
                    </tr>

                    {/* Role Rows */}
                    {cat.roles.map((r) => (
                      <tr key={r.roleId} className="hover:bg-slate-50 dark:hover:bg-[#2B2D31] transition-colors">
                        <td className="py-2.5 px-3 sm:px-4 font-semibold text-[#0F172A] dark:text-[#F2F3F5] sticky left-0 bg-white dark:bg-[#18191C] z-10 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] truncate table-sticky-col-shadow border-r border-black dark:border-[#3A3D42]">
                          {r.roleName}
                        </td>
                        {weekDays.map((wd) => {
                          const dayData = r.days.get(wd.dateStr);
                          return (
                            <td
                              key={wd.dateStr}
                              className={`py-2.5 px-2 text-center border-l border-black dark:border-[#3A3D42] ${
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
                        <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-bold text-[#0F172A] dark:text-[#F2F3F5]">
                          {r.totalWorkerDays}
                        </td>
                        <td className="py-2.5 px-3 sm:px-4 text-right border-l border-black dark:border-[#3A3D42] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                          {formatINR(r.totalCostPaise)}
                        </td>
                      </tr>
                    ))}

                    {/* Category Subtotal Row (Inverted dark blue / navy + white typography) */}
                    <tr className="bg-slate-800 dark:bg-[#202225] text-white font-bold text-xs border-b border-slate-900 dark:border-[#3A3D42]">
                      <td className="py-2.5 px-3 sm:px-4 text-[11px] uppercase tracking-wide sticky left-0 bg-slate-800 dark:bg-[#202225] text-white z-10 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] truncate table-sticky-col-shadow border-r border-black dark:border-[#3A3D42]">
                        Subtotal — {cat.categoryName}
                      </td>
                      {weekDays.map((wd) => {
                        const catDayRecs = records.filter(
                          (rec) => (rec.category_id || 'other') === cat.categoryId && rec.date === wd.dateStr
                        );
                        const catDayWorkerDays = catDayRecs.reduce((sum, rec) => sum + rec.worker_days, 0);
                        return (
                          <td key={wd.dateStr} className="py-2.5 px-2 text-center border-l border-black dark:border-[#3A3D42] text-xs font-semibold text-white">
                            {catDayWorkerDays > 0 ? `${catDayWorkerDays}d` : '—'}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-black text-amber-300 dark:text-[#1ED760]">
                        {cat.totalWorkerDays}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-right border-l border-black dark:border-[#3A3D42] font-black text-amber-300 dark:text-[#1ED760]">
                        {formatINR(cat.totalCostPaise)}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}

                {/* Grand Daily Totals Footer (Inverted dark blue / navy + white typography) */}
                <tr className="bg-slate-900 dark:bg-[#18191C] text-white font-black text-xs border-t-2 border-slate-900 dark:border-[#4A4D52]">
                  <td className="py-3 px-3 sm:px-4 uppercase tracking-wider sticky left-0 bg-slate-900 dark:bg-[#18191C] text-white z-10 w-44 sm:w-52 min-w-[160px] sm:min-w-[190px] truncate table-sticky-col-shadow border-r border-black dark:border-[#4A4D52]">
                    Grand Daily Total
                  </td>
                  {dailyTotals.map((dt) => (
                    <td key={dt.dateStr} className="py-3 px-2 text-center border-l border-black dark:border-[#4A4D52]">
                      <div className="text-white font-black text-sm">{dt.workerDays}d</div>
                      <div className="text-[10px] text-slate-300 dark:text-[#949BA4] font-medium">{formatINR(dt.costPaise, false)}</div>
                    </td>
                  ))}
                  <td className="py-3 px-3 text-center border-l border-black dark:border-[#4A4D52] text-amber-400 dark:text-[#1ED760] text-sm font-black">
                    {grandTotalWorkerDays}
                  </td>
                  <td className="py-3 px-3 sm:px-4 text-right border-l border-black dark:border-[#4A4D52] text-amber-400 dark:text-[#1ED760] text-sm font-black">
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