'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { 
  Users, 
  Clock, 
  IndianRupee, 
  PlusCircle, 
  MinusCircle, 
  ClipboardCheck, 
  BarChart3, 
  FileDown, 
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  TrendingUp,
  Building2
} from 'lucide-react';

function formatDayCount(fullDay: number, halfDay: number): string {
  const count = (fullDay || 0) + (halfDay || 0) * 0.5;
  return count.toLocaleString('en-IN', { maximumFractionDigits: 1 });
}

export default function DashboardPage() {
  const { selectedSite, selectedSiteId, user } = useSite();
  const [loading, setLoading] = useState(true);

  // Stats State
  const [todayStats, setTodayStats] = useState({
    workers: 0,
    fullDay: 0,
    halfDay: 0,
    costPaise: 0,
  });

  const [weekStats, setWeekStats] = useState({
    workers: 0,
    fullDay: 0,
    halfDay: 0,
    costPaise: 0,
  });

  const [monthStats, setMonthStats] = useState({
    workers: 0,
    fullDay: 0,
    halfDay: 0,
    costPaise: 0,
  });

  const [financeStats, setFinanceStats] = useState({
    totalCreditPaise: 0,
    suppliesDebitPaise: 0,
    specialDebitPaise: 0,
    totalDebitPaise: 0,
    balancePaise: 0,
  });

  const [categoryBreakdown, setCategoryBreakdown] = useState<
    { categoryName: string; workerDays: number; costPaise: number }[]
  >([]);

  const fetchDashboardData = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);

    try {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      // Week Start (Monday) & End (Sunday)
      const dayOfWeek = (now.getDay() + 6) % 7; // Monday = 0
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - dayOfWeek);
      const weekStartStr = weekStart.toISOString().split('T')[0];

      // Month Start & End
      const monthStartStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const monthEndStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // 1. Today Attendance
      const todayRes = await fetch(`/api/attendance/daily?siteId=${selectedSiteId}&date=${todayStr}`);
      if (todayRes.ok) {
        const todayData = await todayRes.json();
        const sum = todayData.summary;
        setTodayStats({
          workers: sum.totalWorkers || 0,
          fullDay: sum.fullDayCount || 0,
          halfDay: sum.halfDayCount || 0,
          costPaise: sum.totalLabourCostPaise || 0,
        });
      }

      // 2. Week Attendance
      const weekRes = await fetch(
        `/api/attendance/range?siteId=${selectedSiteId}&startDate=${weekStartStr}&endDate=${todayStr}`
      );
      if (weekRes.ok) {
        const weekData = await weekRes.json();
        setWeekStats({
          workers: weekData.totals.totalWorkers || 0,
          fullDay: weekData.totals.totalFullDays || 0,
          halfDay: weekData.totals.totalHalfDays || 0,
          costPaise: weekData.totals.totalCostPaise || 0,
        });
      }

      // 3. Month Attendance & Category Summary
      const monthRes = await fetch(
        `/api/attendance/range?siteId=${selectedSiteId}&startDate=${monthStartStr}&endDate=${monthEndStr}`
      );
      if (monthRes.ok) {
        const monthData = await monthRes.json();
        setMonthStats({
          workers: monthData.totals.totalWorkers || 0,
          fullDay: monthData.totals.totalFullDays || 0,
          halfDay: monthData.totals.totalHalfDays || 0,
          costPaise: monthData.totals.totalCostPaise || 0,
        });

        // Compute category breakdown from records
        const catMap = new Map<string, { categoryName: string; workerDays: number; costPaise: number }>();
        for (const r of monthData.records) {
          const cId = r.category_id || 'other';
          if (!catMap.has(cId)) {
            catMap.set(cId, { categoryName: r.category_name || 'General', workerDays: 0, costPaise: 0 });
          }
          const curr = catMap.get(cId)!;
          curr.workerDays += r.worker_days;
          curr.costPaise += r.total_cost_paise;
        }
        setCategoryBreakdown(Array.from(catMap.values()));
      }

      // 4. Financial Summary
      const finRes = await fetch(`/api/finance/summary?siteId=${selectedSiteId}`);
      if (finRes.ok) {
        const finData = await finRes.json();
        const sum = finData.summary;
        setFinanceStats({
          totalCreditPaise: sum.totalCreditPaise || 0,
          suppliesDebitPaise: sum.suppliesDebitPaise || 0,
          specialDebitPaise: sum.specialWorkerTaskDebitPaise || 0,
          totalDebitPaise: sum.totalDebitPaise || 0,
          balancePaise: sum.closingBalancePaise || 0,
        });
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  if (!selectedSite) {
    return (
      <div className="bg-white dark:bg-[#18191C] p-6 sm:p-8 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center shadow-sm max-w-lg mx-auto my-6 sm:my-8">
        <h2 className="text-xl font-bold text-[#0F172A] dark:text-[#F2F3F5]">No Active Site Selected</h2>
        <p className="text-slate-600 dark:text-[#949BA4] mt-2 text-sm">Please create or select a site to start monitoring attendance and financials.</p>
        {user?.role === 'ADMIN' && (
          <Link
            href="/setup/sites"
            className="inline-flex items-center justify-center min-h-[44px] mt-4 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] rounded-lg text-sm font-bold transition-colors touch-action-manipulation border border-slate-900 dark:border-[#1ED760]"
          >
            Manage Sites
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Site Context Banner & Quick Actions with Inverted Dark Header Strip */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2 sm:py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
            <h2 className="text-xs font-black uppercase tracking-wider text-white dark:text-[#F2F3F5] truncate">
              Site Overview
            </h2>
            {selectedSite.code && (
              <span className="text-[11px] font-semibold text-slate-300 dark:text-[#949BA4] truncate">
                [{selectedSite.code}]
              </span>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] break-words">
              {selectedSite.name}
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5 truncate">
              {selectedSite.location || 'Site Location Not Specified'}
            </p>
          </div>

          {/* Quick Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
            <Link
              href="/attendance/daily"
              className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] text-xs sm:text-sm font-bold rounded-lg shadow-sm border border-slate-900 dark:border-[#1ED760] transition-colors touch-action-manipulation"
            >
              <ClipboardCheck className="w-4 h-4 mr-1.5 text-white dark:text-[#07130B] shrink-0" />
              <span className="truncate">Daily Entry</span>
            </Link>

            {/* Common Add Transaction CTA with Split Credit/Debit Visual */}
            <Link
              href="/finance"
              id="dashboard-common-add-btn"
              aria-label="Add Transaction (Credit or Debit)"
              className="group relative inline-flex flex-col items-center justify-center min-h-[44px] h-[44px] px-3 py-1 rounded-lg overflow-hidden border border-slate-900 dark:border-[#4A4D52] shadow-sm hover:shadow-md transition-all touch-action-manipulation focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760]"
            >
              <div className="absolute inset-0 flex pointer-events-none">
                <div className="w-1/2 h-full bg-emerald-600 group-hover:bg-emerald-700 dark:bg-emerald-700 dark:group-hover:bg-emerald-800 border-r border-slate-900 dark:border-[#4A4D52] transition-colors" />
                <div className="w-1/2 h-full bg-rose-600 group-hover:bg-rose-700 dark:bg-rose-700 dark:group-hover:bg-rose-800 transition-colors" />
              </div>

              <div className="relative z-10 flex flex-col items-center justify-center w-full min-w-[150px]">
                <span className="text-[10px] font-black uppercase tracking-widest text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] leading-none">
                  Add
                </span>
                <div className="grid grid-cols-2 w-full pt-1 text-white font-black text-sm leading-none">
                  <div className="flex items-center justify-center gap-1 pr-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                    <PlusCircle className="w-3.5 h-3.5 shrink-0 stroke-[2.5]" />
                    <span>Credit</span>
                  </div>
                  <div className="flex items-center justify-center gap-1 pl-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                    <span>Debit</span>
                    <MinusCircle className="w-3.5 h-3.5 shrink-0 stroke-[2.5]" />
                  </div>
                </div>
              </div>
            </Link>

            <Link
              href="/attendance/monthly"
              className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-800 dark:text-[#F2F3F5] text-xs sm:text-sm font-semibold rounded-lg border border-slate-900 dark:border-[#4A4D52] transition-colors touch-action-manipulation"
            >
              <BarChart3 className="w-4 h-4 mr-1.5 text-slate-500 dark:text-[#949BA4] shrink-0" />
              <span className="truncate">Monthly Report</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Attendance Overview Shared Visual Anchor Strip */}
      <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
          <h2 className="text-xs font-black uppercase tracking-wider text-white dark:text-[#F2F3F5] truncate">
            Attendance Overview
          </h2>
        </div>
        <span className="text-[11px] font-semibold text-slate-300 dark:text-[#949BA4] truncate hidden sm:inline">
          Today • This Week • This Month
        </span>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        {/* TODAY CARD */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-900 dark:border-[#2B2D31] pb-2.5">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4] flex items-center">
              <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-500 dark:text-[#949BA4] shrink-0" />
              Today
            </span>
            <Link 
              href="/attendance/daily" 
              className="text-xs font-semibold text-slate-900 dark:text-[#1ED760] hover:underline min-h-[44px] inline-flex items-center touch-action-manipulation"
            >
              Enter Today →
            </Link>
          </div>

          <div className="space-y-3">
            {/* Top Row: Total Workers & Labour Cost side-by-side */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {/* Left: Total Workers (light/white metric box) */}
              <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3 sm:p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex flex-col justify-between">
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
                  Total Workers
                </span>
                <span className="text-xl sm:text-2xl lg:text-3xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-1 truncate">
                  {todayStats.workers}
                </span>
              </div>

              {/* Right: Labour Cost (Dark navy / blue box) */}
              <div className="bg-slate-900 dark:bg-[#202225] text-white dark:text-[#F2F3F5] p-3 sm:p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex flex-col justify-between">
                <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
                  Labour Cost
                </span>
                <span className="text-xl sm:text-2xl lg:text-3xl font-black text-amber-400 dark:text-[#1ED760] tracking-tight block mt-1 truncate" title={formatINR(todayStats.costPaise)}>
                  {formatINR(todayStats.costPaise)}
                </span>
              </div>
            </div>

            {/* Bottom Row: Day Count Equation */}
            <div
              data-testid="attendance-equation"
              className="bg-[#F8F9FA] dark:bg-[#202225] px-3.5 py-2.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] text-xs font-semibold text-slate-700 dark:text-[#D1D5DB] flex flex-wrap items-center gap-1.5 leading-normal"
            >
              <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{todayStats.fullDay} Full</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">+</span>
              <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{todayStats.halfDay} Half</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">=</span>
              <span className="font-black text-emerald-700 dark:text-[#1ED760]">
                {formatDayCount(todayStats.fullDay, todayStats.halfDay)} Day Count
              </span>
            </div>
          </div>
        </div>

        {/* THIS WEEK CARD */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-900 dark:border-[#2B2D31] pb-2.5">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4] flex items-center">
              <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-slate-500 dark:text-[#949BA4] shrink-0" />
              This Week
            </span>
            <Link 
              href="/attendance/weekly" 
              className="text-xs font-semibold text-slate-900 dark:text-[#1ED760] hover:underline min-h-[44px] inline-flex items-center touch-action-manipulation"
            >
              Weekly Attendance →
            </Link>
          </div>

          <div className="space-y-3">
            {/* Top Row: Total Workers & Labour Cost side-by-side */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {/* Left: Total Workers (light/white metric box) */}
              <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3 sm:p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex flex-col justify-between">
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
                  Total Workers
                </span>
                <span className="text-xl sm:text-2xl lg:text-3xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-1 truncate">
                  {weekStats.workers}
                </span>
              </div>

              {/* Right: Labour Cost (Dark navy / blue box) */}
              <div className="bg-slate-900 dark:bg-[#202225] text-white dark:text-[#F2F3F5] p-3 sm:p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex flex-col justify-between">
                <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
                  Labour Cost
                </span>
                <span className="text-xl sm:text-2xl lg:text-3xl font-black text-amber-400 dark:text-[#1ED760] tracking-tight block mt-1 truncate" title={formatINR(weekStats.costPaise)}>
                  {formatINR(weekStats.costPaise)}
                </span>
              </div>
            </div>

            {/* Bottom Row: Day Count Equation */}
            <div
              data-testid="attendance-equation"
              className="bg-[#F8F9FA] dark:bg-[#202225] px-3.5 py-2.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] text-xs font-semibold text-slate-700 dark:text-[#D1D5DB] flex flex-wrap items-center gap-1.5 leading-normal"
            >
              <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{weekStats.fullDay} Full</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">+</span>
              <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{weekStats.halfDay} Half</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">=</span>
              <span className="font-black text-emerald-700 dark:text-[#1ED760]">
                {formatDayCount(weekStats.fullDay, weekStats.halfDay)} Day Count
              </span>
            </div>
          </div>
        </div>

        {/* THIS MONTH CARD */}
        <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-900 dark:border-[#2B2D31] pb-2.5">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4] flex items-center">
              <BarChart3 className="w-3.5 h-3.5 mr-1.5 text-slate-500 dark:text-[#949BA4] shrink-0" />
              This Month
            </span>
            <Link 
              href="/attendance/monthly" 
              className="text-xs font-semibold text-slate-900 dark:text-[#1ED760] hover:underline min-h-[44px] inline-flex items-center touch-action-manipulation"
            >
              Monthly Details →
            </Link>
          </div>

          <div className="space-y-3">
            {/* Top Row: Total Workers & Labour Cost side-by-side */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              {/* Left: Total Workers (light/white metric box) */}
              <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3 sm:p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex flex-col justify-between">
                <span className="text-[10px] sm:text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase tracking-wider block truncate">
                  Total Workers
                </span>
                <span className="text-xl sm:text-2xl lg:text-3xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-1 truncate">
                  {monthStats.workers}
                </span>
              </div>

              {/* Right: Labour Cost (Dark navy / blue box) */}
              <div className="bg-slate-900 dark:bg-[#202225] text-white dark:text-[#F2F3F5] p-3 sm:p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex flex-col justify-between">
                <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block truncate">
                  Labour Cost
                </span>
                <span className="text-xl sm:text-2xl lg:text-3xl font-black text-amber-400 dark:text-[#1ED760] tracking-tight block mt-1 truncate" title={formatINR(monthStats.costPaise)}>
                  {formatINR(monthStats.costPaise)}
                </span>
              </div>
            </div>

            {/* Bottom Row: Day Count Equation */}
            <div
              data-testid="attendance-equation"
              className="bg-[#F8F9FA] dark:bg-[#202225] px-3.5 py-2.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] text-xs font-semibold text-slate-700 dark:text-[#D1D5DB] flex flex-wrap items-center gap-1.5 leading-normal"
            >
              <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{monthStats.fullDay} Full</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">+</span>
              <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{monthStats.halfDay} Half</span>
              <span className="text-slate-400 dark:text-slate-500 font-bold">=</span>
              <span className="font-black text-emerald-700 dark:text-[#1ED760]">
                {formatDayCount(monthStats.fullDay, monthStats.halfDay)} Day Count
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Overview Card with Inverted Dark Header Strip */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2 sm:py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
            <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
              Site Financial Balance
            </h2>
          </div>
          <Link 
            href="/finance" 
            className="text-xs font-semibold text-emerald-400 dark:text-[#1ED760] hover:underline min-h-[44px] inline-flex items-center touch-action-manipulation shrink-0"
          >
            View Transactions →
          </Link>
        </div>

        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
            <div className="p-3 sm:p-3.5 bg-emerald-50 dark:bg-[#0F291B] rounded-lg border border-slate-900 dark:border-[#1A7F3C]">
              <span className="text-[10px] sm:text-xs font-bold text-emerald-800 dark:text-[#1ED760] uppercase block truncate">Credit</span>
              <span className="text-base sm:text-xl font-black text-emerald-900 dark:text-[#1ED760] block mt-0.5 break-words">{formatINR(financeStats.totalCreditPaise)}</span>
              <span className="text-[10px] text-emerald-700 dark:text-[#1DB954] block mt-0.5 truncate">Funding / Received</span>
            </div>

            <div className="p-3 sm:p-3.5 bg-amber-50 dark:bg-[#241C12] rounded-lg border border-slate-900 dark:border-[#684C12]">
              <span className="text-[10px] sm:text-xs font-bold text-amber-800 dark:text-amber-300 uppercase block truncate">Supplies Debit</span>
              <span className="text-base sm:text-xl font-black text-amber-900 dark:text-amber-200 block mt-0.5 break-words">{formatINR(financeStats.suppliesDebitPaise)}</span>
              <span className="text-[10px] text-amber-700 dark:text-amber-400 block mt-0.5 truncate">Materials</span>
            </div>

            <div className="p-3 sm:p-3.5 bg-indigo-50 dark:bg-[#1A182E] rounded-lg border border-slate-900 dark:border-[#3B3860]">
              <span className="text-[10px] sm:text-xs font-bold text-indigo-800 dark:text-indigo-300 uppercase block truncate">Special Work Debit</span>
              <span className="text-base sm:text-xl font-black text-indigo-900 dark:text-indigo-200 block mt-0.5 break-words">{formatINR(financeStats.specialDebitPaise)}</span>
              <span className="text-[10px] text-indigo-700 dark:text-indigo-400 block mt-0.5 truncate">Task Expense</span>
            </div>

            <div className="p-3 sm:p-3.5 bg-rose-50 dark:bg-[#2A1215] rounded-lg border border-slate-900 dark:border-[#6E1C24]">
              <span className="text-[10px] sm:text-xs font-bold text-rose-800 dark:text-rose-300 uppercase block truncate">Total Debit</span>
              <span className="text-base sm:text-xl font-black text-rose-900 dark:text-rose-300 block mt-0.5 break-words">{formatINR(financeStats.totalDebitPaise)}</span>
              <span className="text-[10px] text-rose-700 dark:text-rose-400 block mt-0.5 truncate">Outflow</span>
            </div>

            <div className="col-span-2 sm:col-span-3 lg:col-span-1 p-3 sm:p-3.5 bg-slate-900 dark:bg-[#202225] rounded-lg border border-slate-900 dark:border-[#4A4D52] text-white">
              <span className="text-[10px] sm:text-xs font-bold text-amber-400 dark:text-[#1ED760] uppercase block truncate">Remaining Balance</span>
              <span className="text-base sm:text-xl font-black text-white dark:text-[#F2F3F5] block mt-0.5 break-words">
                {formatINR(financeStats.balancePaise)}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5 truncate">Actual Cash In Hand</span>
            </div>
          </div>
        </div>
      </div>

      {/* Category Breakdown Table with Inverted Dark Header Strip */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2 sm:py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
            <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
              Work Category Summary (This Month)
            </h2>
          </div>
          <Link 
            href="/reports/category" 
            className="text-xs font-semibold text-emerald-400 dark:text-[#1ED760] hover:underline min-h-[44px] inline-flex items-center shrink-0 touch-action-manipulation"
          >
            Detailed Breakdown →
          </Link>
        </div>

        <div className="p-4 sm:p-5">
          {categoryBreakdown.length === 0 ? (
            <div className="py-6 sm:py-8 text-center text-slate-500 dark:text-[#949BA4] text-sm">
              No attendance recorded for this month yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {categoryBreakdown.map((cat) => (
                <div key={cat.categoryName} className="p-3.5 sm:p-4 bg-[#F8F9FA] dark:bg-[#202225] rounded-lg border border-slate-900 dark:border-[#3A3D42] space-y-1">
                  <span className="text-xs font-black text-[#0F172A] dark:text-[#F2F3F5] uppercase tracking-wide block truncate">
                    {cat.categoryName}
                  </span>
                  <div className="flex justify-between items-baseline pt-1 gap-2">
                    <span className="text-xs text-slate-600 dark:text-[#949BA4] font-semibold shrink-0">{cat.workerDays} Day Count</span>
                    <span className="text-sm font-black text-[#0F172A] dark:text-[#F2F3F5] shrink-0 break-words">{formatINR(cat.costPaise)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}