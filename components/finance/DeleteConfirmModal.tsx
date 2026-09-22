'use client';

import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';
import { FinancialDbRecord } from '@/lib/db/repositories/finance-repo';
import { formatINR } from '@/lib/domain/money';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  transaction: FinancialDbRecord | null;
}

export function DeleteConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  transaction,
}: DeleteConfirmModalProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !transaction) return null;

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete transaction.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
    >
      <div className="bg-white dark:bg-[#18191C] rounded-2xl shadow-2xl max-w-md w-full border border-slate-900 dark:border-[#3A3D42] overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-[#2B2D31] flex items-center justify-between bg-rose-50/50 dark:bg-[#2A1215]/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-600 dark:bg-[#F87171] text-white dark:text-[#0A0A0A] flex items-center justify-center font-black shadow-sm">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h2 id="delete-modal-title" className="text-base sm:text-lg font-black uppercase text-[#0F172A] dark:text-[#F2F3F5]">
                Delete Transaction
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-[#949BA4] font-medium">
                This action is permanent and audited
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            aria-label="Close dialog"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-[#2A1215] border border-rose-300 dark:border-[#6E1C24] rounded-xl text-rose-700 dark:text-[#F87171] text-xs font-semibold">
              {error}
            </div>
          )}

          <p className="text-xs sm:text-sm text-slate-600 dark:text-[#B5BAC1]">
            Are you sure you want to permanently delete this financial transaction?
          </p>

          <div className="p-3.5 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-xl text-xs space-y-2">
            <div className="flex items-center justify-between font-bold">
              <span className="text-slate-500 dark:text-[#949BA4]">Amount:</span>
              <span className={transaction.type === 'CREDIT' ? 'text-emerald-600 dark:text-[#1ED760]' : 'text-rose-600 dark:text-[#F87171]'}>
                {transaction.type === 'CREDIT' ? '+' : '-'}{formatINR(transaction.amount_paise)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-[#949BA4]">Date:</span>
              <span className="font-semibold text-slate-800 dark:text-[#F2F3F5]">{transaction.date}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-[#949BA4]">Type:</span>
              <span className="font-bold uppercase text-slate-800 dark:text-[#F2F3F5]">{transaction.type}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-[#949BA4]">Description:</span>
              <span className="font-semibold text-slate-800 dark:text-[#F2F3F5] truncate max-w-[200px]">
                {transaction.description}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-[#2B2D31] flex items-center justify-end space-x-3 bg-slate-50 dark:bg-[#111214]">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="min-h-[40px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-xl text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 touch-action-manipulation"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="min-h-[40px] px-5 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 dark:bg-[#F87171] dark:hover:bg-[#EF4444] text-white dark:text-[#0A0A0A] border border-slate-900 dark:border-rose-900 text-xs sm:text-sm font-black rounded-xl shadow transition-colors flex items-center justify-center space-x-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 touch-action-manipulation"
          >
            {deleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-1" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-1" />
                <span>Confirm Delete</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
