'use client';

import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { 
  X, 
  Upload, 
  Image as ImageIcon, 
  Trash2, 
  Loader2, 
  ArrowUpRight, 
  ExternalLink,
  Briefcase,
  Package
} from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';
import { SupplySelect } from '@/components/finance/SupplySelect';

interface CategoryItem {
  id: string;
  name: string;
}

interface RoleItem {
  id: string;
  category_id: string;
  name: string;
}

interface DebitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  siteId: string;
}

export function DebitModal({ isOpen, onClose, onSuccess, siteId }: DebitModalProps) {
  const [mounted, setMounted] = useState<boolean>(false);
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [amountRupees, setAmountRupees] = useState<string>('');
  const [debitCategory, setDebitCategory] = useState<'SUPPLIES' | 'SALARY'>('SUPPLIES');
  
  // Supplies item selection
  const [supplyItem, setSupplyItem] = useState<string>('');

  // Salary category & role selections
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedRoleId, setSelectedRoleId] = useState<string>('');
  const [loadingLookups, setLoadingLookups] = useState<boolean>(false);

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

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
    }
  }, [isOpen]);

  // Fetch categories & roles when modal opens or siteId changes
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function loadWorkforceMetadata() {
      setLoadingLookups(true);
      try {
        const [catRes, roleRes] = await Promise.all([
          fetch('/api/categories'),
          fetch(`/api/roles?siteId=${siteId}`),
        ]);

        if (catRes.ok && roleRes.ok) {
          const catData = await catRes.json();
          const roleData = await roleRes.json();
          if (isMounted) {
            const activeCats: CategoryItem[] = catData.categories || [];
            const activeRoles: RoleItem[] = roleData.roles || [];
            setCategories(activeCats);
            setRoles(activeRoles);
            if (activeCats.length > 0 && !selectedCategoryId) {
              setSelectedCategoryId(activeCats[0].id);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load categories/roles:', err);
      } finally {
        if (isMounted) setLoadingLookups(false);
      }
    }

    loadWorkforceMetadata();
    return () => {
      isMounted = false;
    };
  }, [isOpen, siteId, selectedCategoryId]);

  if (!isOpen || !mounted) return null;

  // Filter roles matching selected category
  const filteredRoles = roles.filter((r) => r.category_id === selectedCategoryId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setError('Attachment file size must not exceed 5MB.');
      return;
    }

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

    if (debitCategory === 'SUPPLIES' && !supplyItem.trim()) {
      setError('Please enter or select a supply item name.');
      return;
    }

    if (debitCategory === 'SALARY' && !selectedCategoryId) {
      setError('Please select a workforce category for salary debit.');
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('siteId', siteId);
      formData.append('date', date);
      formData.append('type', 'DEBIT');
      formData.append('debitCategory', debitCategory);
      formData.append('amountRupees', amt.toString());

      if (debitCategory === 'SUPPLIES') {
        formData.append('description', supplyItem.trim());
      } else if (debitCategory === 'SALARY') {
        if (selectedCategoryId) {
          formData.append('workCategoryId', selectedCategoryId);
        }
        if (selectedRoleId) {
          formData.append('workRoleId', selectedRoleId);
        }
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
        throw new Error(data.error || 'Failed to record debit transaction.');
      }

      // Record supply usage memory ONLY AFTER financial transaction creation succeeds
      if (debitCategory === 'SUPPLIES' && supplyItem.trim()) {
        try {
          await fetch('/api/supplies', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, name: supplyItem.trim() }),
          });
        } catch (suppErr) {
          console.error('Failed to update supply memory:', suppErr);
        }
      }

      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error recording debit transaction.');
    } finally {
      setSubmitting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="debit-modal-title"
    >
      <div className="bg-white dark:bg-[#18191C] rounded-2xl shadow-2xl max-w-lg w-full border border-slate-900 dark:border-[#3A3D42] my-auto overflow-hidden animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-[#2B2D31] flex items-center justify-between bg-rose-50/50 dark:bg-[#2A1215]/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-600 dark:bg-[#F87171] text-white dark:text-[#0A0A0A] flex items-center justify-center font-black shadow-sm">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h2 id="debit-modal-title" className="text-base sm:text-lg font-black uppercase text-[#0F172A] dark:text-[#F2F3F5]">
                Record Debit
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-[#949BA4] font-medium">
                Record site expenditure for supplies or worker salaries
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close dialog"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
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
              id="debit-date"
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
                placeholder="25,000"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl pl-8 pr-3 text-base sm:text-lg font-black focus:ring-2 focus:ring-rose-500 dark:focus:ring-rose-500 focus:outline-none input-no-zoom touch-action-manipulation"
              />
            </div>
          </div>

          {/* Debit Category Selection */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              Debit Category <span className="text-rose-500">*</span>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDebitCategory('SUPPLIES')}
                className={`min-h-[44px] px-3 py-2.5 rounded-xl border flex items-center justify-center space-x-2 text-xs sm:text-sm font-bold transition-all ${
                  debitCategory === 'SUPPLIES'
                    ? 'bg-rose-600 text-white border-slate-900 dark:border-rose-900 shadow-sm'
                    : 'bg-white dark:bg-[#111214] text-slate-700 dark:text-[#B5BAC1] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225]'
                }`}
              >
                <Package className="w-4 h-4 shrink-0" />
                <span>Supplies / Materials</span>
              </button>

              <button
                type="button"
                onClick={() => setDebitCategory('SALARY')}
                className={`min-h-[44px] px-3 py-2.5 rounded-xl border flex items-center justify-center space-x-2 text-xs sm:text-sm font-bold transition-all ${
                  debitCategory === 'SALARY'
                    ? 'bg-rose-600 text-white border-slate-900 dark:border-rose-900 shadow-sm'
                    : 'bg-white dark:bg-[#111214] text-slate-700 dark:text-[#B5BAC1] border-slate-300 dark:border-[#3A3D42] hover:bg-slate-50 dark:hover:bg-[#202225]'
                }`}
              >
                <Briefcase className="w-4 h-4 shrink-0" />
                <span>Salary / Wages</span>
              </button>
            </div>
          </div>

          {/* Conditional Supplies Section: Searchable Memory Combobox */}
          {debitCategory === 'SUPPLIES' && (
            <div>
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
                Supply / Item <span className="text-rose-500">*</span>
              </label>
              <SupplySelect
                siteId={siteId}
                value={supplyItem}
                onChange={setSupplyItem}
                required
              />
            </div>
          )}

          {/* Conditional Salary Section: Category & Role with Contextual Manage Roles */}
          {debitCategory === 'SALARY' && (
            <div className="p-3.5 bg-slate-50 dark:bg-[#111214] rounded-xl border border-slate-900 dark:border-[#3A3D42] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 text-xs font-black uppercase text-slate-800 dark:text-[#F2F3F5]">
                  <Briefcase className="w-3.5 h-3.5 text-rose-600 dark:text-[#F87171]" />
                  <span>Salary Workforce Assignment</span>
                </div>
                <Link
                  href="/setup/roles"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-[11px] font-bold text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] underline underline-offset-2"
                  title="Manage Categories and Roles"
                >
                  <span>Manage Roles</span>
                  <ExternalLink className="w-3 h-3 ml-1 shrink-0" />
                </Link>
              </div>

              {loadingLookups ? (
                <div className="py-2 text-center text-xs text-slate-500 font-medium flex items-center justify-center space-x-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading categories &amp; roles...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Category Dropdown */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 dark:text-[#949BA4] mb-1">
                      Work Category <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={selectedCategoryId}
                      onChange={(e) => {
                        setSelectedCategoryId(e.target.value);
                        setSelectedRoleId(''); // Reset role when category changes
                      }}
                      className="w-full min-h-[44px] bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-lg px-2.5 py-2 text-xs sm:text-sm font-bold focus:ring-2 focus:ring-rose-500 focus:outline-none input-no-zoom touch-action-manipulation"
                    >
                      <option value="" disabled>Select Category</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Role Dropdown (Filtered) */}
                  <div>
                    <label className="block text-[11px] font-bold uppercase text-slate-600 dark:text-[#949BA4] mb-1">
                      Role (Optional)
                    </label>
                    <select
                      value={selectedRoleId}
                      onChange={(e) => setSelectedRoleId(e.target.value)}
                      className="w-full min-h-[44px] bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-lg px-2.5 py-2 text-xs sm:text-sm font-bold focus:ring-2 focus:ring-rose-500 focus:outline-none input-no-zoom touch-action-manipulation"
                    >
                      <option value="">All / Entire Category</option>
                      {filteredRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reference / Notes */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              NOTE (OPTIONAL)
            </label>
            <textarea
              rows={2}
              placeholder="e.g. Invoice #2039, Cement delivery 50 bags, or weekly payout..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-[#0F172A] dark:text-[#F2F3F5] rounded-xl p-3 text-xs sm:text-sm font-medium focus:ring-2 focus:ring-rose-500 focus:outline-none input-no-zoom touch-action-manipulation resize-none"
            />
          </div>

          {/* Attachment Upload */}
          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-[#B5BAC1] mb-1.5">
              Attachment / Invoice Bill (Optional)
            </label>

            {!attachment ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer border-2 border-dashed border-slate-300 dark:border-[#3A3D42] hover:border-rose-500 rounded-xl p-4 text-center transition-colors bg-slate-50 dark:bg-[#111214]/50"
              >
                <Upload className="w-6 h-6 text-slate-400 dark:text-[#949BA4] mx-auto mb-1.5" />
                <p className="text-xs font-bold text-slate-700 dark:text-[#F2F3F5]">
                  Click to upload invoice, receipt or payment voucher
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
              className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-xl text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 touch-action-manipulation"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] px-6 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 dark:bg-[#F87171] dark:hover:bg-[#EF4444] text-white dark:text-[#0A0A0A] border border-slate-900 dark:border-rose-900 text-xs sm:text-sm font-black rounded-xl shadow transition-colors flex items-center justify-center space-x-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50 touch-action-manipulation"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                  <span>Recording...</span>
                </>
              ) : (
                <span>+ Record Debit</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
