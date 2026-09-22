'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { 
  Plus, 
  Edit, 
  Trash2, 
  Archive, 
  Eye, 
  EyeOff, 
  Search, 
  Info, 
  AlertTriangle, 
  ArrowLeft, 
  X,
  Layers
} from 'lucide-react';
import { CategoryRecord } from '@/lib/db/repositories/role-repo';

export default function CategoriesManagementPage() {
  const [mounted, setMounted] = useState(false);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTab, setFilterTab] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catForm, setCatForm] = useState({ id: '', name: '', sortOrder: 0 });
  const [catFormError, setCatFormError] = useState('');
  const [catSubmitting, setCatSubmitting] = useState(false);

  // Details Modal
  const [detailsCategory, setDetailsCategory] = useState<CategoryRecord | null>(null);

  // Archive Modal
  const [archiveModalCat, setArchiveModalCat] = useState<CategoryRecord | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  // Recycle Bin / Delete Modal
  const [recycleModalCat, setRecycleModalCat] = useState<CategoryRecord | null>(null);
  const [recycleConfirmInput, setRecycleConfirmInput] = useState('');
  const [recycleError, setRecycleError] = useState('');
  const [recycleSubmitting, setRecycleSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isAnyModalOpen = Boolean(
    catModalOpen || 
    detailsCategory || 
    archiveModalCat || 
    recycleModalCat
  );

  // Lock body scroll when any modal is open
  useEffect(() => {
    if (!isAnyModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isAnyModalOpen]);

  // Escape key handler to close any active modal
  useEffect(() => {
    if (!isAnyModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCatModalOpen(false);
        setDetailsCategory(null);
        setArchiveModalCat(null);
        setRecycleModalCat(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAnyModalOpen]);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/categories?includeInactive=true');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Counts for tabs
  const allCount = categories.length;
  const activeCount = categories.filter(c => c.is_active === 1).length;
  const inactiveCount = categories.filter(c => c.is_active === 0).length;

  // Filtered categories
  const filteredCategories = useMemo(() => {
    return categories.filter((c) => {
      // Tab filter
      if (filterTab === 'ACTIVE' && c.is_active !== 1) return false;
      if (filterTab === 'INACTIVE' && c.is_active !== 0) return false;

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!c.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [categories, filterTab, searchQuery]);

  // Add / Edit Save Handler
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setCatFormError('');

    const trimmedName = catForm.name.trim();
    if (!trimmedName) {
      setCatFormError('Category name is required');
      return;
    }

    setCatSubmitting(true);
    try {
      let res: Response;
      if (catForm.id) {
        res = await fetch('/api/categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: catForm.id,
            name: trimmedName,
            sortOrder: Number(catForm.sortOrder) || 0,
          }),
        });
      } else {
        res = await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedName,
            sortOrder: Number(catForm.sortOrder) || 0,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setCatFormError(data.error || 'Failed to save category');
        return;
      }

      setCatModalOpen(false);
      fetchCategories();
    } catch (err: unknown) {
      setCatFormError(err instanceof Error ? err.message : 'Error saving category');
    } finally {
      setCatSubmitting(false);
    }
  };

  // Toggle Active / Inactive
  const handleToggleActive = async (cat: CategoryRecord) => {
    const nextAction = cat.is_active === 1 ? 'DEACTIVATE' : 'ACTIVATE';
    try {
      const res = await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cat.id, action: nextAction }),
      });
      if (res.ok) {
        fetchCategories();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to update category status');
      }
    } catch (err) {
      alert('Error updating category status');
    }
  };

  // Archive Category
  const handleArchiveConfirm = async () => {
    if (!archiveModalCat) return;
    setArchiveSubmitting(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: archiveModalCat.id, action: 'ARCHIVE' }),
      });
      if (res.ok) {
        setArchiveModalCat(null);
        fetchCategories();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to archive category');
      }
    } catch (err) {
      alert('Error archiving category');
    } finally {
      setArchiveSubmitting(false);
    }
  };

  // Move to Recycle Bin (Delete)
  const handleRecycleConfirm = async () => {
    if (!recycleModalCat) return;
    if (recycleConfirmInput.trim().toUpperCase() !== 'CONFIRM') return;

    setRecycleSubmitting(true);
    setRecycleError('');
    try {
      const res = await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: recycleModalCat.id, action: 'RECYCLE' }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRecycleError(data.error || 'Failed to delete category');
        return;
      }

      setRecycleModalCat(null);
      setRecycleConfirmInput('');
      fetchCategories();
    } catch (err: unknown) {
      setRecycleError(err instanceof Error ? err.message : 'Error deleting category');
    } finally {
      setRecycleSubmitting(false);
    }
  };

  const isRecycleConfirmed = recycleConfirmInput.trim().toUpperCase() === 'CONFIRM';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Primary Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Master Data Setup
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5]">
            CATEGORIES
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Configure work categories and organizational groupings for labour roles.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <Link
            href="/setup/roles"
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 border border-slate-900 dark:border-[#3A3D42] text-slate-800 dark:text-[#F2F3F5] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <ArrowLeft className="w-4 h-4 mr-1.5 text-slate-600 dark:text-[#B5BAC1] shrink-0" />
            ROLES
          </Link>

          <button
            type="button"
            onClick={() => {
              setCatForm({ id: '', name: '', sortOrder: categories.length + 1 });
              setCatFormError('');
              setCatModalOpen(true);
            }}
            className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <Plus className="w-4 h-4 mr-1.5 text-emerald-400 dark:text-[#0A0A0A] shrink-0" aria-hidden="true" />
            <span className="sr-only">+ </span>CATEGORY
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white dark:bg-[#18191C] p-3 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
        {/* Filter Tabs */}
        <div className="flex items-center space-x-1.5 overflow-x-auto custom-scrollbar pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setFilterTab('ALL')}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap touch-action-manipulation ${
              filterTab === 'ALL'
                ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A]'
                : 'bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-200 dark:hover:bg-[#2B2D31]'
            }`}
          >
            ALL ({allCount})
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('ACTIVE')}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap touch-action-manipulation ${
              filterTab === 'ACTIVE'
                ? 'bg-emerald-600 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A]'
                : 'bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-200 dark:hover:bg-[#2B2D31]'
            }`}
          >
            ACTIVE ({activeCount})
          </button>

          <button
            type="button"
            onClick={() => setFilterTab('INACTIVE')}
            className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap touch-action-manipulation ${
              filterTab === 'INACTIVE'
                ? 'bg-amber-600 text-white dark:bg-amber-500 dark:text-black'
                : 'bg-slate-100 dark:bg-[#202225] text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-200 dark:hover:bg-[#2B2D31]'
            }`}
          >
            INACTIVE ({inactiveCount})
          </button>
        </div>

        {/* Search Box */}
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#949BA4]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search categories..."
            className="w-full min-h-[40px] pl-9 pr-3 text-xs bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] touch-action-manipulation"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading categories...
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="p-8 text-center bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] text-slate-500 dark:text-[#949BA4] text-sm">
          No categories found matching your criteria.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] shadow-sm overflow-hidden">
          {/* DESKTOP TABLE VIEW (>= 768px) */}
          <div className="hidden md:block overflow-x-auto custom-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                  <th className="py-3 px-4">Category Name</th>
                  <th className="py-3 px-4 text-center">Sort Order</th>
                  <th className="py-3 px-4 text-center">Roles</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#2B2D31]">
                {filteredCategories.map((cat) => (
                  <tr 
                    key={cat.id} 
                    className={`hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors ${
                      cat.is_active === 0 ? 'bg-amber-50/20 dark:bg-[#202225]/40 opacity-75' : ''
                    }`}
                  >
                    <td className="py-3 px-4 font-bold text-slate-900 dark:text-[#F2F3F5] text-sm whitespace-nowrap">
                      {cat.name}
                    </td>

                    <td className="py-3 px-4 text-center font-mono font-medium text-slate-600 dark:text-[#B5BAC1]">
                      {cat.sort_order}
                    </td>

                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <span className="font-bold text-slate-800 dark:text-[#F2F3F5]">
                        {cat.role_count ?? 0}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-[#949BA4] ml-1">
                        ({cat.active_role_count ?? 0} active)
                      </span>
                    </td>

                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {cat.is_active === 1 ? (
                        <span className="text-[10px] font-bold bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] px-2 py-0.5 rounded border border-transparent dark:border-[#1A7F3C]">
                          Active
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold bg-amber-100 dark:bg-[#2E2010] text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded border border-amber-300 dark:border-amber-800">
                          Inactive
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      <div className="inline-flex items-center space-x-1">
                        {/* Details */}
                        <button
                          type="button"
                          onClick={() => setDetailsCategory(cat)}
                          aria-label={`View details for ${cat.name}`}
                          className="min-h-[36px] px-2.5 py-1 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] text-xs font-bold text-slate-700 dark:text-[#F2F3F5] rounded-lg transition-colors border border-slate-900 dark:border-[#3A3D42] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                          title="Category Details"
                        >
                          <Info className="w-3.5 h-3.5 inline mr-1" />
                          Details
                        </button>

                        {/* Edit */}
                        <button
                          type="button"
                          onClick={() => {
                            setCatForm({ id: cat.id, name: cat.name, sortOrder: cat.sort_order });
                            setCatFormError('');
                            setCatModalOpen(true);
                          }}
                          aria-label={`Edit ${cat.name}`}
                          className="w-10 h-10 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                          title="Edit Category"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        {/* Toggle Active / Inactive */}
                        <button
                          type="button"
                          onClick={() => handleToggleActive(cat)}
                          aria-label={cat.is_active === 1 ? `Deactivate ${cat.name}` : `Activate ${cat.name}`}
                          className="w-10 h-10 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                          title={cat.is_active === 1 ? 'Deactivate Category' : 'Activate Category'}
                        >
                          {cat.is_active === 1 ? (
                            <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          ) : (
                            <Eye className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                          )}
                        </button>

                        {/* Archive */}
                        <button
                          type="button"
                          onClick={() => setArchiveModalCat(cat)}
                          aria-label={`Archive ${cat.name}`}
                          className="w-10 h-10 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                          title="Archive Category"
                        >
                          <Archive className="w-4 h-4" />
                        </button>

                        {/* Delete (Move to Recycle Bin) */}
                        <button
                          type="button"
                          onClick={() => {
                            setRecycleModalCat(cat);
                            setRecycleConfirmInput('');
                            setRecycleError('');
                          }}
                          aria-label={`Delete ${cat.name}`}
                          className="w-10 h-10 inline-flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 touch-action-manipulation"
                          title="Move to Recycle Bin"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MOBILE CARDS VIEW (< 768px) */}
          <div className="md:hidden p-3 space-y-3">
            {filteredCategories.map((cat) => (
              <div
                key={cat.id}
                className={`bg-slate-50 dark:bg-[#111214] p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] space-y-2.5 ${
                  cat.is_active === 0 ? 'border-amber-300 dark:border-amber-700/60 opacity-80' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-black text-slate-900 dark:text-[#F2F3F5] text-sm">{cat.name}</h3>
                    <span className="text-xs text-slate-500 dark:text-[#949BA4] block mt-0.5">
                      Sort Order: {cat.sort_order} • Roles: {cat.role_count ?? 0} ({cat.active_role_count ?? 0} active)
                    </span>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                      cat.is_active === 1
                        ? 'bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] border border-transparent dark:border-[#1A7F3C]'
                        : 'bg-amber-100 dark:bg-[#2E2010] text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                    }`}
                  >
                    {cat.is_active === 1 ? 'Active' : 'Inactive'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-slate-200/60 dark:border-[#2B2D31]">
                  <button
                    type="button"
                    onClick={() => setDetailsCategory(cat)}
                    className="min-h-[44px] px-3 py-1.5 bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] hover:bg-slate-100 dark:hover:bg-[#202225] text-xs font-bold text-slate-700 dark:text-[#F2F3F5] rounded-lg transition-colors touch-action-manipulation flex items-center"
                  >
                    <Info className="w-3.5 h-3.5 mr-1 text-slate-500" />
                    Details
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCatForm({ id: cat.id, name: cat.name, sortOrder: cat.sort_order });
                      setCatFormError('');
                      setCatModalOpen(true);
                    }}
                    aria-label={`Edit ${cat.name}`}
                    className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-100 dark:hover:bg-[#202225] text-slate-600 dark:text-[#B5BAC1] rounded-lg transition-colors touch-action-manipulation"
                  >
                    <Edit className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleToggleActive(cat)}
                    aria-label={cat.is_active === 1 ? `Deactivate ${cat.name}` : `Activate ${cat.name}`}
                    className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-100 dark:hover:bg-[#202225] text-slate-600 dark:text-[#B5BAC1] rounded-lg transition-colors touch-action-manipulation"
                  >
                    {cat.is_active === 1 ? (
                      <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    ) : (
                      <Eye className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setArchiveModalCat(cat)}
                    aria-label={`Archive ${cat.name}`}
                    className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-600 dark:text-amber-400 rounded-lg transition-colors touch-action-manipulation"
                  >
                    <Archive className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRecycleModalCat(cat);
                      setRecycleConfirmInput('');
                      setRecycleError('');
                    }}
                    aria-label={`Delete ${cat.name}`}
                    className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-lg transition-colors touch-action-manipulation"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 1. Add / Edit Category Modal */}
      {mounted && catModalOpen ? createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-5 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2B2D31] pb-3">
              <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                {catForm.id ? 'Edit Category' : 'Add Category'}
              </h3>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-4 pt-4 text-xs">
              {catFormError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg text-rose-700 dark:text-rose-400 font-semibold">
                  {catFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Category Name *
                </label>
                <input
                  type="text"
                  required
                  value={catForm.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    setCatForm((prev) => ({ ...prev, name: val }));
                  }}
                  placeholder="e.g. MASONRY WORKS"
                  className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg text-xs font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Sort Order
                </label>
                <input
                  type="number"
                  value={catForm.sortOrder}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setCatForm((prev) => ({ ...prev, sortOrder: val }));
                  }}
                  className="w-full min-h-[42px] px-3 bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg text-xs font-mono font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
                />
                <span className="text-[11px] text-slate-500 dark:text-[#949BA4] mt-0.5 block">
                  Lower numbers appear first in lists and filters.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setCatModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] font-bold rounded-lg text-xs touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={catSubmitting}
                  className="min-h-[44px] px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white font-bold rounded-lg text-xs border border-slate-900 dark:border-transparent transition-colors disabled:opacity-50 touch-action-manipulation"
                >
                  {catSubmitting ? 'Saving...' : catForm.id ? 'Save Changes' : 'Create Category'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 2. Category Details Modal */}
      {mounted && detailsCategory ? createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-5 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2B2D31] pb-3">
              <div className="flex items-center space-x-2">
                <Layers className="w-5 h-5 text-slate-700 dark:text-[#1ED760]" />
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                  Category Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailsCategory(null)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-4 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Category Name</div>
                <div className="text-sm font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5">{detailsCategory.name}</div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Status</div>
                  <div className="text-xs font-black mt-0.5">
                    {detailsCategory.is_active === 1 ? (
                      <span className="text-emerald-700 dark:text-[#1ED760]">ACTIVE</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">INACTIVE</span>
                    )}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Sort Order</div>
                  <div className="text-xs font-mono font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5">
                    {detailsCategory.sort_order}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Role Usage Breakdown</div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60 dark:border-[#2B2D31]">
                  <span className="text-slate-600 dark:text-[#B5BAC1]">Total Roles:</span>
                  <strong className="text-slate-900 dark:text-[#F2F3F5]">{detailsCategory.role_count ?? 0}</strong>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60 dark:border-[#2B2D31]">
                  <span className="text-emerald-700 dark:text-[#1ED760]">Active Roles:</span>
                  <strong className="text-emerald-700 dark:text-[#1ED760]">{detailsCategory.active_role_count ?? 0}</strong>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-amber-700 dark:text-amber-400">Inactive Roles:</span>
                  <strong className="text-amber-700 dark:text-amber-400">{detailsCategory.inactive_role_count ?? 0}</strong>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg text-slate-500 dark:text-[#949BA4] space-y-1 font-mono text-[11px]">
                <div>ID: {detailsCategory.id}</div>
                <div>Created: {detailsCategory.created_at}</div>
                <div>Updated: {detailsCategory.updated_at}</div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setDetailsCategory(null)}
                  className="min-h-[44px] px-4 py-2 bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A] font-bold rounded-lg text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 3. Archive Confirmation Modal */}
      {mounted && archiveModalCat ? createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-5 sm:p-6 border border-amber-300 dark:border-amber-700/60 my-auto">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2B2D31] pb-3">
              <div className="flex items-center space-x-2 text-amber-600 dark:text-amber-400">
                <Archive className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-black uppercase">
                  Archive Category
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setArchiveModalCat(null)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-3.5 text-xs">
              <p className="text-slate-700 dark:text-[#B5BAC1]">
                Are you sure you want to archive category <strong className="text-slate-900 dark:text-[#F2F3F5]">{archiveModalCat.name}</strong>?
              </p>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg text-amber-800 dark:text-amber-300">
                Archived categories are hidden from active management and daily operational selection. Historical attendance and financials remain fully intact. You can restore archived categories at any time.
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setArchiveModalCat(null)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] font-bold rounded-lg text-xs touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleArchiveConfirm}
                  disabled={archiveSubmitting}
                  className="min-h-[44px] px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-xs transition-colors disabled:opacity-50 touch-action-manipulation"
                >
                  {archiveSubmitting ? 'Archiving...' : 'Archive Category'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 4. Move to Recycle Bin (Delete) Modal with exact CONFIRM requirement */}
      {mounted && recycleModalCat ? createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-5 sm:p-6 border border-rose-300 dark:border-rose-900/60 my-auto">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2B2D31] pb-3">
              <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 className="text-base font-black uppercase">
                  Move to Recycle Bin
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRecycleModalCat(null)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-3.5 text-xs">
              <p className="text-slate-700 dark:text-[#B5BAC1]">
                Are you sure you want to delete category <strong className="text-slate-900 dark:text-[#F2F3F5]">{recycleModalCat.name}</strong>?
              </p>

              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg text-slate-600 dark:text-[#949BA4]">
                This category will be moved to the Recycle Bin. Items can be restored at any time or permanently removed later.
              </div>

              {/* Blocking Error Notice if Child Roles Exist or Deletion Blocked */}
              {recycleError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg text-rose-700 dark:text-rose-400 font-semibold space-y-1">
                  <div className="font-bold flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1 shrink-0" />
                    Deletion Blocked
                  </div>
                  <div className="text-[11px] leading-relaxed">
                    {recycleError}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Type <span className="font-mono text-rose-600 dark:text-rose-400">CONFIRM</span> to proceed:
                </label>
                <input
                  type="text"
                  value={recycleConfirmInput}
                  onChange={(e) => setRecycleConfirmInput(e.target.value)}
                  placeholder="CONFIRM"
                  className="w-full min-h-[42px] px-3 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg text-xs font-mono font-bold focus:ring-2 focus:ring-rose-500 focus:outline-none touch-action-manipulation"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setRecycleModalCat(null)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] text-slate-700 dark:text-[#F2F3F5] font-bold rounded-lg text-xs touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRecycleConfirm}
                  disabled={!isRecycleConfirmed || recycleSubmitting}
                  className="min-h-[44px] px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-lg text-xs transition-colors disabled:opacity-40 touch-action-manipulation"
                >
                  {recycleSubmitting ? 'Deleting...' : 'Move to Recycle Bin'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
