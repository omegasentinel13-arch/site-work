'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { FinancialDbRecord } from '@/lib/db/repositories/finance-repo';
import { FinancialSummary } from '@/lib/domain/finance-engine';
import { ChevronLeft, ChevronRight, Receipt } from 'lucide-react';
import { PdfExportButton } from '@/components/export/PdfExportButton';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

export default function MonthlyFinancialReportPage() {
  const { selectedSite, selectedSiteId } = useSite();

  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [month, setMonth] = useState<number>(() => new Date().getMonth() + 1);
  const [summary, setSummary] = useState<FinancialSummary | null>(null);
  const [transactions, setTransactions] = useState<FinancialDbRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const monthLabel = `${monthNames[month - 1]} ${year}`;
  const startDateStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDateStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const fetchMonthlyStatement = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/finance/summary?siteId=${selectedSiteId}&startDate=${startDateStr}&endDate=${endDateStr}`
      );
      if (res.ok) {
        const data = await res.json();
        setSummary(data.summary);
        setTransactions(data.transactions || []);
      }
    } catch (err) {
      console.error('Error fetching monthly finance statement:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId, startDateStr, endDateStr]);

  useEffect(() => {
    fetchMonthlyStatement();
  }, [fetchMonthlyStatement]);

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

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Financial Statement
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5]">
            Monthly Financial Summary
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            {monthLabel} | Site: <span className="font-semibold text-slate-700 dark:text-[#B5BAC1]">{selectedSite?.name || 'No Site Selected'}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Month Navigation with explicit 44x44 hit targets */}
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
              type: 'MONTHLY_FINANCE',
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Monthly_Finance_${monthLabel.replace(/\s+/g, '_')}.pdf`}
            label="Export PDF"
          />

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'MONTHLY_FINANCE',
              startDate: startDateStr,
              endDate: endDateStr,
              monthLabel,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Monthly_Finance_${monthLabel.replace(/\s+/g, '_')}.xlsx`}
            label="Export Excel"
          />
        </div>
      </div>

      {/* Monthly Financial Statement Card */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Calculating monthly financial balances...
        </div>
      ) : summary ? (
        <div className="space-y-4 sm:space-y-6">
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-6 shadow-sm">
            <h2 className="text-sm sm:text-base font-black text-[#0F172A] dark:text-[#F2F3F5] uppercase tracking-wide border-b border-slate-900 dark:border-[#3A3D42] pb-3 mb-4">
              {monthLabel.toUpperCase()} — Balance Sheet
            </h2>

            <div className="space-y-3 text-xs sm:text-sm max-w-xl">
              {/* 1. Opening Balance */}
              <div className="flex justify-between items-center py-2.5 border-b border-slate-200 dark:border-[#2B2D31]">
                <span className="text-slate-600 dark:text-[#B5BAC1] font-bold">1. Opening Balance</span>
                <span className="font-black text-[#0F172A] dark:text-[#F2F3F5] text-sm sm:text-base">
                  {formatINR(summary.openingBalancePaise)}
                </span>
              </div>

              {/* 2. Total Credits */}
              <div className="flex justify-between items-center py-2.5 border-b border-slate-200 dark:border-[#1A7F3C] bg-emerald-50/50 dark:bg-[#0F291B] px-3 rounded-lg border border-slate-900 dark:border-[#1A7F3C]">
                <span className="text-emerald-800 dark:text-[#86EFAC] font-bold">2. Total Credits (Inflow)</span>
                <span className="font-black text-emerald-800 dark:text-[#1ED760] text-sm sm:text-base">
                  +{formatINR(summary.totalCreditPaise)}
                </span>
              </div>

              {/* 3. Total Debits */}
              <div className="py-2.5 border-b border-slate-200 dark:border-[#2B2D31] space-y-2">
                <span className="text-rose-800 dark:text-[#FCA5A5] font-bold block">3. Total Debits (Outflow):</span>
                <div className="pl-3 sm:pl-4 space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 dark:text-[#B5BAC1] font-medium">a. Supplies / Materials:</span>
                    <span className="font-bold text-[#0F172A] dark:text-[#F2F3F5]">
                      {formatINR(summary.suppliesDebitPaise)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600 dark:text-[#B5BAC1] font-medium">b. Special Worker / Task:</span>
                    <span className="font-bold text-[#0F172A] dark:text-[#F2F3F5]">
                      {formatINR(summary.specialWorkerTaskDebitPaise)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1.5 border-t border-slate-200 dark:border-[#2B2D31] font-bold">
                    <span className="text-rose-700 dark:text-[#F87171] font-bold">Subtotal Debits:</span>
                    <span className="font-black text-rose-700 dark:text-[#F87171] text-xs sm:text-sm">
                      -{formatINR(summary.totalDebitPaise)}
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. Closing Cash Balance */}
              <div className="flex justify-between items-center py-3.5 sm:py-4 bg-slate-900 dark:bg-[#202225] border border-slate-900 dark:border-[#3A3D42] text-white px-3.5 sm:px-4 rounded-lg shadow-sm">
                <div>
                  <span className="font-bold text-emerald-400 dark:text-[#1ED760] block text-xs uppercase">
                    4. Closing Cash Balance
                  </span>
                  <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5">
                    Opening + Credits - Debits
                  </span>
                </div>
                <span className="font-black text-white dark:text-[#F2F3F5] text-lg sm:text-xl">
                  {formatINR(summary.closingBalancePaise)}
                </span>
              </div>
            </div>
          </div>

          {/* Month Transaction Log */}
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 bg-slate-100 dark:bg-[#202225] border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
              <span className="font-black text-xs sm:text-sm text-[#0F172A] dark:text-[#F2F3F5] uppercase">
                {monthLabel} — Recorded Transactions ({transactions.length})
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-[#949BA4] md:hidden">
                Card list below
              </span>
            </div>

            {transactions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 dark:text-[#949BA4] text-sm">
                <Receipt className="w-8 h-8 text-slate-300 dark:text-[#4A4D52] mx-auto mb-2" />
                No transactions recorded in {monthLabel}.
              </div>
            ) : (
              <>
                {/* DESKTOP / TABLET VIEW: Crisp table */}
                <div className="hidden md:block overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-3">Type</th>
                        <th className="py-3 px-3">Category</th>
                        <th className="py-3 px-4">Description</th>
                        <th className="py-3 px-4 text-right">Credit (+)</th>
                        <th className="py-3 px-4 text-right">Debit (-)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                      {transactions.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                          <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] whitespace-nowrap">{t.date}</td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                                t.type === 'CREDIT'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-[#0F291B] dark:text-[#1ED760] dark:border-[#1A7F3C]'
                                  : 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-[#2A1215] dark:text-[#F87171] dark:border-[#6E1C24]'
                              }`}
                            >
                              {t.type}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-600 dark:text-[#B5BAC1] whitespace-nowrap">
                            {t.debit_category === 'SPECIAL_WORKER_TASK'
                              ? 'Special Task'
                              : t.debit_category === 'SUPPLIES'
                              ? 'Supplies'
                              : '—'}
                          </td>
                          <td className="py-3 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] max-w-sm break-words">{t.description}</td>
                          <td className="py-3 px-4 text-right font-black text-emerald-700 dark:text-[#1ED760] whitespace-nowrap">
                            {t.type === 'CREDIT' ? `+${formatINR(t.amount_paise)}` : '—'}
                          </td>
                          <td className="py-3 px-4 text-right font-black text-rose-700 dark:text-[#F87171] whitespace-nowrap">
                            {t.type === 'DEBIT' ? `-${formatINR(t.amount_paise)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE VIEW: Responsive Cards (< 768px) */}
                <div className="md:hidden p-3 space-y-2.5">
                  {transactions.map((t) => (
                    <div
                      key={t.id}
                      className="bg-slate-50 dark:bg-[#111214] p-3.5 rounded-lg border border-slate-900 dark:border-[#3A3D42] space-y-2"
                    >
                      {/* Top: Badges and Amount */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                              t.type === 'CREDIT'
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-[#0F291B] dark:text-[#1ED760] dark:border-[#1A7F3C]'
                                : 'bg-rose-100 text-rose-800 border border-rose-300 dark:bg-[#2A1215] dark:text-[#F87171] dark:border-[#6E1C24]'
                            }`}
                          >
                            {t.type}
                          </span>
                          <span className="text-xs font-bold text-slate-600 dark:text-[#B5BAC1]">{t.date}</span>
                        </div>

                        <span
                          className={`text-sm font-black shrink-0 ${
                            t.type === 'CREDIT' ? 'text-emerald-700 dark:text-[#1ED760]' : 'text-rose-700 dark:text-[#F87171]'
                          }`}
                        >
                          {t.type === 'CREDIT' ? `+${formatINR(t.amount_paise)}` : `-${formatINR(t.amount_paise)}`}
                        </span>
                      </div>

                      {/* Middle: Description */}
                      <p className="text-xs font-bold text-[#0F172A] dark:text-[#F2F3F5] break-words leading-snug">
                        {t.description}
                      </p>

                      {/* Category */}
                      {t.debit_category && (
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-[#949BA4]">
                          Category: {t.debit_category === 'SPECIAL_WORKER_TASK' ? 'Special Task / Work' : 'Supplies / Materials'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
