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
  ChevronDown, 
  Layers, 
  Calendar as CalendarIcon, 
  Users, 
  FolderTree, 
  AlertCircle,
  ArrowRight
} from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

interface CategoryOption {
  id: string;
  name: string;
  sort_order?: number;
}

interface RoleOption {
  id: string;
  name: string;
  category_id: string;
  category_name?: string;
  daily_rate_paise?: number;
}

interface FinancialRecord {
  id: string;
  date: string;
  type: 'CREDIT' | 'DEBIT';
  debit_category: string | null;
  amount_paise: number;
  description: string;
  reference_note: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const SHORT_MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

function getTodayISO(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYearStartISO(year: number): string {
  return `${year}-01-01`;
}

function WorkforceAnalyticsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedSite, selectedSiteId } = useSite();

  // Navigation / Tabs State
  const [activeTab, setActiveTab] = useState<'attendance' | 'transactions'>('attendance');
  const [viewMode, setViewMode] = useState<'overall' | 'year'>('overall');

  // Authoritative Dynamic Categories and Roles
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);

  // Hierarchical Multi-Select State
  const [isAllSelected, setIsAllSelected] = useState<boolean>(true);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(new Set());
  const [isSelectorOpen, setIsSelectorOpen] = useState<boolean>(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Authoritative Earliest Persisted Dates
  const [earliestAttendanceDate, setEarliestAttendanceDate] = useState<string | null>(null);
  const [earliestTransactionDate, setEarliestTransactionDate] = useState<string | null>(null);

  // Date Range State: Draft vs Applied
  const currentYear = new Date().getFullYear();
  const todayISO = useMemo(() => getTodayISO(), []);
  
  const [draftFromDate, setDraftFromDate] = useState<string>('');
  const [draftToDate, setDraftToDate] = useState<string>(() => todayISO);
  const [appliedFromDate, setAppliedFromDate] = useState<string>('');
  const [appliedToDate, setAppliedToDate] = useState<string>(() => todayISO);
  const [dateValidationError, setDateValidationError] = useState<string | null>(null);

  // Data Loading & Records State
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceDbRecord[]>([]);
  const [yearAttendanceRecords, setYearAttendanceRecords] = useState<AttendanceDbRecord[]>([]);
  const [transactions, setTransactions] = useState<FinancialRecord[]>([]);
  const [financeSummary, setFinanceSummary] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Year Calendar State
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [highlightedMonth, setHighlightedMonth] = useState<number | null>(null);

  // Close selector on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setIsSelectorOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Fetch dynamic categories and roles
  useEffect(() => {
    if (!selectedSiteId) return;

    let isMounted = true;
    Promise.all([
      fetch('/api/categories').then((r) => r.json()),
      fetch(`/api/roles?siteId=${selectedSiteId}`).then((r) => r.json()),
    ])
      .then(([catData, roleData]) => {
        if (!isMounted) return;
        const catList: CategoryOption[] = catData.categories || [];
        const roleList: RoleOption[] = roleData.roles || [];
        setCategories(catList);
        setRoles(roleList);

        // Check if query params pre-select category
        const queryCat = searchParams?.get('categoryId');
        if (queryCat && catList.some((c) => c.id === queryCat)) {
          setIsAllSelected(false);
          setSelectedCategoryIds(new Set([queryCat]));
          const catRoles = roleList.filter((r) => r.category_id === queryCat).map((r) => r.id);
          setSelectedRoleIds(new Set(catRoles));
          setExpandedCategoryIds(new Set([queryCat]));
        }
      })
      .catch((err) => console.error('Error fetching categories/roles:', err));

    return () => {
      isMounted = false;
    };
  }, [selectedSiteId, searchParams]);

  // Fetch authoritative date boundaries on site change
  useEffect(() => {
    if (!selectedSiteId) return;
    let isMounted = true;

    Promise.all([
      fetch(`/api/attendance/range?siteId=${selectedSiteId}&bounds=true`).then((r) => r.json()),
      fetch(`/api/finance?siteId=${selectedSiteId}`).then((r) => r.json()),
    ])
      .then(([attData, finData]) => {
        if (!isMounted) return;
        const attEarliest = attData.earliestDate || null;
        const finEarliest = finData.earliestDate || null;
        setEarliestAttendanceDate(attEarliest);
        setEarliestTransactionDate(finEarliest);

        const activeEarliest = activeTab === 'attendance' ? attEarliest : finEarliest;
        const initialFrom = activeEarliest || todayISO;
        setDraftFromDate(initialFrom);
        setAppliedFromDate(initialFrom);
        setDraftToDate(todayISO);
        setAppliedToDate(todayISO);
      })
      .catch((err) => console.error('Error fetching date bounds:', err));

    return () => {
      isMounted = false;
    };
  }, [selectedSiteId]);

  // Active Earliest Selectable Date based on Active Mode
  const activeEarliestDate = activeTab === 'attendance' ? earliestAttendanceDate : earliestTransactionDate;

  // Handle Tab Switch (ATTENDANCE vs TRANSACTIONS)
  const handleTabChange = (newTab: 'attendance' | 'transactions') => {
    setActiveTab(newTab);
    setDateValidationError(null);
    const targetEarliest = newTab === 'attendance' ? earliestAttendanceDate : earliestTransactionDate;
    if (targetEarliest) {
      setDraftFromDate(targetEarliest);
      setAppliedFromDate(targetEarliest);
    }
  };

  // Fetch Attendance for Applied Range
  const fetchAppliedAttendance = useCallback(async () => {
    if (!selectedSiteId || !appliedFromDate || !appliedToDate) return;
    setLoading(true);
    try {
      const url = `/api/attendance/range?siteId=${selectedSiteId}&startDate=${appliedFromDate}&endDate=${appliedToDate}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setAttendanceRecords(data.records || []);
        if (data.earliestDate && !earliestAttendanceDate) {
          setEarliestAttendanceDate(data.earliestDate);
        }
      }
    } catch (err) {
      console.error('Error fetching range attendance:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, appliedFromDate, appliedToDate, earliestAttendanceDate]);

  // Fetch Attendance for Selected Year (for Year Calendar)
  const fetchYearAttendance = useCallback(async () => {
    if (!selectedSiteId) return;
    try {
      const yStart = `${selectedYear}-01-01`;
      const yEnd = `${selectedYear}-12-31`;
      const res = await fetch(`/api/attendance/range?siteId=${selectedSiteId}&startDate=${yStart}&endDate=${yEnd}`);
      if (res.ok) {
        const data = await res.json();
        setYearAttendanceRecords(data.records || []);
      }
    } catch (err) {
      console.error('Error fetching yearly attendance:', err);
    }
  }, [selectedSiteId, selectedYear]);

  // Fetch Financial Transactions for Applied Range
  const fetchTransactions = useCallback(async () => {
    if (!selectedSiteId || !appliedFromDate || !appliedToDate) return;
    try {
      const res = await fetch(`/api/finance?siteId=${selectedSiteId}&startDate=${appliedFromDate}&endDate=${appliedToDate}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setFinanceSummary(data.summary || null);
        if (data.earliestDate && !earliestTransactionDate) {
          setEarliestTransactionDate(data.earliestDate);
        }
      }
    } catch (err) {
      console.error('Error fetching transactions:', err);
    }
  }, [selectedSiteId, appliedFromDate, appliedToDate, earliestTransactionDate]);

  useEffect(() => {
    fetchAppliedAttendance();
  }, [fetchAppliedAttendance]);

  useEffect(() => {
    fetchYearAttendance();
  }, [fetchYearAttendance]);

  useEffect(() => {
    if (activeTab === 'transactions') {
      fetchTransactions();
    }
  }, [activeTab, fetchTransactions]);

  // Handle APPLY Button Click
  const handleApplyDateRange = () => {
    setDateValidationError(null);

    // If From Date selected but To Date empty, default To Date = From Date
    let effectiveTo = draftToDate;
    if (draftFromDate && !draftToDate) {
      effectiveTo = draftFromDate;
      setDraftToDate(draftFromDate);
    }

    if (!draftFromDate) {
      setDateValidationError('Please select a valid From Date.');
      return;
    }

    if (activeEarliestDate && draftFromDate < activeEarliestDate) {
      setDateValidationError(`From Date cannot be earlier than ${activeEarliestDate}.`);
      return;
    }

    if (draftFromDate > effectiveTo) {
      setDateValidationError('To Date must be on or after From Date.');
      return;
    }

    // Apply Range
    setAppliedFromDate(draftFromDate);
    setAppliedToDate(effectiveTo);
  };

  // Selector Toggles
  const handleToggleAll = () => {
    if (isAllSelected) {
      setIsAllSelected(false);
      setSelectedCategoryIds(new Set());
      setSelectedRoleIds(new Set());
    } else {
      setIsAllSelected(true);
      setSelectedCategoryIds(new Set(categories.map((c) => c.id)));
      setSelectedRoleIds(new Set(roles.map((r) => r.id)));
    }
  };

  const handleToggleCategory = (catId: string) => {
    const nextCatIds = new Set(selectedCategoryIds);
    const nextRoleIds = new Set(selectedRoleIds);
    const catRoles = roles.filter((r) => r.category_id === catId);

    if (nextCatIds.has(catId)) {
      nextCatIds.delete(catId);
      catRoles.forEach((r) => nextRoleIds.delete(r.id));
    } else {
      nextCatIds.add(catId);
      catRoles.forEach((r) => nextRoleIds.add(r.id));
    }

    setIsAllSelected(false);
    setSelectedCategoryIds(nextCatIds);
    setSelectedRoleIds(nextRoleIds);
  };

  const handleToggleRole = (roleId: string, catId: string) => {
    const nextRoleIds = new Set(selectedRoleIds);
    const nextCatIds = new Set(selectedCategoryIds);
    const catRoles = roles.filter((r) => r.category_id === catId);

    if (nextRoleIds.has(roleId)) {
      nextRoleIds.delete(roleId);
      const remainingCatRoles = catRoles.filter((r) => nextRoleIds.has(r.id));
      if (remainingCatRoles.length === 0) {
        nextCatIds.delete(catId);
      }
    } else {
      nextRoleIds.add(roleId);
      nextCatIds.add(catId);
    }

    setIsAllSelected(false);
    setSelectedRoleIds(nextRoleIds);
    setSelectedCategoryIds(nextCatIds);
  };

  const toggleCategoryExpand = (catId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(expandedCategoryIds);
    if (next.has(catId)) next.delete(catId);
    else next.add(catId);
    setExpandedCategoryIds(next);
  };

  // Filtered Attendance Records (based on Category / Role selections)
  const filteredRecords = useMemo(() => {
    if (isAllSelected) return attendanceRecords;
    return attendanceRecords.filter((r) => {
      if (selectedRoleIds.size > 0 && selectedRoleIds.has(r.role_id)) return true;
      if (r.category_id && selectedCategoryIds.has(r.category_id) && selectedRoleIds.size === 0) return true;
      return false;
    });
  }, [attendanceRecords, isAllSelected, selectedCategoryIds, selectedRoleIds]);

  // Overall KPI Metrics
  const overallMetrics = useMemo(() => {
    const totalFullDays = filteredRecords.reduce((sum, r) => sum + r.full_day_count, 0);
    const totalHalfDays = filteredRecords.reduce((sum, r) => sum + r.half_day_count, 0);
    const totalWorkerDays = filteredRecords.reduce((sum, r) => sum + r.worker_days, 0);
    const totalCostPaise = filteredRecords.reduce((sum, r) => sum + r.total_cost_paise, 0);
    const totalWorkers = filteredRecords.reduce((sum, r) => sum + r.total_workers, 0);
    
    const activeDates = new Set(filteredRecords.map((r) => r.date));
    const activeDaysCount = activeDates.size;
    const avgDailyHeadcount = activeDaysCount > 0 ? (totalWorkerDays / activeDaysCount).toFixed(1) : '0';

    return {
      totalFullDays,
      totalHalfDays,
      totalWorkerDays,
      totalCostPaise,
      totalWorkers,
      activeDaysCount,
      avgDailyHeadcount,
    };
  }, [filteredRecords]);

  // Grouping for View 1: Category -> Roles Matrix
  const categoryGroups = useMemo(() => {
    const groupMap = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        roles: Map<
          string,
          {
            roleId: string;
            roleName: string;
            rateSnapshotPaise: number;
            fullDayCount: number;
            halfDayCount: number;
            totalWorkers: number;
            workerDays: number;
            totalCostPaise: number;
          }
        >;
      }
    >();

    for (const rec of filteredRecords) {
      const catId = rec.category_id || 'uncategorized';
      if (!groupMap.has(catId)) {
        groupMap.set(catId, {
          categoryId: catId,
          categoryName: rec.category_name || 'Uncategorized',
          roles: new Map(),
        });
      }
      const catGroup = groupMap.get(catId)!;
      if (!catGroup.roles.has(rec.role_id)) {
        catGroup.roles.set(rec.role_id, {
          roleId: rec.role_id,
          roleName: rec.role_name || 'Role',
          rateSnapshotPaise: rec.rate_snapshot_paise,
          fullDayCount: 0,
          halfDayCount: 0,
          totalWorkers: 0,
          workerDays: 0,
          totalCostPaise: 0,
        });
      }
      const roleRow = catGroup.roles.get(rec.role_id)!;
      roleRow.fullDayCount += rec.full_day_count;
      roleRow.halfDayCount += rec.half_day_count;
      roleRow.totalWorkers += rec.total_workers;
      roleRow.workerDays += rec.worker_days;
      roleRow.totalCostPaise += rec.total_cost_paise;
    }

    return Array.from(groupMap.values()).map((g) => {
      const roleRows = Array.from(g.roles.values());
      const subtotalFull = roleRows.reduce((sum, r) => sum + r.fullDayCount, 0);
      const subtotalHalf = roleRows.reduce((sum, r) => sum + r.halfDayCount, 0);
      const subtotalWorkers = roleRows.reduce((sum, r) => sum + r.totalWorkers, 0);
      const subtotalWorkerDays = roleRows.reduce((sum, r) => sum + r.workerDays, 0);
      const subtotalCostPaise = roleRows.reduce((sum, r) => sum + r.totalCostPaise, 0);

      return {
        ...g,
        roleRows,
        subtotal: {
          full: subtotalFull,
          half: subtotalHalf,
          totalWorkers: subtotalWorkers,
          workerDays: subtotalWorkerDays,
          costPaise: subtotalCostPaise,
        },
      };
    });
  }, [filteredRecords]);

  // Year Calendar Month Summaries (12 Months)
  const yearlyMonthSummaries = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const monthNum = i + 1;
      const monthPrefix = `${selectedYear}-${String(monthNum).padStart(2, '0')}`;
      const monthRecords = yearAttendanceRecords.filter((r) => r.date.startsWith(monthPrefix));

      const fullDays = monthRecords.reduce((sum, r) => sum + r.full_day_count, 0);
      const halfDays = monthRecords.reduce((sum, r) => sum + r.half_day_count, 0);
      const totalWorkers = monthRecords.reduce((sum, r) => sum + r.total_workers, 0);
      const workerDays = monthRecords.reduce((sum, r) => sum + r.worker_days, 0);
      const totalCostPaise = monthRecords.reduce((sum, r) => sum + r.total_cost_paise, 0);
      const activeDays = new Set(monthRecords.map((r) => r.date)).size;

      return {
        monthNum,
        monthName: MONTH_NAMES[i],
        shortName: SHORT_MONTH_NAMES[i],
        monthStr: monthPrefix,
        fullDays,
        halfDays,
        totalWorkers,
        workerDays,
        totalCostPaise,
        activeDays,
        hasRecords: monthRecords.length > 0,
        records: monthRecords,
      };
    });
  }, [selectedYear, yearAttendanceRecords]);

  // Month Drilldown Navigation Handler (Year Calendar -> Monthly Attendance)
  const handleMonthDoubleClick = (yyyyMm: string) => {
    router.push(`/attendance/monthly?month=${yyyyMm}`);
  };

  // Dynamic Selector Summary Label
  const selectorLabel = useMemo(() => {
    if (isAllSelected) return 'ALL WORKERS';
    if (selectedCategoryIds.size === 0) return 'Select Category / Role';
    if (selectedCategoryIds.size === 1) {
      const catId = Array.from(selectedCategoryIds)[0];
      const cat = categories.find((c) => c.id === catId);
      const catRoles = roles.filter((r) => r.category_id === catId && selectedRoleIds.has(r.id));
      if (catRoles.length === 0 || catRoles.length === roles.filter((r) => r.category_id === catId).length) {
        return cat?.name || 'Category';
      }
      return `${cat?.name} (${catRoles.length} roles)`;
    }
    return `${selectedCategoryIds.size} Categories Selected`;
  }, [isAllSelected, selectedCategoryIds, selectedRoleIds, categories, roles]);

  const isSingleDayRange = appliedFromDate === appliedToDate;

  return (
    <div className="space-y-4 sm:space-y-6 max-w-full overflow-x-hidden">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] sm:text-xs font-bold text-emerald-600 dark:text-[#1ED760] uppercase tracking-wider">
              {activeTab === 'attendance' ? 'Attendance Matrix' : 'Financial Ledger'}
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-[#0F172A] dark:text-[#F2F3F5] tracking-tight mt-0.5">
            ANALYTICS
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            {viewMode === 'year' ? (
              <>Year: <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">{selectedYear}</span></>
            ) : (
              <>
                Range: <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">{appliedFromDate}</span> to{' '}
                <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">{appliedToDate}</span>
              </>
            )}{' '}
            | Site: <span className="font-bold text-slate-700 dark:text-[#B5BAC1]">{selectedSite?.name || 'No Site Selected'}</span>
          </p>
        </div>

        {/* Top Controls: Secondary Tabs & View Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Secondary Tab Switcher: Attendance vs Transactions (Hidden in Year Calendar mode) */}
          {viewMode !== 'year' && (
            <div className="inline-flex p-1 bg-slate-100 dark:bg-[#111214] rounded-lg border border-slate-900 dark:border-[#3A3D42]">
              <button
                type="button"
                data-testid="tab-attendance"
                onClick={() => handleTabChange('attendance')}
                aria-pressed={activeTab === 'attendance'}
                className={clsx(
                  'min-h-[40px] px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-bold transition-all touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                  activeTab === 'attendance'
                    ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] shadow-sm'
                    : 'text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                ATTENDANCE
              </button>
              <button
                type="button"
                data-testid="tab-transactions"
                onClick={() => handleTabChange('transactions')}
                aria-pressed={activeTab === 'transactions'}
                className={clsx(
                  'min-h-[40px] px-3 sm:px-4 py-1.5 rounded-md text-xs sm:text-sm font-bold transition-all touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                  activeTab === 'transactions'
                    ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] shadow-sm'
                    : 'text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                TRANSACTIONS
              </button>
            </div>
          )}

          {/* Two View Modes Switcher: Overall Breakdown and Year Calendar */}
          {activeTab === 'attendance' && (
            <div className="inline-flex p-1 bg-slate-100 dark:bg-[#111214] rounded-lg border border-slate-900 dark:border-[#3A3D42]">
              <button
                type="button"
                data-testid="view-mode-overall"
                onClick={() => setViewMode('overall')}
                aria-pressed={viewMode === 'overall'}
                title="Overall Breakdown"
                className={clsx(
                  'min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-bold flex items-center space-x-1.5 transition-all touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                  viewMode === 'overall'
                    ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] shadow-sm'
                    : 'text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <Layers className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Overall Breakdown</span>
              </button>
              <button
                type="button"
                data-testid="view-mode-year"
                onClick={() => setViewMode('year')}
                aria-pressed={viewMode === 'year'}
                title="Year Calendar"
                className={clsx(
                  'min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm font-bold flex items-center space-x-1.5 transition-all touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]',
                  viewMode === 'year'
                    ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#07130B] shadow-sm'
                    : 'text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-white'
                )}
              >
                <CalendarIcon className="w-4 h-4 shrink-0" />
                <span className="hidden sm:inline">Year Calendar</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Control Filter Bar: Hierarchical Selector & Date Range (Draft/Apply) - Overall Breakdown Only */}
      {viewMode === 'overall' && (
        <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-4">
          <div className={clsx('flex flex-col lg:flex-row lg:items-center gap-4', activeTab === 'attendance' ? 'justify-between' : 'justify-start')}>
            {/* Left: Dynamic Hierarchical Category/Role Multi-Select (Attendance Mode Only) */}
            {activeTab === 'attendance' && (
              <div className="relative w-full lg:w-auto" ref={selectorRef}>
                <span className="text-[11px] font-black uppercase text-slate-500 dark:text-[#949BA4] block mb-1">
                  Filter
                </span>
                <button
                  type="button"
                  data-testid="filter-dropdown-btn"
                  onClick={() => setIsSelectorOpen(!isSelectorOpen)}
                  aria-expanded={isSelectorOpen}
                  aria-haspopup="true"
                  className="w-full lg:w-[320px] min-h-[44px] px-3.5 py-2 bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg text-left text-xs sm:text-sm font-bold text-slate-900 dark:text-[#F2F3F5] flex items-center justify-between shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Users className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
                    <span className="truncate">{selectorLabel}</span>
                  </div>
                  <ChevronDown className={clsx('w-4 h-4 text-slate-500 transition-transform shrink-0', isSelectorOpen && 'rotate-180')} />
                </button>

                {/* Expandable Hierarchical Dropdown Panel */}
                {isSelectorOpen && (
                  <div className="absolute left-0 top-full mt-1.5 z-40 w-full sm:w-[360px] bg-white dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl p-3 max-h-[380px] overflow-y-auto custom-scrollbar animate-in fade-in-50 zoom-in-95">
                    {/* Top Toggle: ALL */}
                    <div className="flex items-center justify-between pb-2.5 border-b border-slate-200 dark:border-[#2B2D31]">
                      <label className="flex items-center space-x-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={handleToggleAll}
                          className="w-4 h-4 rounded border-slate-900 text-slate-900 dark:text-[#1ED760] focus:ring-0 cursor-pointer"
                        />
                        <span className="text-xs font-black uppercase text-slate-900 dark:text-[#F2F3F5]">
                          ALL (ALL WORKERS)
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={handleToggleAll}
                        className="text-[11px] font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white"
                      >
                        Reset
                      </button>
                    </div>

                  {/* Categories & Roles Tree */}
                  <div className="mt-2.5 space-y-2">
                    {categories.map((cat) => {
                      const catRoles = roles.filter((r) => r.category_id === cat.id);
                      const isCatSelected = isAllSelected || selectedCategoryIds.has(cat.id);
                      const isExpanded = expandedCategoryIds.has(cat.id);
                      const selectedRoleCount = isAllSelected 
                        ? catRoles.length 
                        : catRoles.filter((r) => selectedRoleIds.has(r.id)).length;

                      return (
                        <div key={cat.id} className="border border-slate-200 dark:border-[#2B2D31] rounded-lg p-2 bg-slate-50/50 dark:bg-[#111214]/50">
                          {/* Category Header Row */}
                          <div className="flex items-center justify-between">
                            <label className="flex items-center space-x-2 cursor-pointer select-none truncate">
                              <input
                                type="checkbox"
                                checked={isCatSelected}
                                onChange={() => handleToggleCategory(cat.id)}
                                className="w-4 h-4 rounded border-slate-900 text-slate-900 dark:text-[#1ED760] focus:ring-0 cursor-pointer"
                              />
                              <span className="text-xs font-black text-slate-800 dark:text-[#F2F3F5] uppercase truncate">
                                {cat.name}
                              </span>
                            </label>

                            <div className="flex items-center space-x-1.5 shrink-0">
                              {catRoles.length > 0 && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-[#2B2D31] text-slate-700 dark:text-[#B5BAC1]">
                                  {selectedRoleCount}/{catRoles.length}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={(e) => toggleCategoryExpand(cat.id, e)}
                                aria-label={`Expand ${cat.name} roles`}
                                className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded"
                              >
                                <ChevronDown className={clsx('w-3.5 h-3.5 transition-transform', isExpanded && 'rotate-180')} />
                              </button>
                            </div>
                          </div>

                          {/* Child Roles */}
                          {isExpanded && catRoles.length > 0 && (
                            <div className="mt-2 pl-6 pr-1 space-y-1.5 border-t border-slate-200 dark:border-[#2B2D31] pt-2">
                              {catRoles.map((role) => {
                                const isRoleChecked = isAllSelected || selectedRoleIds.has(role.id);
                                return (
                                  <label key={role.id} className="flex items-center space-x-2 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={isRoleChecked}
                                      onChange={() => handleToggleRole(role.id, cat.id)}
                                      className="w-3.5 h-3.5 rounded border-slate-700 text-slate-900 dark:text-[#1ED760] focus:ring-0 cursor-pointer"
                                    />
                                    <span className="text-[11px] font-semibold text-slate-700 dark:text-[#B5BAC1]">
                                      {role.name}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

            {/* Right: Date Range Draft & APPLY Mechanism */}
            <div className="flex flex-col sm:flex-row sm:items-end gap-3 w-full lg:w-auto">
              {/* From Date */}
              <div className="w-full sm:w-[170px]">
                <label htmlFor="workforce-from-date" className="text-[11px] font-black uppercase text-slate-500 dark:text-[#949BA4] block mb-1">
                  From Date
                </label>
                <DatePicker
                  id="workforce-from-date"
                  value={draftFromDate}
                  minDate={activeEarliestDate || undefined}
                  onChange={(newVal) => {
                    setDraftFromDate(newVal);
                    setDateValidationError(null);
                  }}
                  aria-label="From Date"
                />
              </div>

              {/* To Date */}
              <div className="w-full sm:w-[170px]">
                <label htmlFor="workforce-to-date" className="text-[11px] font-black uppercase text-slate-500 dark:text-[#949BA4] block mb-1">
                  To Date <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                </label>
                <DatePicker
                  id="workforce-to-date"
                  value={draftToDate}
                  placeholder="Defaults to From"
                  onChange={(newVal) => {
                    setDraftToDate(newVal);
                    setDateValidationError(null);
                  }}
                  aria-label="To Date"
                />
              </div>

              {/* APPLY Button */}
              <button
                type="button"
                id="workforce-analytics-apply-btn"
                onClick={handleApplyDateRange}
                className="min-h-[44px] px-5 py-2.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] font-black text-xs sm:text-sm rounded-lg shadow-sm border border-slate-900 dark:border-[#1ED760] transition-colors flex items-center justify-center space-x-2 shrink-0 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
              >
                <span>APPLY</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              {/* Exports */}
              <div className="flex items-center space-x-2 shrink-0">
                <PdfExportButton
                  payload={{
                    siteId: selectedSiteId || '',
                    type: 'ROLE_REPORT',
                    roleId: isAllSelected ? 'ALL' : (Array.from(selectedRoleIds)[0] || 'ALL'),
                    startDate: appliedFromDate,
                    endDate: appliedToDate,
                    monthLabel: `${appliedFromDate} to ${appliedToDate}`,
                  }}
                  fallbackFilename={`${selectedSite?.name || 'Site'}_Analytics_${appliedFromDate}_${appliedToDate}.pdf`}
                  label="PDF"
                />
                <ExcelExportButton
                  payload={{
                    siteId: selectedSiteId || '',
                    type: 'ROLE_REPORT',
                    roleId: isAllSelected ? 'ALL' : (Array.from(selectedRoleIds)[0] || 'ALL'),
                    startDate: appliedFromDate,
                    endDate: appliedToDate,
                    monthLabel: `${appliedFromDate} to ${appliedToDate}`,
                  }}
                  fallbackFilename={`${selectedSite?.name || 'Site'}_Analytics_${appliedFromDate}_${appliedToDate}.xlsx`}
                  label="Excel"
                />
              </div>
            </div>
          </div>

          {/* Date Validation Error Banner */}
          {dateValidationError && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg flex items-center space-x-2 text-xs font-bold text-rose-700 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{dateValidationError}</span>
            </div>
          )}
        </div>
      )}

      {/* KPI Overview Cards for Attendance Tab (Overall Breakdown Only) */}
      {activeTab === 'attendance' && viewMode === 'overall' && (
        <div className="bg-slate-900 dark:bg-[#202225] text-white rounded-xl p-4 sm:p-5 border border-slate-900 dark:border-[#3A3D42] shadow-sm grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Total Full Days
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
              {overallMetrics.totalFullDays}
            </span>
          </div>

          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Total Half Days
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
              {overallMetrics.totalHalfDays}
            </span>
          </div>

          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Total Day Count
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-amber-400 dark:text-[#1ED760] block mt-0.5">
              {overallMetrics.totalWorkerDays}
            </span>
          </div>

          <div className="p-1">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              {isSingleDayRange ? 'Total Workers' : 'Avg Daily Headcount'}
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-white dark:text-[#F2F3F5] block mt-0.5">
              {isSingleDayRange ? overallMetrics.totalWorkers : overallMetrics.avgDailyHeadcount}
            </span>
          </div>

          <div className="col-span-2 sm:col-span-1 lg:col-span-1 border-t sm:border-t-0 sm:border-l border-slate-800 dark:border-[#3A3D42] pt-2.5 sm:pt-1 sm:pl-4 p-1">
            <span className="text-[10px] sm:text-xs font-bold text-amber-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Total Labour Cost
            </span>
            <span className="text-lg sm:text-xl lg:text-2xl font-black text-amber-400 dark:text-[#1ED760] block truncate mt-0.5" title={formatINR(overallMetrics.totalCostPaise)}>
              {formatINR(overallMetrics.totalCostPaise)}
            </span>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MAIN VIEW AREA                                                            */}
      {/* ========================================================================= */}

      {/* TRANSACTIONS TAB */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Finance Summary Box */}
          <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-400 block">
                Total Inflow (Credits)
              </span>
              <span className="text-xl sm:text-2xl font-black text-emerald-700 dark:text-[#1ED760] block mt-1">
                {formatINR(financeSummary?.totalCreditsPaise || 0)}
              </span>
            </div>
            <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-800 dark:text-rose-400 block">
                Total Outflow (Debits)
              </span>
              <span className="text-xl sm:text-2xl font-black text-rose-700 dark:text-rose-400 block mt-1">
                {formatINR(financeSummary?.totalDebitsPaise || 0)}
              </span>
            </div>
            <div className="p-3 bg-slate-100 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-lg">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-[#949BA4] block">
                Net Balance
              </span>
              <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] block mt-1">
                {formatINR(financeSummary?.netBalancePaise || 0)}
              </span>
            </div>
          </div>

          {/* Transactions List Table */}
          {transactions.length === 0 ? (
            <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm">
              No financial transactions found for the selected date range.
            </div>
          ) : (
            <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
              <div
                id="financial-transactions-log-header"
                className="px-5 py-3.5 bg-slate-900 dark:bg-[#111214] border-b border-slate-900 dark:border-[#3A3D42] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
              >
                <span className="font-black text-sm text-white dark:text-[#F2F3F5] uppercase tracking-wide">
                  Financial Transactions Log ({transactions.length} records)
                </span>
                <span className="text-xs font-semibold text-slate-300 dark:text-[#949BA4]">
                  {isSingleDayRange ? `Single Day: ${appliedFromDate}` : `${appliedFromDate} → ${appliedToDate}`}
                </span>
              </div>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4">Type</th>
                      <th className="py-2.5 px-4">Category</th>
                      <th className="py-2.5 px-4 text-right">Amount</th>
                      <th className="py-2.5 px-4">Description</th>
                      <th className="py-2.5 px-4">Reference Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                        <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] whitespace-nowrap">{tx.date}</td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={clsx(
                              'px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border',
                              tx.type === 'CREDIT'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800'
                                : 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-800'
                            )}
                          >
                            {tx.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-700 dark:text-[#B5BAC1] whitespace-nowrap">
                          {tx.debit_category ? tx.debit_category.replace(/_/g, ' ') : 'General Credit'}
                        </td>
                        <td className="py-3 px-4 text-right font-black whitespace-nowrap text-sm">
                          <span className={tx.type === 'CREDIT' ? 'text-emerald-700 dark:text-[#1ED760]' : 'text-rose-700 dark:text-rose-400'}>
                            {tx.type === 'DEBIT' ? '-' : '+'}{formatINR(tx.amount_paise)}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-800 dark:text-[#F2F3F5] font-medium max-w-[240px] truncate" title={tx.description}>
                          {tx.description}
                        </td>
                        <td className="py-3 px-4 text-slate-500 dark:text-[#949BA4] max-w-[200px] truncate" title={tx.reference_note || '-'}>
                          {tx.reference_note || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 1: OVERALL BREAKDOWN */}
      {activeTab === 'attendance' && viewMode === 'overall' && (
        <div className="space-y-4">
          {loading ? (
            <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
              Loading analytics...
            </div>
          ) : filteredRecords.length === 0 ? (
            <div className="bg-white dark:bg-[#18191C] p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm">
              No attendance recorded for the selected scope in this date range.
            </div>
          ) : (
            <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-slate-900 dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 shadow-sm text-white dark:text-[#F2F3F5]">
                <div className="flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                  <span className="font-black text-sm text-white dark:text-[#F2F3F5] uppercase tracking-wide">
                    Category &amp; Role Breakdown ({categoryGroups.length} Categories)
                  </span>
                </div>
                <span className="text-xs font-semibold text-slate-300 dark:text-[#949BA4]">
                  {isSingleDayRange ? `Single Day: ${appliedFromDate}` : `${appliedFromDate} → ${appliedToDate}`}
                </span>
              </div>

              {/* Data Table with Thin Visible Column Separators */}
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                      <th className="py-3 px-4 border-r border-slate-300 dark:border-[#2B2D31]">Category / Role</th>
                      <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#2B2D31]">Full Day</th>
                      <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#2B2D31]">Half Day</th>
                      <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#2B2D31]">Total Workers</th>
                      <th className="py-3 px-4 text-center border-r border-slate-300 dark:border-[#2B2D31]">Day Count</th>
                      <th className="py-3 px-4 text-right">Labour Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryGroups.map((group) => (
                      <React.Fragment key={group.categoryId}>
                        {/* CATEGORY HEADER ROW: dark navy background, white text */}
                        <tr className="bg-slate-900 dark:bg-[#202225] text-white border-y border-slate-900 dark:border-[#3A3D42]">
                          <td colSpan={6} className="py-2.5 px-4 font-black uppercase tracking-wider text-xs text-white dark:text-[#F2F3F5]">
                            <span className="inline-flex items-center gap-2">
                              <Layers className="w-3.5 h-3.5 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                              {group.categoryName}
                            </span>
                          </td>
                        </tr>

                        {/* ROLE ROWS: clean light/dark surface with thin black/slate vertical separators */}
                        {group.roleRows.map((roleRow) => (
                          <tr
                            key={roleRow.roleId}
                            className="hover:bg-slate-50 dark:hover:bg-[#202225] border-b border-slate-200 dark:divide-[#2B2D31] transition-colors"
                          >
                            <td className="py-2.5 px-4 pl-7 font-bold text-slate-900 dark:text-[#F2F3F5] text-xs border-r border-slate-300 dark:border-[#2B2D31] whitespace-nowrap">
                              {roleRow.roleName}
                            </td>
                            <td className="py-2.5 px-4 text-center font-medium text-slate-700 dark:text-[#B5BAC1] border-r border-slate-300 dark:border-[#2B2D31] whitespace-nowrap">
                              {roleRow.fullDayCount}
                            </td>
                            <td className="py-2.5 px-4 text-center font-medium text-slate-700 dark:text-[#B5BAC1] border-r border-slate-300 dark:border-[#2B2D31] whitespace-nowrap">
                              {roleRow.halfDayCount}
                            </td>
                            <td className="py-2.5 px-4 text-center font-bold text-slate-800 dark:text-[#F2F3F5] border-r border-slate-300 dark:border-[#2B2D31] whitespace-nowrap">
                              {roleRow.totalWorkers}
                            </td>
                            <td className="py-2.5 px-4 text-center font-black text-slate-900 dark:text-[#F2F3F5] border-r border-slate-300 dark:border-[#2B2D31] whitespace-nowrap">
                              {roleRow.workerDays}
                            </td>
                            <td className="py-2.5 px-4 text-right font-black text-slate-900 dark:text-[#1ED760] text-xs whitespace-nowrap">
                              {formatINR(roleRow.totalCostPaise)}
                            </td>
                          </tr>
                        ))}

                        {/* CATEGORY SUBTOTAL ROW: dark navy inverted treatment, white text */}
                        <tr className="bg-slate-800 dark:bg-[#202225] text-white border-b-2 border-slate-900 dark:border-[#3A3D42] text-xs font-bold">
                          <td className="py-2 px-4 uppercase tracking-wider text-[11px] border-r border-slate-700 dark:border-[#3A3D42] whitespace-nowrap">
                            Subtotal — {group.categoryName}
                          </td>
                          <td className="py-2 px-4 text-center border-r border-slate-700 dark:border-[#3A3D42] whitespace-nowrap">
                            {group.subtotal.full}
                          </td>
                          <td className="py-2 px-4 text-center border-r border-slate-700 dark:border-[#3A3D42] whitespace-nowrap">
                            {group.subtotal.half}
                          </td>
                          <td className="py-2 px-4 text-center border-r border-slate-700 dark:border-[#3A3D42] whitespace-nowrap">
                            {group.subtotal.totalWorkers}
                          </td>
                          <td className="py-2 px-4 text-center border-r border-slate-700 dark:border-[#3A3D42] whitespace-nowrap">
                            {group.subtotal.workerDays}
                          </td>
                          <td className="py-2 px-4 text-right font-black text-amber-400 dark:text-[#1ED760] whitespace-nowrap">
                            {formatINR(group.subtotal.costPaise)}
                          </td>
                        </tr>
                      </React.Fragment>
                    ))}

                    {/* GRAND TOTAL ROW: strongest dark navy, white text, highlighted totals */}
                    <tr className="bg-slate-950 dark:bg-[#0B0E14] text-white border-t-2 border-slate-900 text-sm font-black">
                      <td className="py-3 px-4 uppercase tracking-wider text-xs border-r border-slate-800 whitespace-nowrap">
                        GRAND TOTAL
                      </td>
                      <td className="py-3 px-4 text-center border-r border-slate-800 whitespace-nowrap">
                        {overallMetrics.totalFullDays}
                      </td>
                      <td className="py-3 px-4 text-center border-r border-slate-800 whitespace-nowrap">
                        {overallMetrics.totalHalfDays}
                      </td>
                      <td className="py-3 px-4 text-center border-r border-slate-800 whitespace-nowrap">
                        {overallMetrics.totalWorkers}
                      </td>
                      <td className="py-3 px-4 text-center border-r border-slate-800 whitespace-nowrap">
                        {overallMetrics.totalWorkerDays}
                      </td>
                      <td className="py-3 px-4 text-right text-amber-400 dark:text-[#1ED760] whitespace-nowrap text-base">
                        {formatINR(overallMetrics.totalCostPaise)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: YEAR CALENDAR */}
      {activeTab === 'attendance' && viewMode === 'year' && (
        <div className="space-y-4">
          {/* Year Navigator Bar */}
          <div className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                Yearly Calendar ({selectedYear})
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#949BA4]">
                Single click highlights month card | Double-click drills down directly into Monthly Attendance.
              </p>
            </div>

            {/* Right side: Year Selector + PDF/Excel Export buttons */}
            <div className="flex items-center gap-3 self-start sm:self-auto flex-wrap">
              {/* Custom SITE WORK Year Selector */}
              <div className="flex items-center space-x-1.5 border border-slate-900 dark:border-[#3A3D42] rounded-lg p-1 bg-slate-50 dark:bg-[#111214]">
                <button
                  type="button"
                  onClick={() => setSelectedYear((y) => y - 1)}
                  aria-label="Previous Year"
                  className="w-10 h-10 inline-flex items-center justify-center rounded-md hover:bg-slate-200 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-3 text-sm font-black text-slate-900 dark:text-[#F2F3F5] min-w-[70px] text-center select-none">
                  {selectedYear}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedYear((y) => y + 1)}
                  aria-label="Next Year"
                  className="w-10 h-10 inline-flex items-center justify-center rounded-md hover:bg-slate-200 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Exports */}
              <div className="flex items-center space-x-2 shrink-0">
                <PdfExportButton
                  payload={{
                    siteId: selectedSiteId || '',
                    type: 'ROLE_REPORT',
                    roleId: isAllSelected ? 'ALL' : (Array.from(selectedRoleIds)[0] || 'ALL'),
                    startDate: `${selectedYear}-01-01`,
                    endDate: `${selectedYear}-12-31`,
                    monthLabel: `Year ${selectedYear}`,
                  }}
                  fallbackFilename={`${selectedSite?.name || 'Site'}_Analytics_Year_${selectedYear}.pdf`}
                  label="PDF"
                />
                <ExcelExportButton
                  payload={{
                    siteId: selectedSiteId || '',
                    type: 'ROLE_REPORT',
                    roleId: isAllSelected ? 'ALL' : (Array.from(selectedRoleIds)[0] || 'ALL'),
                    startDate: `${selectedYear}-01-01`,
                    endDate: `${selectedYear}-12-31`,
                    monthLabel: `Year ${selectedYear}`,
                  }}
                  fallbackFilename={`${selectedSite?.name || 'Site'}_Analytics_Year_${selectedYear}.xlsx`}
                  label="Excel"
                />
              </div>
            </div>
          </div>

          {/* 12-Month Grid (Jan to Dec) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4">
            {yearlyMonthSummaries.map((m) => {
              const isHighlighted = highlightedMonth === m.monthNum;
              return (
                <div
                  key={m.monthNum}
                  data-month={m.monthStr}
                  onClick={() => setHighlightedMonth(m.monthNum)}
                  onDoubleClick={() => handleMonthDoubleClick(m.monthStr)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleMonthDoubleClick(m.monthStr);
                  }}
                  title="Double-click to open Monthly Attendance"
                  className={clsx(
                    'p-4 rounded-xl border transition-all cursor-pointer select-none text-left flex flex-col justify-between space-y-3 min-h-[140px]',
                    isHighlighted
                      ? 'border-slate-900 dark:border-[#1ED760] ring-2 ring-slate-900/20 dark:ring-[#1ED760]/30 shadow-md bg-white dark:bg-[#202225]'
                      : 'border-slate-300 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:border-slate-500 dark:hover:border-[#4E5058] shadow-sm'
                  )}
                >
                  {/* Top: Month Title & Active Badge */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                      {m.monthName} {selectedYear}
                    </span>
                    <span
                      className={clsx(
                        'text-[10px] font-bold px-2 py-0.5 rounded border',
                        m.hasRecords
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-[#1ED760] border-emerald-200 dark:border-emerald-800'
                          : 'bg-slate-100 dark:bg-[#2B2D31] text-slate-500 dark:text-[#949BA4] border-slate-200 dark:border-[#3A3D42]'
                      )}
                    >
                      {m.activeDays} Active Days
                    </span>
                  </div>

                  {/* Body: Key Attendance Metrics */}
                  {m.hasRecords ? (
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between text-slate-600 dark:text-[#B5BAC1]">
                        <span>Full / Half Days:</span>
                        <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">{m.fullDays} / {m.halfDays}</span>
                      </div>
                      <div className="flex justify-between text-slate-600 dark:text-[#B5BAC1]">
                        <span>Total Day Count:</span>
                        <span className="font-black text-slate-900 dark:text-[#F2F3F5]">{m.workerDays}</span>
                      </div>
                      <div className="flex justify-between pt-1 border-t border-slate-100 dark:border-[#2B2D31]">
                        <span className="font-semibold text-slate-700 dark:text-[#B5BAC1]">Labour Cost:</span>
                        <span className="font-black text-emerald-700 dark:text-[#1ED760]">{formatINR(m.totalCostPaise)}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-3 text-center text-xs text-slate-400 dark:text-[#6A6F78] font-medium">
                      No attendance recorded
                    </div>
                  )}

                  {/* Footnote instruction */}
                  <div className="text-[10px] font-semibold text-slate-400 dark:text-[#6A6F78] flex items-center justify-between pt-1 border-t border-slate-100 dark:border-[#2B2D31]">
                    <span>Double-click to drill down</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RoleReportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm font-semibold text-slate-500">Loading Analytics...</div>}>
      <WorkforceAnalyticsContent />
    </Suspense>
  );
}
