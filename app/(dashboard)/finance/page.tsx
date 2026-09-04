'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR } from '@/lib/domain/money';
import { FinancialDbRecord } from '@/lib/db/repositories/finance-repo';
import { 
  PlusCircle, 
  MinusCircle, 
  FileDown, 
  Trash2, 
  X,
  Filter,
  Receipt
} from 'lucide-react';
import { ExcelExportButton } from '@/components/export/ExcelExportButton';

export default function FinanceTransactionsPage() {
  const { selectedSite, selectedSiteId, user } = useSite();
  const [transactions, setTransactions] = useState<FinancialDbRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    amountRupees: '',
    debitCategory: 'SUPPLIES' as 'SUPPLIES' | 'SPECIAL_WORKER_TASK',
    description: '',
    referenceNote: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [exportLoading, setExportLoading] = useState(false);

  const fetchTransactions = useCallback(async () => {
    if (!selectedSiteId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/finance?siteId=${selectedSiteId}`);
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.transactions || []);
      }
    } catch (err) {
      console.error('Error fetching transactions:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const openAddModal = (type: 'CREDIT' | 'DEBIT') => {
    setModalType(type);
    setFormData({
      date: new Date().toISOString().split('T')[0],
      amountRupees: '',
      debitCategory: 'SUPPLIES',
      description: '',
      referenceNote: '',
    });
    setFormError('');
    setModalOpen(true);
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSiteId) return;
    setFormError('');

    const amt = parseFloat(formData.amountRupees);
    if (isNaN(amt) || amt <= 0) {
      setFormError('Please enter a valid amount greater than 0.');
      return;
    }

    if (!formData.description.trim()) {
      setFormError('Description is required.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: selectedSiteId,
          date: formData.date,
          type: modalType,
          debitCategory: modalType === 'DEBIT' ? formData.debitCategory : null,
          amountRupees: amt,
          description: formData.description,
          referenceNote: formData.referenceNote,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to create transaction');
      }

      setModalOpen(false);
      fetchTransactions();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error creating transaction');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this financial transaction?')) return;
    try {
      const res = await fetch(`/api/finance/${id}?siteId=${selectedSiteId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchTransactions();
      }
    } catch (err) {
      alert('Failed to delete transaction');
    }
  };

  // Filtered List & Calculations
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      if (filterType !== 'ALL' && t.type !== filterType) return false;
      if (filterCategory !== 'ALL' && t.debit_category !== filterCategory) return false;
      return true;
    });
  }, [transactions, filterType, filterCategory]);

  const summary = useMemo(() => {
    let credit = 0;
    let supplies = 0;
    let special = 0;

    for (const t of transactions) {
      if (t.type === 'CREDIT') {
        credit += t.amount_paise;
      } else if (t.type === 'DEBIT') {
        if (t.debit_category === 'SPECIAL_WORKER_TASK') {
          special += t.amount_paise;
        } else {
          supplies += t.amount_paise;
        }
      }
    }

    const totalDebit = supplies + special;
    const balance = credit - totalDebit;

    return { credit, supplies, special, totalDebit, balance };
  }, [transactions]);

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
        }),
      });
      if (!res.ok) throw new Error('PDF export failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedSite?.name || 'Site'}_Financial_Ledger.pdf`;
      a.click();
    } catch (err) {
      alert('Failed to export PDF');
    } finally {
      setExportLoading(false);
    }
  };

  const isReadOnly = user?.role === 'VIEWER';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Site Financials
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-[#0F172A] dark:text-[#F2F3F5]">
            Cash Inflow & Outflow Ledger
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Site: <span className="font-semibold text-slate-700 dark:text-[#B5BAC1]">{selectedSite?.name || 'No Site Selected'}</span> (Direct Cash Movement Only)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={exportLoading}
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] border border-slate-900 dark:border-[#3A3D42] text-xs sm:text-sm font-bold text-slate-800 dark:text-[#F2F3F5] rounded-lg shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
          >
            <FileDown className="w-4 h-4 mr-1.5 text-rose-600 dark:text-[#F87171] shrink-0" />
            PDF Ledger
          </button>

          <ExcelExportButton
            payload={{
              siteId: selectedSiteId || '',
              type: 'FINANCE',
              transactionType: filterType !== 'ALL' ? filterType : undefined,
              debitCategory: filterCategory !== 'ALL' ? filterCategory : undefined,
            }}
            fallbackFilename={`${selectedSite?.name || 'Site'}_Financial_Ledger.xlsx`}
            label="Excel Ledger"
          />

          {!isReadOnly && (
            <>
              <button
                type="button"
                onClick={() => openAddModal('CREDIT')}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white border border-slate-900 dark:border-[#1A7F3C] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <PlusCircle className="w-4 h-4 mr-1.5 shrink-0" />
                Add Credit
              </button>

              <button
                type="button"
                onClick={() => openAddModal('DEBIT')}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 dark:bg-[#F87171] dark:hover:bg-[#EF4444] dark:text-[#0A0A0A] text-white border border-slate-900 dark:border-rose-900/60 text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-rose-500 touch-action-manipulation"
              >
                <MinusCircle className="w-4 h-4 mr-1.5 shrink-0" />
                Add Debit
              </button>
            </>
          )}
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3.5">
        <div className="p-3.5 sm:p-4 bg-emerald-50 dark:bg-[#0F291B] rounded-xl border border-slate-900 dark:border-[#1A7F3C]">
          <span className="text-[10px] sm:text-xs font-bold text-emerald-800 dark:text-[#86EFAC] uppercase block">Total Credit</span>
          <span className="text-base sm:text-lg lg:text-xl font-black text-emerald-900 dark:text-[#1ED760] block truncate mt-0.5" title={formatINR(summary.credit)}>
            {formatINR(summary.credit)}
          </span>
          <span className="text-[10px] text-emerald-600 dark:text-[#86EFAC]/80 block mt-0.5">Investor / Funding</span>
        </div>

        <div className="p-3.5 sm:p-4 bg-amber-50 dark:bg-[#202225] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          <span className="text-[10px] sm:text-xs font-bold text-amber-800 dark:text-[#949BA4] uppercase block">Supplies Debit</span>
          <span className="text-base sm:text-lg lg:text-xl font-black text-amber-900 dark:text-[#F2F3F5] block truncate mt-0.5" title={formatINR(summary.supplies)}>
            {formatINR(summary.supplies)}
          </span>
          <span className="text-[10px] text-amber-600 dark:text-[#B5BAC1] block mt-0.5">Materials</span>
        </div>

        <div className="p-3.5 sm:p-4 bg-indigo-50 dark:bg-[#202225] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          <span className="text-[10px] sm:text-xs font-bold text-indigo-800 dark:text-[#949BA4] uppercase block">Special Work Debit</span>
          <span className="text-base sm:text-lg lg:text-xl font-black text-indigo-900 dark:text-[#F2F3F5] block truncate mt-0.5" title={formatINR(summary.special)}>
            {formatINR(summary.special)}
          </span>
          <span className="text-[10px] text-indigo-600 dark:text-[#B5BAC1] block mt-0.5">Task Expense</span>
        </div>

        <div className="p-3.5 sm:p-4 bg-rose-50 dark:bg-[#2A1215] rounded-xl border border-slate-900 dark:border-[#6E1C24]">
          <span className="text-[10px] sm:text-xs font-bold text-rose-800 dark:text-[#FCA5A5] uppercase block">Total Debit</span>
          <span className="text-base sm:text-lg lg:text-xl font-black text-rose-900 dark:text-[#F87171] block truncate mt-0.5" title={formatINR(summary.totalDebit)}>
            {formatINR(summary.totalDebit)}
          </span>
          <span className="text-[10px] text-rose-600 dark:text-[#F87171]/80 block mt-0.5">Total Outflow</span>
        </div>

        <div className="col-span-2 lg:col-span-1 p-3.5 sm:p-4 bg-slate-900 dark:bg-[#202225] rounded-xl border border-slate-900 dark:border-[#3A3D42] text-white">
          <span className="text-[10px] sm:text-xs font-bold text-emerald-400 dark:text-[#1ED760] uppercase block">Remaining Balance</span>
          <span className="text-base sm:text-lg lg:text-xl font-black text-white dark:text-[#F2F3F5] block truncate mt-0.5" title={formatINR(summary.balance)}>
            {formatINR(summary.balance)}
          </span>
          <span className="text-[10px] text-slate-400 dark:text-[#949BA4] block mt-0.5">Cash Position</span>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white dark:bg-[#18191C] p-3 sm:p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1.5 text-slate-500 dark:text-[#949BA4] mr-1">
            <Filter className="w-4 h-4 text-slate-400 dark:text-[#949BA4] shrink-0" />
            <span className="font-bold text-slate-700 dark:text-[#F2F3F5] uppercase text-xs">Filters:</span>
          </div>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filter by transaction type"
            className="min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg px-3 py-2 bg-slate-50 dark:bg-[#111214] font-semibold text-slate-800 dark:text-[#F2F3F5] text-sm sm:text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] input-no-zoom touch-action-manipulation"
          >
            <option value="ALL">All Types</option>
            <option value="CREDIT">Credits Only</option>
            <option value="DEBIT">Debits Only</option>
          </select>

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            aria-label="Filter by debit category"
            className="min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg px-3 py-2 bg-slate-50 dark:bg-[#111214] font-semibold text-slate-800 dark:text-[#F2F3F5] text-sm sm:text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] input-no-zoom touch-action-manipulation"
          >
            <option value="ALL">All Debit Categories</option>
            <option value="SUPPLIES">Supplies / Materials</option>
            <option value="SPECIAL_WORKER_TASK">Special Worker / Task</option>
          </select>
        </div>

        <div className="text-slate-500 dark:text-[#949BA4] font-semibold text-xs text-right sm:text-left">
          Showing {filteredTransactions.length} of {transactions.length} transactions
        </div>
      </div>

      {/* Transactions Dual Presentation (Table on Desktop/Tablet, Responsive Cards on Mobile) */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading financial ledger...
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 sm:p-12 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center space-y-3 shadow-sm">
          <Receipt className="w-10 h-10 text-slate-300 dark:text-[#4A4D52] mx-auto" />
          <p className="text-slate-600 dark:text-[#B5BAC1] font-medium text-sm">No financial transactions recorded for this site.</p>
          {!isReadOnly && (
            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => openAddModal('CREDIT')}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white border border-slate-900 dark:border-[#1A7F3C] font-bold text-xs sm:text-sm rounded-lg transition-colors shadow-sm touch-action-manipulation"
              >
                + Add First Credit
              </button>
              <button
                type="button"
                onClick={() => openAddModal('DEBIT')}
                className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 dark:bg-[#F87171] dark:hover:bg-[#EF4444] dark:text-[#0A0A0A] text-white border border-slate-900 dark:border-rose-900/60 font-bold text-xs sm:text-sm rounded-lg transition-colors shadow-sm touch-action-manipulation"
              >
                - Add First Debit
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* DESKTOP / TABLET VIEW: High-density data table */}
          <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">Reference / Note</th>
                    <th className="py-3 px-4 text-right">Credit (+)</th>
                    <th className="py-3 px-4 text-right">Debit (-)</th>
                    {!isReadOnly && <th className="py-3 px-3 text-center">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-[#2B2D31]">
                  {filteredTransactions.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                      <td className="py-3.5 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] whitespace-nowrap">{t.date}</td>
                      <td className="py-3.5 px-3">
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
                      <td className="py-3.5 px-3 font-semibold text-slate-600 dark:text-[#B5BAC1] whitespace-nowrap">
                        {t.debit_category === 'SPECIAL_WORKER_TASK'
                          ? 'Special Task / Work'
                          : t.debit_category === 'SUPPLIES'
                          ? 'Supplies / Materials'
                          : '—'}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-[#0F172A] dark:text-[#F2F3F5] max-w-xs break-words">{t.description}</td>
                      <td className="py-3.5 px-4 text-slate-500 dark:text-[#949BA4] max-w-xs break-words">{t.reference_note || '—'}</td>
                      <td className="py-3.5 px-4 text-right font-black text-emerald-700 dark:text-[#1ED760] whitespace-nowrap">
                        {t.type === 'CREDIT' ? `+${formatINR(t.amount_paise)}` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-black text-rose-700 dark:text-[#F87171] whitespace-nowrap">
                        {t.type === 'DEBIT' ? `-${formatINR(t.amount_paise)}` : '—'}
                      </td>
                      {!isReadOnly && (
                        <td className="py-3.5 px-3 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleDelete(t.id)}
                            aria-label={`Delete transaction ${t.description}`}
                            className="w-11 h-11 inline-flex items-center justify-center text-slate-400 dark:text-[#949BA4] hover:text-rose-600 dark:hover:text-[#F87171] hover:bg-rose-50 dark:hover:bg-[#2A1215] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                            title="Delete Transaction"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE VIEW: Responsive Stacked Cards (< 768px) */}
          <div className="md:hidden space-y-3">
            {filteredTransactions.map((t) => (
              <div
                key={t.id}
                className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-3"
              >
                {/* Top Row: Badge, Date, Amount */}
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
                    className={`text-base font-black shrink-0 ${
                      t.type === 'CREDIT' ? 'text-emerald-700 dark:text-[#1ED760]' : 'text-rose-700 dark:text-[#F87171]'
                    }`}
                  >
                    {t.type === 'CREDIT' ? `+${formatINR(t.amount_paise)}` : `-${formatINR(t.amount_paise)}`}
                  </span>
                </div>

                {/* Middle: Description & Category */}
                <div className="space-y-1">
                  <p className="text-sm font-bold text-[#0F172A] dark:text-[#F2F3F5] break-words leading-snug">
                    {t.description}
                  </p>
                  {t.debit_category && (
                    <span className="inline-block text-[11px] font-semibold text-slate-500 dark:text-[#949BA4] bg-slate-100 dark:bg-[#111214] px-2 py-0.5 rounded border border-transparent dark:border-[#2B2D31]">
                      {t.debit_category === 'SPECIAL_WORKER_TASK'
                        ? 'Special Task / Work'
                        : 'Supplies / Materials'}
                    </span>
                  )}
                </div>

                {/* Bottom Row: Note & Delete Action */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200 dark:border-[#2B2D31]">
                  <div className="text-xs text-slate-500 dark:text-[#949BA4] truncate max-w-[220px]">
                    {t.reference_note ? (
                      <span className="italic">Ref: {t.reference_note}</span>
                    ) : (
                      <span className="text-slate-400 dark:text-[#6A6F78]">No ref note</span>
                    )}
                  </div>

                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => handleDelete(t.id)}
                      aria-label={`Delete transaction ${t.description}`}
                      className="w-11 h-11 inline-flex items-center justify-center text-slate-400 dark:text-[#949BA4] hover:text-rose-600 dark:hover:text-[#F87171] hover:bg-rose-50 dark:hover:bg-[#2A1215] rounded-lg transition-colors border border-slate-900 dark:border-[#3A3D42] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation shrink-0"
                      title="Delete Transaction"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Add Modal — Fully responsive, scroll-safe on mobile & landscape */}
      {modalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finance-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-900 dark:border-[#2B2D31] pb-3">
              <h3 id="finance-modal-title" className="text-sm sm:text-base font-black text-[#0F172A] dark:text-[#F2F3F5] uppercase">
                {modalType === 'CREDIT' ? '+ Record Investor Credit' : '- Record Site Debit'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-[#949BA4] hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTransaction} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-[#2A1215] border border-red-300 dark:border-[#6E1C24] rounded-lg text-red-700 dark:text-[#F87171] text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase mb-1">
                  Transaction Date
                </label>
                <input
                  type="date"
                  required
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  aria-label="Transaction Date"
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase mb-1">
                  Amount in Rupees (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 500000"
                  value={formData.amountRupees}
                  onChange={(e) => setFormData({ ...formData, amountRupees: e.target.value })}
                  aria-label="Amount in Rupees"
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-black focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              {modalType === 'DEBIT' && (
                <div>
                  <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase mb-1">
                    Debit Category
                  </label>
                  <select
                    value={formData.debitCategory}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        debitCategory: e.target.value as 'SUPPLIES' | 'SPECIAL_WORKER_TASK',
                      })
                    }
                    aria-label="Debit Category"
                    className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none bg-slate-50 dark:bg-[#111214] text-[#0F172A] dark:text-[#F2F3F5] input-no-zoom touch-action-manipulation"
                  >
                    <option value="SUPPLIES">Supplies / Materials (Cement, Steel, etc.)</option>
                    <option value="SPECIAL_WORKER_TASK">Special Worker / Task / Subcontract</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase mb-1">
                  Description
                </label>
                <input
                  type="text"
                  required
                  placeholder={
                    modalType === 'CREDIT'
                      ? 'e.g. Funding from Primary Investor'
                      : 'e.g. 200 bags OPC 53 Cement'
                  }
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  aria-label="Description"
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 dark:text-[#B5BAC1] uppercase mb-1">
                  Optional Note / Voucher Reference
                </label>
                <input
                  type="text"
                  placeholder="e.g. Bill #8492 / Bank Transfer Ref"
                  value={formData.referenceNote}
                  onChange={(e) => setFormData({ ...formData, referenceNote: e.target.value })}
                  aria-label="Optional Note or Voucher Reference"
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-normal focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`min-h-[44px] px-5 py-2 rounded-lg text-xs sm:text-sm font-bold text-white shadow transition-colors border border-slate-900 dark:border-transparent focus:outline-none focus-visible:ring-2 touch-action-manipulation ${
                    modalType === 'CREDIT'
                      ? 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]'
                      : 'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 dark:bg-[#F87171] dark:hover:bg-[#EF4444] dark:text-[#0A0A0A] focus-visible:ring-slate-900 dark:focus-visible:ring-rose-500'
                  }`}
                >
                  {submitting ? 'Saving...' : modalType === 'CREDIT' ? 'Save Credit' : 'Save Debit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
