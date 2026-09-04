'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSite } from '@/context/site-context';
import { formatINR, toRupees, toPaise } from '@/lib/domain/money';
import { CategoryRecord, RoleRecord } from '@/lib/db/repositories/role-repo';
import { 
  Plus, 
  Edit, 
  X, 
  Eye, 
  EyeOff
} from 'lucide-react';

export default function RolesManagementPage() {
  const { selectedSite, selectedSiteId } = useSite();
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  // Category Modal
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catForm, setCatForm] = useState({ id: '', name: '' });

  // Role Modal
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [roleForm, setRoleForm] = useState({
    id: '',
    categoryId: '',
    name: '',
    defaultRateRupees: '',
  });

  // Site Rate Override Modal
  const [siteRateModalOpen, setSiteRateModalOpen] = useState(false);
  const [selectedRoleForSiteRate, setSelectedRoleForSiteRate] = useState<RoleRecord | null>(null);
  const [siteRateRupees, setSiteRateRupees] = useState('');

  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchMasterData = useCallback(async () => {
    setLoading(true);
    try {
      const catRes = await fetch(`/api/categories?includeInactive=true`);
      if (catRes.ok) {
        const d = await catRes.json();
        setCategories(d.categories || []);
      }

      const roleUrl = selectedSiteId
        ? `/api/roles?siteId=${selectedSiteId}&includeInactive=true`
        : `/api/roles?includeInactive=true`;

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

  // Category Handlers
  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catForm.name.trim()) return;
    setSubmitting(true);
    try {
      if (catForm.id) {
        await fetch('/api/categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: catForm.id, name: catForm.name }),
        });
      } else {
        await fetch('/api/categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: catForm.name }),
        });
      }
      setCatModalOpen(false);
      fetchMasterData();
    } catch (err) {
      alert('Failed to save category');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleCategory = async (cat: CategoryRecord) => {
    const nextActive = cat.is_active === 1 ? false : true;
    try {
      await fetch('/api/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cat.id, isActive: nextActive }),
      });
      fetchMasterData();
    } catch (err) {
      alert('Failed to toggle category');
    }
  };

  // Role Handlers
  const openAddRoleModal = (categoryId?: string) => {
    setRoleForm({
      id: '',
      categoryId: categoryId || (categories.length > 0 ? categories[0].id : ''),
      name: '',
      defaultRateRupees: '',
    });
    setFormError('');
    setRoleModalOpen(true);
  };

  const openEditRoleModal = (role: RoleRecord) => {
    setRoleForm({
      id: role.id,
      categoryId: role.category_id,
      name: role.name,
      defaultRateRupees: toRupees(role.default_rate_paise).toString(),
    });
    setFormError('');
    setRoleModalOpen(true);
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const rateNum = parseFloat(roleForm.defaultRateRupees);
    if (isNaN(rateNum) || rateNum <= 0) {
      setFormError('Please enter a valid wage rate greater than 0');
      return;
    }

    setSubmitting(true);
    try {
      const defaultRatePaise = toPaise(rateNum);

      if (roleForm.id) {
        await fetch('/api/roles', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: roleForm.id,
            name: roleForm.name,
            categoryId: roleForm.categoryId,
            defaultRatePaise,
          }),
        });
      } else {
        await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roleForm.name,
            categoryId: roleForm.categoryId,
            defaultRatePaise,
          }),
        });
      }

      setRoleModalOpen(false);
      fetchMasterData();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error saving role');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleRole = async (role: RoleRecord) => {
    const nextActive = role.is_active === 1 ? false : true;
    try {
      await fetch('/api/roles', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: role.id, isActive: nextActive }),
      });
      fetchMasterData();
    } catch (err) {
      alert('Failed to toggle role');
    }
  };

  // Site Rate Override Handlers
  const openSiteRateModal = (role: RoleRecord) => {
    setSelectedRoleForSiteRate(role);
    setSiteRateRupees(
      role.site_rate_paise !== null && role.site_rate_paise !== undefined
        ? toRupees(role.site_rate_paise).toString()
        : toRupees(role.default_rate_paise).toString()
    );
    setFormError('');
    setSiteRateModalOpen(true);
  };

  const handleSaveSiteRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSiteId || !selectedRoleForSiteRate) return;

    const rateNum = parseFloat(siteRateRupees);
    if (isNaN(rateNum) || rateNum <= 0) {
      setFormError('Please enter a valid wage rate greater than 0');
      return;
    }

    setSubmitting(true);
    try {
      const ratePaise = toPaise(rateNum);
      await fetch('/api/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: selectedSiteId,
          roleId: selectedRoleForSiteRate.id,
          ratePaise,
        }),
      });

      setSiteRateModalOpen(false);
      fetchMasterData();
    } catch (err) {
      setFormError('Failed to save site wage override');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveSiteRate = async () => {
    if (!selectedSiteId || !selectedRoleForSiteRate) return;
    if (!confirm('Revert this role to the global default wage rate?')) return;

    setSubmitting(true);
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
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] block">
            Master Data Setup
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-[#F2F3F5]">
            Work Categories, Roles &amp; Rates
          </h1>
          <p className="text-xs text-slate-500 dark:text-[#949BA4] mt-0.5">
            Configure default daily wage rates and site-specific rate overrides.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          <label className="flex items-center space-x-2 text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] cursor-pointer min-h-[44px] px-2 touch-action-manipulation">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="w-4 h-4 rounded border-slate-900 dark:border-[#3A3D42] text-emerald-600 focus:ring-slate-900 dark:focus:ring-[#1ED760] dark:bg-[#111214]"
            />
            <span>Show Deactivated</span>
          </label>

          <button
            type="button"
            onClick={() => {
              setCatForm({ id: '', name: '' });
              setCatModalOpen(true);
            }}
            className="inline-flex items-center justify-center min-h-[44px] px-3.5 py-2 bg-white dark:bg-[#202225] hover:bg-slate-100 dark:hover:bg-[#2B2D31] active:bg-slate-200 border border-slate-900 dark:border-[#3A3D42] text-slate-800 dark:text-[#F2F3F5] text-xs sm:text-sm font-bold rounded-lg shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <Plus className="w-4 h-4 mr-1 text-slate-600 dark:text-[#B5BAC1] shrink-0" />
            Add Category
          </button>

          <button
            type="button"
            onClick={() => openAddRoleModal()}
            className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 active:bg-black dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white text-xs sm:text-sm font-bold rounded-lg border border-slate-900 dark:border-transparent shadow-sm transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <Plus className="w-4 h-4 mr-1 text-emerald-400 dark:text-[#0A0A0A] shrink-0" />
            Add Role
          </button>
        </div>
      </div>

      {/* Role List Grouped by Category */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-[#949BA4] font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading master roles...
        </div>
      ) : (
        <div className="space-y-4 sm:space-y-6">
          {categories
            .filter((c) => (showInactive ? true : c.is_active === 1))
            .map((cat) => {
              const catRoles = roles.filter(
                (r) => r.category_id === cat.id && (showInactive ? true : r.is_active === 1)
              );

              return (
                <div
                  key={cat.id}
                  className={`rounded-xl border overflow-hidden shadow-sm ${
                    cat.is_active === 0
                      ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50/20 dark:bg-[#202225] opacity-60'
                      : 'bg-white dark:bg-[#18191C] border-slate-900 dark:border-[#3A3D42]'
                  }`}
                >
                  {/* Category Header */}
                  <div className="bg-slate-100 dark:bg-[#202225] px-4 sm:px-5 py-3 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div className="flex items-center space-x-2">
                      <h2 className="text-xs sm:text-sm font-black text-slate-900 dark:text-[#F2F3F5] uppercase tracking-wider">
                        {cat.name}
                      </h2>
                      {cat.is_active === 0 && (
                        <span className="text-[10px] font-bold bg-amber-200 text-amber-900 dark:bg-amber-900/60 dark:text-amber-200 px-2 py-0.5 rounded">
                          DEACTIVATED
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCatForm({ id: cat.id, name: cat.name });
                          setCatModalOpen(true);
                        }}
                        aria-label={`Rename category ${cat.name}`}
                        className="w-11 h-11 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1ED760] touch-action-manipulation"
                        title="Rename Category"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleCategory(cat)}
                        aria-label={cat.is_active === 1 ? `Deactivate category ${cat.name}` : `Activate category ${cat.name}`}
                        className="w-11 h-11 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                        title={cat.is_active === 1 ? 'Deactivate Category' : 'Activate Category'}
                      >
                        {cat.is_active === 1 ? (
                          <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Eye className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Dual Presentation (Desktop Table vs Mobile Cards) */}
                  {catRoles.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 dark:text-[#949BA4] text-xs sm:text-sm">
                      No roles configured in this category.
                    </div>
                  ) : (
                    <>
                      {/* DESKTOP / TABLET VIEW: High-density Table */}
                      <div className="hidden md:block overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-[#949BA4] border-b border-slate-900 dark:border-[#3A3D42]">
                              <th className="py-2.5 px-4">Role Name</th>
                              <th className="py-2.5 px-4 text-right">Default Rate</th>
                              <th className="py-2.5 px-4 text-right">
                                {selectedSite?.name || 'Site'} Rate Override
                              </th>
                              <th className="py-2.5 px-4 text-right">Effective Rate</th>
                              <th className="py-2.5 px-4 text-center">Status</th>
                              <th className="py-2.5 px-4 text-center">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-[#2B2D31]">
                            {catRoles.map((r) => (
                              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
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
                                  {r.is_active === 1 ? (
                                    <span className="text-[10px] font-bold bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] px-2 py-0.5 rounded border border-transparent dark:border-[#1A7F3C]">
                                      Active
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold bg-slate-200 dark:bg-[#2B2D31] text-slate-700 dark:text-[#949BA4] px-2 py-0.5 rounded">
                                      Inactive
                                    </span>
                                  )}
                                </td>
                                <td className="py-3 px-4 text-center whitespace-nowrap">
                                  <div className="inline-flex items-center space-x-1">
                                    <button
                                      type="button"
                                      onClick={() => openSiteRateModal(r)}
                                      className="min-h-[36px] px-2.5 py-1 bg-slate-100 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] text-xs font-bold text-blue-700 dark:text-[#38BDF8] rounded-lg transition-colors border border-slate-900 dark:border-[#3A3D42] focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                                      title="Set site-specific rate"
                                    >
                                      Site Rate
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditRoleModal(r)}
                                      aria-label={`Edit role ${r.name}`}
                                      className="w-11 h-11 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                                      title="Edit Role & Default Rate"
                                    >
                                      <Edit className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleRole(r)}
                                      aria-label={r.is_active === 1 ? `Deactivate role ${r.name}` : `Activate role ${r.name}`}
                                      className="w-11 h-11 inline-flex items-center justify-center text-slate-500 dark:text-[#949BA4] hover:text-slate-900 dark:hover:text-[#F2F3F5] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                                      title={r.is_active === 1 ? 'Deactivate Role' : 'Activate Role'}
                                    >
                                      {r.is_active === 1 ? (
                                        <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                      ) : (
                                        <Eye className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                                      )}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* MOBILE VIEW: Stacked Responsive Cards (< 768px) */}
                      <div className="md:hidden p-3 space-y-2.5">
                        {catRoles.map((r) => (
                          <div
                            key={r.id}
                            className="bg-slate-50 dark:bg-[#111214] p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] space-y-2.5"
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
                                    : 'bg-slate-200 dark:bg-[#2B2D31] text-slate-700 dark:text-[#949BA4]'
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

                            <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-200/60 dark:border-[#2B2D31]">
                              <button
                                type="button"
                                onClick={() => openSiteRateModal(r)}
                                className="min-h-[44px] px-3 py-1.5 bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] hover:bg-slate-100 dark:hover:bg-[#202225] text-xs font-bold text-blue-700 dark:text-[#38BDF8] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                              >
                                Site Rate
                              </button>

                              <button
                                type="button"
                                onClick={() => openEditRoleModal(r)}
                                aria-label={`Edit role ${r.name}`}
                                className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-100 dark:hover:bg-[#202225] text-slate-600 dark:text-[#B5BAC1] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                                title="Edit Role"
                              >
                                <Edit className="w-4 h-4" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleRole(r)}
                                aria-label={r.is_active === 1 ? `Deactivate role ${r.name}` : `Activate role ${r.name}`}
                                className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-white dark:bg-[#18191C] hover:bg-slate-100 dark:hover:bg-[#202225] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                                title={r.is_active === 1 ? 'Deactivate Role' : 'Activate Role'}
                              >
                                {r.is_active === 1 ? (
                                  <EyeOff className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                ) : (
                                  <Eye className="w-4 h-4 text-emerald-600 dark:text-[#1ED760]" />
                                )}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* 1. Category Modal */}
      {catModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="category-modal-title" className="text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                {catForm.id ? 'Rename Category' : 'Create Category'}
              </h3>
              <button
                type="button"
                onClick={() => setCatModalOpen(false)}
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-[#949BA4] hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Category Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Masonry, Electrical, Plumbing"
                  value={catForm.name}
                  onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setCatModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  {submitting ? 'Saving...' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Role Modal */}
      {roleModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="role-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="role-modal-title" className="text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                {roleForm.id ? 'Edit Master Role' : 'Add New Role'}
              </h3>
              <button
                type="button"
                onClick={() => setRoleModalOpen(false)}
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-[#949BA4] hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRole} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-[#2A1215] border border-red-200 dark:border-[#6E1C24] rounded-lg text-red-700 dark:text-[#F87171] text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-[#B5BAC1] uppercase mb-1">
                  Category
                </label>
                <select
                  value={roleForm.categoryId}
                  onChange={(e) => setRoleForm({ ...roleForm, categoryId: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-bold bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-[#F2F3F5] focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id} className="dark:bg-[#18191C] dark:text-[#F2F3F5]">
                      {c.name}
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
                  onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-bold focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
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
                  onChange={(e) => setRoleForm({ ...roleForm, defaultRateRupees: e.target.value })}
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-black focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setRoleModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                >
                  {submitting ? 'Saving...' : 'Save Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Site Rate Override Modal */}
      {siteRateModalOpen && selectedRoleForSiteRate && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="site-rate-modal-title"
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="site-rate-modal-title" className="text-base font-black text-slate-900 dark:text-[#F2F3F5] uppercase">
                Site Wage Override
              </h3>
              <button
                type="button"
                onClick={() => setSiteRateModalOpen(false)}
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-[#949BA4] hover:text-slate-700 dark:hover:text-[#F2F3F5] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveSiteRate} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-[#2A1215] border border-red-200 dark:border-[#6E1C24] rounded-lg text-red-700 dark:text-[#F87171] text-xs font-semibold">
                  {formError}
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
                  className="w-full min-h-[44px] bg-white dark:bg-[#111214] border border-slate-900 dark:border-[#3A3D42] text-slate-900 dark:text-[#F2F3F5] rounded-lg p-2.5 text-base sm:text-sm font-black focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:outline-none input-no-zoom touch-action-manipulation"
                />
                <p className="text-[11px] text-slate-500 dark:text-[#949BA4] mt-1">
                  Overrides default rate for attendance recorded at this site only.
                </p>
              </div>

              <div className="pt-2 sm:pt-3 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-[#2B2D31]">
                {selectedRoleForSiteRate.site_rate_paise !== null && selectedRoleForSiteRate.site_rate_paise !== undefined ? (
                  <button
                    type="button"
                    onClick={handleRemoveSiteRate}
                    className="min-h-[44px] px-3 py-2 text-rose-600 dark:text-[#F87171] hover:text-rose-800 dark:hover:text-[#EF4444] text-xs sm:text-sm font-bold touch-action-manipulation"
                  >
                    Reset to Default
                  </button>
                ) : <div />}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSiteRateModalOpen(false)}
                    className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-[#B5BAC1] hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-[44px] px-5 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-[#0A0A0A] text-white rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
                  >
                    {submitting ? 'Saving...' : 'Apply Site Rate'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
