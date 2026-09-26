'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { FinancialDbRecord } from '@/lib/db/repositories/finance-repo';
import { 
  PlusCircle, 
  MinusCircle, 
  FileDown, 
  Eye,
  Receipt,
  Paperclip,
  Clock,
  TrendingUp,
  TrendingDown,
  Wallet,
  Coins,
  Scale,
  Users
} from 'lucide-react';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';
import { DateRangeFilter, FilterValues } from '@/components/finance/DateRangeFilter';
import { CreditModal } from '@/components/finance/CreditModal';
import { DebitModal } from '@/components/finance/DebitModal';
import { TransactionDetailsModal } from '@/components/finance/TransactionDetailsModal';
import { parseTransactionSearch, matchTransactionSearch } from '@/lib/finance/search-parser';

interface TransactionWithBalance extends FinancialDbRecord {
  runningBalancePaise: number;
}

export default function FinanceTransactionsPage() {
  const { selectedSite, selectedSiteId, user } = useSite();

  // Transactions & Financial Metrics from API
  const [transactions, setTransactions] = useState<FinancialDbRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [periodOpeningBalancePaise, setPeriodOpeningBalancePaise] = useState<number>(0);
  const [currentSiteBalancePaise, setCurrentSiteBalancePaise] = useState<number>(0);
  const [attendanceLabourCostPaise, setAttendanceLabourCostPaise] = useState<number>(0);

  // Authoritative Date Boundaries
  const [earliestDate, setEarliestDate] = useState<string>('');
  const [latestDate, setLatestDate] = useState<string>('');
  const [appliedStartDate, setAppliedStartDate] = useState<string>('');
  const [appliedEndDate, setAppliedEndDate] = useState<string>('');

  // Filtering State
  const [filterValues, setFilterValues] = useState<FilterValues>({
    startDate: '',
    endDate: '',
    type: 'ALL',
    category: 'ALL',
    searchQuery: '',
  });

  // Modal Controls
  const [creditModalOpen, setCreditModalOpen] = useState<boolean>(false);
  const [debitModalOpen, setDebitModalOpen] = useState<boolean>(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState<boolean>(false);
  const [selectedTxForDetails, setSelectedTxForDetails] = useState<FinancialDbRecord | null>(null);

  // Export State
  const [exportLoading, setExportLoading] = useState<boolean>(false);

  // Fetch Financial Data from API
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
        setPeriodOpeningBalancePaise(data.periodOpeningBalancePaise ?? 0);
        setCurrentSiteBalancePaise(data.currentSiteBalancePaise ?? 0);
        setAttendanceLabourCostPaise(data.attendanceLabourCostPaise ?? 0);
        setEarliestDate(data.earliestDate || data.startDate || '');
        setLatestDate(data.latestDate || data.endDate || '');

        const actualStart = data.startDate || '';
        const actualEnd = data.endDate || '';
        setAppliedStartDate(actualStart);
        setAppliedEndDate(actualEnd);
        setFilterValues((prev) => ({
          ...prev,
          startDate: actualStart,
          endDate: actualEnd,
        }));
      }
    } catch (err) {
      console.error('Error fetching financial data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  // Initial Load
  useEffect(() => {
    fetchFinancialData();
  }, [fetchFinancialData]);

  // Apply Date Range Handler
  const handleApplyDateRange = (startDate: string, endDate: string) => {
    fetchFinancialData(startDate, endDate);
  };

  // PDF Export
  const handleExportPDF = async () => {
    if (!selectedSiteId) return;
    setExportLoading(true);
    try {
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: selectedSiteId,
          type: 'FINANCE',
          startDate: appliedStartDate,
          endDate: appliedEndDate,
        }),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedSite?.name || 'Site'}_Financial_Ledger_${appliedStartDate}_to_${appliedEndDate}.pdf`;
      a.click();
    } catch (err) {
      alert('Failed to export PDF');
    } finally {
      setExportLoading(false);
    }
  };

  // 1. Calculate running balance across all period transactions in chronological order
  const transactionsWithRunningBalance = useMemo<TransactionWithBalance[]>(() => {
    // Sort ascending by date and creation time for cumulative calculation
    const sortedAsc = [...transactions].sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });

    let running = periodOpeningBalancePaise;
    return sortedAsc.map((tx) => {
      running += tx.type === 'CREDIT' ? tx.amount_paise : -tx.amount_paise;
      return { ...tx, runningBalancePaise: running };
    });
  }, [transactions, periodOpeningBalancePaise]);

  // 2. Filter transactions based on active UI filters
  const filteredTransactions = useMemo<TransactionWithBalance[]>(() => {
    const parsedSearch = parseTransactionSearch(filterValues.searchQuery);

    return transactionsWithRunningBalance.filter((tx) => {
      // Type Filter
      if (filterValues.type !== 'ALL' && tx.type !== filterValues.type) {
        return false;
      }

      // Category Filter
      if (filterValues.category !== 'ALL') {
        if (filterValues.category === 'CASH_INFLOW') {
          if (tx.type !== 'CREDIT') return false;
        } else {
          if (tx.debit_category !== filterValues.category) return false;
        }
      }

      // Advanced Search (Amount Prefix, Signed Direction, Date, or Text)
      if (filterValues.searchQuery.trim()) {
        if (!matchTransactionSearch(tx, parsedSearch, filterValues.type)) {
          return false;
        }
      }

      return true;
    });
  }, [transactionsWithRunningBalance, filterValues]);

  // 3. Display transactions reverse chronological (newest on top)
  const displayTransactions = useMemo<TransactionWithBalance[]>(() => {
    return [...filteredTransactions].reverse();
  }, [filteredTransactions]);

  // Summary Metrics for the Active Period
  const periodSummary = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const t of transactions) {
      if (t.type === 'CREDIT') {
        inflow += t.amount_paise;
      } else if (t.type === 'DEBIT') {
        outflow += t.amount_paise;
      }
    }
    const net = inflow - outflow;
    return { inflow, outflow, net };
  }, [transactions]);

  // Reset Filters Handler
  const handleResetFilters = () => {
    setFilterValues((prev) => ({
      ...prev,
      type: 'ALL',
      category: 'ALL',
      searchQuery: '',
    }));
    if (earliestDate && latestDate) {
      fetchFinancialData(earliestDate, latestDate);
    }
  };

  const isReadOnly = user?.role === 'VIEWER';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* HEADER & ACTION BAR */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4]">
              Financial Ledger &amp; Cash Movements
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5] tracking-tight mt-0.5">
            TRANSACTIONS
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Active Site: <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">{selectedSite?.name || 'No Site Selected'}</span>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Export Controls */}
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={exportLoading || !selectedSiteId}
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-900 dark:border-[#3A3D42] text-xs sm:text-sm font-bold text-slate-800 dark:text-[#F2F3F5] rounded-xl shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 touch-action-manipulation shrink-0"
          >
            <FileDown className="w-4 h-4 mr-1.5 text-rose-600 dark:text-[#F87171] shrink-0" />
            PDF Ledger
          </button>

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'FINANCE',
              startDate: appliedStartDate || undefined,
              endDate: appliedEndDate || undefined,
              transactionType: filterValues.type !== 'ALL' ? filterValues.type : undefined,
              debitCategory: filterValues.category !== 'ALL' ? filterValues.category : undefined,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Financial_Ledger.xlsx`}
            label="Excel Ledger"
          />

          {/* Primary Transaction Composer Buttons */}
          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={() => setCreditModalOpen(true)}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#0A0A0A] border border-slate-900 dark:border-[#1A7F3C] text-xs sm:text-sm font-black rounded-xl shadow transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 touch-action-manipulation shrink-0"
              >
                <PlusCircle className="w-4 h-4 mr-1.5 shrink-0" />
                CREDIT
              </button>

              <button
                type="button"
                onClick={() => setDebitModalOpen(true)}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 dark:bg-[#F87171] dark:hover:bg-[#EF4444] text-white dark:text-[#0A0A0A] border border-slate-900 dark:border-rose-900 text-xs sm:text-sm font-black rounded-xl shadow transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 touch-action-manipulation shrink-0"
              >
                <MinusCircle className="w-4 h-4 mr-1.5 shrink-0" />
                DEBIT
              </button>
            </>
          )}
        </div>
      </div>

      {/* FINANCIAL SUMMARY & METRICS SECTION */}
      <div className="bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
        <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
          <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
            <Wallet className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
            <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
              Financial Summary &amp; Cash Movements
            </h2>
          </div>
          <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
            {appliedStartDate && appliedEndDate ? `${appliedStartDate} to ${appliedEndDate}` : 'Active Period'}
          </span>
        </div>

        <div className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
            {/* 1. Period Opening Balance */}
            <div className="p-3.5 sm:p-4 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4]">
                    Period Opening
                  </span>
                  <Clock className="w-4 h-4 text-slate-400 dark:text-[#949BA4]" />
                </div>
                <span className="text-base sm:text-lg lg:text-xl font-black text-slate-900 dark:text-[#F2F3F5] block truncate mt-1" title={formatINR(periodOpeningBalancePaise)}>
                  {formatINR(periodOpeningBalancePaise)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-1 truncate">
                Prior to {appliedStartDate || 'Start'}
              </span>
            </div>

            {/* 2. Total Inflow */}
            <div className="p-3.5 sm:p-4 bg-emerald-50/50 dark:bg-[#0F291B]/50 rounded-2xl border border-slate-900 dark:border-[#1A7F3C] shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-[#86EFAC]">
                    Total Inflow
                  </span>
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                </div>
                <span className="text-base sm:text-lg lg:text-xl font-black text-emerald-900 dark:text-[#1ED760] block truncate mt-1" title={formatINR(periodSummary.inflow)}>
                  +{formatINR(periodSummary.inflow)}
                </span>
              </div>
              <span className="text-[10px] text-emerald-700 dark:text-[#86EFAC]/80 block mt-1">
                Investor &amp; Capital Credits
              </span>
            </div>

            {/* 3. Total Outflow */}
            <div className="p-3.5 sm:p-4 bg-rose-50/50 dark:bg-[#2A1215]/50 rounded-2xl border border-slate-900 dark:border-[#6E1C24] shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-rose-800 dark:text-[#FCA5A5]">
                    Total Outflow
                  </span>
                  <TrendingDown className="w-4 h-4 text-rose-600 dark:text-[#F87171]" />
                </div>
                <span className="text-base sm:text-lg lg:text-xl font-black text-rose-900 dark:text-[#F87171] block truncate mt-1" title={formatINR(periodSummary.outflow)}>
                  -{formatINR(periodSummary.outflow)}
                </span>
              </div>
              <span className="text-[10px] text-rose-700 dark:text-[#FCA5A5]/80 block mt-1">
                Supplies &amp; Salary Debits
              </span>
            </div>

            {/* 4. Net Movement */}
            <div className="p-3.5 sm:p-4 bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-slate-600 dark:text-[#949BA4]">
                    Net Movement
                  </span>
                  <Scale className="w-4 h-4 text-slate-400 dark:text-[#949BA4]" />
                </div>
                <span
                  className={`text-base sm:text-lg lg:text-xl font-black block truncate mt-1 ${
                    periodSummary.net >= 0
                      ? 'text-emerald-700 dark:text-[#1ED760]'
                      : 'text-rose-700 dark:text-[#F87171]'
                  }`}
                  title={formatINR(periodSummary.net)}
                >
                  {periodSummary.net >= 0 ? '+' : ''}{formatINR(periodSummary.net)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-1">
                Inflow minus Outflow
              </span>
            </div>

            {/* 5. Current Site Balance */}
            <div className="col-span-2 lg:col-span-1 p-3.5 sm:p-4 bg-slate-900 dark:bg-[#111214] text-white rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-emerald-400 dark:text-[#1ED760]">
                    Current Site Balance
                  </span>
                  <Wallet className="w-4 h-4 text-emerald-400 dark:text-[#1ED760]" />
                </div>
                <span className="text-base sm:text-lg lg:text-xl font-black text-white dark:text-[#F2F3F5] block truncate mt-1" title={formatINR(currentSiteBalancePaise)}>
                  {formatINR(currentSiteBalancePaise)}
                </span>
              </div>
              <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-1">
                All-Time Cumulative Cash
              </span>
            </div>
          </div>

          {/* Secondary Card: Attendance Labour Cost */}
          <div className="p-3 bg-slate-50 dark:bg-[#111214] rounded-xl border border-slate-200 dark:border-[#2B2D31] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-slate-500 dark:text-[#949BA4] shrink-0" />
              <span className="text-slate-600 dark:text-[#949BA4]">
                Verified Attendance Labour Cost (Period Accrual):{' '}
                <strong className="text-slate-900 dark:text-[#F2F3F5] font-black">
                  {formatINR(attendanceLabourCostPaise)}
                </strong>
              </span>
            </div>
            <span className="text-[11px] text-slate-400 dark:text-[#949BA4] italic">
              Computed from daily attendance muster. Tracked independently from the cash ledger.
            </span>
          </div>
        </div>
      </div>

      {/* DATE RANGE & SEARCH FILTER TOOLBAR */}
      <DateRangeFilter
        values={filterValues}
        defaultStartDate={earliestDate || appliedStartDate}
        defaultEndDate={latestDate || appliedEndDate}
        onApplyDateRange={handleApplyDateRange}
        onChangeType={(t) => setFilterValues((prev) => ({ ...prev, type: t }))}
        onChangeCategory={(c) => setFilterValues((prev) => ({ ...prev, category: c }))}
        onChangeSearch={(q) => setFilterValues((prev) => ({ ...prev, searchQuery: q }))}
        onResetFilters={handleResetFilters}
        totalCount={transactions.length}
        filteredCount={filteredTransactions.length}
      />

      {/* TRANSACTIONS DUAL PRESENTATION */}
      {loading ? (
        <div className="py-16 text-center text-slate-500 dark:text-[#949BA4] font-bold text-sm bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42]">
          Loading financial ledger...
        </div>
      ) : displayTransactions.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 sm:p-14 rounded-2xl border border-slate-900 dark:border-[#3A3D42] text-center space-y-3 shadow-sm">
          <Receipt className="w-12 h-12 text-slate-300 dark:text-[#4A4D52] mx-auto" />
          <h3 className="text-base font-bold text-[#0F172A] dark:text-[#F2F3F5]">
            No Transactions Found
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-[#949BA4] max-w-sm mx-auto">
            There are no transactions recorded for this period matching your active filters.
          </p>
          {!isReadOnly && (
            <div className="flex flex-wrap justify-center gap-3 pt-3">
              <button
                type="button"
                onClick={() => setCreditModalOpen(true)}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#0A0A0A] border border-slate-900 dark:border-[#1A7F3C] font-black text-xs sm:text-sm rounded-xl shadow-sm touch-action-manipulation"
              >
                + Record Credit
              </button>
              <button
                type="button"
                onClick={() => setDebitModalOpen(true)}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 dark:bg-[#F87171] dark:hover:bg-[#EF4444] text-white dark:text-[#0A0A0A] border border-slate-900 dark:border-rose-900 font-black text-xs sm:text-sm rounded-xl shadow-sm touch-action-manipulation"
              >
                + Record Debit
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* DESKTOP / TABLET VIEW: High-Density Table */}
          <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
              <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
                <Receipt className="w-4 h-4 text-slate-300 dark:text-[#949BA4] shrink-0" />
                <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                  Transaction Ledger
                </h2>
              </div>
              <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                {displayTransactions.length} {displayTransactions.length === 1 ? 'RECORD' : 'RECORDS'}
              </span>
            </div>
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                    <th className="py-3 px-4 whitespace-nowrap">Date</th>
                    <th className="py-3 px-3 whitespace-nowrap">Type</th>
                    <th className="py-3 px-3 whitespace-nowrap">Category</th>
                    <th className="py-3 px-4">Context / Assignment</th>
                    <th className="py-3 px-4">NOTE</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Inflow (+₹)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Outflow (-₹)</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Running Balance</th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">Proof</th>
                    <th className="py-3 px-4 text-center whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                  {displayTransactions.map((tx) => {
                    const isCredit = tx.type === 'CREDIT';

                    // Context String
                    let contextText = '—';
                    if (isCredit) {
                      contextText = tx.investor_name || 'Direct Inflow';
                    } else if (tx.debit_category === 'SALARY') {
                      contextText = `${tx.work_category_name || 'Salary'}${tx.work_role_name ? ' • ' + tx.work_role_name : ''}`;
                    } else if (tx.debit_category === 'SUPPLIES') {
                      contextText = tx.description || 'Supplies / Materials';
                    } else if (tx.debit_category === 'SPECIAL_WORKER_TASK') {
                      contextText = tx.description || 'Special Task (Legacy)';
                    }

                    // Category label
                    let categoryBadge = 'Credit';
                    if (!isCredit) {
                      if (tx.debit_category === 'SALARY') categoryBadge = 'Salary';
                      else if (tx.debit_category === 'SUPPLIES') categoryBadge = 'Supplies';
                      else if (tx.debit_category === 'SPECIAL_WORKER_TASK') categoryBadge = 'Special Task';
                    }

                    return (
                      <tr 
                        key={tx.id} 
                        className="hover:bg-slate-50/80 dark:hover:bg-[#202225] transition-colors"
                      >
                        {/* Date */}
                        <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] whitespace-nowrap">
                          {tx.date}
                        </td>

                        {/* Type Badge */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              isCredit
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-[#0F291B] dark:text-[#1ED760] dark:border-[#1A7F3C]'
                                : 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-[#2A1215] dark:text-[#F87171] dark:border-[#6E1C24]'
                            }`}
                          >
                            {tx.type}
                          </span>
                        </td>

                        {/* Category */}
                        <td className="py-3 px-3 whitespace-nowrap font-semibold text-slate-700 dark:text-[#B5BAC1]">
                          {categoryBadge}
                        </td>

                        {/* Context / Assignment */}
                        <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] max-w-xs break-words">
                          {contextText}
                        </td>

                        {/* Note */}
                        <td className="py-3 px-4 text-slate-500 dark:text-[#949BA4] max-w-xs break-words">
                          {tx.reference_note || '—'}
                        </td>

                        {/* Inflow (+₹) */}
                        <td className="py-3 px-4 text-right font-black text-emerald-600 dark:text-[#1ED760] whitespace-nowrap">
                          {isCredit ? `+${formatINR(tx.amount_paise)}` : '—'}
                        </td>

                        {/* Outflow (-₹) */}
                        <td className="py-3 px-4 text-right font-black text-rose-600 dark:text-[#F87171] whitespace-nowrap">
                          {!isCredit ? `-${formatINR(tx.amount_paise)}` : '—'}
                        </td>

                        {/* Running Balance */}
                        <td className="py-3 px-4 text-right font-black text-slate-900 dark:text-[#F2F3F5] whitespace-nowrap">
                          {formatINR(tx.runningBalancePaise)}
                        </td>

                        {/* Attachment Indicator */}
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {tx.attachment_url ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedTxForDetails(tx);
                                setDetailsModalOpen(true);
                              }}
                              className="p-1 text-emerald-600 dark:text-[#1ED760] hover:bg-emerald-50 dark:hover:bg-[#0F291B] rounded-lg transition-colors"
                              title="View Attached Proof"
                              aria-label="View Attachment"
                            >
                              <Paperclip className="w-4 h-4" />
                            </button>
                          ) : (
                            <span className="text-slate-300 dark:text-[#3A3D42]">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTxForDetails(tx);
                              setDetailsModalOpen(true);
                            }}
                            aria-label="View Details"
                            className="w-8 h-8 inline-flex items-center justify-center text-slate-400 dark:text-[#949BA4] hover:text-slate-800 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#202225] rounded-lg transition-colors"
                            title="View Details"
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
          </div>

          {/* MOBILE VIEW: Stacked Cards (< 768px) */}
          <div className="md:hidden space-y-3">
            <div className="bg-slate-900 dark:bg-[#202225] px-4 py-2.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <Receipt className="w-4 h-4 text-slate-300 dark:text-[#949BA4] shrink-0" />
                <h2 className="text-xs font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                  Transaction Ledger
                </h2>
              </div>
              <span className="text-[10px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2 py-0.5 rounded shrink-0">
                {displayTransactions.length} {displayTransactions.length === 1 ? 'RECORD' : 'RECORDS'}
              </span>
            </div>
            {displayTransactions.map((tx) => {
              const isCredit = tx.type === 'CREDIT';

              let contextText = '—';
              if (isCredit) {
                contextText = tx.investor_name || 'Direct Inflow';
              } else if (tx.debit_category === 'SALARY') {
                contextText = `${tx.work_category_name || 'Salary'}${tx.work_role_name ? ' • ' + tx.work_role_name : ''}`;
              } else if (tx.debit_category === 'SUPPLIES') {
                contextText = tx.description || 'Supplies / Materials';
              } else if (tx.debit_category === 'SPECIAL_WORKER_TASK') {
                contextText = tx.description || 'Special Task';
              }

              return (
                <div
                  key={tx.id}
                  className="bg-white dark:bg-[#18191C] p-4 rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-3"
                >
                  {/* Top Row: Type Badge, Date, and Amount */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                          isCredit
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-[#0F291B] dark:text-[#1ED760] dark:border-[#1A7F3C]'
                            : 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-[#2A1215] dark:text-[#F87171] dark:border-[#6E1C24]'
                        }`}
                      >
                        {tx.type}
                      </span>
                      <span className="text-xs font-bold text-slate-600 dark:text-[#B5BAC1]">
                        {tx.date}
                      </span>
                    </div>

                    <span
                      className={`text-base font-black shrink-0 ${
                        isCredit
                          ? 'text-emerald-600 dark:text-[#1ED760]'
                          : 'text-rose-600 dark:text-[#F87171]'
                      }`}
                    >
                      {isCredit ? `+${formatINR(tx.amount_paise)}` : `-${formatINR(tx.amount_paise)}`}
                    </span>
                  </div>

                  {/* Middle: Context & Notes */}
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-[#0F172A] dark:text-[#F2F3F5] break-words leading-snug">
                      {contextText}
                    </p>
                    {tx.reference_note && (
                      <p className="text-xs text-slate-500 dark:text-[#949BA4] break-words">
                        Ref: {tx.reference_note}
                      </p>
                    )}
                  </div>

                  {/* Running Balance & Actions */}
                  <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-slate-200 dark:border-[#2B2D31]">
                    <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4]">
                      Balance:{' '}
                      <span className="text-slate-900 dark:text-[#F2F3F5] font-black">
                        {formatINR(tx.runningBalancePaise)}
                      </span>
                    </div>

                    <div className="flex items-center space-x-1.5">
                      {tx.attachment_url && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTxForDetails(tx);
                            setDetailsModalOpen(true);
                          }}
                          className="p-2 text-emerald-600 dark:text-[#1ED760] bg-emerald-50 dark:bg-[#0F291B] rounded-lg"
                          aria-label="View Attachment"
                          title="Has Attachment"
                        >
                          <Paperclip className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTxForDetails(tx);
                          setDetailsModalOpen(true);
                        }}
                        className="p-2 text-slate-600 dark:text-[#949BA4] hover:bg-slate-100 dark:hover:bg-[#202225] rounded-lg border border-slate-300 dark:border-[#3A3D42]"
                        aria-label="View Details"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* COMPOSER & DETAILS MODALS */}
      <CreditModal
        isOpen={creditModalOpen}
        onClose={() => setCreditModalOpen(false)}
        onSuccess={() => fetchFinancialData(appliedStartDate, appliedEndDate)}
        siteId={selectedSiteId || ''}
      />

      <DebitModal
        isOpen={debitModalOpen}
        onClose={() => setDebitModalOpen(false)}
        onSuccess={() => fetchFinancialData(appliedStartDate, appliedEndDate)}
        siteId={selectedSiteId || ''}
      />

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
