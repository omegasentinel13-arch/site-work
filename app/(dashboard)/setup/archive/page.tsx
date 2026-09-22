'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSite } from '@/context/site-context';
import { GlobalLifecycleRecord } from '@/lib/db/repositories/global-lifecycle-repo';
import { 
  Archive, 
  RotateCcw, 
  Trash2, 
  Search, 
  ExternalLink, 
  ShieldAlert, 
  AlertTriangle,
  X,
  ArrowLeft,
  Briefcase,
  Layers,
  Building2,
  CheckCircle2
} from 'lucide-react';
import { clsx } from 'clsx';

export default function GlobalArchivePage() {
  const { user, isLoading, refreshSites } = useSite();
  const isAdmin = user?.role === 'ADMIN';

  const [items, setItems] = useState<GlobalLifecycleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Move to Recycle Bin Confirmation Modal
  const [selectedItemForRecycle, setSelectedItemForRecycle] = useState<GlobalLifecycleRecord | null>(null);
  const [recycleConfirmInput, setRecycleConfirmInput] = useState('');
  const [recycleSubmitting, setRecycleSubmitting] = useState(false);
  const [recycleError, setRecycleError] = useState('');

  // Restore Confirmation Modal
  const [selectedItemForRestore, setSelectedItemForRestore] = useState<GlobalLifecycleRecord | null>(null);
  const [restoreSubmitting, setRestoreSubmitting] = useState(false);
  const [restoreError, setRestoreError] = useState('');

  const fetchArchivedItems = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await fetch('/api/lifecycle/archive');
      if (res.ok) {
        const data = await res.json();
        setItems(data.items || []);
      }
    } catch (err) {
      console.error('Error fetching global archive items:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchArchivedItems();
  }, [fetchArchivedItems]);

  useEffect(() => {
    const isAnyModalOpen = Boolean(selectedItemForRecycle || selectedItemForRestore);
    if (!isAnyModalOpen) return;

    const originalStyle = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedItemForRecycle(null);
        setSelectedItemForRestore(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalStyle;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedItemForRecycle, selectedItemForRestore]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (typeFilter !== 'ALL' && item.entity_type !== typeFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = item.entity_name.toLowerCase().includes(query);
        const matchesModule = item.source_module.toLowerCase().includes(query);
        const matchesId = item.entity_id.toLowerCase().includes(query);
        if (!matchesName && !matchesModule && !matchesId) return false;
      }
      return true;
    });
  }, [items, typeFilter, searchQuery]);

  const handleRestore = (item: GlobalLifecycleRecord) => {
    setSelectedItemForRestore(item);
    setRestoreError('');
  };

  const handleConfirmRestore = async () => {
    if (!selectedItemForRestore) return;
    setRestoreSubmitting(true);
    setRestoreError('');
    const item = selectedItemForRestore;

    try {
      // First try unified restore endpoint
      const res = await fetch('/api/lifecycle/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: item.entity_type, entityId: item.entity_id }),
      });

      if (!res.ok) {
        // Fallback to direct entity routes if needed
        if (item.entity_type === 'SITE') {
          const fb = await fetch(`/api/sites/${item.entity_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'RESTORE' }),
          });
          if (!fb.ok) {
            const d = await fb.json();
            throw new Error(d.error || 'Failed to restore site');
          }
        } else if (item.entity_type === 'WORK_ROLE' || item.entity_type === 'ROLE') {
          const fb = await fetch('/api/roles', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.entity_id, action: 'RESTORE' }),
          });
          if (!fb.ok) {
            const d = await fb.json();
            throw new Error(d.error || 'Failed to restore role');
          }
        } else if (item.entity_type === 'WORK_CATEGORY' || item.entity_type === 'CATEGORY') {
          const fb = await fetch('/api/categories', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.entity_id, action: 'RESTORE' }),
          });
          if (!fb.ok) {
            const d = await fb.json();
            throw new Error(d.error || 'Failed to restore category');
          }
        } else {
          const d = await res.json();
          throw new Error(d.error || 'Failed to restore item');
        }
      }

      setSelectedItemForRestore(null);
      setActionSuccess(`"${item.entity_name}" was successfully restored to ${item.source_module}.`);
      setTimeout(() => setActionSuccess(null), 4000);

      await fetchArchivedItems();
      await refreshSites();
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : 'Failed to restore item');
    } finally {
      setRestoreSubmitting(false);
    }
  };

  const handleMoveToRecycleBin = async () => {
    if (!selectedItemForRecycle) return;
    if (recycleConfirmInput.trim().toUpperCase() !== 'CONFIRM') {
      setRecycleError('Please type CONFIRM to proceed');
      return;
    }

    setRecycleSubmitting(true);
    setRecycleError('');

    try {
      if (selectedItemForRecycle.entity_type === 'SITE') {
        const res = await fetch(`/api/sites/${selectedItemForRecycle.entity_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'MOVE_TO_BIN' }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to move to Recycle Bin');
        }
      } else if (selectedItemForRecycle.entity_type === 'WORK_ROLE' || selectedItemForRecycle.entity_type === 'ROLE') {
        const res = await fetch('/api/roles', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedItemForRecycle.entity_id, action: 'RECYCLE' }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to move role to Recycle Bin');
        }
      } else if (selectedItemForRecycle.entity_type === 'WORK_CATEGORY' || selectedItemForRecycle.entity_type === 'CATEGORY') {
        const res = await fetch('/api/categories', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedItemForRecycle.entity_id, action: 'RECYCLE' }),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to move category to Recycle Bin');
        }
      }

      const movedName = selectedItemForRecycle.entity_name;
      setSelectedItemForRecycle(null);
      setActionSuccess(`"${movedName}" has been moved to the Recycle Bin.`);
      setTimeout(() => setActionSuccess(null), 4000);

      await fetchArchivedItems();
      await refreshSites();
    } catch (err: unknown) {
      setRecycleError(err instanceof Error ? err.message : 'Failed to move item to Recycle Bin');
    } finally {
      setRecycleSubmitting(false);
    }
  };

  const renderTypeBadge = (entityType: string) => {
    switch (entityType) {
      case 'WORK_ROLE':
      case 'ROLE':
        return (
          <span className="inline-flex items-center text-[10px] font-bold bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
            <Briefcase className="w-3 h-3 mr-1" />
            Role
          </span>
        );
      case 'WORK_CATEGORY':
      case 'CATEGORY':
        return (
          <span className="inline-flex items-center text-[10px] font-bold bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-300 px-2 py-0.5 rounded border border-purple-200 dark:border-purple-800">
            <Layers className="w-3 h-3 mr-1" />
            Category
          </span>
        );
      case 'SITE':
      default:
        return (
          <span className="inline-flex items-center text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
            <Building2 className="w-3 h-3 mr-1" />
            Site
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm">
        Loading workspace...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="p-8 text-center bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] max-w-lg mx-auto mt-12 space-y-4">
        <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto" />
        <h2 className="text-lg font-black text-slate-900 dark:text-[#F2F3F5]">Access Restricted</h2>
        <p className="text-xs text-slate-500 dark:text-[#949BA4]">
          The Global Archive workspace requires Administrator permissions.
        </p>
        <Link
          href="/"
          className="inline-flex items-center text-xs font-bold text-slate-900 dark:text-[#1ED760] underline"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Link
              href="/setup/account"
              className="text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] transition-colors"
              title="Back to My Account"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4]">
              Governance &amp; Data Protection
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5">
            ARCHIVE
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Archived items from across SITE WORK.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/50 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-800 dark:text-amber-300 self-start md:self-auto">
          <Archive className="w-4 h-4 mr-1 shrink-0" />
          <span>{items.length} Total Archived Item{items.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      {/* Success Notification */}
      {actionSuccess && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 rounded-xl flex items-center space-x-2.5 text-xs text-emerald-800 dark:text-emerald-200 font-semibold shadow-sm">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{actionSuccess}</span>
        </div>
      )}

      {/* Controls Bar */}
      <div className="bg-white dark:bg-[#18191C] p-3 sm:p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-[#111214] rounded-lg border border-slate-900 dark:border-[#3A3D42] self-start sm:self-auto">
          {[
            { key: 'ALL', label: 'All Entities' },
            { key: 'WORK_ROLE', label: 'Roles' },
            { key: 'WORK_CATEGORY', label: 'Categories' },
            { key: 'SITE', label: 'Sites' },
          ].map((type) => (
            <button
              key={type.key}
              type="button"
              onClick={() => setTypeFilter(type.key)}
              className={clsx(
                'min-h-[36px] px-3 py-1 rounded-md text-xs font-bold transition-colors touch-action-manipulation',
                typeFilter === type.key
                  ? 'bg-slate-900 dark:bg-[#1ED760] text-white dark:text-[#0A0A0A] shadow-sm'
                  : 'text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5]'
              )}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px] sm:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Search archived entity or module..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[40px] pl-9 pr-3 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg text-xs font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
          />
        </div>
      </div>

      {/* Items Table / Cards */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading archived records...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 sm:p-12 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm space-y-2">
          <p className="font-bold">No archived items found in the system.</p>
          <p className="text-xs">When enterprise entities are archived, they will appear here with full restore capabilities.</p>
        </div>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-900 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#111214] text-[10px] font-black uppercase text-slate-500 dark:text-[#949BA4]">
                    <th className="py-3 px-4">Entity</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Source Module</th>
                    <th className="py-3 px-4">Restore Destination</th>
                    <th className="py-3 px-4">Archived Date</th>
                    <th className="py-3 px-4">Archived By</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#2B2D31]">
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                      <td className="py-3.5 px-4 font-black text-slate-900 dark:text-[#F2F3F5]">
                        <div className="flex flex-col">
                          <span>{item.entity_name}</span>
                          <span className="text-[10px] font-mono text-slate-400 dark:text-[#80848E] font-normal mt-0.5 truncate max-w-[180px]">
                            ID: {item.entity_id}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {renderTypeBadge(item.entity_type)}
                      </td>
                      <td className="py-3.5 px-4">
                        <Link
                          href={item.source_route}
                          className="inline-flex items-center text-slate-700 dark:text-[#B5BAC1] hover:text-slate-900 dark:hover:text-[#1ED760] font-semibold underline"
                        >
                          <span>{item.source_module}</span>
                          <ExternalLink className="w-3 h-3 ml-1 opacity-70" />
                        </Link>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-[#B5BAC1] font-medium">
                        {item.restore_destination || item.source_route}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-[#B5BAC1] font-mono">
                        {item.archived_at || item.created_at}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 dark:text-[#B5BAC1]">
                        {item.performed_by_name || 'System Administrator'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
                          ARCHIVED
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => handleRestore(item)}
                          className="min-h-[34px] px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] rounded-lg font-bold text-xs inline-flex items-center transition-colors touch-action-manipulation shadow-sm"
                          title={`Restore to ${item.source_module}`}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          Restore
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItemForRecycle(item);
                            setRecycleConfirmInput('');
                            setRecycleError('');
                          }}
                          className="min-h-[34px] px-3 py-1 bg-white dark:bg-[#202225] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-slate-300 dark:border-[#3A3D42] rounded-lg font-bold text-xs inline-flex items-center transition-colors touch-action-manipulation"
                          title="Move to Recycle Bin"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          Recycle Bin
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card View (< md) */}
          <div className="md:hidden space-y-3">
            {filteredItems.map((item) => (
              <div 
                key={item.id} 
                className="p-4 bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-black text-sm text-slate-900 dark:text-[#F2F3F5]">
                      {item.entity_name}
                    </h3>
                    <div className="text-[10px] font-mono text-slate-400 dark:text-[#80848E] truncate max-w-[240px]">
                      ID: {item.entity_id}
                    </div>
                  </div>
                  {renderTypeBadge(item.entity_type)}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100 dark:border-[#2B2D31]">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-[#80848E] block">Source Module</span>
                    <Link
                      href={item.source_route}
                      className="inline-flex items-center text-slate-700 dark:text-[#B5BAC1] hover:text-slate-900 dark:hover:text-[#1ED760] font-semibold underline"
                    >
                      <span>{item.source_module}</span>
                      <ExternalLink className="w-3 h-3 ml-1 opacity-70" />
                    </Link>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-[#80848E] block">Status</span>
                    <span className="text-[10px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 px-2 py-0.5 rounded inline-block">
                      ARCHIVED
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-[#80848E] block">Archived Date</span>
                    <span className="text-slate-600 dark:text-[#B5BAC1] font-mono text-[11px]">
                      {item.archived_at || item.created_at}
                    </span>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-[#80848E] block">Archived By</span>
                    <span className="text-slate-600 dark:text-[#B5BAC1] text-[11px] truncate block">
                      {item.performed_by_name || 'System Administrator'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#2B2D31]">
                  <button
                    type="button"
                    onClick={() => handleRestore(item)}
                    className="min-h-[44px] flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] rounded-lg font-bold text-xs inline-flex items-center justify-center transition-colors touch-action-manipulation shadow-sm"
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" />
                    Restore
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedItemForRecycle(item);
                      setRecycleConfirmInput('');
                      setRecycleError('');
                    }}
                    className="min-h-[44px] flex-1 px-3 py-2 bg-white dark:bg-[#202225] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-slate-300 dark:border-[#3A3D42] rounded-lg font-bold text-xs inline-flex items-center justify-center transition-colors touch-action-manipulation"
                  >
                    <Trash2 className="w-4 h-4 mr-1.5" />
                    Recycle Bin
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Move to Recycle Bin Confirmation Modal */}
      {selectedItemForRecycle && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-recycle-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-rose-300 dark:border-rose-900/60 my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2B2D31] pb-3">
              <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 id="archive-recycle-modal-title" className="text-base font-black uppercase">
                  Move to Recycle Bin
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItemForRecycle(null)}
                aria-label="Close dialog"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-3 text-xs">
              <p className="text-slate-700 dark:text-[#B5BAC1]">
                Move <strong className="text-slate-900 dark:text-[#F2F3F5]">{selectedItemForRecycle.entity_name}</strong> ({selectedItemForRecycle.source_module}) to the Recycle Bin?
              </p>

              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg text-slate-600 dark:text-[#949BA4]">
                Items moved here will normally stay in the Recycle Bin for one month. After that, they may be permanently removed.
              </div>

              {recycleError && (
                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg text-rose-700 dark:text-rose-400 font-semibold">
                  {recycleError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Type <span className="font-mono text-amber-600 dark:text-amber-400">CONFIRM</span> to move to Recycle Bin:
                </label>
                <input
                  type="text"
                  value={recycleConfirmInput}
                  onChange={(e) => setRecycleConfirmInput(e.target.value)}
                  placeholder="CONFIRM"
                  className="w-full min-h-[42px] px-3 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg text-xs font-mono font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none touch-action-manipulation"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setSelectedItemForRecycle(null)}
                  className="min-h-[40px] px-4 py-2 border border-slate-300 dark:border-[#3A3D42] rounded-lg text-xs font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMoveToRecycleBin}
                  disabled={recycleConfirmInput.trim().toUpperCase() !== 'CONFIRM' || recycleSubmitting}
                  className="min-h-[40px] px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow transition-colors touch-action-manipulation"
                >
                  {recycleSubmitting ? 'Moving...' : 'Confirm Move to Bin'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation Modal */}
      {selectedItemForRestore && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="archive-restore-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-emerald-500 dark:border-emerald-600 my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2B2D31] pb-3">
              <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
                <RotateCcw className="w-5 h-5 shrink-0" />
                <h3 id="archive-restore-modal-title" className="text-base font-black uppercase">
                  Restore Record
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedItemForRestore(null)}
                aria-label="Close dialog"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-3 text-xs">
              <p className="text-slate-700 dark:text-[#B5BAC1]">
                Are you sure you want to restore <strong className="text-slate-900 dark:text-[#F2F3F5]">{selectedItemForRestore.entity_name}</strong> to active status in <strong className="text-slate-900 dark:text-[#F2F3F5]">{selectedItemForRestore.source_module}</strong>?
              </p>

              <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-lg text-emerald-800 dark:text-emerald-300">
                This item will become active immediately and return to its original workspace.
              </div>

              {restoreError && (
                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg text-rose-700 dark:text-rose-400 font-semibold">
                  {restoreError}
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setSelectedItemForRestore(null)}
                  className="min-h-[44px] px-4 py-2 border border-slate-300 dark:border-[#3A3D42] rounded-lg text-xs font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={restoreSubmitting}
                  className="min-h-[44px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-40 text-white dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] rounded-lg text-xs font-bold shadow transition-colors touch-action-manipulation"
                >
                  {restoreSubmitting ? 'Restoring...' : 'Confirm Restore'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
