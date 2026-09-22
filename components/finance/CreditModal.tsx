'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Image as ImageIcon, Trash2, Loader2, ArrowDownLeft } from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';
import { InvestorSelect } from '@/components/finance/InvestorSelect';

interface CreditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  siteId: string;
}

export function CreditModal({ isOpen, onClose, onSuccess, siteId }: CreditModalProps) {
  const [mounted, setMounted] = useState<boolean>(false);
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [amountRupees, setAmountRupees] = useState<string>('');
  const [investorName, setInvestorName] = useState<string>('');
  const [investorId, setInvestorId] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState<string>('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Reset error when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side file size check (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Attachment file size must not exceed 5MB.');
      return;
    }

    // MIME type check
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimes.includes(file.type)) {
      setError('Only JPEG, PNG, and WebP images are supported.');
      return;
    }

    setError(null);
    setAttachment(file);

    const reader = new FileReader();
    reader.onloadend = () => {
      setAttachmentPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeAttachment = () => {
    setAttachment(null);
    setAttachmentPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteId) return;
    setError(null);

    const amt = parseFloat(amountRupees);
    if (isNaN(amt) || amt <= 0) {
      setError('Please enter a valid amount greater than ₹0.');
      return;
    }

    if (!investorName.trim()) {
      setError('Investor name is required for credit transactions.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('siteId', siteId);
      formData.append('date', date);
      formData.append('type', 'CREDIT');
      formData.append('amountRupees', amt.toString());
      formData.append('investorName', investorName.trim());
      if (investorId) {
        formData.append('investorId', investorId);
      }
      if (notes.trim()) {
        formData.append('referenceNote', notes.trim());
      }
      if (attachment) {
        formData.append('attachment', attachment);
      }

      const res = await fetch('/api/finance', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to record credit transaction.');
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error recording credit transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credit-modal-title"
    >
      <div className="bg-white dark:bg-[#18191C] rounded-2xl shadow-2xl max-w-lg w-full border border-slate-900 dark:border-[#3A3D42] my-auto overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-[#2B2D31] flex items-center justify-between bg-emerald-50/50 dark:bg-[#0F291B]/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 dark:bg-[#1ED760] text-white dark:text-[#0A0A0A] flex items-center justify-center font-black shadow-sm">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div>
              <h2 id="credit-modal-title" className="text-base sm:text-lg font-black uppercase text-[#0F172A] dark:text-[#F2F3F5]">
                Record Credit
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-[#949BA4] font-medium">
                Add investor cash inflow or site capital injection
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close dialog"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 max-h-[calc(90vh-140px)] overflow-y-auto custom-scrollbar">
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-[#2A1215] border border-rose-300 dark:border-[#6E1C24] rounded-xl text-rose-700 dark:text-[#F87171] text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Date Picker */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              Transaction Date <span className="text-rose-500">*</span>
            </label>
            <DatePicker
              id="credit-date"
              value={date}
              onChange={setDate}
              required
              variant="full"
            />
          </div>

          {/* Amount in Rupees */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              Amount in Rupees (₹) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-black text-slate-400 dark:text-[#949BA4]">
                ₹
              </span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="50,000"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl pl-8 pr-3 text-base sm:text-lg font-black focus:ring-2 focus:ring-emerald-500 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>
          </div>

          {/* Investor Typeahead */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              Investor Name <span className="text-rose-500">*</span>
            </label>
            <InvestorSelect
              value={investorName}
              onChange={(name, id) => {
                setInvestorName(name);
                setInvestorId(id);
              }}
              required
            />
            <p className="mt-1 text-[11px] text-slate-500 dark:text-[#949BA4]">
              Select an existing investor or type a new name to create automatically.
            </p>
          </div>

          {/* Reference / Notes */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              NOTE (OPTIONAL)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Bank NEFT / Cheque #558291, Phase 2 Capital"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl p-3 text-xs sm:text-sm font-medium focus:ring-2 focus:ring-emerald-500 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation resize-none"
            />
          </div>

          {/* Attachment Upload */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              Attachment / Receipt Proof (Optional)
            </label>

            {!attachment ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer border-2 border-dashed border-slate-300 dark:border-[#3A3D42] hover:border-emerald-500 dark:hover:border-[#1ED760] rounded-xl p-4 text-center transition-colors bg-slate-50 dark:bg-[#111214]/50"
              >
                <Upload className="w-6 h-6 text-slate-400 dark:text-[#949BA4] mx-auto mb-1.5" />
                <p className="text-xs font-bold text-slate-700 dark:text-[#F2F3F5]">
                  Click to upload receipt or voucher image
                </p>
                <p className="text-[10px] text-slate-400 dark:text-[#949BA4] mt-0.5">
                  JPEG, PNG, WebP up to 5MB (stored securely in protected storage)
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] rounded-xl">
                <div className="flex items-center space-x-3 overflow-hidden">
                  {attachmentPreview ? (
                    <img
                      src={attachmentPreview}
                      alt="Attachment preview"
                      className="w-10 h-10 object-cover rounded-lg border border-slate-300 dark:border-[#3A3D42]"
                    />
                  ) : (
                    <ImageIcon className="w-8 h-8 text-slate-400" />
                  )}
                  <div className="overflow-hidden">
                    <p className="text-xs font-bold text-slate-800 dark:text-[#F2F3F5] truncate">
                      {attachment.name}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-[#949BA4]">
                      {(attachment.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeAttachment}
                  className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                  aria-label="Remove attachment"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Footer Controls */}
          <div className="pt-3 border-t border-slate-200 dark:border-[#2B2D31] flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-xl text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 touch-action-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-6 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-[#0A0A0A] border border-slate-900 dark:border-[#1A7F3C] text-xs sm:text-sm font-black rounded-xl shadow transition-colors flex items-center justify-center space-x-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 touch-action-manipulation"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  <span>Recording...</span>
                </>
              ) : (
                <span>+ Record Credit</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
