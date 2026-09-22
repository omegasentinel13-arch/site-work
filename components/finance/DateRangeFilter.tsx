'use client';

import React, { useState, useEffect } from 'react';
import { 
  Filter, 
  Search, 
  X, 
  RotateCcw, 
  Check, 
  Calendar as CalendarIcon,
  Tag
} from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';

export interface FilterValues {
  startDate: string;
  endDate: string;
  type: 'ALL' | 'CREDIT' | 'DEBIT';
  category: string; // 'ALL' | 'CASH_INFLOW' | 'SUPPLIES' | 'SALARY' | 'SPECIAL_WORKER_TASK'
  searchQuery: string;
}

interface DateRangeFilterProps {
  values: FilterValues;
  defaultStartDate: string;
  defaultEndDate: string;
  onApplyDateRange: (startDate: string, endDate: string) => void;
  onChangeType: (type: 'ALL' | 'CREDIT' | 'DEBIT') => void;
  onChangeCategory: (category: string) => void;
  onChangeSearch: (query: string) => void;
  onResetFilters: () => void;
  totalCount: number;
  filteredCount: number;
}

export function DateRangeFilter({
  values,
  defaultStartDate,
  defaultEndDate,
  onApplyDateRange,
  onChangeType,
  onChangeCategory,
  onChangeSearch,
  onResetFilters,
  totalCount,
  filteredCount,
}: DateRangeFilterProps) {
  // Local draft state for dates (Draft -> Apply pattern)
  const [draftStartDate, setDraftStartDate] = useState<string>(values.startDate);
  const [draftEndDate, setDraftEndDate] = useState<string>(values.endDate);

  // Sync draft state when applied values change from outside
  useEffect(() => {
    setDraftStartDate(values.startDate);
  }, [values.startDate]);

  useEffect(() => {
    setDraftEndDate(values.endDate);
  }, [values.endDate]);

  const hasDraftChanges =
    draftStartDate !== values.startDate || draftEndDate !== values.endDate;

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    onApplyDateRange(draftStartDate, draftEndDate);
  };

  const hasActiveFilters =
    values.type !== 'ALL' ||
    values.category !== 'ALL' ||
    values.searchQuery.trim() !== '' ||
    values.startDate !== defaultStartDate ||
    values.endDate !== defaultEndDate;

  return (
    <div className="bg-white dark:bg-[#18191C] rounded-2xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
      {/* Top Row: Date Range Draft & Apply Bar */}
      <form onSubmit={handleApply} className="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-[#949BA4] mb-1">
              From Date
            </label>
            <DatePicker
              id="filter-start-date"
              value={draftStartDate}
              onChange={setDraftStartDate}
              variant="full"
              aria-label="Filter start date"
            />
          </div>

          <div className="flex-1 min-w-[150px]">
            <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-[#949BA4] mb-1">
              To Date
            </label>
            <DatePicker
              id="filter-end-date"
              value={draftEndDate}
              onChange={setDraftEndDate}
              variant="full"
              aria-label="Filter end date"
            />
          </div>

          <div className="sm:self-end pt-1 sm:pt-0">
            <button
              type="submit"
              className={`w-full sm:w-auto min-h-[44px] px-5 py-2 text-xs sm:text-sm font-black rounded-xl border flex items-center justify-center space-x-1.5 transition-all touch-action-manipulation ${
                hasDraftChanges
                  ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A] border-slate-900 dark:border-[#1ED760] shadow-md ring-2 ring-slate-900/20'
                  : 'bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#F2F3F5] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-200 dark:hover:bg-[#2B2D31]'
              }`}
            >
              <Check className="w-4 h-4 shrink-0" />
              <span>APPLY</span>
              {hasDraftChanges && (
                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0 ml-1 animate-pulse" />
              )}
            </button>
          </div>
        </div>

        {/* Quick Date Presets */}
        <div className="flex items-center space-x-1.5 self-start lg:self-end overflow-x-auto pb-1 max-w-full">
          <button
            type="button"
            onClick={() => {
              const today = new Date().toISOString().split('T')[0];
              const firstDay = `${today.slice(0, 7)}-01`;
              setDraftStartDate(firstDay);
              setDraftEndDate(today);
            }}
            className="px-2.5 py-1.5 bg-slate-50 dark:bg-[#111214] hover:bg-slate-100 dark:hover:bg-[#202225] text-[11px] font-bold text-slate-600 dark:text-[#B5BAC1] rounded-lg border border-slate-300 dark:border-[#3A3D42] whitespace-nowrap"
          >
            THIS MONTH
          </button>

          <button
            type="button"
            onClick={() => {
              const today = new Date().toISOString().split('T')[0];
              const firstDayOfYear = `${today.slice(0, 4)}-01-01`;
              setDraftStartDate(firstDayOfYear);
              setDraftEndDate(today);
            }}
            className="px-2.5 py-1.5 bg-slate-50 dark:bg-[#111214] hover:bg-slate-100 dark:hover:bg-[#202225] text-[11px] font-bold text-slate-600 dark:text-[#B5BAC1] rounded-lg border border-slate-300 dark:border-[#3A3D42] whitespace-nowrap"
          >
            THIS YEAR
          </button>

          <button
            type="button"
            onClick={() => {
              const today = new Date().toISOString().split('T')[0];
              const fromDate = defaultStartDate || today;
              setDraftStartDate(fromDate);
              setDraftEndDate(today);
            }}
            className="px-2.5 py-1.5 bg-slate-50 dark:bg-[#111214] hover:bg-slate-100 dark:hover:bg-[#202225] text-[11px] font-bold text-slate-600 dark:text-[#B5BAC1] rounded-lg border border-slate-300 dark:border-[#3A3D42] whitespace-nowrap"
          >
            ALL TIME
          </button>
        </div>
      </form>

      {/* Middle Row: Text Search, Type Filter, Category Filter, and Reset */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-2 border-t border-slate-100 dark:border-[#2B2D31]">
        {/* Search Input */}
        <div className="sm:col-span-5 relative">
          <Search className="w-4 h-4 text-slate-400 dark:text-[#949BA4] absolute left-3 top-1/2 -translate-y-1/2 shrink-0" />
          <input
            type="text"
            value={values.searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Search notes, categories, roles, investors..."
            aria-label="Search ledger transactions"
            className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl pl-9 pr-8 text-xs sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
          />
          {values.searchQuery && (
            <button
              type="button"
              onClick={() => onChangeSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-[#F2F3F5] rounded"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Transaction Type Filter */}
        <div className="sm:col-span-3">
          <select
            value={values.type}
            onChange={(e) => onChangeType(e.target.value as any)}
            aria-label="Filter by transaction type"
            className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl px-3 text-xs sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
          >
            <option value="ALL">All Types (Credit &amp; Debit)</option>
            <option value="CREDIT">Credits Only (+Inflow)</option>
            <option value="DEBIT">Debits Only (-Outflow)</option>
          </select>
        </div>

        {/* Category Filter */}
        <div className="sm:col-span-3">
          <select
            value={values.category}
            onChange={(e) => onChangeCategory(e.target.value)}
            aria-label="Filter by category"
            className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl px-3 text-xs sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
          >
            <option value="ALL">All Categories</option>
            <option value="CASH_INFLOW">Investor Credits</option>
            <option value="SUPPLIES">Supplies / Materials</option>
            <option value="SALARY">Salary / Wages</option>
            <option value="SPECIAL_WORKER_TASK">Special Task (Legacy)</option>
          </select>
        </div>

        {/* Clear Filters Button */}
        <div className="sm:col-span-1 flex items-center justify-end">
          <button
            type="button"
            onClick={onResetFilters}
            disabled={!hasActiveFilters}
            aria-label="Clear all filters"
            className="w-full sm:w-11 min-h-[44px] sm:min-h-[40px] flex items-center justify-center rounded-xl border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Reset All Filters"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Bottom Status Row: Active Filter Chips & Counter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] flex items-center mr-1">
            <Tag className="w-3.5 h-3.5 mr-1" />
            Active:
          </span>

          {values.type !== 'ALL' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-[#2B2D31] text-slate-800 dark:text-[#F2F3F5] font-bold text-[11px] border border-slate-300 dark:border-[#3A3D42]">
              Type: {values.type}
              <button
                type="button"
                onClick={() => onChangeType('ALL')}
                className="ml-1 text-slate-400 hover:text-rose-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {values.category !== 'ALL' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-[#2B2D31] text-slate-800 dark:text-[#F2F3F5] font-bold text-[11px] border border-slate-300 dark:border-[#3A3D42]">
              Category: {values.category}
              <button
                type="button"
                onClick={() => onChangeCategory('ALL')}
                className="ml-1 text-slate-400 hover:text-rose-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {values.searchQuery.trim() !== '' && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-[#2B2D31] text-slate-800 dark:text-[#F2F3F5] font-bold text-[11px] border border-slate-300 dark:border-[#3A3D42]">
              &ldquo;{values.searchQuery}&rdquo;
              <button
                type="button"
                onClick={() => onChangeSearch('')}
                className="ml-1 text-slate-400 hover:text-rose-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )}

          {!hasActiveFilters && (
            <span className="text-[11px] text-slate-400 italic">None (showing all in date range)</span>
          )}
        </div>

        <div className="text-[11px] font-black text-slate-600 dark:text-[#949BA4] text-right">
          Showing <span className="text-slate-900 dark:text-[#F2F3F5] font-extrabold">{filteredCount}</span> of {totalCount} transactions
        </div>
      </div>
    </div>
  );
}
