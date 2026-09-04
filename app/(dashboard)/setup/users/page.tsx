'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSite } from '@/context/site-context';
import { 
  UserPlus, 
  Edit, 
  KeyRound, 
  X, 
  UserCheck, 
  UserX,
  User as UserIcon,
  Trash2
} from 'lucide-react';

interface UserItem {
  id: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  recoveryEmail: string | null;
  isActive: boolean;
  assignedSiteIds: string[];
  createdAt: string;
}

export default function UsersManagementPage() {
  const { user: currentUser, sites } = useSite();
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false);
  const [changeUsernameModalOpen, setChangeUsernameModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Target User for actions
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  // Create User Form
  const [createForm, setCreateForm] = useState({
    username: '',
    fullName: '',
    password: '',
    confirmPassword: '',
    role: 'SITE_MANAGER' as 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
    recoveryEmail: '',
    siteIds: [] as string[],
  });

  // Edit User Form
  const [editForm, setEditForm] = useState({
    id: '',
    fullName: '',
    role: 'SITE_MANAGER' as 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
    isActive: true,
    recoveryEmail: '',
    siteIds: [] as string[],
  });

  // Reset Password Form
  const [resetPasswordForm, setResetPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  // Change Username Form
  const [changeUsernameForm, setChangeUsernameForm] = useState({
    newUsername: '',
  });

  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const d = await res.json();
        setUsers(d.users || []);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // 1. Handle Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (createForm.password !== createForm.confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    if (createForm.password.length < 8) {
      setFormError('Password must be at least 8 characters long');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createForm.username.trim(),
          fullName: createForm.fullName.trim(),
          password: createForm.password,
          role: createForm.role,
          recoveryEmail: createForm.recoveryEmail.trim() || null,
          assignedSiteIds: createForm.role === 'ADMIN' ? [] : createForm.siteIds,
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to create user');

      setCreateModalOpen(false);
      setCreateForm({
        username: '',
        fullName: '',
        password: '',
        confirmPassword: '',
        role: 'SITE_MANAGER',
        recoveryEmail: '',
        siteIds: [],
      });
      fetchUsers();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error creating user');
    } finally {
      setSubmitting(false);
    }
  };

  // 2. Handle Edit User
  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editForm.id,
          fullName: editForm.fullName.trim(),
          role: editForm.role,
          isActive: editForm.isActive,
          recoveryEmail: editForm.recoveryEmail.trim() || null,
          assignedSiteIds: editForm.role === 'ADMIN' ? [] : editForm.siteIds,
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to update user');

      setEditModalOpen(false);
      fetchUsers();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error updating user');
    } finally {
      setSubmitting(false);
    }
  };

  // 3. Handle Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setFormError('');

    if (resetPasswordForm.newPassword.length < 8) {
      setFormError('New password must be at least 8 characters long');
      return;
    }

    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          action: 'RESET_PASSWORD',
          newPassword: resetPasswordForm.newPassword,
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to reset password');

      setResetPasswordModalOpen(false);
      alert(`Password successfully reset for @${selectedUser.username}`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error resetting password');
    } finally {
      setSubmitting(false);
    }
  };

  // 4. Handle Change Username
  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setFormError('');

    if (!changeUsernameForm.newUsername.trim()) {
      setFormError('New username is required');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          action: 'CHANGE_USERNAME',
          newUsername: changeUsernameForm.newUsername.trim(),
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to change username');

      setChangeUsernameModalOpen(false);
      fetchUsers();
      alert(`Username successfully updated to @${changeUsernameForm.newUsername}`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error changing username');
    } finally {
      setSubmitting(false);
    }
  };

  // 5. Handle Delete User
  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    setFormError('');
    setSubmitting(true);

    try {
      const res = await fetch(`/api/users?id=${selectedUser.id}`, {
        method: 'DELETE',
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to delete user');

      setDeleteModalOpen(false);
      fetchUsers();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error deleting user');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header & Controls */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
            System Administration
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            User Accounts &amp; Access Control
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Manage personnel, assign site-level permissions, and enforce security policies.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError('');
            setCreateModalOpen(true);
          }}
          className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] active:bg-black dark:active:bg-[#17a34a] text-white dark:text-black text-xs sm:text-sm font-bold rounded-lg shadow-sm border border-slate-900 dark:border-[#1ED760]/30 transition-colors shrink-0 touch-action-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
        >
          <UserPlus className="w-4 h-4 mr-1.5 text-emerald-400 dark:text-black shrink-0" />
          Create User Account
        </button>
      </div>

      {/* Users Presentation (Desktop Table vs Mobile Cards) */}
      {loading ? (
        <div className="py-12 text-center text-slate-500 dark:text-zinc-400 font-semibold text-sm bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42]">
          Loading user accounts...
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-8 sm:p-12 rounded-xl border border-slate-900 dark:border-[#3A3D42] text-center text-slate-500 dark:text-zinc-400 text-sm shadow-sm">
          No user accounts found. Click &quot;Create User Account&quot; to provision one.
        </div>
      ) : (
        <>
          {/* DESKTOP / TABLET VIEW: High-density Table */}
          <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-[#111214] text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 border-b border-slate-900 dark:border-[#3A3D42]">
                    <th className="py-3 px-4">User Details</th>
                    <th className="py-3 px-3">Role</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4">Assigned Sites</th>
                    <th className="py-3 px-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-[#2B2D31] font-medium">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-[#202225] transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-bold text-slate-900 dark:text-white text-sm">{u.fullName}</div>
                        <div className="text-xs text-slate-500 dark:text-zinc-400 font-mono">@{u.username}</div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                            u.role === 'ADMIN'
                              ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60'
                              : u.role === 'SITE_MANAGER'
                              ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300 border border-blue-300 dark:border-blue-700/60'
                              : 'bg-slate-100 dark:bg-[#202225] text-slate-800 dark:text-zinc-300 border border-slate-900 dark:border-[#3A3D42]'
                          }`}
                        >
                          {u.role === 'SITE_MANAGER' ? 'Engineer' : u.role}
                        </span>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.isActive
                              ? 'bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] border border-emerald-300 dark:border-[#1A7F3C]/60'
                              : 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700/60'
                          }`}
                        >
                          {u.isActive ? (
                            <>
                              <UserCheck className="w-3 h-3 text-emerald-600 dark:text-[#1ED760]" />
                              <span>Active</span>
                            </>
                          ) : (
                            <>
                              <UserX className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                              <span>Disabled</span>
                            </>
                          )}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-slate-600 dark:text-zinc-300">
                        {u.role === 'ADMIN' ? (
                          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">All Sites (Global Access)</span>
                        ) : u.assignedSiteIds.length === 0 ? (
                          <span className="text-slate-400 dark:text-zinc-500 italic">No assigned sites</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {u.assignedSiteIds.map((sId) => {
                              const siteObj = sites.find((s) => s.id === sId);
                              return (
                                <span
                                  key={sId}
                                  className="inline-block bg-slate-100 dark:bg-[#202225] border border-slate-900 dark:border-[#2B2D31] text-slate-800 dark:text-zinc-300 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                >
                                  {siteObj?.name || sId}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center space-x-1">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUser(u);
                              setEditForm({
                                id: u.id,
                                fullName: u.fullName,
                                role: u.role,
                                isActive: u.isActive,
                                recoveryEmail: u.recoveryEmail || '',
                                siteIds: u.assignedSiteIds,
                              });
                              setFormError('');
                              setEditModalOpen(true);
                            }}
                            aria-label={`Edit user ${u.fullName}`}
                            className="w-11 h-11 inline-flex items-center justify-center text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                            title="Edit Profile & Permissions"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUser(u);
                              setResetPasswordForm({ newPassword: '', confirmPassword: '' });
                              setFormError('');
                              setResetPasswordModalOpen(true);
                            }}
                            aria-label={`Reset password for ${u.fullName}`}
                            className="w-11 h-11 inline-flex items-center justify-center text-amber-600 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/40 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                            title="Reset Password"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSelectedUser(u);
                              setChangeUsernameForm({ newUsername: u.username });
                              setFormError('');
                              setChangeUsernameModalOpen(true);
                            }}
                            aria-label={`Change username for ${u.fullName}`}
                            className="w-11 h-11 inline-flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-950/40 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 touch-action-manipulation"
                            title="Change Username"
                          >
                            <UserIcon className="w-4 h-4" />
                          </button>

                          {currentUser?.id !== u.id && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedUser(u);
                                setFormError('');
                                setDeleteModalOpen(true);
                              }}
                              aria-label={`Delete user ${u.fullName}`}
                              className="w-11 h-11 inline-flex items-center justify-center text-rose-500 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-950/40 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 touch-action-manipulation"
                              title="Delete User Account"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* MOBILE VIEW: Stacked Responsive Cards (< 768px) */}
          <div className="md:hidden space-y-3">
            {users.map((u) => (
              <div
                key={u.id}
                className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-3"
              >
                {/* Top: Identity & Status */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-[#2B2D31] pb-2.5">
                  <div>
                    <div className="font-black text-slate-900 dark:text-white text-sm leading-snug">{u.fullName}</div>
                    <div className="text-xs text-slate-500 dark:text-zinc-400 font-mono mt-0.5">@{u.username}</div>
                  </div>

                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                        u.role === 'ADMIN'
                          ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60'
                          : u.role === 'SITE_MANAGER'
                          ? 'bg-blue-100 dark:bg-blue-950/40 text-blue-900 dark:text-blue-300 border border-blue-300 dark:border-blue-700/60'
                          : 'bg-slate-100 dark:bg-[#202225] text-slate-800 dark:text-zinc-300 border border-slate-900 dark:border-[#3A3D42]'
                      }`}
                    >
                      {u.role === 'SITE_MANAGER' ? 'Engineer' : u.role}
                    </span>

                    <span
                      className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        u.isActive
                          ? 'bg-emerald-100 dark:bg-[#0F291B] text-emerald-800 dark:text-[#1ED760] border border-emerald-300 dark:border-[#1A7F3C]/60'
                          : 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-700/60'
                      }`}
                    >
                      {u.isActive ? (
                        <>
                          <UserCheck className="w-2.5 h-2.5 text-emerald-600 dark:text-[#1ED760]" />
                          <span>Active</span>
                        </>
                      ) : (
                        <>
                          <UserX className="w-2.5 h-2.5 text-rose-600 dark:text-rose-400" />
                          <span>Disabled</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>

                {/* Middle: Assigned Sites */}
                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase text-slate-500 dark:text-zinc-400 block">Assigned Sites</span>
                  {u.role === 'ADMIN' ? (
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400">All Sites (Global Access)</span>
                  ) : u.assignedSiteIds.length === 0 ? (
                    <span className="text-xs text-slate-400 dark:text-zinc-500 italic">No assigned sites</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.assignedSiteIds.map((sId) => {
                        const siteObj = sites.find((s) => s.id === sId);
                        return (
                          <span
                            key={sId}
                            className="inline-block bg-slate-100 dark:bg-[#202225] border border-slate-900 dark:border-[#2B2D31] text-slate-800 dark:text-zinc-300 px-2 py-0.5 rounded text-[11px] font-semibold"
                          >
                            {siteObj?.name || sId}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Bottom: Action Buttons with explicit 44x44 hit targets */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#2B2D31]">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUser(u);
                      setEditForm({
                        id: u.id,
                        fullName: u.fullName,
                        role: u.role,
                        isActive: u.isActive,
                        recoveryEmail: u.recoveryEmail || '',
                        siteIds: u.assignedSiteIds,
                      });
                      setFormError('');
                      setEditModalOpen(true);
                    }}
                    aria-label={`Edit user ${u.fullName}`}
                    className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-[#3A3D42] bg-slate-50 dark:bg-[#202225] hover:bg-slate-200 dark:hover:bg-[#2B2D31] rounded-lg text-slate-700 dark:text-zinc-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
                    title="Edit Profile"
                  >
                    <Edit className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUser(u);
                      setResetPasswordForm({ newPassword: '', confirmPassword: '' });
                      setFormError('');
                      setResetPasswordModalOpen(true);
                    }}
                    aria-label={`Reset password for ${u.fullName}`}
                    className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg text-amber-800 dark:text-amber-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 touch-action-manipulation"
                    title="Reset Password"
                  >
                    <KeyRound className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedUser(u);
                      setChangeUsernameForm({ newUsername: u.username });
                      setFormError('');
                      setChangeUsernameModalOpen(true);
                    }}
                    aria-label={`Change username for ${u.fullName}`}
                    className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-blue-700/60 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg text-blue-800 dark:text-blue-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 touch-action-manipulation"
                    title="Change Username"
                  >
                    <UserIcon className="w-4 h-4" />
                  </button>

                  {currentUser?.id !== u.id && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUser(u);
                        setFormError('');
                        setDeleteModalOpen(true);
                      }}
                      aria-label={`Delete user ${u.fullName}`}
                      className="w-11 h-11 inline-flex items-center justify-center border border-slate-900 dark:border-rose-700/60 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-lg text-rose-700 dark:text-rose-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 touch-action-manipulation"
                      title="Delete User"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 1. Create User Modal — Scroll-safe and responsive */}
      {createModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-user-modal-title"
        >
          <div className="bg-white dark:bg-[#202225] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="create-user-modal-title" className="text-base font-black text-slate-900 dark:text-white uppercase">
                Create User Account
              </h3>
              <button 
                type="button"
                onClick={() => setCreateModalOpen(false)} 
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-semibold bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Username *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ramesh"
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-semibold bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Initial Password (min 8 chars) *
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Confirm Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  value={createForm.confirmPassword}
                  onChange={(e) => setCreateForm({ ...createForm, confirmPassword: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  System Role
                </label>
                <select
                  value={createForm.role}
                  onChange={(e) =>
                    setCreateForm({
                      ...createForm,
                      role: e.target.value as 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
                    })
                  }
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-bold bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                >
                  <option value="SITE_MANAGER">Site Manager / Engineer (Site Scoped Read &amp; Write)</option>
                  <option value="VIEWER">Viewer / Auditor (Site Scoped Read-Only)</option>
                  <option value="ADMIN">Administrator (Full Global Access)</option>
                </select>
              </div>

              {createForm.role !== 'ADMIN' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                    Assign Permitted Construction Sites
                  </label>
                  <div className="max-h-36 overflow-y-auto border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 space-y-1.5 bg-slate-50 dark:bg-[#111214] custom-scrollbar">
                    {sites.map((s) => {
                      const isChecked = createForm.siteIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex items-center space-x-2.5 text-xs font-medium text-slate-800 dark:text-zinc-200 p-1.5 hover:bg-slate-200/60 dark:hover:bg-[#202225] rounded-md cursor-pointer touch-action-manipulation"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setCreateForm({ ...createForm, siteIds: [...createForm.siteIds, s.id] });
                              } else {
                                setCreateForm({ ...createForm, siteIds: createForm.siteIds.filter((id) => id !== s.id) });
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-900 dark:border-[#3A3D42] text-emerald-600 dark:text-[#1ED760] focus:ring-slate-900 dark:focus:ring-[#1ED760]"
                          />
                          <span>
                            {s.name} {s.code ? `(${s.code})` : ''}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Optional Recovery Email
                </label>
                <input
                  type="email"
                  placeholder="e.g. user@abconstructions.com"
                  value={createForm.recoveryEmail}
                  onChange={(e) => setCreateForm({ ...createForm, recoveryEmail: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation"
                >
                  {submitting ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Edit User Modal */}
      {editModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-modal-title"
        >
          <div className="bg-white dark:bg-[#202225] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="edit-user-modal-title" className="text-base font-black text-slate-900 dark:text-white uppercase">
                Edit User: @{selectedUser?.username}
              </h3>
              <button 
                type="button"
                onClick={() => setEditModalOpen(false)} 
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditUser} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-semibold bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  System Role
                </label>
                <select
                  value={editForm.role}
                  onChange={(e) =>
                    setEditForm({
                      ...editForm,
                      role: e.target.value as 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
                    })
                  }
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-bold bg-slate-50 dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                >
                  <option value="SITE_MANAGER">Site Manager / Engineer (Site Scoped Read &amp; Write)</option>
                  <option value="VIEWER">Viewer / Auditor (Site Scoped Read-Only)</option>
                  <option value="ADMIN">Administrator (Full Global Access)</option>
                </select>
              </div>

              <div>
                <label className="flex items-center space-x-2.5 text-xs font-bold text-slate-800 dark:text-zinc-200 p-1 cursor-pointer touch-action-manipulation">
                  <input
                    type="checkbox"
                    checked={editForm.isActive}
                    onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-900 dark:border-[#3A3D42] text-emerald-600 dark:text-[#1ED760] focus:ring-slate-900 dark:focus:ring-[#1ED760]"
                  />
                  <span>Account Active (Uncheck to Disable User Login)</span>
                </label>
              </div>

              {editForm.role !== 'ADMIN' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                    Assigned Construction Sites
                  </label>
                  <div className="max-h-36 overflow-y-auto border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 space-y-1.5 bg-slate-50 dark:bg-[#111214] custom-scrollbar">
                    {sites.map((s) => {
                      const isChecked = editForm.siteIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex items-center space-x-2.5 text-xs font-medium text-slate-800 dark:text-zinc-200 p-1.5 hover:bg-slate-200/60 dark:hover:bg-[#202225] rounded-md cursor-pointer touch-action-manipulation"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditForm({ ...editForm, siteIds: [...editForm.siteIds, s.id] });
                              } else {
                                setEditForm({ ...editForm, siteIds: editForm.siteIds.filter((id) => id !== s.id) });
                              }
                            }}
                            className="w-4 h-4 rounded border-slate-900 dark:border-[#3A3D42] text-emerald-600 dark:text-[#1ED760] focus:ring-slate-900 dark:focus:ring-[#1ED760]"
                          />
                          <span>
                            {s.name} {s.code ? `(${s.code})` : ''}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Recovery Email
                </label>
                <input
                  type="email"
                  placeholder="e.g. user@abconstructions.com"
                  value={editForm.recoveryEmail}
                  onChange={(e) => setEditForm({ ...editForm, recoveryEmail: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation"
                >
                  {submitting ? 'Saving...' : 'Update Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Reset Password Modal */}
      {resetPasswordModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-password-modal-title"
        >
          <div className="bg-white dark:bg-[#202225] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="reset-password-modal-title" className="text-base font-black text-slate-900 dark:text-white uppercase">
                Reset Password: @{selectedUser?.username}
              </h3>
              <button 
                type="button"
                onClick={() => setResetPasswordModalOpen(false)} 
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  New Password (min 8 chars) *
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  value={resetPasswordForm.newPassword}
                  onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, newPassword: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  Confirm New Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  value={resetPasswordForm.confirmPassword}
                  onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setResetPasswordModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation"
                >
                  {submitting ? 'Resetting...' : 'Set New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Change Username Modal */}
      {changeUsernameModalOpen && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-username-modal-title"
        >
          <div className="bg-white dark:bg-[#202225] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="change-username-modal-title" className="text-base font-black text-slate-900 dark:text-white uppercase">
                Change Username: @{selectedUser?.username}
              </h3>
              <button 
                type="button"
                onClick={() => setChangeUsernameModalOpen(false)} 
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleChangeUsername} className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase mb-1">
                  New Username (Letters, numbers, _, -) *
                </label>
                <input
                  type="text"
                  required
                  value={changeUsernameForm.newUsername}
                  onChange={(e) => setChangeUsernameForm({ newUsername: e.target.value })}
                  className="w-full min-h-[44px] border border-slate-900 dark:border-[#3A3D42] rounded-lg p-2.5 text-base sm:text-sm font-semibold bg-white dark:bg-[#111214] text-slate-900 dark:text-white focus:ring-2 focus:ring-slate-900 dark:focus:ring-[#1ED760] focus:border-transparent dark:focus:border-transparent focus:outline-none input-no-zoom touch-action-manipulation"
                />
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setChangeUsernameModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation"
                >
                  {submitting ? 'Updating...' : 'Save New Username'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. Delete User Confirmation Modal */}
      {deleteModalOpen && selectedUser && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-user-modal-title"
        >
          <div className="bg-white dark:bg-[#202225] rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 border border-slate-900 dark:border-[#3A3D42] my-auto max-h-[92vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center border-b border-slate-100 dark:border-[#2B2D31] pb-3">
              <h3 id="delete-user-modal-title" className="text-base font-black text-rose-700 dark:text-rose-400 uppercase">
                Delete User Account
              </h3>
              <button 
                type="button"
                onClick={() => setDeleteModalOpen(false)} 
                aria-label="Close dialog"
                className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760] touch-action-manipulation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 sm:space-y-4 mt-3 sm:mt-4">
              {formError && (
                <div className="p-3 bg-red-50 dark:bg-rose-950/40 border border-red-200 dark:border-rose-700/60 rounded-lg text-red-700 dark:text-rose-300 text-xs font-semibold">
                  {formError}
                </div>
              )}

              <p className="text-sm text-slate-700 dark:text-zinc-300 leading-relaxed">
                Are you sure you want to permanently delete user{' '}
                <strong className="text-slate-900 dark:text-white">{selectedUser.fullName}</strong> (@{selectedUser.username})?
              </p>

              <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-700/60 p-3 rounded-lg text-xs text-rose-800 dark:text-rose-300 space-y-1">
                <p className="font-bold">Enterprise Guard Protection:</p>
                <p>This action cannot be undone. Users with historical financial or attendance records cannot be hard-deleted.</p>
              </div>

              <div className="pt-2 sm:pt-3 flex justify-end gap-2.5 border-t border-slate-100 dark:border-[#2B2D31]">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 border border-slate-900 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#2B2D31] transition-colors touch-action-manipulation"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleDeleteUser}
                  className="min-h-[44px] px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs sm:text-sm font-bold border border-slate-900 dark:border-transparent shadow transition-colors touch-action-manipulation"
                >
                  {submitting ? 'Deleting...' : 'Permanently Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
