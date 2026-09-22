'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSite } from '@/context/site-context';
import { formatINR, toRupees, toPaise } from '@/lib/domain/money';
import { CategoryRecord, RoleRecord } from '@/lib/db/repositories/role-repo';
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
  Layers, 
  X,
  Building2,
  IndianRupee
} from 'lucide-react';

export default function RolesManagementPage() {
  const { selectedSite, selectedSiteId } = useSite();
  const [mounted, setMounted] = useState(false);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Tabs & Search
  const [filterTab, setFilterTab] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Role Add / Edit Modal
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({
    id: '',
    categoryId: '',
    name: '',
    defaultRateRupees: '',
  });
  const [roleFormError, setRoleFormError] = useState('');
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  // Role Details Modal
  const [detailsRole, setDetailsRole] = useState<RoleRecord | null>(null);

  // Archive Modal
  const [archiveModalRole, setArchiveModalRole] = useState<RoleRecord | null>(null);
  const [archiveSubmitting, setArchiveSubmitting] = useState(false);

  // Recycle Bin / Delete Modal
  const [recycleModalRole, setRecycleModalRole] = useState<RoleRecord | null>(null);
  const [recycleConfirmInput, setRecycleConfirmInput] = useState('');
  const [recycleError, setRecycleError] = useState('');
  const [recycleSubmitting, setRecycleSubmitting] = useState(false);

  // Site Rate Override Modal (Working feature preserved)
  const [siteRateModalOpen, setSiteRateModalOpen] = useState(false);
  const [selectedRoleForSiteRate, setSelectedRoleForSiteRate] = useState<RoleRecord | null>(null);
  const [siteRateRupees, setSiteRateRupees] = useState('');
  const [siteRateError, setSiteRateError] = useState('');
  const [siteRateSubmitting, setSiteRateSubmitting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isAnyModalOpen = Boolean(
    roleModalOpen || 
    detailsRole || 
    archiveModalRole || 
    recycleModalRole || 
    (siteRateModalOpen && selectedRoleForSiteRate)
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
        setRoleModalOpen(false);
        setDetailsRole(null);
        setArchiveModalRole(null);
        setRecycleModalRole(null);
        setSiteRateModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAnyModalOpen]);

  const fetchMasterData = useCallback(async () => {
    setLoading(true);
    try {
      const catRes = await fetch('/api/categories?includeInactive=true');
      if (catRes.ok) {
        const d = await catRes.json();
        setCategories(d.categories || []);
      }

      const roleUrl = selectedSiteId
        ? `/api/roles?siteId=${selectedSiteId}&includeInactive=true`
        : '/api/roles?includeInactive=true';

      const roleRes = await fetch(roleUrl);
      if (roleRes.ok) {
        const d = await roleRes.json();
        setRoles(d.roles || []);
      }
    } catch (err) {
      console.error('Error loading roles setup:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedSiteId]);

  useEffect(() => {
    fetchMasterData();
  }, [fetchMasterData]);

  // Tab counts
  const allCount = roles.length;
  const activeCount = roles.filter(r => r.is_active === 1).length;
  const inactiveCount = roles.filter(r => r.is_active === 0).length;

  // Filtered Roles
  const filteredRoles = useMemo(() => {
    return roles.filter((r) => {
      // Tab filter
      if (filterTab === 'ACTIVE' && r.is_active !== 1) return false;
      if (filterTab === 'INACTIVE' && r.is_active !== 0) return false;

      // Search filter across role name and category name
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = r.name.toLowerCase().includes(q);
        const matchesCat = (r.category_name || '').toLowerCase().includes(q);
        if (!matchesName && !matchesCat) return false;
      }
      return true;
    });
  }, [roles, filterTab, searchQuery]);

  // Group filtered roles by category
  const groupedByCategory = useMemo(() => {
    const map = new Map<string, { category: CategoryRecord; roles: RoleRecord[] }>();

    // Index all known categories
    categories.forEach((cat) => {
      map.set(cat.id, { category: cat, roles: [] });
    });

    // Distribute filtered roles
    filteredRoles.forEach((role) => {
      let group = map.get(role.category_id);
      if (!group) {
        // Fallback for unexpected or orphaned category
        const fallbackCat: CategoryRecord = {
          id: role.category_id,
          name: role.category_name || 'UNASSIGNED',
          sort_order: 99,
          is_active: 1,
          created_at: '',
          updated_at: '',
        };
        group = { category: fallbackCat, roles: [] };
        map.set(role.category_id, group);
      }
      group.roles.push(role);
    });

    // Return only categories that have matching roles or exist in categories list
    return Array.from(map.values()).filter((g) => g.roles.length > 0);
  }, [categories, filteredRoles]);

  // Role Add / Edit Handlers
  const openAddRoleModal = (categoryId?: string) => {
    setRoleForm({
      id: '',
      categoryId: categoryId || (categories.length > 0 ? categories[0].id : ''),
      name: '',
      defaultRateRupees: '',
    });
    setRoleFormError('');
    setRoleModalOpen(true);
  };

  const openEditRoleModal = (role: RoleRecord) => {
    setRoleForm({
      id: role.id,
      categoryId: role.category_id,
      name: role.name,
      defaultRateRupees: toRupees(role.default_rate_paise).toString(),
    });
    setRoleFormError('');
    setRoleModalOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setRoleFormError('');

    if (!roleForm.name.trim()) {
      setRoleFormError('Role name is required');
      return;
    }

    if (!roleForm.categoryId) {
      setRoleFormError('Please select a category');
      return;
    }

    const rateNum = parseFloat(roleForm.defaultRateRupees);
    if (isNaN(rateNum) || rateNum <= 0) {
      setRoleFormError('Please enter a valid daily wage rate greater than 0');
      return;
    }

    setRoleSubmitting(true);
    try {
      const defaultRatePaise = toPaise(rateNum);

      let res: Response;
      if (roleForm.id) {
        res = await fetch('/api/roles', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: roleForm.id,
            name: roleForm.name.trim(),
            categoryId: roleForm.categoryId,
            defaultRatePaise,
          }),
        });
      } else {
        res = await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roleForm.name.trim(),
            categoryId: roleForm.categoryId,
            defaultRatePaise,
          }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setRoleFormError(data.error || 'Failed to save role');
        return;
      }

      setRoleModalOpen(false);
      fetchMasterData();
    } catch (err: unknown) {
      setRoleFormError(err instanceof Error ? err.message : 'Error saving role');
    } finally {
      setRoleSubmitting(false);
    }
  };

  // Toggle Role Active / Inactive
  const handleToggleRoleActive = async (role: RoleRecord) => {
    const nextAction = role.is_active === 1 ? 'DEACTIVATE' : 'ACTIVATE';
    try {
      const res = await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: role.id, action: nextAction }),
      });
      if (res.ok) {
        fetchMasterData();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to update role status');
      }
    } catch (err) {
      alert('Error updating role status');
    }
  };

  // Archive Role
  const handleArchiveConfirm = async () => {
    if (!archiveModalRole) return;
    setArchiveSubmitting(true);
    try {
      const res = await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: archiveModalRole.id, action: 'ARCHIVE' }),
      });
      if (res.ok) {
        setArchiveModalRole(null);
        fetchMasterData();
      } else {
        const d = await res.json();
        alert(d.error || 'Failed to archive role');
      }
    } catch (err) {
      alert('Error archiving role');
    } finally {
      setArchiveSubmitting(false);
    }
  };

  // Move to Recycle Bin (Delete)
  const handleRecycleConfirm = async () => {
    if (!recycleModalRole) return;
    if (recycleConfirmInput.trim().toUpperCase() !== 'CONFIRM') return;

    setRecycleSubmitting(true);
    setRecycleError('');
    try {
      const res = await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: recycleModalRole.id, action: 'RECYCLE' }),
      });

      const data = await res.json();
      if (!res.ok) {
        setRecycleError(data.error || 'Failed to delete role');
        return;
      }

      setRecycleModalRole(null);
      setRecycleConfirmInput('');
      fetchMasterData();
    } catch (err: unknown) {
      setRecycleError(err instanceof Error ? err.message : 'Error deleting role');
    } finally {
      setRecycleSubmitting(false);
    }
  };

  const isRecycleConfirmed = recycleConfirmInput.trim().toUpperCase() === 'CONFIRM';

  // Site Rate Override Handlers (Preserved)
  const openSiteRateModal = (role: RoleRecord) => {
    setSelectedRoleForSiteRate(role);
    setSiteRateRupees(
      role.site_rate_paise !== null && role.site_rate_paise !== undefined
        ? toRupees(role.site_rate_paise).toString()
        : toRupees(role.default_rate_paise).toString()
    );
    setSiteRateError('');
    setSiteRateModalOpen(true);
  };

  const handleSaveSiteRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSiteId || !selectedRoleForSiteRate) return;

    const rateNum = parseFloat(siteRateRupees);
    if (isNaN(rateNum) || rateNum <= 0) {
      setSiteRateError('Please enter a valid wage rate greater than 0');
      return;
    }

    setSiteRateSubmitting(true);
    try {
      const ratePaise = toPaise(rateNum);
      const res = await fetch('/api/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: selectedSiteId,
          roleId: selectedRoleForSiteRate.id,
          ratePaise,
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        setSiteRateError(d.error || 'Failed to save site wage override');
        return;
      }

      setSiteRateModalOpen(false);
      fetchMasterData();
    } catch (err) {
      setSiteRateError('Failed to save site wage override');
    } finally {
      setSiteRateSubmitting(false);
    }
  };

  const handleRemoveSiteRate = async () => {
    if (!selectedSiteId || !selectedRoleForSiteRate) return;
    if (!confirm('Revert this role to the global default wage rate?')) return;

    setSiteRateSubmitting(true);
    try {
      await fetch(
        `/api/rates?siteId=${selectedSiteId}&roleId=${selectedRoleForSiteRate.id}`,
        { method: 'DELETE' }
      );
      setSiteRateModalOpen(false);
      fetchMasterData();
    } catch (err) {
      alert('Failed to reset site wage rate');
    } finally {
      setSiteRateSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Primary Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Master Data Setup
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5]">
            ROLES
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Configure default daily wage rates, category classification, and site rate overrides.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <Link
            href="/setup/categories"
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 border border-slate-900 dark:border-[#3A3D42] text-slate-800 dark:text-[#F2F3F5] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <Layers className="w-4 h-4 mr-1.5 text-slate-600 dark:text-[#B5BAC1] shrink-0" />
            CATEGORY
          </Link>

          <button
            type="button"
            onClick={() => openAddRoleModal()}
            className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <Plus className="w-4 h-4 mr-1.5 text-emerald-400 dark:text-[#0A0A0A] shrink-0" aria-hidden="true" />
            <span className="sr-only">+ </span>ROLE
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
            placeholder="Search roles or categories..."
            className="w-full min-h-[40px] pl-9 pr-3 text-xs bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] touch-action-manipulation"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading roles...
        </div>
      ) : groupedByCategory.length === 0 ? (
        <div className="p-8 text-center bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] text-slate-500 dark:text-[#949BA4] text-sm">
          No roles found matching your criteria.
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {groupedByCategory.map(({ category, roles: catRoles }) => (
            <div
              key={category.id}
              className={`rounded-xl border overflow-hidden shadow-sm ${
                category.is_active === 0
                  ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50/20 dark:bg-[#202225] opacity-75'
                  : 'bg-white dark:bg-[#18191C] border-slate-900 dark:border-[#3A3D42]'
              }`}
            >
              {/* Category Header */}
              <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                <div className="flex items-center space-x-2 sm:space-x-2.5 min-w-0">
                  <Layers className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                  <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                    {category.name}
                  </h2>
                  {category.is_active === 0 && (
                    <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded shrink-0">
                      DEACTIVATED CATEGORY
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  {catRoles.filter(r => r.is_active === 0).length > 0 && (
                    <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded shrink-0">
                      {catRoles.filter(r => r.is_active === 0).length} INACTIVE
                    </span>
                  )}
                  <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                    {catRoles.length} {catRoles.length === 1 ? 'ROLE' : 'ROLES'}
                  </span>
                </div>
              </div>

              {/* DESKTOP TABLE VIEW (>= 768px) */}
              <div className="hidden md:block overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                      <th className="py-2.5 px-4">Role Name</th>
                      <th className="py-2.5 px-4 text-right">Default Rate</th>
                      <th className="py-2.5 px-4 text-right">
                        {selectedSite?.name || 'Site'} Override
                      </th>
                      <th className="py-2.5 px-4 text-right">Effective Rate</th>
                      <th className="py-2.5 px-4 text-center">Usage</th>
                      <th className="py-2.5 px-4 text-center">Status</th>
                      <th className="py-2.5 px-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#2B2D31]">
                    {catRoles.map((r) => (
                      <tr 
                        key={r.id} 
                        className={`hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors ${
                          r.is_active === 0 ? 'bg-amber-50/15 dark:bg-[#202225]/40 opacity-70' : ''
                        }`}
                      >
                        <td className="py-3 px-4 font-bold text-slate-900 dark:text-[#F2F3F5] text-sm whitespace-nowrap">
                          {r.name}
                        </td>

                        <td className="py-3 px-4 text-right font-medium text-slate-700 dark:text-[#B5BAC1] whitespace-nowrap">
                          {formatINR(r.default_rate_paise)}/day
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {r.site_rate_paise !== null && r.site_rate_paise !== undefined ? (
                            <span className="font-bold text-blue-700 dark:text-[#38BDF8]">
                              {formatINR(r.site_rate_paise)}/day
                            </span>
                          ) : (
                            <span className="text-slate-400 dark:text-[#6A6F78]">Default</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-black text-slate-900 dark:text-[#1ED760] whitespace-nowrap">
                          {formatINR(r.effective_rate_paise || r.default_rate_paise)}/day
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span className="font-mono text-xs font-semibold text-slate-700 dark:text-[#B5BAC1]">
                            {r.total_worker_days ?? 0} d
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-[#949BA4] ml-1">
                            ({r.attendance_count ?? 0} recs)
                          </span>
                        </td>

                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          {r.is_active === 1 ? (
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
                              onClick={() => setDetailsRole(r)}
                              aria-label={`View details for ${r.name}`}
                              className="min-h-[36px] px-2.5 py-1 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] text-xs font-bold text-slate-700 dark:text-[#F2F3F5] rounded-lg transition-colors border border-slate-900 dark:border-[#3A3D42] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                              title="Role Details"
                            >
                              <Info className="w-3.5 h-3.5 inline mr-1" />
                              Details
                            </button>

                            {/* Site Rate Override */}
                            <button
                              type="button"
                              onClick={() => openSiteRateModal(r)}
                              className="min-h-[36px] px-2.5 py-1 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] text-xs font-bold text-blue-700 dark:text-[#38BDF8] rounded-lg transition-colors border border-slate-900 dark:border-[#3A3D42] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                              title="Set site-specific rate"
                            >
                              <Building2 className="w-3.5 h-3.5 inline mr-1" />
                              Site Rate
                            </button>

                            {/* Edit */}
                            <button
                              type="button"
                              onClick={() => openEditRoleModal(r)}
                              aria-label={`Edit ${r.name}`}
                              className="w-10 h-10 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                              title="Edit Role"
                            >
                              <Edit className="w-4 h-4" />
                            </button>

                            {/* Toggle Active / Inactive */}
                            <button
                              type="button"
                              onClick={() => handleToggleRoleActive(r)}
                              aria-label={r.is_active === 1 ? `Deactivate ${r.name}` : `Activate ${r.name}`}
                              className="w-10 h-10 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                              title={r.is_active === 1 ? 'Deactivate Role' : 'Activate Role'}
                            >
                              {r.is_active === 1 ? (
                                <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                              ) : (
                                <Eye className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                              )}
                            </button>

                            {/* Archive */}
                            <button
                              type="button"
                              onClick={() => setArchiveModalRole(r)}
                              aria-label={`Archive ${r.name}`}
                              className="w-10 h-10 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                              title="Archive Role"
                            >
                              <Archive className="w-4 h-4" />
                            </button>

                            {/* Delete (Recycle Bin) */}
                            <button
                              type="button"
                              onClick={() => {
                                setRecycleModalRole(r);
                                setRecycleConfirmInput('');
                                setRecycleError('');
                              }}
                              aria-label={`Delete ${r.name}`}
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
              <div className="md:hidden p-3 space-y-2.5">
                {catRoles.map((r) => (
                  <div
                    key={r.id}
                    className={`bg-slate-50 dark:bg-[#111214] p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] space-y-2.5 ${
                      r.is_active === 0 ? 'border-amber-300 dark:border-amber-700/60 opacity-80' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-black text-slate-900 dark:text-[#F2F3F5] text-sm block">{r.name}</span>
                        <span className="text-xs text-slate-500 dark:text-[#949BA4] block mt-0.5">
                          Default: {formatINR(r.default_rate_paise)}/day
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                          r.is_active === 1
                            ? 'bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] border border-transparent dark:border-[#1A7F3C]'
                            : 'bg-amber-100 dark:bg-[#2E2010] text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                        }`}
                      >
                        {r.is_active === 1 ? 'Active' : 'Inactive'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/60 dark:border-[#2B2D31]">
                      <span className="text-slate-600 dark:text-[#B5BAC1]">
                        Effective Rate: <strong className="text-slate-900 dark:text-[#1ED760] font-black">{formatINR(r.effective_rate_paise || r.default_rate_paise)}/day</strong>
                      </span>
                      {r.site_rate_paise !== null && r.site_rate_paise !== undefined && (
                        <span className="text-[11px] font-bold text-blue-700 dark:text-[#38BDF8] bg-blue-50 dark:bg-[#111214] px-1.5 py-0.5 rounded border border-blue-200 dark:border-[#3A3D42]">
                          Site Override
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-slate-500 dark:text-[#949BA4]">
                      Usage: <strong className="text-slate-700 dark:text-[#F2F3F5]">{r.total_worker_days ?? 0} worker-days</strong> across {r.attendance_count ?? 0} attendance records
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-slate-200/60 dark:border-[#2B2D31]">
                      <button
                        type="button"
                        onClick={() => setDetailsRole(r)}
                        className="min-h-[44px] px-3 py-1.5 bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] hover:bg-slate-100 dark:hover:bg-[#202225] text-xs font-bold text-slate-700 dark:text-[#F2F3F5] rounded-lg transition-colors touch-action-manipulation flex items-center"
                      >
                        <Info className="w-3.5 h-3.5 mr-1 text-slate-500" />
                        Details
                      </button>

                      <button
                        type="button"
                        onClick={() => openSiteRateModal(r)}
                        className="min-h-[44px] px-3 py-1.5 bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] hover:bg-slate-100 dark:hover:bg-[#202225] text-xs font-bold text-blue-700 dark:text-[#38BDF8] rounded-lg transition-colors touch-action-manipulation flex items-center"
                      >
                        <Building2 className="w-3.5 h-3.5 mr-1" />
                        Site Rate
                      </button>

                      <button
                        type="button"
                        onClick={() => openEditRoleModal(r)}
                        aria-label={`Edit role ${r.name}`}
                        className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-100 dark:hover:bg-[#202225] text-slate-600 dark:text-[#B5BAC1] rounded-lg transition-colors touch-action-manipulation"
                      >
                        <Edit className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleToggleRoleActive(r)}
                        aria-label={r.is_active === 1 ? `Deactivate role ${r.name}` : `Activate role ${r.name}`}
                        className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-100 dark:hover:bg-[#202225] text-slate-600 dark:text-[#B5BAC1] rounded-lg transition-colors touch-action-manipulation"
                      >
                        {r.is_active === 1 ? (
                          <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Eye className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setArchiveModalRole(r)}
                        aria-label={`Archive role ${r.name}`}
                        className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-600 dark:text-amber-400 rounded-lg transition-colors touch-action-manipulation"
                      >
                        <Archive className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setRecycleModalRole(r);
                          setRecycleConfirmInput('');
                          setRecycleError('');
                        }}
                        aria-label={`Delete role ${r.name}`}
                        className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-lg transition-colors touch-action-manipulation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 1. Add / Edit Role Modal */}
      {mounted && roleModalOpen ? createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 className="text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                {roleForm.id ? 'Edit Role' : 'Add New Role'}
              </h3>
              <button
                type="button"
                onClick={() => setRoleModalOpen(false)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-[#949BA4] hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-4 pt-4 text-xs">
              {roleFormError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg text-rose-700 dark:text-rose-400 font-semibold">
                  {roleFormError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Category *
                </label>
                <select
                  required
                  value={roleForm.categoryId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRoleForm((prev) => ({ ...prev, categoryId: val }));
                  }}
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
                >
                  <option value="">Select Category...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.is_active === 0 ? '(Inactive)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Role Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Master Mason, Electrician Grade 1"
                  value={roleForm.name}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRoleForm((prev) => ({ ...prev, name: val }));
                  }}
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Default Daily Wage Rate (₹) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 850"
                  value={roleForm.defaultRateRupees}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRoleForm((prev) => ({ ...prev, defaultRateRupees: val }));
                  }}
                  className="w-full min-h-[44px] bg-slate-50 dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg px-3 py-2 text-xs font-black focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2.5 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setRoleModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={roleSubmitting}
                  className="min-h-[44px] px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white rounded-lg text-xs font-bold border border-slate-900 dark:border-transparent transition-colors disabled:opacity-50 touch-action-manipulation"
                >
                  {roleSubmitting ? 'Saving...' : roleForm.id ? 'Save Changes' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 2. Role Details Modal */}
      {mounted && detailsRole ? createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl shadow-2xl max-w-md w-full border border-slate-900 dark:border-[#3A3D42] my-auto overflow-hidden">
            <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <Info className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                <h3 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                  Role Intelligence Details
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailsRole(null)}
                aria-label="Close"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white dark:hover:text-[#F2F3F5] hover:bg-slate-800 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Role Name</div>
                <div className="text-sm font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5">{detailsRole.name}</div>
                <div className="text-[11px] text-slate-500 dark:text-[#949BA4] mt-0.5">Category: {detailsRole.category_name}</div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Default Wage</div>
                  <div className="text-sm font-black text-slate-900 dark:text-[#F2F3F5] mt-0.5">
                    {formatINR(detailsRole.default_rate_paise)}/day
                  </div>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg">
                  <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Status</div>
                  <div className="text-xs font-black mt-0.5">
                    {detailsRole.is_active === 1 ? (
                      <span className="text-emerald-700 dark:text-[#1ED760]">ACTIVE</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">INACTIVE</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Usage Stats */}
              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg space-y-1.5">
                <div className="text-[11px] font-bold text-slate-500 dark:text-[#949BA4] uppercase">Historical Usage Statistics</div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60 dark:border-[#2B2D31]">
                  <span className="text-slate-600 dark:text-[#B5BAC1]">Attendance Records:</span>
                  <strong className="text-slate-900 dark:text-[#F2F3F5]">{detailsRole.attendance_count ?? 0}</strong>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60 dark:border-[#2B2D31]">
                  <span className="text-slate-600 dark:text-[#B5BAC1]">Total Worker-Days:</span>
                  <strong className="text-slate-900 dark:text-[#F2F3F5]">{detailsRole.total_worker_days ?? 0}</strong>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60 dark:border-[#2B2D31]">
                  <span className="text-slate-600 dark:text-[#B5BAC1]">Total Labour Cost:</span>
                  <strong className="text-emerald-700 dark:text-[#1ED760]">{formatINR(detailsRole.total_cost_paise ?? 0)}</strong>
                </div>
                <div className="flex justify-between items-center py-0.5 border-b border-slate-200/60 dark:border-[#2B2D31]">
                  <span className="text-slate-600 dark:text-[#B5BAC1]">Sites Deployed:</span>
                  <strong className="text-slate-900 dark:text-[#F2F3F5]">{detailsRole.sites_used_count ?? 0}</strong>
                </div>
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-slate-600 dark:text-[#B5BAC1]">Site-Specific Overrides:</span>
                  <strong className="text-blue-700 dark:text-[#38BDF8]">{detailsRole.site_override_count ?? 0}</strong>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg text-slate-500 dark:text-[#949BA4] space-y-1 font-mono text-[11px]">
                <div>ID: {detailsRole.id}</div>
                <div>Created: {detailsRole.created_at}</div>
                <div>Updated: {detailsRole.updated_at}</div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setDetailsRole(null)}
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
      {mounted && archiveModalRole ? createPortal(
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
                  Archive Role
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setArchiveModalRole(null)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-3.5 text-xs">
              <p className="text-slate-700 dark:text-[#B5BAC1]">
                Are you sure you want to archive role <strong className="text-slate-900 dark:text-[#F2F3F5]">{archiveModalRole.name}</strong>?
              </p>

              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg text-amber-800 dark:text-amber-300">
                Archived roles will not appear in daily attendance input. All historical attendance logs, payroll calculations, and financial reports will retain their records. You can restore archived roles anytime.
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setArchiveModalRole(null)}
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
                  {archiveSubmitting ? 'Archiving...' : 'Archive Role'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {/* 4. Move to Recycle Bin (Delete) Modal with exact CONFIRM requirement */}
      {mounted && recycleModalRole ? createPortal(
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
                  Move Role to Recycle Bin
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRecycleModalRole(null)}
                className="w-9 h-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-[#F2F3F5] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 pt-3.5 text-xs">
              <p className="text-slate-700 dark:text-[#B5BAC1]">
                Are you sure you want to delete role <strong className="text-slate-900 dark:text-[#F2F3F5]">{recycleModalRole.name}</strong>?
              </p>

              <div className="p-3 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#2B2D31] rounded-lg text-slate-600 dark:text-[#949BA4]">
                This role will be moved to the Recycle Bin. Items can be restored at any time or permanently removed later. Historical attendance remains linked.
              </div>

              {recycleError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg text-rose-700 dark:text-rose-400 font-semibold">
                  {recycleError}
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
                  onClick={() => setRecycleModalRole(null)}
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

      {/* 5. Site Rate Override Modal (Preserved & Working) */}
      {mounted && siteRateModalOpen && selectedRoleForSiteRate ? createPortal(
        <div 
          className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl shadow-2xl max-w-md w-full border border-slate-900 dark:border-[#3A3D42] my-auto overflow-hidden">
            <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <IndianRupee className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                <h3 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                  Site Wage Override
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSiteRateModalOpen(false)}
                aria-label="Close"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-white dark:hover:text-[#F2F3F5] hover:bg-slate-800 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6">
              <form onSubmit={handleSaveSiteRate} className="space-y-3 sm:space-y-4 text-xs">
                {siteRateError && (
                  <div className="p-3 bg-red-50 dark:bg-[#2A1215] border border-red-200 dark:border-[#6E1C24] rounded-lg text-red-700 dark:text-[#F87171] font-semibold">
                    {siteRateError}
                  </div>
                )}

                <div className="bg-slate-50 dark:bg-[#111214] p-3 rounded-lg border border-slate-900 dark:border-[#3A3D42] text-xs space-y-1">
                  <div>
                    <span className="font-semibold text-slate-500 dark:text-[#949BA4]">Target Role: </span>
                    <strong className="text-slate-900 dark:text-[#F2F3F5] font-bold">{selectedRoleForSiteRate.name}</strong>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 dark:text-[#949BA4]">Active Site: </span>
                    <strong className="text-slate-900 dark:text-[#F2F3F5] font-bold">{selectedSite?.name || 'Selected Site'}</strong>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500 dark:text-[#949BA4]">Global Default Rate: </span>
                    <span className="text-slate-800 dark:text-[#B5BAC1]">{formatINR(selectedRoleForSiteRate.default_rate_paise)}/day</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                    Site-Specific Daily Wage Rate (₹) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={siteRateRupees}
                    onChange={(e) => setSiteRateRupees(e.target.value)}
                    className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg px-3 py-2 text-xs font-black focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none touch-action-manipulation"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-[#949BA4] mt-1">
                    Overrides default rate for attendance recorded at this site only.
                  </p>
                </div>

                <div className="pt-3 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-[#2B2D31]">
                  {selectedRoleForSiteRate.site_rate_paise !== null && selectedRoleForSiteRate.site_rate_paise !== undefined ? (
                    <button
                      type="button"
                      onClick={handleRemoveSiteRate}
                      className="min-h-[44px] px-3 py-2 text-rose-600 dark:text-[#F87171] hover:text-rose-800 dark:hover:text-[#EF4444] text-xs font-bold touch-action-manipulation"
                    >
                      Reset to Default
                    </button>
                  ) : <div />}

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setSiteRateModalOpen(false)}
                      className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={siteRateSubmitting}
                      className="min-h-[44px] px-5 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white rounded-lg text-xs font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation"
                    >
                      {siteRateSubmitting ? 'Saving...' : 'Apply Site Rate'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
