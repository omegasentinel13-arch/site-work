'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSite } from '@/context/site-context';
import { SiteRecord, SitesKPISummary, SiteOperationalStats } from '@/lib/db/repositories/site-repo';
import { UserDbRecord } from '@/lib/db/repositories/user-repo';
import { formatINR } from '@/lib/domain/money';
import { 
  Plus, 
  Archive, 
  RotateCcw, 
  Edit, 
  X, 
  Search, 
  Building2, 
  Users, 
  IndianRupee, 
  CalendarDays, 
  ArrowUpRight, 
  Trash2, 
  AlertTriangle,
  History,
  FileSpreadsheet,
  CheckCircle2
} from 'lucide-react';
import { clsx } from 'clsx';

type TabFilter = 'ACTIVE' | 'ALL' | 'ARCHIVED';

export default function SiteManagementPage() {
  const router = useRouter();
  const { user, refreshSites, setSelectedSiteId } = useSite();
  const isAdmin = user?.role === 'ADMIN';

  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [kpiSummary, setKpiSummary] = useState<SitesKPISummary | null>(null);
  const [users, setUsers] = useState<UserDbRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter & Search state
  const [activeTab, setActiveTab] = useState<TabFilter>('ACTIVE');
  const [searchQuery, setSearchQuery] = useState('');

  // Add / Edit Modal State
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

  // Site Overview Modal State
  const [overviewSite, setOverviewSite] = useState<SiteRecord | null>(null);
  const [overviewStats, setOverviewStats] = useState<SiteOperationalStats | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);

  // Move to Recycle Bin Modal State
  const [recycleModalSite, setRecycleModalSite] = useState<SiteRecord | null>(null);
  const [recycleConfirmInput, setRecycleConfirmInput] = useState('');
  const [recycleSubmitting, setRecycleSubmitting] = useState(false);
  const [recycleError, setRecycleError] = useState('');

  const fetchSitesAndUsers = useCallback(async () => {
    setLoading(true);
    try {
      const sRes = await fetch(`/api/sites?status=ALL`);
      if (sRes.ok) {
        const d = await sRes.json();
        setSites(d.sites || []);
        if (d.kpiSummary) {
          setKpiSummary(d.kpiSummary);
        }
      }
      if (isAdmin) {
        const uRes = await fetch('/api/users');
        if (uRes.ok) {
          const d = await uRes.json();
          setUsers(d.users || []);
        }
      }
    } catch (err) {
      console.error('Error fetching sites:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchSitesAndUsers();
  }, [fetchSitesAndUsers]);

  // Filtered sites based on Tab and Search query
  const filteredSites = useMemo(() => {
    return sites.filter((site) => {
      // Tab status filter
      if (activeTab === 'ACTIVE' && site.is_archived !== 0) return false;
      if (activeTab === 'ARCHIVED' && site.is_archived !== 1) return false;

      // Text search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = site.name.toLowerCase().includes(query);
        const matchesCode = site.code ? site.code.toLowerCase().includes(query) : false;
        const matchesLocation = site.location ? site.location.toLowerCase().includes(query) : false;
        if (!matchesName && !matchesCode && !matchesLocation) return false;
      }

      return true;
    });
  }, [sites, activeTab, searchQuery]);

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
    } catch {
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
    const action = isArchived ? 'RESTORE' : 'ARCHIVE';
    const actionLabel = isArchived ? 'restore to active status' : 'archive';

    if (!confirm(`Are you sure you want to ${actionLabel} site "${site.name}"?`)) return;

    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to update site status');
      }
      fetchSitesAndUsers();
      refreshSites();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error updating site');
    }
  };

  const openRecycleModal = (site: SiteRecord) => {
    setRecycleModalSite(site);
    setRecycleConfirmInput('');
    setRecycleError('');
  };

  const handleMoveToRecycleBin = async () => {
    if (!recycleModalSite) return;
    if (recycleConfirmInput.trim().toUpperCase() !== 'DELETE') {
      setRecycleError('Please type DELETE to confirm');
      return;
    }

    setRecycleSubmitting(true);
    setRecycleError('');

    try {
      const res = await fetch(`/api/sites/${recycleModalSite.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MOVE_TO_BIN' }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to move site to Recycle Bin');
      }

      setRecycleModalSite(null);
      fetchSitesAndUsers();
      refreshSites();
    } catch (err: unknown) {
      setRecycleError(err instanceof Error ? err.message : 'Error moving site to Recycle Bin');
    } finally {
      setRecycleSubmitting(false);
    }
  };

  // Open Site Overview
  const handleOpenOverview = async (site: SiteRecord) => {
    setOverviewSite(site);
    setOverviewStats(null);
    setOverviewLoading(true);

    try {
      const res = await fetch(`/api/sites/${site.id}/overview`);
      if (res.ok) {
        const data = await res.json();
        setOverviewStats(data.stats);
      }
    } catch (err) {
      console.error('Error fetching site overview:', err);
    } finally {
      setOverviewLoading(false);
    }
  };

  // Shortcut navigation with active site preset
  const handleNavigateShortcut = (targetHref: string) => {
    if (overviewSite) {
      setSelectedSiteId(overviewSite.id);
      setOverviewSite(null);
      router.push(targetHref);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 1. Header & Primary Management Action */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            System Administration
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5]">
            SITE MANAGEMENT
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Configure enterprise construction sites, location metadata, and assign authorized site personnel.
          </p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
            >
              <Plus className="w-4 h-4 mr-1.5 text-emerald-400 dark:text-[#0A0A0A] shrink-0" />
              Add New Site
            </button>
          </div>
        )}
      </div>

      {/* 2. Live Non-Fabricated KPI Strip */}
      {kpiSummary && (
        <div className="rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] overflow-hidden shadow-sm bg-slate-50 dark:bg-[#111214]">
          <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
            <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
              <Building2 className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
              <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                Site Operational Metrics
              </h2>
            </div>
            <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
              {kpiSummary.totalSites} SITES TOTAL
            </span>
          </div>
          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
                <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-500 dark:text-[#949BA4] block">
                  Total Sites
                </span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] mt-1 block">
                  {kpiSummary.totalSites}
                </span>
              </div>

              <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
                <span className="text-[10px] sm:text-xs font-bold uppercase text-emerald-700 dark:text-[#1ED760] block">
                  Active Sites
                </span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] mt-1 block">
                  {kpiSummary.activeSites}
                </span>
              </div>

              <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
                <span className="text-[10px] sm:text-xs font-bold uppercase text-amber-700 dark:text-amber-400 block">
                  Archived Sites
                </span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] mt-1 block">
                  {kpiSummary.archivedSites}
                </span>
              </div>

              <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
                <span className="text-[10px] sm:text-xs font-bold uppercase text-indigo-700 dark:text-indigo-400 block">
                  With History
                </span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] mt-1 block">
                  {kpiSummary.sitesWithHistory}
                </span>
              </div>

              <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm col-span-2 sm:col-span-1">
                <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-500 dark:text-[#949BA4] block">
                  Assigned Personnel
                </span>
                <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5] mt-1 block">
                  {kpiSummary.assignedPersonnelCount}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. Construction Sites Directory Section */}
      <div className="rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] overflow-hidden shadow-sm bg-slate-50 dark:bg-[#111214]">
        <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
          <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
            <Building2 className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
            <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
              Construction Sites Directory
            </h2>
          </div>
          <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
            {filteredSites.length} {filteredSites.length === 1 ? 'SITE' : 'SITES'}
          </span>
        </div>

        <div className="p-3 sm:p-5 space-y-4">
          {/* Search Bar & Status Filter Tabs */}
          <div className="bg-white dark:bg-[#18191C] p-3 sm:p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Status Filter Tabs */}
            <div className="flex items-center space-x-1.5 p-1 bg-slate-100 dark:bg-[#111214] rounded-lg border border-slate-900 dark:border-[#3A3D42] self-start sm:self-auto">
              {(['ACTIVE', 'ALL', 'ARCHIVED'] as TabFilter[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={clsx(
                    'min-h-[38px] px-3.5 py-1.5 rounded-md text-xs font-bold transition-all touch-action-manipulation',
                    activeTab === tab
                      ? 'bg-slate-900 text-white dark:bg-[#1ED760] dark:text-[#0A0A0A] shadow-sm'
                      : 'text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5]'
                  )}
                >
                  {tab === 'ACTIVE' && `Active (${kpiSummary?.activeSites ?? 0})`}
                  {tab === 'ALL' && `All (${kpiSummary?.totalSites ?? 0})`}
                  {tab === 'ARCHIVED' && `Archived (${kpiSummary?.archivedSites ?? 0})`}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#949BA4]" />
              <input
                type="text"
                placeholder="Search site name, code, location..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full min-h-[42px] pl-9 pr-3 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg text-xs font-semibold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
              />
            </div>
          </div>

          {/* Sites Grid / List */}
          {loading ? (
            <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
              Loading construction sites...
            </div>
          ) : filteredSites.length === 0 ? (
            <div className="bg-white dark:bg-[#18191C] p-8 sm:p-12 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-[#949BA4] text-sm shadow-sm">
              No construction sites found matching your criteria.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-5">
              {filteredSites.map((site) => (
                <div
                  key={site.id}
                  className={clsx(
                    'rounded-xl border p-4 sm:p-5 shadow-sm space-y-3.5 transition-shadow flex flex-col justify-between',
                    site.is_archived === 1
                      ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50/20 dark:bg-[#202225] opacity-80'
                      : 'bg-white dark:bg-[#18191C] border-slate-900 dark:border-[#3A3D42]'
                  )}
                >
                  <div>
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                          <span className="font-black text-slate-900 dark:text-[#F2F3F5] text-base sm:text-lg break-words">
                            {site.name}
                          </span>
                          {site.is_archived === 1 ? (
                            <span className="text-[10px] font-bold bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 rounded shrink-0">
                              ARCHIVED
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-[#1ED760] px-2 py-0.5 rounded shrink-0">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-semibold text-slate-500 dark:text-[#949BA4] block mt-0.5">
                          Code: {site.code || 'None'}
                        </span>
                      </div>

                      {/* Actions Bar */}
                      <div className="flex items-center space-x-1 shrink-0">
                        {/* OPEN Site Overview button */}
                        <button
                          type="button"
                          onClick={() => handleOpenOverview(site)}
                          className="min-h-[38px] px-2.5 py-1 text-xs font-bold text-slate-900 dark:text-[#F2F3F5] bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] border border-slate-900 dark:border-[#3A3D42] rounded-lg transition-colors inline-flex items-center touch-action-manipulation"
                          title="Open Site Overview"
                        >
                          <ArrowUpRight className="w-3.5 h-3.5 mr-1 text-emerald-600 dark:text-[#1ED760]" />
                          OPEN
                        </button>

                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(site)}
                              aria-label={`Edit site ${site.name}`}
                              className="w-9 h-9 inline-flex items-center justify-center text-slate-600 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] rounded-lg transition-colors border border-transparent hover:border-slate-300 dark:hover:border-[#3A3D42] touch-action-manipulation"
                              title="Edit Site"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleArchiveToggle(site)}
                              aria-label={site.is_archived === 1 ? `Unarchive site ${site.name}` : `Archive site ${site.name}`}
                              className="w-9 h-9 inline-flex items-center justify-center text-slate-600 dark:text-[#949BA4] hover:text-amber-700 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-[#2B2D31] rounded-lg transition-colors border border-transparent hover:border-amber-300 dark:hover:border-amber-600/50 touch-action-manipulation"
                              title={site.is_archived === 1 ? 'Restore to Active' : 'Archive Site'}
                            >
                              {site.is_archived === 1 ? (
                                <RotateCcw className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                              ) : (
                                <Archive className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => openRecycleModal(site)}
                              aria-label={`Move site ${site.name} to Recycle Bin`}
                              className="w-9 h-9 inline-flex items-center justify-center text-slate-600 dark:text-[#949BA4] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-[#2B2D31] rounded-lg transition-colors border border-transparent hover:border-rose-300 dark:hover:border-rose-900/60 touch-action-manipulation"
                              title="Move to Recycle Bin"
                            >
                              <Trash2 className="w-4 h-4 text-rose-500" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 dark:text-[#B5BAC1] pt-3 mt-3 border-t border-slate-100 dark:border-[#2B2D31] space-y-1.5">
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-[#949BA4]">Location: </span>
                        <span className="font-bold text-slate-800 dark:text-[#F2F3F5] break-words">
                          {site.location || 'Not Specified'}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500 dark:text-[#949BA4]">Created: </span>
                        <span className="text-slate-600 dark:text-[#B5BAC1]">{site.created_at}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 5. Dense Site Overview Modal ("OPEN") */}
      {overviewSite && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-overview-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-hidden flex flex-col">
            {/* Modal Inverted Header */}
            <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-6 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2 shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                  <Building2 className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                  <h3 id="site-overview-title" className="text-sm sm:text-base font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                    {overviewSite.name}
                  </h3>
                  {overviewSite.is_archived === 1 ? (
                    <span className="text-[10px] font-bold bg-amber-900/80 text-amber-200 border border-amber-700 px-2 py-0.5 rounded shrink-0">
                      ARCHIVED
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded shrink-0">
                      ACTIVE
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300 dark:text-[#949BA4] mt-0.5">
                  Code: <strong className="text-white dark:text-[#F2F3F5]">{overviewSite.code || 'None'}</strong> • Location: <strong className="text-white dark:text-[#F2F3F5]">{overviewSite.location || 'Not Specified'}</strong>
                </p>
              </div>

              <button
                type="button"
                onClick={() => setOverviewSite(null)}
                aria-label="Close overview"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white dark:hover:text-[#F2F3F5] hover:bg-slate-800 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar flex-1">
              {overviewLoading ? (
                <div className="py-12 text-center text-xs font-bold text-slate-500 dark:text-[#949BA4]">
                  Loading canonical site data...
                </div>
              ) : overviewStats ? (
                <div className="space-y-4 text-xs">
                {/* Personnel Summary */}
                <div className="p-3 bg-slate-50 dark:bg-[#111214] rounded-lg border border-slate-200 dark:border-[#2B2D31]">
                  <span className="font-bold text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block mb-1.5">
                    Assigned Personnel
                  </span>
                  {overviewStats.assignedUsers.length === 0 ? (
                    <span className="text-slate-500 dark:text-[#949BA4] italic">
                      No engineers or viewers assigned directly to this site.
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {overviewStats.assignedUsers.map((u) => (
                        <span
                          key={u.id}
                          className="inline-flex items-center px-2 py-1 rounded-md bg-white dark:bg-[#202225] border border-slate-300 dark:border-[#3A3D42] text-slate-800 dark:text-[#F2F3F5] font-semibold"
                        >
                          <Users className="w-3 h-3 mr-1 text-slate-400" />
                          {u.fullName} ({u.role})
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Financial Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-300 block">
                      Total Inflow
                    </span>
                    <span className="text-sm sm:text-base font-black text-emerald-900 dark:text-[#1ED760] mt-0.5 block">
                      {formatINR(overviewStats.financials.totalCreditsPaise)}
                    </span>
                  </div>

                  <div className="p-2.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/40 rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-rose-800 dark:text-rose-300 block">
                      Total Outflow
                    </span>
                    <span className="text-sm sm:text-base font-black text-rose-900 dark:text-rose-400 mt-0.5 block">
                      {formatINR(overviewStats.financials.totalDebitsPaise)}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-100 dark:bg-[#111214] border border-slate-300 dark:border-[#3A3D42] rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-[#949BA4] block">
                      Net Balance
                    </span>
                    <span className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5 block">
                      {formatINR(overviewStats.financials.netBalancePaise)}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-100 dark:bg-[#111214] border border-slate-300 dark:border-[#3A3D42] rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-[#949BA4] block">
                      Transactions
                    </span>
                    <span className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5 block">
                      {overviewStats.financials.transactionCount}
                    </span>
                  </div>
                </div>

                {/* Workforce Summary */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-2.5 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-[#949BA4] block">
                      Worker-Days Logged
                    </span>
                    <span className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5 block">
                      {overviewStats.workforce.totalWorkerDays}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                    <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-[#949BA4] block">
                      Total Labor Cost
                    </span>
                    <span className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5 block">
                      {formatINR(overviewStats.workforce.totalLaborCostPaise)}
                    </span>
                  </div>

                  <div className="p-2.5 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-[#949BA4] block">
                      Last Active Date
                    </span>
                    <span className="text-sm sm:text-base font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5 block">
                      {overviewStats.workforce.lastAttendanceDate || 'No attendance yet'}
                    </span>
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="border border-slate-200 dark:border-[#2B2D31] rounded-lg p-3 bg-white dark:bg-[#111214]">
                  <span className="font-bold text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block mb-2">
                    Recent Activity
                  </span>
                  {overviewStats.recentActivity.length === 0 ? (
                    <p className="text-slate-500 dark:text-[#949BA4] italic py-2">
                      No attendance or financial records logged for this site yet.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {overviewStats.recentActivity.map((act) => (
                        <div
                          key={act.id}
                          className="flex items-center justify-between text-xs py-1 border-b border-slate-100 dark:border-[#202225] last:border-b-0"
                        >
                          <div className="flex items-center space-x-2 min-w-0 pr-2">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-[#949BA4] shrink-0 font-mono">
                              {act.date}
                            </span>
                            <span className="text-slate-800 dark:text-[#F2F3F5] truncate font-medium">
                              {act.summary}
                            </span>
                          </div>
                          {act.amountOrCostPaise !== undefined && act.amountOrCostPaise > 0 && (
                            <span className="font-bold text-slate-900 dark:text-[#F2F3F5] shrink-0 font-mono text-[11px]">
                              {formatINR(act.amountOrCostPaise)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Useful Module Shortcuts */}
                <div className="pt-2 border-t border-slate-200 dark:border-[#2B2D31]">
                  <span className="font-bold text-[11px] uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block mb-2">
                    Jump to Module with this Site
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => handleNavigateShortcut('/attendance/daily')}
                      className="min-h-[38px] px-2.5 py-1.5 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42] rounded-lg text-slate-800 dark:text-[#F2F3F5] font-bold text-xs flex items-center justify-center transition-colors touch-action-manipulation"
                    >
                      <CalendarDays className="w-3.5 h-3.5 mr-1 text-slate-500 dark:text-[#1ED760]" />
                      Daily Attendance
                    </button>

                    <button
                      type="button"
                      onClick={() => handleNavigateShortcut('/finance')}
                      className="min-h-[38px] px-2.5 py-1.5 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42] rounded-lg text-slate-800 dark:text-[#F2F3F5] font-bold text-xs flex items-center justify-center transition-colors touch-action-manipulation"
                    >
                      <IndianRupee className="w-3.5 h-3.5 mr-1 text-slate-500 dark:text-[#1ED760]" />
                      Transactions
                    </button>

                    <button
                      type="button"
                      onClick={() => handleNavigateShortcut('/finance/monthly')}
                      className="min-h-[38px] px-2.5 py-1.5 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42] rounded-lg text-slate-800 dark:text-[#F2F3F5] font-bold text-xs flex items-center justify-center transition-colors touch-action-manipulation"
                    >
                      <History className="w-3.5 h-3.5 mr-1 text-slate-500 dark:text-[#1ED760]" />
                      Master Ledger
                    </button>

                    <button
                      type="button"
                      onClick={() => handleNavigateShortcut('/reports/site')}
                      className="min-h-[38px] px-2.5 py-1.5 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] border border-slate-300 dark:border-[#3A3D42] rounded-lg text-slate-800 dark:text-[#F2F3F5] font-bold text-xs flex items-center justify-center transition-colors touch-action-manipulation"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 mr-1 text-slate-500 dark:text-[#1ED760]" />
                      Site Report
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-rose-500">
                Failed to load site operational data.
              </div>
            )}
            </div>
          </div>
        </div>
      )}

      {/* 6. Move to Recycle Bin Modal (Requires typing DELETE) */}
      {recycleModalSite && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="recycle-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-rose-300 dark:border-rose-900/60 my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#2B2D31] pb-3">
              <div className="flex items-center space-x-2 text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <h3 id="recycle-modal-title" className="text-base font-black uppercase">
                  Move Site to Recycle Bin
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRecycleModalSite(null)}
                aria-label="Close dialog"
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-3 text-xs">
              <p className="text-slate-700 dark:text-[#B5BAC1]">
                Are you sure you want to move site <strong className="text-slate-900 dark:text-[#F2F3F5]">{recycleModalSite.name}</strong> to the Recycle Bin?
              </p>

              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg text-slate-600 dark:text-[#949BA4]">
                Items moved here will normally stay in the Recycle Bin for one month. After that, they may be permanently removed. Items can be restored at any time or kept permanently.
              </div>

              {recycleError && (
                <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg text-rose-700 dark:text-rose-400 font-semibold">
                  {recycleError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Type <span className="font-mono text-rose-600 dark:text-rose-400">DELETE</span> to confirm:
                </label>
                <input
                  type="text"
                  value={recycleConfirmInput}
                  onChange={(e) => setRecycleConfirmInput(e.target.value)}
                  placeholder="DELETE"
                  className="w-full min-h-[42px] px-3 bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg text-xs font-mono font-bold focus:ring-2 focus:ring-rose-500 focus:outline-none touch-action-manipulation"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setRecycleModalSite(null)}
                  className="min-h-[40px] px-4 py-2 border border-slate-300 dark:border-[#3A3D42] rounded-lg text-xs font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMoveToRecycleBin}
                  disabled={recycleConfirmInput.trim().toUpperCase() !== 'DELETE' || recycleSubmitting}
                  className="min-h-[40px] px-4 py-2 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 disabled:opacity-40 text-white rounded-lg text-xs font-bold shadow transition-colors touch-action-manipulation"
                >
                  {recycleSubmitting ? 'Moving...' : 'Confirm Move to Bin'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. Add / Edit Site Modal */}
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
