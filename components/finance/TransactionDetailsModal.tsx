'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  X, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Calendar, 
  UserCheck, 
  Briefcase, 
  Package, 
  Paperclip, 
  ExternalLink 
} from 'lucide-react';
import { FinancialDbRecord } from '@/lib/db/repositories/finance-repo';
import { formatINR } from '@/lib/domain/money';

interface TransactionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: FinancialDbRecord | null;
}

export function TransactionDetailsModal({
  isOpen,
  onClose,
  transaction,
}: TransactionDetailsModalProps) {
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!isOpen || !transaction || !mounted) return null;

  const isCredit = transaction.type === 'CREDIT';

  // Category display label
  let categoryLabel = 'Transaction';
  if (isCredit) {
    categoryLabel = 'Investor Credit';
  } else if (transaction.debit_category === 'SALARY') {
    categoryLabel = 'Salary / Wages';
  } else if (transaction.debit_category === 'SUPPLIES') {
    categoryLabel = 'Supplies / Materials';
  } else if (transaction.debit_category === 'SPECIAL_WORKER_TASK') {
    categoryLabel = 'Special Task (Legacy)';
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-details-title"
    >
      <div className="bg-white dark:bg-[#18191C] rounded-2xl shadow-2xl max-w-lg w-full border border-slate-900 dark:border-[#3A3D42] my-auto overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className={`p-4 sm:p-5 border-b border-slate-200 dark:border-[#2B2D31] flex items-center justify-between ${
          isCredit ? 'bg-emerald-50/50 dark:bg-[#0F291B]/40' : 'bg-rose-50/50 dark:bg-[#2A1215]/40'
        }`}>
          <div className="flex items-center space-x-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black shadow-sm ${
              isCredit 
                ? 'bg-emerald-600 dark:bg-[#1ED760] text-white dark:text-[#0A0A0A]' 
                : 'bg-rose-600 dark:bg-[#F87171] text-white dark:text-[#0A0A0A]'
            }`}>
              {isCredit ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
            </div>
            <div>
              <h2 id="tx-details-title" className="text-base sm:text-lg font-black uppercase text-[#0F172A] dark:text-[#F2F3F5]">
                Transaction Details
              </h2>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase mt-0.5 ${
                isCredit 
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-[#0F291B] dark:text-[#1ED760] border border-emerald-300 dark:border-[#1A7F3C]' 
                  : 'bg-rose-100 text-rose-800 dark:bg-[#2A1215] dark:text-[#F87171] border border-rose-300 dark:border-[#6E1C24]'
              }`}>
                {transaction.type} • {categoryLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-6 space-y-4 max-h-[calc(90vh-140px)] overflow-y-auto custom-scrollbar">
          {/* Amount Display */}
          <div className="p-4 bg-slate-50 dark:bg-[#111214] rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center">
            <span className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase block">
              Transaction Amount
            </span>
            <div className={`text-2xl sm:text-3xl font-black mt-1 ${
              isCredit ? 'text-emerald-600 dark:text-[#1ED760]' : 'text-rose-600 dark:text-[#F87171]'
            }`}>
              {isCredit ? `+${formatINR(transaction.amount_paise)}` : `-${formatINR(transaction.amount_paise)}`}
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            {/* Date */}
            <div className="p-3 bg-white dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-xl">
              <div className="flex items-center space-x-1.5 text-slate-500 dark:text-[#949BA4] font-bold uppercase text-[10px] mb-1">
                <Calendar className="w-3.5 h-3.5" />
                <span>Date</span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-[#F2F3F5]">
                {transaction.date}
              </p>
            </div>

            {/* Category */}
            <div className="p-3 bg-white dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-xl">
              <div className="flex items-center space-x-1.5 text-slate-500 dark:text-[#949BA4] font-bold uppercase text-[10px] mb-1">
                {isCredit ? <UserCheck className="w-3.5 h-3.5" /> : transaction.debit_category === 'SALARY' ? <Briefcase className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
                <span>Category</span>
              </div>
              <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-[#F2F3F5]">
                {categoryLabel}
              </p>
            </div>
          </div>

          {/* Context Details */}
          {isCredit && transaction.investor_name && (
            <div className="p-3 bg-white dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-xl">
              <div className="flex items-center space-x-1.5 text-slate-500 dark:text-[#949BA4] font-bold uppercase text-[10px] mb-1">
                <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-[#1ED760]" />
                <span>Investor</span>
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-[#F2F3F5]">
                {transaction.investor_name}
              </p>
            </div>
          )}

          {!isCredit && transaction.debit_category === 'SALARY' && (
            <div className="p-3 bg-white dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-xl space-y-2">
              <div className="flex items-center space-x-1.5 text-slate-500 dark:text-[#949BA4] font-bold uppercase text-[10px]">
                <Briefcase className="w-3.5 h-3.5 text-rose-600 dark:text-[#F87171]" />
                <span>Workforce Allocation</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 block">Category</span>
                  <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">
                    {transaction.work_category_name || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block">Role</span>
                  <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">
                    {transaction.work_role_name || 'All Category Roles'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Description & Notes */}
          <div className="p-3 bg-white dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-xl space-y-2">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                Description
              </span>
              <p className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-[#F2F3F5] mt-0.5">
                {transaction.description || '—'}
              </p>
            </div>

            {transaction.reference_note && (
              <div className="pt-2 border-t border-slate-100 dark:border-[#2B2D31]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  Reference Note / Voucher
                </span>
                <p className="text-xs text-slate-700 dark:text-[#B5BAC1] mt-0.5">
                  {transaction.reference_note}
                </p>
              </div>
            )}
          </div>

          {/* Attachment Preview Section */}
          <div className="p-3 bg-white dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] flex items-center space-x-1">
                <Paperclip className="w-3.5 h-3.5" />
                <span>Attachment Document</span>
              </span>
              {transaction.attachment_url && (
                <a
                  href={transaction.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-[11px] font-bold text-emerald-600 dark:text-[#1ED760] hover:underline"
                >
                  <span>Open Full Image</span>
                  <ExternalLink className="w-3 h-3 ml-1" />
                </a>
              )}
            </div>

            {transaction.attachment_url ? (
              <div className="mt-2 rounded-xl overflow-hidden border border-slate-300 dark:border-[#3A3D42] bg-slate-100 dark:bg-[#202225] flex justify-center p-2">
                <img
                  src={transaction.attachment_url}
                  alt="Transaction Attachment Proof"
                  className="max-h-60 w-auto object-contain rounded-lg shadow-sm"
                />
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic py-1">
                No receipt or voucher image attached to this transaction.
              </p>
            )}
          </div>

          {/* Metadata Footprint */}
          <div className="p-3 bg-slate-50 dark:bg-[#111214] rounded-xl border border-slate-200 dark:border-[#2B2D31] text-[11px] font-mono text-slate-400 space-y-1">
            <div className="flex items-center justify-between">
              <span>ID:</span>
              <span className="text-slate-600 dark:text-[#949BA4] truncate max-w-[240px]">{transaction.id}</span>
            </div>
            {transaction.created_at && (
              <div className="flex items-center justify-between">
                <span>Recorded:</span>
                <span className="text-slate-600 dark:text-[#949BA4]">{new Date(transaction.created_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-[#2B2D31] flex items-center justify-end bg-slate-50 dark:bg-[#111214]">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] px-5 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-xl text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 touch-action-manipulation"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
