'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSite } from '@/context/site-context';
import { SiteRecord } from '@/lib/db/repositories/site-repo';
import { UserDbRecord } from '@/lib/db/repositories/user-repo';
import { 
  Plus, 
  Archive, 
  RotateCcw, 
  Edit, 
  X
} from 'lucide-react';

export default function SiteManagementPage() {
  const { refreshSites } = useSite();
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [users, setUsers] = useState<UserDbRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    location: '',
    assignedUserIds: [] as string[],
  });
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchSitesAndUsers = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await fetch(`/api/sites?includeArchived=true`);
      if (sRes.ok) {
        const d = await sRes.json();
        setSites(d.sites || []);
      }
      const uRes = await fetch('/api/users');
      if (uRes.ok) {
        const d = await uRes.json();
        setUsers(d.users || []);
      }
    } catch (err) {
      console.error('Error fetching sites:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSitesAndUsers();
  }, [fetchSitesAndUsers]);

  const openAddModal = () => {
    setEditingSiteId(null);
    setFormData({ name: '', code: '', location: '', assignedUserIds: [] });
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = async (site: SiteRecord) => {
    setEditingSiteId(site.id);
    setFormError('');
    try {
      const res = await fetch(`/api/sites/${site.id}`);
      const data = await res.json();
      setFormData({
        name: site.name,
        code: site.code || '',
        location: site.location || '',
        assignedUserIds: data.assignedUserIds || [],
      });
      setModalOpen(true);
    } catch (err) {
      alert('Error fetching site details');
    }
  };

  const handleSaveSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setFormError('Site name is required');
      return;
    }

    setSubmitting(true);
    setFormError('');

    try {
      if (editingSiteId) {
        const res = await fetch(`/api/sites/${editingSiteId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to update site');
        }
      } else {
        const res = await fetch('/api/sites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || 'Failed to create site');
        }
      }

      setModalOpen(false);
      fetchSitesAndUsers();
      refreshSites();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error saving site');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveToggle = async (site: SiteRecord) => {
    const isArchived = site.is_archived === 1;
    const action = isArchived ? 'unarchive' : 'archive';
    if (!confirm(`Are you sure you want to ${action} site "${site.name}"?`)) return;

    try {
      if (isArchived) {
        await fetch(`/api/sites/${site.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isArchived: false }),
        });
      } else {
        await fetch(`/api/sites/${site.id}`, { method: 'DELETE' });
      }
      fetchSitesAndUsers();
      refreshSites();
    } catch (err) {
      alert(`Failed to ${action} site`);
    }
  };

  const filteredSites = sites.filter((s) => (showArchived ? true : s.is_archived === 0));

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            System Administration
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5]">
            Construction Sites Directory
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Configure active construction sites, location metadata, and assign authorized site personnel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <label className="flex items-center space-x-2 text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] cursor-pointer min-h-[44px] px-2 touch-action-manipulation">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="w-4 h-4 rounded border-slate-900 dark:border-[#3A3D42] text-emerald-600 focus:ring-slate-900 dark:focus:ring-[#1ED760] dark:bg-[#111214]"
            />
            <span>Show Archived</span>
          </label>

          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <Plus className="w-4 h-4 mr-1.5 text-emerald-400 dark:text-[#0A0A0A] shrink-0" />
            Add New Site
          </button>
        </div>
      </div>

      {/* Sites Grid */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading construction sites...
        </div>
      ) : filteredSites.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 sm:p-12 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm">
          No construction sites found. Click &quot;Add New Site&quot; to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
          {filteredSites.map((site) => (
            <div
              key={site.id}
              className={`rounded-xl border p-4 sm:p-5 shadow-sm space-y-3 transition-shadow ${
                site.is_archived === 1
                  ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50/20 dark:bg-[#202225] opacity-75'
                  : 'bg-white dark:bg-[#18191C] border-slate-900 dark:border-[#3A3D42]'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                    <span className="font-black text-slate-900 dark:text-[#F2F3F5] text-base sm:text-lg break-words">{site.name}</span>
                    {site.is_archived === 1 && (
                      <span className="text-[10px] font-bold bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 rounded shrink-0">
                        ARCHIVED
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-slate-500 dark:text-[#949BA4] block mt-0.5">
                    Code: {site.code || 'None'}
                  </span>
                </div>

                <div className="flex items-center space-x-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditModal(site)}
                    aria-label={`Edit site ${site.name}`}
                    className="w-11 h-11 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ED760] touch-action-manipulation"
                    title="Edit Site"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleArchiveToggle(site)}
                    aria-label={site.is_archived === 1 ? `Unarchive site ${site.name}` : `Archive site ${site.name}`}
                    className="w-11 h-11 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-amber-700 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                    title={site.is_archived === 1 ? 'Unarchive Site' : 'Archive Site'}
                  >
                    {site.is_archived === 1 ? (
                      <RotateCcw className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                    ) : (
                      <Archive className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    )}
                  </button>
                </div>
              </div>

              <div className="text-xs text-slate-600 dark:text-[#B5BAC1] pt-2.5 border-t border-slate-100 dark:border-[#2B2D31] space-y-1.5">
                <div>
                  <span className="font-semibold text-slate-500 dark:text-[#949BA4]">Location: </span>
                  <span className="font-bold text-slate-800 dark:text-[#F2F3F5] break-words">{site.location || 'Not Specified'}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-500 dark:text-[#949BA4]">Created: </span>
                  <span className="text-slate-600 dark:text-[#B5BAC1]">{site.created_at}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Site Modal — Scroll-safe and responsive */}
      {modalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="site-modal-title" className="text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                {editingSiteId ? 'Edit Construction Site' : 'Add Construction Site'}
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

            <form onSubmit={handleSaveSite} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-[#2A1215] border border-red-200 dark:border-[#6E1C24] rounded-lg text-red-700 dark:text-[#F87171] text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Site Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Commercial Tower Phase 2"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Site Code (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. S-03"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Location / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sector 62, Expressway"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-normal focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              {editingSiteId && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                    Assign Engineers / Viewers
                  </label>
                  <div className="max-h-36 overflow-y-auto border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 space-y-1.5 bg-slate-50 dark:bg-[#111214] custom-scrollbar">
                    {users.filter(u => u.role !== 'ADMIN').map((u) => {
                      const isChecked = formData.assignedUserIds.includes(u.id);
                      return (
                        <label
                          key={u.id}
                          className="flex items-center space-x-2.5 text-xs font-semibold text-slate-800 dark:text-[#F2F3F5] p-1.5 hover:bg-slate-200/60 dark:hover:bg-[#202225] rounded-md cursor-pointer touch-action-manipulation"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFormData({
                                  ...formData,
                                  assignedUserIds: [...formData.assignedUserIds, u.id],
                                });
                              } else {
                                setFormData({
                                  ...formData,
                                  assignedUserIds: formData.assignedUserIds.filter(id => id !== u.id),
                                });
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-900 dark:border-[#3A3D42] text-emerald-600 focus:ring-slate-900 dark:focus:ring-[#1ED760] dark:bg-[#111214]"
                          />
                          <span>
                            {u.full_name} ({u.role})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  {submitting ? 'Saving...' : editingSiteId ? 'Update Site' : 'Create Site'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
