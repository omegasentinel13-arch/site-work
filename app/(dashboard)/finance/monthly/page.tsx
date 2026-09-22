'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { FinancialDbRecord, MonthOverviewItem, MonthlyRollForward } from '@/lib/db/repositories/finance-repo';
import { FinancialSummary } from '@/lib/domain/finance-engine';
import { 
  Building2, 
  Check, 
  Eye, 
  HardHat, 
  IndianRupee, 
  LayoutDashboard, 
  Package, 
  Paperclip, 
  Receipt, 
  RotateCcw, 
  Search, 
  ShieldCheck, 
  TrendingDown, 
  TrendingUp, 
  Users, 
  Wallet,
  ArrowRight,
  Tag
} from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';
import { TransactionDetailsModal } from '@/components/finance/TransactionDetailsModal';

interface TransactionWithBalance extends FinancialDbRecord {
  runningBalancePaise: number;
}

type ViewMode = 'OVERVIEW' | 'LEDGER';

export default function MasterLedgerPage() {
  const { selectedSite, selectedSiteId } = useSite();

  // Active View Mode
  const [viewMode, setViewMode] = useState<ViewMode>('OVERVIEW');

  // Authoritative Financial State
  const [loading, setLoading] = useState<boolean>(true);
  const [transactions, setTransactions] = useState<FinancialDbRecord[]>([]);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [periodOpeningBalancePaise, setPeriodOpeningBalancePaise] = useState<number>(0);
  const [currentSiteBalancePaise, setCurrentSiteBalancePaise] = useState<number>(0);
  const [attendanceLabourCostPaise, setAttendanceLabourCostPaise] = useState<number>(0);
  const [yearOverview, setYearOverview] = useState<MonthOverviewItem[]>([]);
  const [monthlyRollForward, setMonthlyRollForward] = useState<MonthlyRollForward | null>(null);
  const [earliestDate, setEarliestDate] = useState<string>('');
  const [latestDate, setLatestDate] = useState<string>('');

  // Applied Date Range (Canonical Active Scope)
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');

  // Draft Date Range (Draft -> Apply Contract)
  const [draftStartDate, setDraftStartDate] = useState<string>('');
  const [draftEndDate, setDraftEndDate] = useState<string>('');

  // Transaction Ledger Filters (Presentation Layer)
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterType, setFilterType] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  // Details Modal State (Read-Only Traceability)
  const [detailsModalOpen, setDetailsModalOpen] = useState<boolean>(false);
  const [selectedTxForDetails, setSelectedTxForDetails] = useState<FinancialDbRecord | null>(null);

  // Check if draft date range differs from applied date range
  const hasDraftChanges =
    draftStartDate !== appliedStartDate || draftEndDate !== appliedEndDate;

  // Single Canonical Data Fetch
  const fetchFinancialData = useCallback(async (start?: string, end?: string) => {
    if (!selectedSiteId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ siteId: selectedSiteId });
      if (start) params.append('startDate', start);
      if (end) params.append('endDate', end);

      const res = await fetch(`/api/finance?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
        setSummary(data.summary || null);
        setPeriodOpeningBalancePaise(data.periodOpeningBalancePaise ?? 0);
        setCurrentSiteBalancePaise(data.currentSiteBalancePaise ?? 0);
        setAttendanceLabourCostPaise(data.attendanceLabourCostPaise ?? 0);
        setYearOverview(data.yearOverview || []);
        setMonthlyRollForward(data.monthlyRollForward || null);
        setEarliestDate(data.earliestDate || '');
        setLatestDate(data.latestDate || '');

        const actualStart = data.startDate || '';
        const actualEnd = data.endDate || '';
        setAppliedStartDate(actualStart);
        setAppliedEndDate(actualEnd);
        setDraftStartDate(actualStart);
        setDraftEndDate(actualEnd);
      }
    } catch (err) {
      console.error('Error fetching Master Ledger data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  // Initial Load on Site Change
  useEffect(() => {
    fetchFinancialData();
  }, [fetchFinancialData]);

  // Commit Draft Dates via APPLY
  const handleApplyDates = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!draftStartDate || !draftEndDate) return;
    if (draftStartDate > draftEndDate) {
      alert('From Date cannot be later than To Date.');
      return;
    }
    fetchFinancialData(draftStartDate, draftEndDate);
  };

  // Presets Handlers (Updates DRAFT state only - preserved Draft -> Apply)
  const applyPresetThisMonth = () => {
    const today = new Date().toISOString().split('T')[0];
    const firstDay = `${today.slice(0, 7)}-01`;
    setDraftStartDate(firstDay);
    setDraftEndDate(today);
  };

  const applyPresetThisYear = () => {
    const today = new Date().toISOString().split('T')[0];
    const firstDayOfYear = `${today.slice(0, 4)}-01-01`;
    setDraftStartDate(firstDayOfYear);
    setDraftEndDate(today);
  };

  const applyPresetAllTime = () => {
    const today = new Date().toISOString().split('T')[0];
    const fromDate = earliestDate || today;
    setDraftStartDate(fromDate);
    setDraftEndDate(today);
  };

  // Month overview click to apply specific month
  const handleSelectMonthFromYearOverview = (monthKey: string) => {
    const [y, m] = monthKey.split('-').map(Number);
    const start = `${monthKey}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${monthKey}-${String(lastDay).padStart(2, '0')}`;
    setDraftStartDate(start);
    setDraftEndDate(end);
    fetchFinancialData(start, end);
  };

  // 1. Calculate Chronological Running Balance (Oldest -> Newest)
  const transactionsWithRunningBalance = useMemo<TransactionWithBalance[]>(() => {
    const sortedAsc = [...transactions].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });

    let running = periodOpeningBalancePaise;
    const computed = sortedAsc.map((tx) => {
      if (tx.type === 'CREDIT') {
        running += tx.amount_paise;
      } else {
        running -= tx.amount_paise;
      }
      return { ...tx, runningBalancePaise: running };
    });

    // Presentation order: newest first
    return computed.reverse();
  }, [transactions, periodOpeningBalancePaise]);

  // 2. Filter Presentation Rows (Without corrupting calculated running balances)
  const filteredTransactions = useMemo<TransactionWithBalance[]>(() => {
    return transactionsWithRunningBalance.filter((tx) => {
      // Type Filter
      if (filterType !== 'ALL' && tx.type !== filterType) {
        return false;
      }

      // Category Filter
      if (filterCategory !== 'ALL') {
        if (filterCategory === 'CASH_INFLOW') {
          if (tx.type !== 'CREDIT') return false;
        } else {
          if (tx.debit_category !== filterCategory) return false;
        }
      }

      // Search Query Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNote = (tx.reference_note || '').toLowerCase().includes(q);
        const matchDesc = (tx.description || '').toLowerCase().includes(q);
        const matchInv = (tx.investor_name || '').toLowerCase().includes(q);
        const matchCat = (tx.work_category_name || '').toLowerCase().includes(q);
        const matchRole = (tx.work_role_name || '').toLowerCase().includes(q);
        const matchDebitCat = (tx.debit_category || '').toLowerCase().includes(q);
        const matchId = tx.id.toLowerCase().includes(q);

        if (!matchNote && !matchDesc && !matchInv && !matchCat && !matchRole && !matchDebitCat && !matchId) {
          return false;
        }
      }

      return true;
    });
  }, [transactionsWithRunningBalance, filterType, filterCategory, searchQuery]);

  // Reconciliation Mathematics (Strict integer paise)
  const totalInflowPaise = summary?.totalCreditPaise ?? 0;
  const totalOutflowPaise = summary?.totalDebitPaise ?? 0;
  const netMovementPaise = totalInflowPaise - totalOutflowPaise;
  const calculatedPeriodClosingPaise = periodOpeningBalancePaise + netMovementPaise;
  const ledgerClosingBalancePaise = summary?.closingBalancePaise ?? calculatedPeriodClosingPaise;
  const reconciliationDiffPaise = ledgerClosingBalancePaise - calculatedPeriodClosingPaise;
  const isReconciled = reconciliationDiffPaise === 0;

  // Expense Outflow Breakdown Proportions
  const suppliesPaise = summary?.suppliesDebitPaise ?? 0;
  const salaryPaise = summary?.salaryDebitPaise ?? 0;
  const specialTaskPaise = summary?.specialWorkerTaskDebitPaise ?? 0;

  const suppliesPct = totalOutflowPaise > 0 ? (suppliesPaise / totalOutflowPaise) * 100 : 0;
  const salaryPct = totalOutflowPaise > 0 ? (salaryPaise / totalOutflowPaise) * 100 : 0;
  const specialTaskPct = totalOutflowPaise > 0 ? (specialTaskPaise / totalOutflowPaise) * 100 : 0;

  // Supplies Intelligence Grouping
  const suppliesIntelligence = useMemo(() => {
    const map = new Map<string, { name: string; amountPaise: number; count: number }>();
    let unclassifiedPaise = 0;
    let unclassifiedCount = 0;

    for (const tx of transactions) {
      if (tx.type === 'DEBIT' && tx.debit_category === 'SUPPLIES') {
        const itemName = (tx.reference_note || '').trim() || (tx.description || '').trim();
        if (itemName && itemName !== 'Cement & Steel Purchase') {
          const current = map.get(itemName) || { name: itemName, amountPaise: 0, count: 0 };
          current.amountPaise += tx.amount_paise;
          current.count += 1;
          map.set(itemName, current);
        } else if (itemName === 'Cement & Steel Purchase') {
          unclassifiedPaise += tx.amount_paise;
          unclassifiedCount += 1;
        } else {
          unclassifiedPaise += tx.amount_paise;
          unclassifiedCount += 1;
        }
      }
    }

    const items = Array.from(map.values()).sort((a, b) => b.amountPaise - a.amountPaise);
    return { items, unclassifiedPaise, unclassifiedCount, totalSuppliesPaise: suppliesPaise };
  }, [transactions, suppliesPaise]);

  // Investor / Funding Summary
  const investorSummary = useMemo(() => {
    const map = new Map<string, { name: string; amountPaise: number; count: number }>();

    for (const tx of transactions) {
      if (tx.type === 'CREDIT') {
        const invName = (tx.investor_name || '').trim() || (tx.description || '').trim() || 'Investor Funding';
        const current = map.get(invName) || { name: invName, amountPaise: 0, count: 0 };
        current.amountPaise += tx.amount_paise;
        current.count += 1;
        map.set(invName, current);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.amountPaise - a.amountPaise);
  }, [transactions]);

  // Daily Cash Movement Grouping (Only active dates with movement)
  const dailyMovements = useMemo(() => {
    const map = new Map<string, { date: string; inflowPaise: number; outflowPaise: number; count: number }>();

    for (const tx of transactions) {
      const d = tx.date;
      const current = map.get(d) || { date: d, inflowPaise: 0, outflowPaise: 0, count: 0 };
      if (tx.type === 'CREDIT') {
        current.inflowPaise += tx.amount_paise;
      } else {
        current.outflowPaise += tx.amount_paise;
      }
      current.count += 1;
      map.set(d, current);
    }

    return Array.from(map.values())
      .map((item) => ({
        ...item,
        netPaise: item.inflowPaise - item.outflowPaise,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions]);

  // Has active presentation filters
  const hasActivePresentationFilters =
    filterType !== 'ALL' || filterCategory !== 'ALL' || searchQuery.trim() !== '';

  const resetPresentationFilters = () => {
    setSearchQuery('');
    setFilterType('ALL');
    setFilterCategory('ALL');
  };

  const handleFilterBySupplyItem = (itemName: string) => {
    setViewMode('LEDGER');
    setFilterType('DEBIT');
    setFilterCategory('SUPPLIES');
    setSearchQuery(itemName);
  };

  const handleViewDetails = (tx: FinancialDbRecord) => {
    setSelectedTxForDetails(tx);
    setDetailsModalOpen(true);
  };

  const isScopeAllTime =
    appliedStartDate && earliestDate && appliedStartDate <= earliestDate;

  return (
    <div className="space-y-5 pb-12">
      {/* ============================================================ */}
      {/* 1. MASTER LEDGER HEADER & CONTROLS                          */}
      {/* ============================================================ */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-6 rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A]">
                Financial Control Center
              </span>
              <span className="text-xs font-bold text-slate-500 dark:text-[#949BA4] flex items-center">
                <Building2 className="w-3.5 h-3.5 mr-1" />
                Active Site: <strong className="ml-1 text-slate-900 dark:text-[#F2F3F5]">{selectedSite?.name || 'No Site Selected'}</strong>
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-[#0F172A] dark:text-[#F2F3F5] mt-1 tracking-tight">
              MASTER LEDGER
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-[#949BA4] mt-0.5 font-medium">
              Complete Financial &amp; Site Cash Ledger
            </p>
          </div>

          {/* Export Actions (Respecting active applied date range) */}
          <div className="flex items-center space-x-2 self-start lg:self-center">
            <PdfExportButton
              payload={{
                siteId: selectedSiteId || '',
                type: 'FINANCE',
                startDate: appliedStartDate,
                endDate: appliedEndDate,
              }}
              fallbackFilename={`${selectedSite?.name || 'Site'}_Master_Ledger_${appliedStartDate}_to_${appliedEndDate}.pdf`}
              label="PDF"
            />
            <ExcelExportButton
              payload={{
                siteId: selectedSiteId || '',
                type: 'FINANCE',
                startDate: appliedStartDate,
                endDate: appliedEndDate,
              }}
              fallbackFilename={`${selectedSite?.name || 'Site'}_Master_Ledger_${appliedStartDate}_to_${appliedEndDate}.xlsx`}
              label="EXCEL"
            />
          </div>
        </div>

        {/* ============================================================ */}
        {/* 2. DATE RANGE CONTROL (Draft -> Apply Contract)             */}
        {/* ============================================================ */}
        <div className="pt-3 border-t border-slate-200 dark:border-[#2B2D31] flex flex-col xl:flex-row xl:items-end justify-between gap-3">
          <form onSubmit={handleApplyDates} className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2.5 flex-1">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-[#949BA4] mb-1">
                From Date
              </label>
              <DatePicker
                id="ledger-from-date"
                value={draftStartDate}
                onChange={setDraftStartDate}
                variant="full"
                aria-label="Master ledger from date"
              />
            </div>

            <div className="flex-1 min-w-[140px]">
              <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-[#949BA4] mb-1">
                To Date
              </label>
              <DatePicker
                id="ledger-to-date"
                value={draftEndDate}
                onChange={setDraftEndDate}
                variant="full"
                aria-label="Master ledger to date"
              />
            </div>

            <div className="pt-1 sm:pt-0">
              <button
                type="submit"
                disabled={loading}
                className={`w-full sm:w-auto min-h-[44px] px-6 py-2 text-xs sm:text-sm font-black rounded-xl border flex items-center justify-center space-x-1.5 transition-all touch-action-manipulation ${
                  hasDraftChanges
                    ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A] border-slate-900 dark:border-[#1ED760] shadow-md ring-2 ring-slate-900/20'
                    : 'bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#F2F3F5] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-200 dark:hover:bg-[#2B2D31]'
                }`}
              >
                <Check className="w-4 h-4 shrink-0" />
                <span>APPLY</span>
                {hasDraftChanges && (
                  <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 ml-1 animate-pulse" title="Pending unapplied changes" />
                )}
              </button>
            </div>
          </form>

          {/* Presets Bar */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 max-w-full">
            <button
              type="button"
              onClick={applyPresetThisMonth}
              className="min-h-[40px] px-3 py-1.5 bg-slate-50 dark:bg-[#111214] hover:bg-slate-100 dark:hover:bg-[#202225] text-[11px] font-bold text-slate-700 dark:text-[#B5BAC1] rounded-lg border border-slate-300 dark:border-[#3A3D42] whitespace-nowrap transition-colors touch-action-manipulation"
            >
              THIS MONTH
            </button>
            <button
              type="button"
              onClick={applyPresetThisYear}
              className="min-h-[40px] px-3 py-1.5 bg-slate-50 dark:bg-[#111214] hover:bg-slate-100 dark:hover:bg-[#202225] text-[11px] font-bold text-slate-700 dark:text-[#B5BAC1] rounded-lg border border-slate-300 dark:border-[#3A3D42] whitespace-nowrap transition-colors touch-action-manipulation"
            >
              THIS YEAR
            </button>
            <button
              type="button"
              onClick={applyPresetAllTime}
              className="min-h-[40px] px-3 py-1.5 bg-slate-50 dark:bg-[#111214] hover:bg-slate-100 dark:hover:bg-[#202225] text-[11px] font-bold text-slate-700 dark:text-[#B5BAC1] rounded-lg border border-slate-300 dark:border-[#3A3D42] whitespace-nowrap transition-colors touch-action-manipulation"
            >
              ALL TIME
            </button>
          </div>
        </div>

        {/* Active Scope Summary Banner */}
        <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-[#949BA4] pt-2 border-t border-slate-100 dark:border-[#202225] gap-2">
          <div>
            Active Range: <strong className="text-slate-800 dark:text-[#F2F3F5]">{appliedStartDate || '—'}</strong> to <strong className="text-slate-800 dark:text-[#F2F3F5]">{appliedEndDate || '—'}</strong>
            {hasDraftChanges && (
              <span className="ml-2 inline-flex items-center text-rose-600 dark:text-rose-400 font-semibold text-[11px]">
                (Draft changes pending — click APPLY)
              </span>
            )}
          </div>
          <div>
            Total Transactions: <strong className="text-slate-800 dark:text-[#F2F3F5]">{transactions.length}</strong>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 4. FINANCIAL COMMAND CENTER — 5-KPI STRIP + SITE BALANCE   */}
      {/* ============================================================ */}
      <div className="bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
          <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
            <Wallet className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
            <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
              Financial Command Center
            </h2>
          </div>
          <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
            {appliedStartDate && appliedEndDate ? `${appliedStartDate} to ${appliedEndDate}` : 'Active Period'}
          </span>
        </div>
        <div className="p-3 sm:p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* 1. Period Opening Balance */}
        <div className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4]">
              Opening Balance
            </span>
            <Wallet className="w-4 h-4 text-slate-400 dark:text-[#949BA4]" />
          </div>
          <div className="mt-2">
            <span className="text-base sm:text-lg font-black text-[#0F172A] dark:text-[#F2F3F5] block truncate">
              {formatINR(periodOpeningBalancePaise)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5">
              Strictly before {appliedStartDate || 'start'}
            </span>
          </div>
        </div>

        {/* 2. Total Inflow */}
        <div className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-[#1ED760]">
              Total Inflow
            </span>
            <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
          </div>
          <div className="mt-2">
            <span className="text-base sm:text-lg font-black text-emerald-700 dark:text-[#1ED760] block truncate">
              +{formatINR(totalInflowPaise)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5">
              Credits in period
            </span>
          </div>
        </div>

        {/* 3. Total Outflow */}
        <div className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-700 dark:text-[#F87171]">
              Total Outflow
            </span>
            <TrendingDown className="w-4 h-4 text-rose-600 dark:text-[#F87171]" />
          </div>
          <div className="mt-2">
            <span className="text-base sm:text-lg font-black text-rose-700 dark:text-[#F87171] block truncate">
              −{formatINR(totalOutflowPaise)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5">
              Debits in period
            </span>
          </div>
        </div>

        {/* 4. Net Movement */}
        <div className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4]">
              Net Movement
            </span>
            <Receipt className="w-4 h-4 text-slate-400 dark:text-[#949BA4]" />
          </div>
          <div className="mt-2">
            <span className={`text-base sm:text-lg font-black block truncate ${
              netMovementPaise >= 0 
                ? 'text-emerald-700 dark:text-[#1ED760]' 
                : 'text-rose-700 dark:text-[#F87171]'
            }`}>
              {netMovementPaise >= 0 ? `+${formatINR(netMovementPaise)}` : `-${formatINR(Math.abs(netMovementPaise))}`}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5">
              Inflow − Outflow
            </span>
          </div>
        </div>

        {/* 5. Period Closing Balance */}
        <div className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-900 dark:text-[#F2F3F5]">
              Period Closing
            </span>
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
          </div>
          <div className="mt-2">
            <span className="text-base sm:text-lg font-black text-slate-900 dark:text-[#F2F3F5] block truncate">
              {formatINR(calculatedPeriodClosingPaise)}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5">
              Opening + Net
            </span>
          </div>
        </div>

        {/* 6. Current Site Balance (All-Time) */}
        <div className="bg-slate-50 dark:bg-[#202225] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1]">
              Current Site Balance
            </span>
            <IndianRupee className="w-4 h-4 text-slate-600 dark:text-[#F2F3F5]" />
          </div>
          <div className="mt-2">
            <span className="text-base sm:text-lg font-black text-slate-900 dark:text-[#F2F3F5] block truncate">
              {formatINR(currentSiteBalancePaise)}
            </span>
            <span className="text-[10px] font-semibold text-slate-500 dark:text-[#949BA4] block mt-0.5">
              {isScopeAllTime ? 'Matches active period' : 'All-time site total'}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>

      {/* ============================================================ */}
      {/* 3. TWO PRIMARY VIEW MODES TOGGLE                            */}
      {/* ============================================================ */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#2B2D31] pb-2">
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setViewMode('OVERVIEW')}
            className={`min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-black border flex items-center space-x-2 transition-all touch-action-manipulation ${
              viewMode === 'OVERVIEW'
                ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A] border-slate-900 dark:border-[#1ED760] shadow-sm'
                : 'bg-white dark:bg-[#18191C] text-slate-600 dark:text-[#B5BAC1] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-100 dark:hover:bg-[#202225]'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>OVERVIEW</span>
          </button>

          <button
            type="button"
            onClick={() => setViewMode('LEDGER')}
            className={`min-h-[44px] px-4 py-2 rounded-xl text-xs sm:text-sm font-black border flex items-center space-x-2 transition-all touch-action-manipulation ${
              viewMode === 'LEDGER'
                ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A] border-slate-900 dark:border-[#1ED760] shadow-sm'
                : 'bg-white dark:bg-[#18191C] text-slate-600 dark:text-[#B5BAC1] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-100 dark:hover:bg-[#202225]'
            }`}
          >
            <Receipt className="w-4 h-4" />
            <span>TRANSACTION LEDGER</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
              viewMode === 'LEDGER'
                ? 'bg-white/20 text-white dark:bg-black/20 dark:text-black'
                : 'bg-slate-100 dark:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5]'
            }`}>
              {transactions.length}
            </span>
          </button>
        </div>

        <span className="text-xs text-slate-400 dark:text-[#949BA4] hidden sm:block">
          {viewMode === 'OVERVIEW' ? 'Financial Intelligence & Control' : 'Detailed Transaction Audit'}
        </span>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42]">
          Loading Master Ledger financial data...
        </div>
      ) : (
        <>
          {/* ============================================================ */}
          {/* VIEW MODE A: OVERVIEW                                        */}
          {/* ============================================================ */}
          {viewMode === 'OVERVIEW' && (
            <div className="space-y-6">
              {/* Row 1: Cash Reconciliation & Period Movement */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* 5. CASH RECONCILIATION */}
                <div className="lg:col-span-7 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Control &amp; Verification
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        CASH RECONCILIATION
                      </h2>
                    </div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-black uppercase ${
                      isReconciled 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    }`}>
                      {isReconciled ? '✓ RECONCILED' : '⚠ RECONCILIATION DIFFERENCE'}
                    </span>
                  </div>

                  {/* Math Formula Presentation */}
                  <div className="p-4 sm:p-5 space-y-2.5 text-xs sm:text-sm">
                    <div className="flex justify-between items-center py-1 text-slate-600 dark:text-[#B5BAC1]">
                      <span>Opening Balance</span>
                      <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{formatINR(periodOpeningBalancePaise)}</span>
                    </div>

                    <div className="flex justify-between items-center py-1 text-emerald-700 dark:text-[#1ED760]">
                      <span className="font-medium">+ Total Inflow</span>
                      <span className="font-bold">+{formatINR(totalInflowPaise)}</span>
                    </div>

                    <div className="flex justify-between items-center py-1 text-rose-700 dark:text-[#F87171]">
                      <span className="font-medium">− Total Outflow</span>
                      <span className="font-bold">−{formatINR(totalOutflowPaise)}</span>
                    </div>

                    <div className="pt-2 border-t border-slate-300 dark:border-[#3A3D42] flex justify-between items-center font-bold text-slate-900 dark:text-[#F2F3F5]">
                      <span>Period Closing Balance (Formula)</span>
                      <span className="font-black text-sm sm:text-base">{formatINR(calculatedPeriodClosingPaise)}</span>
                    </div>

                    <div className="flex justify-between items-center py-1 text-slate-600 dark:text-[#B5BAC1]">
                      <span>Ledger Balance (End of Period)</span>
                      <span className="font-bold text-slate-900 dark:text-[#F2F3F5]">{formatINR(ledgerClosingBalancePaise)}</span>
                    </div>

                    <div className="pt-2 border-t border-slate-200 dark:border-[#2B2D31] flex justify-between items-center">
                      <span className="font-bold text-slate-500 dark:text-[#949BA4]">Difference</span>
                      <span className={`font-black ${isReconciled ? 'text-emerald-600 dark:text-[#1ED760]' : 'text-rose-600 dark:text-[#F87171]'}`}>
                        {formatINR(reconciliationDiffPaise)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 6. PERIOD MOVEMENT SUMMARY */}
                <div className="lg:col-span-5 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Cash Flow
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        PERIOD MOVEMENT
                      </h2>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3">
                    <div className="bg-emerald-50 dark:bg-[#0F291B]/40 border border-slate-900 dark:border-[#1A7F3C] p-3.5 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-black uppercase text-emerald-800 dark:text-[#86EFAC] block">
                          Money In
                        </span>
                        <span className="text-xs text-slate-500 dark:text-[#949BA4]">Credits received</span>
                      </div>
                      <span className="text-lg font-black text-emerald-700 dark:text-[#1ED760]">
                        +{formatINR(totalInflowPaise)}
                      </span>
                    </div>

                    <div className="bg-rose-50 dark:bg-[#2A1215]/40 border border-slate-900 dark:border-[#6E1C24] p-3.5 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-black uppercase text-rose-800 dark:text-[#FCA5A5] block">
                          Money Out
                        </span>
                        <span className="text-xs text-slate-500 dark:text-[#949BA4]">Expenses disbursed</span>
                      </div>
                      <span className="text-lg font-black text-rose-700 dark:text-[#F87171]">
                        −{formatINR(totalOutflowPaise)}
                      </span>
                    </div>

                    <div className="bg-slate-900 dark:bg-[#202225] text-white border border-slate-900 dark:border-[#3A3D42] p-3.5 rounded-xl flex items-center justify-between">
                      <div>
                        <span className="text-[11px] font-black uppercase text-emerald-400 dark:text-[#1ED760] block">
                          Net Movement
                        </span>
                        <span className="text-xs text-slate-400 dark:text-[#949BA4]">Net cash flow</span>
                      </div>
                      <span className="text-lg font-black text-white dark:text-[#F2F3F5]">
                        {netMovementPaise >= 0 ? `+${formatINR(netMovementPaise)}` : `-${formatINR(Math.abs(netMovementPaise))}`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 2: Expense Breakdown & Supplies Intelligence */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* 7. EXPENSE BREAKDOWN */}
                <div className="lg:col-span-6 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Outgoing Money
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        EXPENSE BREAKDOWN
                      </h2>
                    </div>
                    <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                      Total: {formatINR(totalOutflowPaise)}
                    </span>
                  </div>

                  <div className="p-4 sm:p-5 space-y-4 text-xs sm:text-sm">
                    {/* Supplies */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700 dark:text-[#F2F3F5] flex items-center">
                          <Package className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          Supplies / Materials
                        </span>
                        <div className="text-right">
                          <span className="font-black text-slate-900 dark:text-[#F2F3F5] mr-2">
                            {formatINR(suppliesPaise)}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-400">
                            {suppliesPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-[#111214] h-2 rounded-full overflow-hidden border border-slate-200 dark:border-[#2B2D31]">
                        <div 
                          className="bg-amber-500 h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, Math.max(0, suppliesPct))}%` }}
                        />
                      </div>
                    </div>

                    {/* Salary */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700 dark:text-[#F2F3F5] flex items-center">
                          <Users className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          Salary / Wages
                        </span>
                        <div className="text-right">
                          <span className="font-black text-slate-900 dark:text-[#F2F3F5] mr-2">
                            {formatINR(salaryPaise)}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-400">
                            {salaryPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-[#111214] h-2 rounded-full overflow-hidden border border-slate-200 dark:border-[#2B2D31]">
                        <div 
                          className="bg-blue-500 h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, Math.max(0, salaryPct))}%` }}
                        />
                      </div>
                    </div>

                    {/* Legacy / Special Task */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700 dark:text-[#F2F3F5] flex items-center">
                          <HardHat className="w-3.5 h-3.5 mr-1 text-slate-400" />
                          Legacy Special Task
                        </span>
                        <div className="text-right">
                          <span className="font-black text-slate-900 dark:text-[#F2F3F5] mr-2">
                            {formatINR(specialTaskPaise)}
                          </span>
                          <span className="text-[11px] font-semibold text-slate-400">
                            {specialTaskPct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 dark:bg-[#111214] h-2 rounded-full overflow-hidden border border-slate-200 dark:border-[#2B2D31]">
                        <div 
                          className="bg-purple-500 h-full rounded-full transition-all"
                          style={{ width: `${Math.min(100, Math.max(0, specialTaskPct))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 8. SUPPLIES INTELLIGENCE */}
                <div className="lg:col-span-6 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Supply Memory
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        SUPPLY SPEND
                      </h2>
                    </div>
                    <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                      Total: {formatINR(suppliesIntelligence.totalSuppliesPaise)}
                    </span>
                  </div>

                  <div className="p-4 sm:p-5 space-y-4">

                  {suppliesIntelligence.totalSuppliesPaise === 0 ? (
                    <div className="py-6 text-center text-slate-400 dark:text-[#949BA4] text-xs">
                      No supplies expenditure recorded in this period.
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs sm:text-sm max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                      {suppliesIntelligence.items.map((item) => (
                        <button
                          key={item.name}
                          type="button"
                          onClick={() => handleFilterBySupplyItem(item.name)}
                          className="w-full text-left p-2.5 rounded-lg border border-slate-200 dark:border-[#2B2D31] hover:border-slate-900 dark:hover:border-[#1ED760] hover:bg-slate-50 dark:hover:bg-[#202225] flex items-center justify-between transition-colors group"
                        >
                          <span className="font-bold text-slate-800 dark:text-[#F2F3F5] group-hover:text-slate-900 dark:group-hover:text-[#1ED760]">
                            {item.name}
                          </span>
                          <div className="flex items-center space-x-2">
                            <span className="font-black text-slate-900 dark:text-[#F2F3F5]">
                              {formatINR(item.amountPaise)}
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-900 dark:group-hover:text-[#1ED760]" />
                          </div>
                        </button>
                      ))}

                      {suppliesIntelligence.unclassifiedPaise > 0 && (
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] flex items-center justify-between text-slate-600 dark:text-[#949BA4]">
                          <span className="font-medium text-[11px] italic">
                            Historical item detail unavailable (Cement &amp; Steel Purchase)
                          </span>
                          <span className="font-black text-slate-700 dark:text-[#F2F3F5]">
                            {formatINR(suppliesIntelligence.unclassifiedPaise)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

              {/* Row 3: Investor Movement & Labour Accrual Separation */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* 9. FUNDING / INVESTOR MOVEMENT */}
                <div className="lg:col-span-6 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-emerald-400 dark:text-[#1ED760] block">
                        Capital Inflows
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        FUNDING / INVESTOR MOVEMENT
                      </h2>
                    </div>
                    <span className="text-[11px] font-bold bg-slate-800 text-emerald-400 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#1ED760] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                      Total: +{formatINR(totalInflowPaise)}
                    </span>
                  </div>

                  <div className="p-4 sm:p-5 space-y-4">
                  {investorSummary.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 dark:text-[#949BA4] text-xs">
                      No investor credit transactions in this period.
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs sm:text-sm">
                      {investorSummary.map((inv) => (
                        <div
                          key={inv.name}
                          className="p-3 rounded-lg border border-slate-200 dark:border-[#2B2D31] bg-emerald-50/40 dark:bg-[#0F291B]/20 flex items-center justify-between"
                        >
                          <div className="min-w-0 pr-2">
                            <span className="font-bold text-slate-900 dark:text-[#F2F3F5] block truncate">
                              {inv.name}
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-[#949BA4]">
                              {inv.count} transaction{inv.count > 1 ? 's' : ''}
                            </span>
                          </div>
                          <span className="font-black text-emerald-800 dark:text-[#1ED760] text-sm shrink-0">
                            +{formatINR(inv.amountPaise)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                </div>

                {/* 10. LABOUR ACCRUAL SEPARATION */}
                <div className="lg:col-span-6 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Accrual vs Cash Principle
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        LABOUR COST / ACCRUAL SEPARATION
                      </h2>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3 text-xs sm:text-sm">
                    <div className="p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-[#F2F3F5] block">
                          Verified Attendance Labour Accrual
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-[#949BA4]">
                          Operational workforce liability from Daily Attendance
                        </span>
                      </div>
                      <span className="font-black text-slate-900 dark:text-[#F2F3F5] text-sm">
                        {formatINR(attendanceLabourCostPaise)}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900 dark:text-[#F2F3F5] block">
                          Cash Paid / Financial Salary Debits
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-[#949BA4]">
                          Actual disbursed wage transactions in ledger
                        </span>
                      </div>
                      <span className="font-black text-slate-900 dark:text-[#F2F3F5] text-sm">
                        {formatINR(salaryPaise)}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-700/50 text-[11px] text-amber-900 dark:text-amber-200 font-medium">
                      💡 <strong>Financial Invariant:</strong> Attendance labour accrual is tracked independently from cash debits and is <em>never</em> automatically added to Total Outflow unless explicitly recorded as a salary disbursement.
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 4: Daily Cash Movement & Monthly Roll-Forward */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* 14. DAILY CASH MOVEMENT */}
                <div className="lg:col-span-6 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Chronology
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        DAILY CASH MOVEMENT
                      </h2>
                    </div>
                    <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                      {dailyMovements.length} Active Day{dailyMovements.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="p-4 sm:p-5 space-y-4">
                  {dailyMovements.length === 0 ? (
                    <div className="py-6 text-center text-slate-400 dark:text-[#949BA4] text-xs">
                      No active financial movements recorded in this period.
                    </div>
                  ) : (
                    <div className="space-y-2 text-xs max-h-[260px] overflow-y-auto custom-scrollbar pr-1">
                      {dailyMovements.map((dm) => (
                        <div
                          key={dm.date}
                          className="p-2.5 rounded-lg border border-slate-200 dark:border-[#2B2D31] bg-slate-50 dark:bg-[#111214] flex items-center justify-between gap-2"
                        >
                          <div className="min-w-[80px]">
                            <span className="font-bold text-slate-900 dark:text-[#F2F3F5] block">
                              {dm.date}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {dm.count} tx{dm.count > 1 ? 's' : ''}
                            </span>
                          </div>

                          <div className="flex items-center space-x-3 text-right">
                            {dm.inflowPaise > 0 && (
                              <span className="font-bold text-emerald-700 dark:text-[#1ED760]">
                                +{formatINR(dm.inflowPaise)}
                              </span>
                            )}
                            {dm.outflowPaise > 0 && (
                              <span className="font-bold text-rose-700 dark:text-[#F87171]">
                                −{formatINR(dm.outflowPaise)}
                              </span>
                            )}
                            <span className={`font-black pl-2 border-l border-slate-200 dark:border-[#3A3D42] ${
                              dm.netPaise >= 0 ? 'text-emerald-700 dark:text-[#1ED760]' : 'text-rose-700 dark:text-[#F87171]'
                            }`}>
                              {dm.netPaise >= 0 ? `+${formatINR(dm.netPaise)}` : `-${formatINR(Math.abs(dm.netPaise))}`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                </div>

                {/* 15. MONTHLY ROLL-FORWARD */}
                <div className="lg:col-span-6 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden flex flex-col justify-between">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Period Continuity
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        MONTHLY ROLL-FORWARD
                      </h2>
                    </div>
                  </div>

                  <div className="p-4 sm:p-5 space-y-3 text-xs sm:text-sm">
                  {monthlyRollForward ? (
                    <div className="space-y-3">
                      {/* Step 1: Previous Month Closing */}
                      <div className="p-3 rounded-lg border border-slate-200 dark:border-[#2B2D31] bg-slate-50 dark:bg-[#111214] flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            {(monthlyRollForward.previousMonthLabel || '').toUpperCase()} CLOSING
                          </span>
                          <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">
                            {monthlyRollForward.hasPriorData ? formatINR(monthlyRollForward.previousMonthClosingPaise) : 'No prior financial balance (₹0)'}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-slate-400">Step 1</span>
                      </div>

                      <div className="flex justify-center -my-1 text-slate-400">
                        ↓
                      </div>

                      {/* Step 2: Current Month Opening */}
                      <div className="p-3 rounded-lg border border-slate-200 dark:border-[#2B2D31] bg-slate-50 dark:bg-[#111214] flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            {(monthlyRollForward.currentMonthLabel || '').toUpperCase()} OPENING
                          </span>
                          <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">
                            {formatINR(monthlyRollForward.currentMonthOpeningPaise)}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-slate-400">Step 2</span>
                      </div>

                      <div className="flex justify-center -my-1 text-slate-400">
                        ↓
                      </div>

                      {/* Step 3: Current Month Net */}
                      <div className="p-3 rounded-lg border border-slate-200 dark:border-[#2B2D31] bg-slate-50 dark:bg-[#111214] flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-slate-400 block">
                            {(monthlyRollForward.currentMonthLabel || '').toUpperCase()} NET MOVEMENT
                          </span>
                          <span className={`font-black ${
                            monthlyRollForward.currentMonthNetPaise >= 0 ? 'text-emerald-700 dark:text-[#1ED760]' : 'text-rose-700 dark:text-[#F87171]'
                          }`}>
                            {monthlyRollForward.currentMonthNetPaise >= 0 
                              ? `+${formatINR(monthlyRollForward.currentMonthNetPaise)}` 
                              : `-${formatINR(Math.abs(monthlyRollForward.currentMonthNetPaise))}`}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-slate-400">Step 3</span>
                      </div>

                      <div className="flex justify-center -my-1 text-slate-400">
                        ↓
                      </div>

                      {/* Step 4: Current Month Closing */}
                      <div className="p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] bg-slate-900 dark:bg-[#202225] text-white flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-emerald-400 dark:text-[#1ED760] block">
                            {(monthlyRollForward.currentMonthLabel || '').toUpperCase()} CLOSING
                          </span>
                          <span className="font-black text-white text-base">
                            {formatINR(monthlyRollForward.currentMonthClosingPaise)}
                          </span>
                        </div>
                        <span className="text-xs font-bold text-slate-400">Final Balance</span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-slate-400 text-xs">
                      Roll-forward data unavailable.
                    </div>
                  )}
                  </div>
                </div>
              </div>

              {/* Row 5: 16. YEAR OVERVIEW */}
              {yearOverview.length > 0 && (
                <div className="bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div>
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-300 dark:text-[#949BA4] block">
                        Annual Cadence
                      </span>
                      <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider">
                        YEAR OVERVIEW ({yearOverview[0]?.monthKey?.slice(0, 4) || ''})
                      </h2>
                    </div>
                    <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                      Click any month to apply
                    </span>
                  </div>

                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                          <th className="py-2.5 px-3">Month</th>
                          <th className="py-2.5 px-3 text-right">Inflow</th>
                          <th className="py-2.5 px-3 text-right">Outflow</th>
                          <th className="py-2.5 px-3 text-right">Net Movement</th>
                          <th className="py-2.5 px-3 text-right">Closing Balance</th>
                          <th className="py-2.5 px-3 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                        {yearOverview.map((m) => (
                          <tr 
                            key={m.monthKey}
                            className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors"
                          >
                            <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-[#F2F3F5] whitespace-nowrap">
                              {m.monthLabel}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-emerald-700 dark:text-[#1ED760] whitespace-nowrap">
                              {m.inflowPaise > 0 ? `+${formatINR(m.inflowPaise)}` : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-rose-700 dark:text-[#F87171] whitespace-nowrap">
                              {m.outflowPaise > 0 ? `−${formatINR(m.outflowPaise)}` : '—'}
                            </td>
                            <td className={`py-2.5 px-3 text-right font-bold whitespace-nowrap ${
                              m.netPaise > 0 
                                ? 'text-emerald-700 dark:text-[#1ED760]' 
                                : m.netPaise < 0 
                                ? 'text-rose-700 dark:text-[#F87171]' 
                                : 'text-slate-400'
                            }`}>
                              {m.netPaise !== 0 ? (m.netPaise > 0 ? `+${formatINR(m.netPaise)}` : `-${formatINR(Math.abs(m.netPaise))}`) : '—'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-black text-slate-900 dark:text-[#F2F3F5] whitespace-nowrap">
                              {formatINR(m.closingBalancePaise)}
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleSelectMonthFromYearOverview(m.monthKey)}
                                className="px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-300 dark:border-[#3A3D42] hover:bg-slate-900 hover:text-white dark:hover:bg-[#1ED760] dark:hover:text-[#0A0A0A] transition-colors"
                              >
                                View
                              </button>
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

          {/* ============================================================ */}
          {/* VIEW MODE B: TRANSACTION LEDGER                              */}
          {/* ============================================================ */}
          {viewMode === 'LEDGER' && (
            <div className="space-y-4">
              {/* Filter Bar */}
              <div className="bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] p-4 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  {/* Search */}
                  <div className="sm:col-span-5 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search note, investor, context, role, ID..."
                      aria-label="Search ledger transactions"
                      className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl pl-9 pr-3 text-xs sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                    />
                  </div>

                  {/* Type Filter */}
                  <div className="sm:col-span-3">
                    <select
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value as any)}
                      aria-label="Filter by type"
                      className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl px-3 text-xs sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                    >
                      <option value="ALL">All Types (Credit &amp; Debit)</option>
                      <option value="CREDIT">Credits Only (+Inflow)</option>
                      <option value="DEBIT">Debits Only (−Outflow)</option>
                    </select>
                  </div>

                  {/* Category Filter */}
                  <div className="sm:col-span-3">
                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      aria-label="Filter by category"
                      className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl px-3 text-xs sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                    >
                      <option value="ALL">All Categories</option>
                      <option value="CASH_INFLOW">Investor Inflow</option>
                      <option value="SUPPLIES">Supplies / Materials</option>
                      <option value="SALARY">Salary / Wages</option>
                      <option value="SPECIAL_WORKER_TASK">Special Task (Legacy)</option>
                    </select>
                  </div>

                  {/* Reset Filters */}
                  <div className="sm:col-span-1 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={resetPresentationFilters}
                      disabled={!hasActivePresentationFilters}
                      aria-label="Reset filters"
                      title="Reset presentation filters"
                      className="w-full sm:w-11 min-h-[44px] flex items-center justify-center rounded-xl border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Filter Chips & Running Balance Notice */}
                <div className="flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-[#949BA4] pt-2 border-t border-slate-100 dark:border-[#202225] gap-2">
                  <div className="flex items-center space-x-2">
                    <Tag className="w-3.5 h-3.5" />
                    <span>Showing {filteredTransactions.length} of {transactions.length} transactions</span>
                  </div>
                  <span className="text-[11px] text-slate-400 italic">
                    Running balances are calculated chronologically from opening balance and preserved across filters.
                  </span>
                </div>
              </div>

              {/* Ledger Card / Table Container */}
              <div className="bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                  <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
                    <Receipt className="w-4 h-4 text-slate-300 dark:text-[#949BA4] shrink-0" />
                    <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                      Master Transaction Ledger
                    </h2>
                  </div>
                  <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                    {filteredTransactions.length} {filteredTransactions.length === 1 ? 'RECORD' : 'RECORDS'}
                  </span>
                </div>

                {filteredTransactions.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 dark:text-[#949BA4] text-sm">
                    <Receipt className="w-8 h-8 text-slate-300 dark:text-[#4A4D52] mx-auto mb-2" />
                    No transactions match the selected filters or period.
                  </div>
                ) : (
                  <>
                    {/* DESKTOP / TABLET: Enterprise Ledger Table */}
                    <div className="hidden md:block overflow-x-auto custom-scrollbar">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                            <th className="py-3 px-3">Date</th>
                            <th className="py-3 px-2.5">Type</th>
                            <th className="py-3 px-3">Category</th>
                            <th className="py-3 px-3">Party / Item / Context</th>
                            <th className="py-3 px-3">Note</th>
                            <th className="py-3 px-3 text-right">Inflow (+)</th>
                            <th className="py-3 px-3 text-right">Outflow (−)</th>
                            <th className="py-3 px-3 text-right">Running Balance</th>
                            <th className="py-3 px-2.5 text-center">Proof</th>
                            <th className="py-3 px-2.5 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                          {filteredTransactions.map((tx) => {
                            const isCredit = tx.type === 'CREDIT';
                            
                            // Determine Party / Context column content
                            let partyContext = '—';
                            if (isCredit) {
                              partyContext = tx.investor_name || tx.description || 'Investor Funding';
                            } else if (tx.debit_category === 'SUPPLIES') {
                              partyContext = tx.reference_note || tx.description || 'Supplies / Materials';
                            } else if (tx.debit_category === 'SALARY') {
                              partyContext = tx.work_role_name || tx.work_category_name || 'Workforce Wages';
                            } else if (tx.debit_category === 'SPECIAL_WORKER_TASK') {
                              partyContext = tx.description || 'Special Worker Task';
                            }

                            return (
                              <tr 
                                key={tx.id}
                                className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors"
                              >
                                <td className="py-3 px-3 font-bold text-slate-900 dark:text-[#F2F3F5] whitespace-nowrap">
                                  {tx.date}
                                </td>

                                <td className="py-3 px-2.5 whitespace-nowrap">
                                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                    isCredit
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-[#0F291B] dark:text-[#1ED760] dark:border-[#1A7F3C]'
                                      : 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-[#2A1215] dark:text-[#F87171] dark:border-[#6E1C24]'
                                  }`}>
                                    {tx.type}
                                  </span>
                                </td>

                                <td className="py-3 px-3 font-semibold text-slate-600 dark:text-[#B5BAC1] whitespace-nowrap">
                                  {isCredit
                                    ? 'Investor Credit'
                                    : tx.debit_category === 'SUPPLIES'
                                    ? 'Supplies'
                                    : tx.debit_category === 'SALARY'
                                    ? 'Salary'
                                    : 'Special Task (Legacy)'}
                                </td>

                                <td className="py-3 px-3 font-bold text-slate-900 dark:text-[#F2F3F5] max-w-xs truncate" title={partyContext}>
                                  {partyContext}
                                </td>

                                <td className="py-3 px-3 text-slate-600 dark:text-[#949BA4] max-w-xs truncate" title={tx.reference_note || tx.description}>
                                  {tx.reference_note || tx.description}
                                </td>

                                <td className="py-3 px-3 text-right font-black text-emerald-700 dark:text-[#1ED760] whitespace-nowrap">
                                  {isCredit ? `+${formatINR(tx.amount_paise)}` : '—'}
                                </td>

                                <td className="py-3 px-3 text-right font-black text-rose-700 dark:text-[#F87171] whitespace-nowrap">
                                  {!isCredit ? `−${formatINR(tx.amount_paise)}` : '—'}
                                </td>

                                <td className="py-3 px-3 text-right font-black text-slate-900 dark:text-[#F2F3F5] whitespace-nowrap">
                                  {formatINR(tx.runningBalancePaise)}
                                </td>

                                <td className="py-3 px-2.5 text-center whitespace-nowrap">
                                  {tx.attachment_url ? (
                                    <a
                                      href={tx.attachment_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label="View Proof Attachment"
                                      className="inline-flex p-1 text-slate-600 hover:text-slate-900 dark:text-[#949BA4] dark:hover:text-[#1ED760] transition-colors"
                                      title="View Proof"
                                    >
                                      <Paperclip className="w-4 h-4" />
                                    </a>
                                  ) : (
                                    <span className="text-slate-300 dark:text-[#4A4D52]">—</span>
                                  )}
                                </td>

                                <td className="py-3 px-2.5 text-center whitespace-nowrap">
                                  <button
                                    type="button"
                                    onClick={() => handleViewDetails(tx)}
                                    aria-label="View transaction details"
                                    title="View Details"
                                    className="p-1 text-slate-600 hover:text-slate-900 dark:text-[#949BA4] dark:hover:text-[#F2F3F5] transition-colors"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* MOBILE: Stacked Cards (< 768px) */}
                    <div className="md:hidden p-3 space-y-3">
                      {filteredTransactions.map((tx) => {
                        const isCredit = tx.type === 'CREDIT';
                        let partyContext = '—';
                        if (isCredit) {
                          partyContext = tx.investor_name || tx.description || 'Investor Funding';
                        } else if (tx.debit_category === 'SUPPLIES') {
                          partyContext = tx.reference_note || tx.description || 'Supplies / Materials';
                        } else if (tx.debit_category === 'SALARY') {
                          partyContext = tx.work_role_name || tx.work_category_name || 'Workforce Wages';
                        } else if (tx.debit_category === 'SPECIAL_WORKER_TASK') {
                          partyContext = tx.description || 'Special Worker Task';
                        }

                        return (
                          <div
                            key={tx.id}
                            className="bg-slate-50 dark:bg-[#111214] p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] space-y-2.5"
                          >
                            {/* Top row: Type, Date, Amount */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center space-x-2">
                                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                  isCredit
                                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-[#0F291B] dark:text-[#1ED760] dark:border-[#1A7F3C]'
                                    : 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-[#2A1215] dark:text-[#F87171] dark:border-[#6E1C24]'
                                }`}>
                                  {tx.type}
                                </span>
                                <span className="text-xs font-bold text-slate-600 dark:text-[#B5BAC1]">
                                  {tx.date}
                                </span>
                              </div>
                              <span className={`text-sm font-black ${
                                isCredit ? 'text-emerald-700 dark:text-[#1ED760]' : 'text-rose-700 dark:text-[#F87171]'
                              }`}>
                                {isCredit ? `+${formatINR(tx.amount_paise)}` : `−${formatINR(tx.amount_paise)}`}
                              </span>
                            </div>

                            {/* Context & Description */}
                            <div className="space-y-0.5">
                              <p className="text-xs font-black text-slate-900 dark:text-[#F2F3F5] break-words">
                                {partyContext}
                              </p>
                              {(tx.reference_note || tx.description) && (
                                <p className="text-[11px] text-slate-500 dark:text-[#949BA4] break-words">
                                  {tx.reference_note || tx.description}
                                </p>
                              )}
                            </div>

                            {/* Bottom row: Running balance & Action */}
                            <div className="pt-2 border-t border-slate-200 dark:border-[#2B2D31] flex items-center justify-between text-xs">
                              <div>
                                <span className="text-[10px] font-semibold text-slate-400 block">
                                  Balance
                                </span>
                                <span className="font-black text-slate-900 dark:text-[#F2F3F5]">
                                  {formatINR(tx.runningBalancePaise)}
                                </span>
                              </div>

                              <div className="flex items-center space-x-2">
                                {tx.attachment_url && (
                                  <a
                                    href={tx.attachment_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-1.5 rounded-lg border border-slate-300 dark:border-[#3A3D42] text-slate-600 dark:text-[#949BA4] hover:bg-slate-200 dark:hover:bg-[#2B2D31]"
                                    title="View Proof"
                                  >
                                    <Paperclip className="w-3.5 h-3.5" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleViewDetails(tx)}
                                  className="min-h-[36px] px-3 py-1 rounded-lg border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] font-bold text-[11px] text-slate-800 dark:text-[#F2F3F5] flex items-center space-x-1"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Details</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Details Modal (Non-destructive, Zero-delete) */}
      <TransactionDetailsModal
        isOpen={detailsModalOpen}
        onClose={() => {
          setDetailsModalOpen(false);
          setSelectedTxForDetails(null);
        }}
        transaction={selectedTxForDetails}
      />
    </div>
  );
}
