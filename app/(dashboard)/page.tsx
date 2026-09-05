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
  TrendingUp
} from 'lucide-react';

export default function DashboardPage() {
  const { selectedSite, selectedSiteId, user } = useSite();
  const [loading, setLoading] = useState(true);

  // Stats State
  const [todayStats, setTodayStats] = useState({
    workers: 0,
    fullDay: 0,
    halfDay: 0,
    workerDays: 0,
    costPaise: 0,
  });

  const [weekStats, setWeekStats] = useState({
    workerDays: 0,
    costPaise: 0,
  });

  const [monthStats, setMonthStats] = useState({
    workerDays: 0,
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
          workerDays: sum.workerDays || 0,
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
          workerDays: weekData.totals.totalWorkerDays || 0,
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
          workerDays: monthData.totals.totalWorkerDays || 0,
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
    <div className="space-y-4 sm:space-y-6">
      {/* Site Context Banner & Quick Actions */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-6 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-[#1ED760] bg-slate-100 dark:bg-[#0F291B] px-2 py-0.5 rounded border border-slate-900 dark:border-[#1A7F3C] shrink-0">
              Site Overview
            </span>
            {selectedSite.code && (
              <span className="text-xs font-semibold text-slate-500 dark:text-[#949BA4] truncate">[{selectedSite.code}]</span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] mt-1 break-words">{selectedSite.name}</h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5 truncate">{selectedSite.location || 'Site Location Not Specified'}</p>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
          <Link
            href="/attendance/daily"
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#07130B] text-xs sm:text-sm font-bold rounded-lg shadow-sm border border-slate-900 dark:border-[#1ED760] transition-colors touch-action-manipulation"
          >
            <ClipboardCheck className="w-4 h-4 mr-1.5 text-white dark:text-[#07130B] shrink-0" />
            <span className="truncate">Daily Entry</span>
          </Link>
          <Link
            href="/finance"
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 dark:bg-[#0F291B] dark:hover:bg-[#1A7F3C]/40 text-white dark:text-[#1ED760] border border-slate-900 dark:border-[#1A7F3C] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors touch-action-manipulation"
          >
            <PlusCircle className="w-4 h-4 mr-1.5 shrink-0" />
            <span className="truncate">Add Credit</span>
          </Link>
          <Link
            href="/finance"
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-rose-600 hover:bg-rose-700 dark:bg-[#2A1215] dark:hover:bg-rose-950 text-white dark:text-rose-400 border border-slate-900 dark:border-rose-900/60 text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors touch-action-manipulation"
          >
            <MinusCircle className="w-4 h-4 mr-1.5 shrink-0" />
            <span className="truncate">Add Debit</span>
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

          <div className="grid grid-cols-2 gap-2.5 xs:gap-3">
            <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3 rounded-lg border border-slate-900 dark:border-[#4A4D52]">
              <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase block truncate">Total Workers</span>
              <span className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-0.5">{todayStats.workers}</span>
              <span className="text-[10px] text-slate-500 dark:text-[#949BA4] block mt-0.5 truncate">
                {todayStats.fullDay} Full + {todayStats.halfDay} Half
              </span>
            </div>

            <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3 rounded-lg border border-slate-900 dark:border-[#4A4D52]">
              <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase block truncate">Worker-Days</span>
              <span className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] block mt-0.5">{todayStats.workerDays}</span>
              <span className="text-[10px] text-slate-500 dark:text-[#949BA4] block mt-0.5 truncate">Effort Units</span>
            </div>
          </div>

          <div className="bg-slate-900 dark:bg-[#202225] text-white dark:text-[#F2F3F5] p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52]">
            <span className="text-[11px] font-semibold text-slate-400 dark:text-[#949BA4] uppercase tracking-wider block">
              Today&apos;s Labour Cost
            </span>
            <span className="text-xl sm:text-2xl font-black text-amber-400 dark:text-[#1ED760] tracking-tight block mt-0.5 break-words">
              {formatINR(todayStats.costPaise)}
            </span>
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
              Weekly Matrix →
            </Link>
          </div>

          <div className="space-y-3">
            <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase block truncate">Worker-Days</span>
                <span className="text-xs text-slate-500 dark:text-[#949BA4] truncate block">Monday to Today</span>
              </div>
              <span className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] shrink-0">{weekStats.workerDays}</span>
            </div>

            <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase block truncate">Weekly Labour Cost</span>
                <span className="text-xs text-slate-500 dark:text-[#949BA4] truncate block">Cumulative</span>
              </div>
              <span className="text-base sm:text-xl font-black text-[#0F172A] dark:text-[#F2F3F5] shrink-0 break-words">{formatINR(weekStats.costPaise)}</span>
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
            <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase block truncate">Monthly Worker-Days</span>
                <span className="text-xs text-slate-500 dark:text-[#949BA4] truncate block">Month-to-Date</span>
              </div>
              <span className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] shrink-0">{monthStats.workerDays}</span>
            </div>

            <div className="bg-[#F8F9FA] dark:bg-[#202225] p-3.5 rounded-lg border border-slate-900 dark:border-[#4A4D52] flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase block truncate">Monthly Labour Cost</span>
                <span className="text-xs text-slate-500 dark:text-[#949BA4] truncate block">Total Month</span>
              </div>
              <span className="text-base sm:text-xl font-black text-[#0F172A] dark:text-[#F2F3F5] shrink-0 break-words">{formatINR(monthStats.costPaise)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Financial Overview Card */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-900 dark:border-[#2B2D31] pb-2.5">
          <div className="flex items-center space-x-2">
            <Wallet className="w-5 h-5 text-slate-800 dark:text-[#B5BAC1] shrink-0" />
            <h2 className="text-sm sm:text-base font-black text-[#0F172A] dark:text-[#F2F3F5] uppercase tracking-wide">
              Site Financial Balance
            </h2>
          </div>
          <Link 
            href="/finance" 
            className="text-xs font-semibold text-slate-900 dark:text-[#1ED760] hover:underline min-h-[44px] inline-flex items-center touch-action-manipulation"
          >
            View Ledger →
          </Link>
        </div>

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

      {/* Category Breakdown Table */}
      <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-900 dark:border-[#2B2D31] pb-2.5">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-slate-800 dark:text-[#B5BAC1] shrink-0" />
            <h2 className="text-sm sm:text-base font-black text-[#0F172A] dark:text-[#F2F3F5] uppercase tracking-wide truncate">
              Work Category Summary (This Month)
            </h2>
          </div>
          <Link 
            href="/reports/category" 
            className="text-xs font-semibold text-slate-900 dark:text-[#1ED760] hover:underline min-h-[44px] inline-flex items-center shrink-0 touch-action-manipulation"
          >
            Detailed Breakdown →
          </Link>
        </div>

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
                  <span className="text-xs text-slate-600 dark:text-[#949BA4] font-semibold shrink-0">{cat.workerDays} Worker-Days</span>
                  <span className="text-sm font-black text-[#0F172A] dark:text-[#F2F3F5] shrink-0 break-words">{formatINR(cat.costPaise)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}