'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { 
  ChevronLeft, 
  ChevronRight, 
  TrendingUp, 
  TrendingDown, 
  ChevronDown,
  LayoutGrid,
  Calendar as CalendarIcon,
  Layers
} from 'lucide-react';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const SUPPORTED_YEARS = Array.from({ length: 21 }, (_, i) => 2018 + i);
const WEEKDAY_NAMES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function parseQueryMonth(monthParam?: string | null, dateParam?: string | null): { year: number; month: number } | null {
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m] = dateParam.split('-').map(Number);
    if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) {
      return { year: y, month: m };
    }
  }
  return null;
}

function MonthlyAttendanceReportContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryMonth = searchParams?.get('month');
  const queryDate = searchParams?.get('date');
  const initialParsed = parseQueryMonth(queryMonth, queryDate);

  const { selectedSite, selectedSiteId } = useSite();

  // Primary State
  const [viewMode, setViewMode] = useState<'table' | 'calendar'>('table');
  const [year, setYear] = useState<number>(() => initialParsed ? initialParsed.year : new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => initialParsed ? initialParsed.month : new Date().getMonth() + 1); // 1-indexed (1-12)
  const [records, setRecords] = useState<AttendanceDbRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Custom Month/Year Selector State
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [pickerViewMode, setPickerViewMode] = useState<'months' | 'years'>('months');
  const [pickerYear, setPickerYear] = useState<number>(year);
  const monthPickerRef = useRef<HTMLDivElement>(null);

  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;

  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const todayISO = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);

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

  useEffect(() => {
    const p = parseQueryMonth(queryMonth, queryDate);
    if (p && (p.year !== year || p.month !== month)) {
      setYear(p.year);
      setMonth(p.month);
      setPickerYear(p.year);
    }
  }, [queryMonth, queryDate, year, month]);

  // Handle Month Picker Outside Click & Escape Key
  useEffect(() => {
    if (!isMonthPickerOpen) return;

    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (monthPickerRef.current && !monthPickerRef.current.contains(e.target as Node)) {
        setIsMonthPickerOpen(false);
        setPickerViewMode('months');
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsMonthPickerOpen(false);
        setPickerViewMode('months');
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMonthPickerOpen]);

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
    setPickerYear(newYear);
  };

  const setThisMonth = () => {
    const now = new Date();
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setPickerYear(now.getFullYear());
    setIsMonthPickerOpen(false);
  };

  const handleSelectMonth = (mNum: number) => {
    setMonth(mNum);
    setYear(pickerYear);
    setIsMonthPickerOpen(false);
  };

  const handleSelectYear = (y: number) => {
    setPickerYear(y);
    setPickerViewMode('months');
  };

  const handleDayDoubleClick = (dateStr: string) => {
    router.push(`/attendance/daily?date=${dateStr}`);
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

  // Group by Category -> Role for Table View
  const categoryTree = useMemo(() => {
    const catMap = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        fullDays: number;
        halfDays: number;
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
          fullDays: 0,
          halfDays: 0,
          workerDays: 0,
          costPaise: 0,
          roles: new Map(),
        });
      }
      const cat = catMap.get(cId)!;
      cat.fullDays += r.full_day_count;
      cat.halfDays += r.half_day_count;
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

  // Daily aggregate map for Calendar View
  const dailyMetricsMap = useMemo(() => {
    const map = new Map<string, {
      workers: number;
      full: number;
      half: number;
      workerDays: number;
      costPaise: number;
    }>();

    for (const r of records) {
      if (!map.has(r.date)) {
        map.set(r.date, { workers: 0, full: 0, half: 0, workerDays: 0, costPaise: 0 });
      }
      const day = map.get(r.date)!;
      day.workers += r.total_workers;
      day.full += r.full_day_count;
      day.half += r.half_day_count;
      day.workerDays += r.worker_days;
      day.costPaise += r.total_cost_paise;
    }

    return map;
  }, [records]);

  // Calendar cells generation (Monday-first grid)
  const calendarGrid = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const startingOffset = (firstDay.getDay() + 6) % 7; // 0 for Mon, 6 for Sun
    const totalDays = new Date(year, month, 0).getDate();

    const leadingBlanks = Array.from({ length: startingOffset }, (_, i) => i);
    const days = Array.from({ length: totalDays }, (_, i) => i + 1);
    const totalSlots = startingOffset + totalDays;
    const trailingBlanks = Array.from({ length: (7 - (totalSlots % 7)) % 7 }, (_, i) => i);

    return {
      leadingBlanks,
      days,
      trailingBlanks,
    };
  }, [year, month]);

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

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Top-Corner View Mode Switcher */}
          <div 
            role="group" 
            aria-label="View Mode Switcher" 
            className="inline-flex p-1 bg-slate-100 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg shadow-sm"
          >
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-label="Table View"
              aria-pressed={viewMode === 'table'}
              data-testid="view-mode-table"
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-md text-xs sm:text-sm font-bold transition-all touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                viewMode === 'table'
                  ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] font-black shadow-sm'
                  : 'text-slate-700 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200/50 dark:hover:bg-[#202225]'
              )}
            >
              <LayoutGrid className="w-4 h-4 shrink-0" />
              <span>Table View</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              aria-label="Calendar View"
              aria-pressed={viewMode === 'calendar'}
              data-testid="view-mode-calendar"
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-md text-xs sm:text-sm font-bold transition-all touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                viewMode === 'calendar'
                  ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] font-black shadow-sm'
                  : 'text-slate-700 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200/50 dark:hover:bg-[#202225]'
              )}
            >
              <CalendarIcon className="w-4 h-4 shrink-0" />
              <span>Calendar View</span>
            </button>
          </div>

          {/* Established Custom SITE WORK Month/Year Selector */}
          <div className="relative inline-block" ref={monthPickerRef}>
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

              <button
                type="button"
                id="monthly-attendance-month-selector"
                data-testid="month-selector-trigger"
                onClick={() => {
                  setPickerYear(year);
                  setPickerViewMode('months');
                  setIsMonthPickerOpen(prev => !prev);
                }}
                aria-expanded={isMonthPickerOpen}
                aria-haspopup="dialog"
                aria-label={`Select Month and Year, current is ${monthLabel}`}
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 text-xs sm:text-sm font-black text-slate-900 dark:text-[#F2F3F5] hover:bg-slate-200/60 dark:hover:bg-[#2B2D31] rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <span>{monthLabel}</span>
                <ChevronDown className={clsx('w-3.5 h-3.5 text-slate-500 dark:text-[#949BA4] transition-transform duration-150', isMonthPickerOpen && 'rotate-180')} />
              </button>

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

            {/* Custom SITE WORK Month/Year Selector Popover */}
            {isMonthPickerOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="SITE WORK Month and Year Selector"
                data-testid="month-selector-popover"
                className="absolute top-full mt-2 left-0 sm:left-auto sm:right-0 z-50 p-3 sm:p-4 w-[310px] sm:w-[330px] max-w-[calc(100vw-2rem)] bg-white dark:bg-[#18191C] text-slate-900 dark:text-[#F2F3F5] border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl animate-in fade-in-50 zoom-in-95 duration-100"
              >
                {/* Popover Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#2B2D31] gap-1">
                  <div className="flex items-center gap-1 min-w-0">
                    {/* Month Mode Tab */}
                    <button
                      type="button"
                      onClick={() => setPickerViewMode('months')}
                      className={clsx(
                        'inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1 rounded-lg font-black text-xs sm:text-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                        pickerViewMode === 'months'
                          ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B]'
                          : 'text-slate-900 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42]'
                      )}
                    >
                      <span>{MONTH_NAMES[month - 1]}</span>
                      <ChevronDown className="w-3.5 h-3.5 opacity-80 shrink-0" />
                    </button>

                    {/* Year Mode Tab */}
                    <button
                      type="button"
                      onClick={() => setPickerViewMode(prev => prev === 'years' ? 'months' : 'years')}
                      className={clsx(
                        'inline-flex items-center gap-1 min-h-[38px] px-2.5 py-1 rounded-lg font-black text-xs sm:text-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                        pickerViewMode === 'years'
                          ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B]'
                          : 'text-slate-900 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42]'
                      )}
                    >
                      <span>{pickerYear}</span>
                      <ChevronDown className="w-3.5 h-3.5 opacity-80 shrink-0" />
                    </button>
                  </div>

                  {/* Year Step Arrows */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPickerYear(prev => prev - 1)}
                      aria-label="Previous Year"
                      className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                      title="Previous Year"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickerYear(prev => prev + 1)}
                      aria-label="Next Year"
                      className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                      title="Next Year"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 12-Month Selector Grid */}
                {pickerViewMode === 'months' && (
                  <div className="py-2.5 animate-in fade-in-50 duration-100">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] mb-2 px-1">
                      Choose Month ({pickerYear})
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {MONTH_NAMES.map((mName, idx) => {
                        const mNum = idx + 1;
                        const isCurrent = mNum === month && pickerYear === year;
                        return (
                          <button
                            key={mName}
                            type="button"
                            onClick={() => handleSelectMonth(mNum)}
                            className={clsx(
                              'min-h-[44px] px-2 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors touch-action-manipulation focus:outline-none',
                              'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                              isCurrent
                                ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] font-black shadow-sm'
                                : 'text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-200 dark:border-[#3A3D42]'
                            )}
                          >
                            {SHORT_MONTH_NAMES[idx]}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Direct Year Selector Grid (2018 - 2038) */}
                {pickerViewMode === 'years' && (
                  <div className="py-2.5 animate-in fade-in-50 duration-100">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] mb-2 px-1">
                      Choose Year
                    </div>
                    <div className="grid grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
                      {SUPPORTED_YEARS.map((y) => {
                        const isCurrent = y === pickerYear;
                        return (
                          <button
                            key={y}
                            type="button"
                            onClick={() => handleSelectYear(y)}
                            className={clsx(
                              'min-h-[44px] px-2 py-2 rounded-lg text-xs sm:text-sm font-bold transition-colors touch-action-manipulation focus:outline-none',
                              'focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                              isCurrent
                                ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] font-black shadow-sm'
                                : 'text-slate-800 dark:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-200 dark:border-[#3A3D42]'
                            )}
                          >
                            {y}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Popover Footer Actions */}
                <div className="pt-3 border-t border-slate-200 dark:border-[#2B2D31] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={setThisMonth}
                    className="min-h-[38px] px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-[#202225] dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42] text-xs font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                  >
                    Current Month
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMonthPickerOpen(false)}
                    className="min-h-[38px] px-3 py-1 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-xs font-black text-white dark:text-[#07130B] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
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
              Total Day Count
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
                  ({monthlyMetrics.highestDay.workerDays} Day Count | {formatINR(monthlyMetrics.highestDay.costPaise)})
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
                    ({monthlyMetrics.lowestDay.workerDays} Day Count | {formatINR(monthlyMetrics.lowestDay.costPaise)})
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area: Table View vs Calendar View */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading monthly attendance records...
        </div>
      ) : categoryTree.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm">
          No attendance recorded for {monthLabel}.
        </div>
      ) : viewMode === 'table' ? (
        /* TABLE VIEW (with Weekly Attendance Category Hierarchy Visual Treatment) */
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
          {/* Table Affordance Header */}
          <div className="flex items-center justify-between px-3.5 sm:px-4 py-2.5 sm:py-3 bg-slate-900 dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] text-xs text-white dark:text-[#F2F3F5] font-semibold shadow-sm">
            <span className="flex items-center gap-1.5 font-bold text-white dark:text-[#F2F3F5]">
              <Layers className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
              Monthly Workforce Matrix
            </span>
            <span className="inline-flex items-center text-[11px] text-slate-300 dark:text-[#949BA4] font-semibold md:hidden">
              Scroll horizontally to view all columns →
            </span>
          </div>

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[620px] sm:min-w-full">
              <thead>
                <tr className="bg-[#F8F9FA] dark:bg-[#202225] text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                  <th className="py-3 px-3 sm:px-4">Category / Role</th>
                  <th className="py-3 px-3 text-center border-l border-black dark:border-[#3A3D42]">Full Days</th>
                  <th className="py-3 px-3 text-center border-l border-black dark:border-[#3A3D42]">Half Days</th>
                  <th className="py-3 px-3 text-center border-l border-black dark:border-[#3A3D42]">Day Count</th>
                  <th className="py-3 px-3 sm:px-4 text-right border-l border-black dark:border-[#3A3D42]">Monthly Labour Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31] text-xs">
                {categoryTree.map((cat) => (
                  <React.Fragment key={cat.categoryId}>
                    {/* Category Header Row (Dark navy/blue + white typography) */}
                    <tr className="bg-slate-900 dark:bg-[#202225] text-white border-y border-slate-900 dark:border-[#3A3D42]">
                      <td colSpan={5} className="py-2.5 px-3 sm:px-4 uppercase tracking-wider text-xs font-black text-white dark:text-[#F2F3F5]">
                        <span className="inline-flex items-center gap-2 font-black text-white dark:text-[#F2F3F5]">
                          <Layers className="w-3.5 h-3.5 text-emerald-400 dark:text-[#1ED760] shrink-0 inline-block" />
                          {cat.categoryName}
                        </span>
                      </td>
                    </tr>

                    {/* Role Rows */}
                    {cat.roles.map((r) => (
                      <tr key={r.roleId} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                        <td className="py-2.5 px-3 sm:px-4 font-semibold text-[#0F172A] dark:text-[#F2F3F5]">
                          {r.roleName}
                        </td>
                        <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-medium text-slate-700 dark:text-[#B5BAC1]">
                          {r.fullDays}
                        </td>
                        <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-medium text-slate-700 dark:text-[#B5BAC1]">
                          {r.halfDays}
                        </td>
                        <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-black text-[#0F172A] dark:text-[#F2F3F5]">
                          {r.workerDays}
                        </td>
                        <td className="py-2.5 px-3 sm:px-4 text-right border-l border-black dark:border-[#3A3D42] font-black text-emerald-700 dark:text-[#1ED760] text-sm">
                          {formatINR(r.costPaise)}
                        </td>
                      </tr>
                    ))}

                    {/* Category Subtotal Row (Inverted dark blue / navy + white typography) */}
                    <tr className="bg-slate-800 dark:bg-[#202225] text-white font-bold text-xs border-b border-slate-900 dark:border-[#3A3D42]">
                      <td className="py-2.5 px-3 sm:px-4 text-[11px] uppercase tracking-wide text-white">
                        Subtotal — {cat.categoryName}
                      </td>
                      <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-semibold text-white">
                        {cat.fullDays}
                      </td>
                      <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-semibold text-white">
                        {cat.halfDays}
                      </td>
                      <td className="py-2.5 px-3 text-center border-l border-black dark:border-[#3A3D42] font-black text-amber-300 dark:text-[#1ED760]">
                        {cat.workerDays}
                      </td>
                      <td className="py-2.5 px-3 sm:px-4 text-right border-l border-black dark:border-[#3A3D42] font-black text-amber-300 dark:text-[#1ED760] text-sm">
                        {formatINR(cat.costPaise)}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}

                {/* Grand Total Row (Inverted dark blue / navy + white typography) */}
                <tr className="bg-slate-900 dark:bg-[#18191C] text-white font-black text-xs border-t-2 border-slate-900 dark:border-[#4A4D52]">
                  <td className="py-3 px-3 sm:px-4 uppercase tracking-wider text-white">
                    Grand Total
                  </td>
                  <td className="py-3 px-3 text-center border-l border-black dark:border-[#4A4D52] text-white font-bold">
                    {monthlyMetrics.totalFullDays}
                  </td>
                  <td className="py-3 px-3 text-center border-l border-black dark:border-[#4A4D52] text-white font-bold">
                    {monthlyMetrics.totalHalfDays}
                  </td>
                  <td className="py-3 px-3 text-center border-l border-black dark:border-[#4A4D52] text-amber-400 dark:text-[#1ED760] text-sm font-black">
                    {monthlyMetrics.totalWorkerDays}
                  </td>
                  <td className="py-3 px-3 sm:px-4 text-right border-l border-black dark:border-[#4A4D52] text-amber-400 dark:text-[#1ED760] text-sm font-black">
                    {formatINR(monthlyMetrics.totalCostPaise)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* CALENDAR VIEW (7-Column Mon-Sun Grid with Daily Metrics & Double-Click Drill-Down) */
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
          {/* Calendar Header Affordance */}
          <div className="flex items-center justify-between px-3.5 sm:px-4 py-2.5 bg-[#F8F9FA] dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] text-xs text-slate-600 dark:text-[#949BA4] font-medium">
            <span className="flex items-center gap-1.5 font-bold text-[#0F172A] dark:text-[#F2F3F5]">
              <CalendarIcon className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
              Monthly Attendance Calendar
            </span>
            <span className="inline-flex items-center text-[11px] text-slate-500 dark:text-[#949BA4] font-medium">
              Double-click any day to open Daily Attendance
            </span>
          </div>

          <div className="p-3 sm:p-4 overflow-x-auto custom-scrollbar">
            <div className="min-w-[650px] sm:min-w-full">
              {/* 7-Column Weekday Headers (MON to SUN) */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2 mb-2 text-center">
                {WEEKDAY_NAMES.map((wd) => (
                  <div
                    key={wd}
                    className="py-2 text-[11px] sm:text-xs font-black uppercase text-slate-700 dark:text-[#D1D5DB] bg-slate-100 dark:bg-[#202225] rounded-lg border border-slate-300 dark:border-[#3A3D42]"
                  >
                    {wd}
                  </div>
                ))}
              </div>

              {/* Monthly Calendar Grid Cells */}
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {/* Leading Blank Cells */}
                {calendarGrid.leadingBlanks.map((blankIdx) => (
                  <div
                    key={`blank-lead-${blankIdx}`}
                    className="min-h-[110px] p-2 rounded-lg border border-dashed border-slate-200 dark:border-[#2B2D31] bg-slate-50/20 dark:bg-[#111214]/20 opacity-30 select-none pointer-events-none"
                    aria-hidden="true"
                  />
                ))}

                {/* Day Cells */}
                {calendarGrid.days.map((d) => {
                  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                  const isToday = dateStr === todayISO;
                  const dayData = dailyMetricsMap.get(dateStr);
                  const hasAttendance = dayData && (dayData.workerDays > 0 || dayData.workers > 0 || dayData.full > 0 || dayData.half > 0);

                  return (
                    <div
                      key={dateStr}
                      data-date={dateStr}
                      data-testid={`calendar-day-${dateStr}`}
                      onDoubleClick={() => handleDayDoubleClick(dateStr)}
                      title={`Double-click to view daily attendance for ${dateStr}`}
                      className={clsx(
                        'min-h-[110px] p-2 sm:p-2.5 rounded-lg border transition-all select-none cursor-pointer flex flex-col justify-between text-xs touch-action-manipulation',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                        isToday
                          ? 'border-2 border-emerald-600 dark:border-[#1ED760] bg-emerald-50/25 dark:bg-[#1ED760]/10 shadow-sm'
                          : hasAttendance
                          ? 'border-slate-300 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:border-slate-400 dark:hover:border-[#52565E] hover:bg-slate-50/60 dark:hover:bg-[#202225]/50'
                          : 'border-slate-200 dark:border-[#2B2D31] bg-slate-50/40 dark:bg-[#111214]/40 hover:bg-slate-100/60 dark:hover:bg-[#202225]/30'
                      )}
                    >
                      {/* Day Number Header & Today Indicator */}
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={clsx(
                            'font-black text-xs sm:text-sm',
                            isToday
                              ? 'text-emerald-700 dark:text-[#1ED760]'
                              : 'text-[#0F172A] dark:text-[#F2F3F5]'
                          )}
                        >
                          {d}
                        </span>
                        {isToday && (
                          <span className="text-[9px] sm:text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-emerald-600 text-white dark:bg-[#1ED760] dark:text-[#07130B] shadow-xs">
                            Today
                          </span>
                        )}
                      </div>

                      {/* Day Metrics / Empty State */}
                      <div className="mt-1 space-y-0.5 min-h-[48px] flex flex-col justify-center">
                        {hasAttendance ? (
                          <>
                            <div className="font-semibold text-slate-700 dark:text-[#D1D5DB] text-[11px] truncate">
                              {dayData.full}F{dayData.half > 0 ? ` + ${dayData.half}H` : ''} ({dayData.workers} {dayData.workers === 1 ? 'Worker' : 'Workers'})
                            </div>
                            <div className="font-black text-amber-600 dark:text-[#1ED760] text-xs">
                              {dayData.workerDays} Day Count
                            </div>
                            <div
                              className="font-semibold text-slate-600 dark:text-[#949BA4] text-[10px] truncate"
                              title={formatINR(dayData.costPaise)}
                            >
                              {formatINR(dayData.costPaise)}
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] text-slate-400 dark:text-[#6D6F78] italic">
                            No attendance
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Trailing Blank Cells */}
                {calendarGrid.trailingBlanks.map((blankIdx) => (
                  <div
                    key={`blank-trail-${blankIdx}`}
                    className="min-h-[110px] p-2 rounded-lg border border-dashed border-slate-200 dark:border-[#2B2D31] bg-slate-50/20 dark:bg-[#111214]/20 opacity-30 select-none pointer-events-none"
                    aria-hidden="true"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MonthlyAttendanceReportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm font-semibold text-slate-500">Loading Monthly Attendance...</div>}>
      <MonthlyAttendanceReportContent />
    </Suspense>
  );
}
