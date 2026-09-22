'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  UserPlus,
  Edit2,
  KeyRound,
  Trash2,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Building,
  Save,
  Undo,
  HelpCircle,
  Lock,
  Unlock,
  ChevronRight,
  ArrowLeft,
  AlertTriangle,
  Info,
  Check,
  X,
  Layers,
  FileText,
  User as UserIcon,
  Crown,
  Users,
} from 'lucide-react';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type AuthorityTier = 'KING_MAKER' | 'SUPERIOR_PRIME' | 'CLIENT_PRIME' | 'STANDARD_ADMIN' | 'STANDARD';

export interface UserItem {
  id: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  authorityTier?: AuthorityTier;
  recoveryEmail: string | null;
  isActive: boolean;
  assignedSiteIds: string[];
  createdAt: string;
  updatedAt?: string;
  permissionVersion?: number;
  tokenVersion?: number;
}

export interface PermissionDefinition {
  id: string;
  page_id: string;
  action_id: string;
  display_name: string;
  description: string;
  is_site_scoped: number;
}

export interface RoleBaseline {
  id: string;
  role: string;
  permission_id: string;
  scope_type: 'GLOBAL' | 'ASSIGNED_SITES' | 'SPECIFIC_SITE';
  site_id: string | null;
}

export interface UserOverride {
  id: string;
  user_id: string;
  permission_id: string;
  site_id: string | null;
  effect: 'ALLOW' | 'DENY';
  granted_by: string;
  page_id?: string;
  action_id?: string;
}

export type PermissionCellState = 'ALLOWED' | 'DENIED' | 'INHERITED' | 'UNAVAILABLE';

interface PendingOverride {
  permissionId: string;
  siteId: string | null;
  effect: 'ALLOW' | 'DENY' | 'RESET';
  originalState: PermissionCellState;
}

// Module Grouping for Permission Matrix
const MODULE_GROUPS = [
  {
    name: 'Overview',
    pages: ['PAGE_DASHBOARD'],
  },
  {
    name: 'Workforce',
    pages: ['PAGE_ATTENDANCE_DAILY', 'PAGE_ATTENDANCE_WEEKLY', 'PAGE_ATTENDANCE_MONTHLY'],
  },
  {
    name: 'Financials',
    pages: ['PAGE_FINANCE_TRANSACTIONS', 'PAGE_FINANCE_LEDGER'],
  },
  {
    name: 'Analytics & Reports',
    pages: ['PAGE_REPORTS_ROLE', 'PAGE_REPORTS_CATEGORY', 'PAGE_REPORTS_SITE', 'PAGE_COMPLETE_EXPORT'],
  },
  {
    name: 'Governance & Security',
    pages: [
      'PAGE_DATA_PROTECTION',
      'PAGE_BACKUP_CONSOLE',
      'PAGE_GLOBAL_ARCHIVE',
      'PAGE_GLOBAL_RECYCLE_BIN',
      'PAGE_AUDIT_TRAIL',
    ],
  },
  {
    name: 'System Configuration',
    pages: ['PAGE_SETUP_SITES', 'PAGE_SETUP_CATEGORIES', 'PAGE_SETUP_ROLES', 'PAGE_SETUP_USERS'],
  },
  {
    name: 'Self-Service',
    pages: ['PAGE_MY_ACCOUNT'],
  },
];

const MATRIX_ACTIONS = ['VIEW', 'CREATE', 'EDIT', 'DELETE', 'MANAGE'] as const;

export default function UsersAndAccessPage() {
  const { user: currentUser, sites } = useSite();

  // --------------------------------------------------------------------------
  // Core State
  // --------------------------------------------------------------------------
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  // Permission Data for Selected User
  const [definitions, setDefinitions] = useState<PermissionDefinition[]>([]);
  const [roleBaselines, setRoleBaselines] = useState<RoleBaseline[]>([]);
  const [userOverrides, setUserOverrides] = useState<UserOverride[]>([]);
  const [assignedSiteIds, setAssignedSiteIds] = useState<string[]>([]);
  const [permissionVersion, setPermissionVersion] = useState<number>(1);
  const [loadingPermissions, setLoadingPermissions] = useState(false);

  // UI Navigation / Mobile view toggles
  const [mobileView, setMobileView] = useState<'list' | 'details'>('list');
  const [activeTab, setActiveTab] = useState<'account' | 'matrix' | 'sites'>('account');

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Scope Filter for Matrix
  const [selectedSiteScope, setSelectedSiteScope] = useState<string>('GLOBAL'); // 'GLOBAL' or site_id

  // Draft changes for Permission Matrix
  const [pendingChanges, setPendingChanges] = useState<Record<string, PendingOverride>>({});
  const [savingChanges, setSavingChanges] = useState(false);

  // Site Access Draft State
  const [draftSiteIds, setDraftSiteIds] = useState<string[]>([]);
  const [draftAllSites, setDraftAllSites] = useState(false);
  const [savingSites, setSavingSites] = useState(false);

  // Notification Toast / Inline Notice
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Modals
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [changeUsernameModalOpen, setChangeUsernameModalOpen] = useState(false);
  const [newUsernameInput, setNewUsernameInput] = useState('');
  const [resetPasswordModalOpen, setResetPasswordModalOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  const [currentUserTier, setCurrentUserTier] = useState<AuthorityTier>('STANDARD');

  // Forms State
  const [createForm, setCreateForm] = useState({
    username: '',
    fullName: '',
    password: '',
    confirmPassword: '',
    role: 'SITE_MANAGER' as 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
    authorityTier: 'STANDARD' as AuthorityTier,
    recoveryEmail: '',
    mustChangePassword: true,
    siteIds: [] as string[],
  });

  const [editForm, setEditForm] = useState({
    id: '',
    fullName: '',
    role: 'SITE_MANAGER' as 'ADMIN' | 'SITE_MANAGER' | 'VIEWER',
    authorityTier: 'STANDARD' as AuthorityTier,
    isActive: true,
    recoveryEmail: '',
    siteIds: [] as string[],
  });

  const [resetPasswordForm, setResetPasswordForm] = useState({
    newPassword: '',
    confirmPassword: '',
  });

  const [submittingUser, setSubmittingUser] = useState(false);
  const [userFormError, setUserFormError] = useState('');

  // --------------------------------------------------------------------------
  // Data Fetching
  // --------------------------------------------------------------------------
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const d = await res.json();
        const userList: UserItem[] = d.users || [];
        setUsers(userList);

        // Check URL search params for ?user= or ?userId=
        const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const targetQuery = urlParams?.get('user') || urlParams?.get('userId');
        let initialSelectedId: string | null = null;
        if (targetQuery) {
          const matched = userList.find(u => u.id === targetQuery || u.username.toLowerCase() === targetQuery.toLowerCase());
          if (matched) initialSelectedId = matched.id;
        }

        // Keep current selected user if still exists, or default to first
        setSelectedUserId((prev) => {
          if (initialSelectedId) return initialSelectedId;
          if (prev && userList.some((u) => u.id === prev)) return prev;
          return userList.length > 0 ? userList[0].id : null;
        });
      } else {
        const d = await res.json();
        setFeedback({ type: 'error', message: d.error || 'Failed to fetch users' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Network error fetching users' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user?.authorityTier) {
          setCurrentUserTier(data.user.authorityTier);
        }
      })
      .catch(() => {});
  }, [fetchUsers]);

  // Fetch permissions & overrides for selected user
  const fetchUserPermissions = useCallback(async (userId: string) => {
    setLoadingPermissions(true);
    try {
      const res = await fetch(`/api/permissions?userId=${userId}`);
      if (res.ok) {
        const data = await res.json();
        setDefinitions(data.definitions || []);
        setRoleBaselines(data.roleBaselines || []);
        setUserOverrides(data.userOverrides || []);
        setAssignedSiteIds(data.assignedSiteIds || []);
        setPermissionVersion(data.permissionVersion || 1);
        setPendingChanges({});
      } else if (res.status === 404) {
        // Superior Prime hidden or user not found
        setFeedback({ type: 'error', message: 'User not found or access restricted.' });
      } else if (res.status === 403) {
        setFeedback({ type: 'error', message: 'Insufficient authority to manage this user.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Failed to load permission configuration.' });
    } finally {
      setLoadingPermissions(false);
    }
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      fetchUserPermissions(selectedUserId);
    }
  }, [selectedUserId, fetchUserPermissions]);

  // Active user object
  const selectedUser = useMemo(() => {
    return users.find((u) => u.id === selectedUserId) || null;
  }, [users, selectedUserId]);

  // --------------------------------------------------------------------------
  // User Filtering & Grouping
  // --------------------------------------------------------------------------
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search
      const matchSearch =
        u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.username.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchSearch) return false;

      // Status
      if (statusFilter === 'ACTIVE' && !u.isActive) return false;
      if (statusFilter === 'INACTIVE' && u.isActive) return false;

      return true;
    });
  }, [users, searchQuery, statusFilter]);

  const groupedUsers = useMemo(() => {
    const groups: Record<AuthorityTier, UserItem[]> = {
      KING_MAKER: [],
      SUPERIOR_PRIME: [],
      CLIENT_PRIME: [],
      STANDARD_ADMIN: [],
      STANDARD: [],
    };

    for (const u of filteredUsers) {
      if (u.authorityTier === 'KING_MAKER') {
        if (currentUserTier === 'KING_MAKER') {
          groups.KING_MAKER.push(u);
        }
        continue;
      }
      const tier: AuthorityTier = u.authorityTier || (u.role === 'ADMIN' ? 'STANDARD_ADMIN' : 'STANDARD');
      if (groups[tier]) {
        groups[tier].push(u);
      } else {
        groups.STANDARD.push(u);
      }
    }

    return groups;
  }, [filteredUsers, currentUserTier]);

  // --------------------------------------------------------------------------
  // Permission Matrix Mapping
  // --------------------------------------------------------------------------
  // Fast lookup for permission definitions by (page_id, action_id)
  const defMap = useMemo(() => {
    const map = new Map<string, PermissionDefinition>();
    for (const d of definitions) {
      map.set(`${d.page_id}:${d.action_id}`, d);
    }
    return map;
  }, [definitions]);

  // Fast lookup for user overrides by (permission_id, site_id)
  const overrideMap = useMemo(() => {
    const map = new Map<string, UserOverride>();
    for (const ov of userOverrides) {
      const key = `${ov.permission_id}:${ov.site_id || 'GLOBAL'}`;
      map.set(key, ov);
    }
    return map;
  }, [userOverrides]);

  // --------------------------------------------------------------------------
  // Authority & Management Hierarchy
  // --------------------------------------------------------------------------
  const isTargetPrime = selectedUser?.authorityTier === 'SUPERIOR_PRIME' || selectedUser?.authorityTier === 'CLIENT_PRIME';
  const isActorKingMaker = currentUserTier === 'KING_MAKER';
  const isPrimeImmutable = isTargetPrime && !isActorKingMaker;
  const isUserPrime = isPrimeImmutable;

  const canManageSelectedUser = useMemo(() => {
    if (!selectedUser) return false;

    // King Maker can configure all users (including Client Prime); cannot modify own platform matrix
    if (currentUserTier === 'KING_MAKER') {
      return selectedUser.authorityTier !== 'KING_MAKER';
    }

    // Superior Prime can configure lower tiers; cannot modify own platform matrix
    if (currentUserTier === 'SUPERIOR_PRIME') {
      return selectedUser.authorityTier !== 'SUPERIOR_PRIME' && selectedUser.authorityTier !== 'KING_MAKER';
    }

    // Client Prime can configure Standard Admin and lower tiers
    // Cannot configure King Maker, Superior Prime, another Client Prime, or self
    if (currentUserTier === 'CLIENT_PRIME') {
      if (selectedUser.id === currentUser?.id) return false;
      if (selectedUser.authorityTier === 'KING_MAKER' || selectedUser.authorityTier === 'SUPERIOR_PRIME' || selectedUser.authorityTier === 'CLIENT_PRIME') return false;
      return true;
    }

    // Standard Admin can configure peer Standard Admin and Standard users
    // Cannot configure Primes or King Maker
    if (currentUserTier === 'STANDARD_ADMIN' || currentUser?.role === 'ADMIN') {
      if (selectedUser.authorityTier === 'KING_MAKER' || selectedUser.authorityTier === 'SUPERIOR_PRIME' || selectedUser.authorityTier === 'CLIENT_PRIME') return false;
      return true;
    }

    return false;
  }, [currentUserTier, currentUser, selectedUser]);

  const isReadOnlyUser = !canManageSelectedUser;

  // --------------------------------------------------------------------------
  // Permission Matrix Evaluation & Toggle
  // --------------------------------------------------------------------------
  const getDefinitionForCell = useCallback(
    (pageId: string, action: string): PermissionDefinition | undefined => {
      // 1. Exact match
      const exact = defMap.get(`${pageId}:${action}`);
      if (exact) return exact;

      // 2. Action aliases mapping standard matrix columns to registered catalog definitions
      if (action === 'MANAGE') {
        return (
          defMap.get(`${pageId}:MANAGE`) ||
          defMap.get(`${pageId}:MANAGE_USERS`) ||
          defMap.get(`${pageId}:MANAGE_PERMISSIONS`)
        );
      }
      if (action === 'DELETE') {
        return defMap.get(`${pageId}:DELETE`) || defMap.get(`${pageId}:PERMANENT_DELETE`);
      }
      if (action === 'EDIT') {
        return defMap.get(`${pageId}:EDIT`) || defMap.get(`${pageId}:RESTORE`);
      }
      if (action === 'VIEW') {
        return defMap.get(`${pageId}:VIEW`) || defMap.get(`${pageId}:EXPORT`);
      }
      return undefined;
    },
    [defMap]
  );

  const evaluateRoleBaseline = useCallback(
    (role: string | undefined, def: PermissionDefinition): boolean => {
      if (!role) return false;

      // Check explicit database role baseline first
      const dbMatch = roleBaselines.some((rb) => rb.role === role && rb.permission_id === def.id);
      if (dbMatch) return true;

      // Fallback matching server-side evaluateLegacyFallback
      if (role === 'ADMIN') {
        if (def.page_id === 'PAGE_AUDIT_TRAIL' && def.action_id === 'RESTORE') {
          return false;
        }
        return true;
      }

      if (role === 'SITE_MANAGER') {
        const isOperational =
          def.page_id.startsWith('PAGE_ATTENDANCE_') ||
          def.page_id.startsWith('PAGE_FINANCE_') ||
          def.page_id.startsWith('PAGE_REPORTS_') ||
          def.page_id === 'PAGE_DASHBOARD';

        const isLookupView =
          def.action_id === 'VIEW' &&
          (def.page_id === 'PAGE_SETUP_SITES' ||
            def.page_id === 'PAGE_SETUP_CATEGORIES' ||
            def.page_id === 'PAGE_SETUP_ROLES');

        if (!isOperational && !isLookupView) return false;

        if (
          def.action_id === 'DELETE' ||
          def.action_id === 'MANAGE' ||
          def.action_id === 'PERMANENT_DELETE' ||
          def.action_id === 'MANAGE_USERS' ||
          def.action_id === 'MANAGE_PERMISSIONS'
        ) {
          return false;
        }

        return true;
      }

      if (role === 'VIEWER') {
        if (def.action_id !== 'VIEW' && def.action_id !== 'EXPORT') return false;
        return (
          def.page_id.startsWith('PAGE_ATTENDANCE_') ||
          def.page_id.startsWith('PAGE_FINANCE_') ||
          def.page_id.startsWith('PAGE_REPORTS_') ||
          def.page_id === 'PAGE_DASHBOARD' ||
          def.page_id === 'PAGE_SETUP_SITES' ||
          def.page_id === 'PAGE_SETUP_CATEGORIES' ||
          def.page_id === 'PAGE_SETUP_ROLES'
        );
      }

      return false;
    },
    [roleBaselines]
  );

  const isActionAllowed = useCallback(
    (def: PermissionDefinition): boolean => {
      const activeSiteId = selectedSiteScope === 'GLOBAL' ? null : selectedSiteScope;
      const changeKey = `${def.id}:${activeSiteId || 'GLOBAL'}`;

      // 0. King Maker root authority: inherently allowed across all operations
      if (selectedUser?.authorityTier === 'KING_MAKER') {
        return true;
      }

      // 1. Pending staged change
      if (pendingChanges[changeKey]) {
        const change = pendingChanges[changeKey];
        if (change.effect === 'ALLOW') return true;
        if (change.effect === 'DENY') return false;
        if (change.effect === 'RESET') {
          if (isTargetPrime) return true;
          return evaluateRoleBaseline(selectedUser?.role, def);
        }
      }

      // 2. Saved user override
      const savedOverride = overrideMap.get(changeKey);
      if (savedOverride) {
        return savedOverride.effect === 'ALLOW';
      }

      // 3. Prime administrators inherently possess full platform access unless overridden
      if (isTargetPrime) {
        return true;
      }

      // 4. Fallback to role baseline
      return evaluateRoleBaseline(selectedUser?.role, def);
    },
    [isTargetPrime, selectedUser, selectedSiteScope, pendingChanges, overrideMap, evaluateRoleBaseline]
  );

  const toggleAction = useCallback(
    (def: PermissionDefinition) => {
      if (isReadOnlyUser || isPrimeImmutable) return;

      const activeSiteId = selectedSiteScope === 'GLOBAL' ? null : selectedSiteScope;
      if (def.is_site_scoped === 0 && activeSiteId !== null) {
        setFeedback({ type: 'error', message: 'Global permissions cannot be scoped to a specific site.' });
        return;
      }

      const currentlyAllowed = isActionAllowed(def);
      const changeKey = `${def.id}:${activeSiteId || 'GLOBAL'}`;
      const hasBaseline = isTargetPrime ? true : evaluateRoleBaseline(selectedUser?.role, def);
      const savedOverride = overrideMap.get(changeKey);

      if (currentlyAllowed) {
        // Turn OFF
        const effect = hasBaseline ? 'DENY' : 'RESET';
        if (!savedOverride && effect === 'RESET') {
          setPendingChanges((prev) => {
            const next = { ...prev };
            delete next[changeKey];
            return next;
          });
        } else {
          setPendingChanges((prev) => ({
            ...prev,
            [changeKey]: {
              permissionId: def.id,
              siteId: activeSiteId,
              effect,
              originalState: 'ALLOWED',
            },
          }));
        }
      } else {
        // Turn ON
        const effect = hasBaseline ? 'RESET' : 'ALLOW';
        if (!savedOverride && effect === 'RESET') {
          setPendingChanges((prev) => {
            const next = { ...prev };
            delete next[changeKey];
            return next;
          });
        } else if (savedOverride?.effect === effect) {
          // Reverting back to saved state
          setPendingChanges((prev) => {
            const next = { ...prev };
            delete next[changeKey];
            return next;
          });
        } else {
          setPendingChanges((prev) => ({
            ...prev,
            [changeKey]: {
              permissionId: def.id,
              siteId: activeSiteId,
              effect,
              originalState: 'DENIED',
            },
          }));
        }
      }
    },
    [
      isReadOnlyUser,
      isPrimeImmutable,
      isTargetPrime,
      selectedSiteScope,
      isActionAllowed,
      evaluateRoleBaseline,
      selectedUser,
      overrideMap,
    ]
  );

  // --------------------------------------------------------------------------
  // Save / Discard Permission Matrix Changes (Batch)
  // --------------------------------------------------------------------------
  const handleSaveChanges = async () => {
    if (!selectedUser) return;
    setSavingChanges(true);
    setFeedback(null);

    const changesToApply = Object.values(pendingChanges);
    if (changesToApply.length === 0) {
      setSavingChanges(false);
      return;
    }

    try {
      const res = await fetch('/api/permissions/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          changes: changesToApply.map((c) => ({
            permissionId: c.permissionId,
            siteId: c.siteId,
            effect: c.effect,
          })),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setFeedback({
          type: 'success',
          message: 'Permission matrix updated successfully.',
        });
        setPendingChanges({});
        await fetchUserPermissions(selectedUser.id);
      } else {
        setFeedback({
          type: 'error',
          message: data.error || 'Failed to update permissions',
        });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Unexpected network error saving permissions' });
    } finally {
      setSavingChanges(false);
    }
  };

  const handleDiscardChanges = () => {
    setPendingChanges({});
    setFeedback({ type: 'info', message: 'Unsaved permission changes discarded.' });
  };

  // --------------------------------------------------------------------------
  // Site Access State Management & Sync
  // --------------------------------------------------------------------------
  useEffect(() => {
    setDraftSiteIds(assignedSiteIds);
    const hasAll = sites.length > 0 && assignedSiteIds.length >= sites.length;
    setDraftAllSites(isTargetPrime ? (assignedSiteIds.length > 0 ? hasAll : true) : hasAll);
  }, [assignedSiteIds, isTargetPrime, sites.length]);

  const isSiteAccessDirty = useMemo(() => {
    if (!selectedUser) return false;
    if (isPrimeImmutable) return false;

    const initialAllSites = isTargetPrime
      ? (assignedSiteIds.length === 0 ? true : (sites.length > 0 && assignedSiteIds.length >= sites.length))
      : (sites.length > 0 && assignedSiteIds.length >= sites.length);

    if (draftAllSites !== initialAllSites) return true;

    if (!draftAllSites) {
      if (draftSiteIds.length !== assignedSiteIds.length) return true;
      const assignedSet = new Set(assignedSiteIds);
      for (const id of draftSiteIds) {
        if (!assignedSet.has(id)) return true;
      }
    }
    return false;
  }, [selectedUser, isPrimeImmutable, isTargetPrime, draftAllSites, draftSiteIds, assignedSiteIds, sites.length]);

  const handleApplySiteChanges = async () => {
    if (!selectedUser) return;
    setSavingSites(true);
    setFeedback(null);

    try {
      const finalSiteIds = draftAllSites ? sites.map((s) => s.id) : draftSiteIds;
      const res = await fetch('/api/permissions/sites', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          siteIds: finalSiteIds,
          allSites: draftAllSites,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Site access updated successfully.' });
        const canonicalIds = Array.isArray(data.assignedSiteIds) ? data.assignedSiteIds : finalSiteIds;
        setAssignedSiteIds(canonicalIds);
        setUsers((prev) =>
          prev.map((u) => (u.id === selectedUser.id ? { ...u, assignedSiteIds: canonicalIds } : u))
        );
        await fetchUserPermissions(selectedUser.id);
        await fetchUsers();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Failed to update site access.' });
      }
    } catch (err) {
      setFeedback({ type: 'error', message: 'Network error updating site access.' });
    } finally {
      setSavingSites(false);
    }
  };

  const handleDiscardSiteChanges = () => {
    setDraftSiteIds(assignedSiteIds);
    const hasAll = sites.length > 0 && assignedSiteIds.length >= sites.length;
    setDraftAllSites(isTargetPrime ? (assignedSiteIds.length > 0 ? hasAll : true) : hasAll);
    setFeedback({ type: 'info', message: 'Unsaved site access changes discarded.' });
  };

  // --------------------------------------------------------------------------
  // User Management Forms
  // --------------------------------------------------------------------------
  const handleOpenEditModal = () => {
    if (!selectedUser) return;
    setUserFormError('');
    setEditForm({
      id: selectedUser.id,
      fullName: selectedUser.fullName,
      role: selectedUser.role,
      authorityTier: selectedUser.authorityTier || 'STANDARD',
      isActive: selectedUser.isActive,
      recoveryEmail: selectedUser.recoveryEmail || '',
      siteIds: selectedUser.assignedSiteIds || [],
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError('');
    setSubmittingUser(true);

    try {
      const res = await fetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editForm.id,
          fullName: editForm.fullName.trim(),
          role: editForm.role,
          authorityTier: editForm.authorityTier,
          isActive: editForm.isActive,
          recoveryEmail: editForm.recoveryEmail.trim() || null,
          assignedSiteIds: editForm.siteIds,
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to update user');

      setEditModalOpen(false);
      setFeedback({ type: 'success', message: 'User account updated successfully.' });
      await fetchUsers();
      if (selectedUserId) await fetchUserPermissions(selectedUserId);
    } catch (err: unknown) {
      setUserFormError(err instanceof Error ? err.message : 'Error updating user');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserFormError('');

    if (createForm.password !== createForm.confirmPassword) {
      setUserFormError('Passwords do not match');
      return;
    }

    if (createForm.password.length < 8) {
      setUserFormError('Password must be at least 8 characters long');
      return;
    }

    setSubmittingUser(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: createForm.username.trim(),
          fullName: createForm.fullName.trim(),
          password: createForm.password,
          role: createForm.role,
          authorityTier: createForm.authorityTier,
          recoveryEmail: createForm.recoveryEmail.trim() || null,
          mustChangePassword: createForm.mustChangePassword,
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
        authorityTier: 'STANDARD',
        recoveryEmail: '',
        mustChangePassword: true,
        siteIds: [],
      });
      setFeedback({ type: 'success', message: 'New user created successfully.' });
      await fetchUsers();
    } catch (err: unknown) {
      setUserFormError(err instanceof Error ? err.message : 'Error creating user');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setUserFormError('');

    if (resetPasswordForm.newPassword.length < 8) {
      setUserFormError('Password must be at least 8 characters long');
      return;
    }

    if (resetPasswordForm.newPassword !== resetPasswordForm.confirmPassword) {
      setUserFormError('Passwords do not match');
      return;
    }

    setSubmittingUser(true);
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
      setResetPasswordForm({ newPassword: '', confirmPassword: '' });
      setFeedback({ type: 'success', message: `Password reset for @${selectedUser.username}.` });
    } catch (err: unknown) {
      setUserFormError(err instanceof Error ? err.message : 'Error resetting password');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleChangeUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setUserFormError('');

    const trimmed = newUsernameInput.trim();
    if (trimmed.length < 3) {
      setUserFormError('Username must be at least 3 characters long');
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      setUserFormError('Username can only contain alphanumeric characters, underscores, hyphens, and periods');
      return;
    }

    setSubmittingUser(true);
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          action: 'CHANGE_USERNAME',
          newUsername: trimmed,
        }),
      });

      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to update username');

      setChangeUsernameModalOpen(false);
      setNewUsernameInput('');
      setFeedback({ type: 'success', message: `Username updated to @${trimmed}.` });
      await fetchUsers();
    } catch (err: unknown) {
      setUserFormError(err instanceof Error ? err.message : 'Error updating username');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeactivateUser = (targetUser: UserItem) => {
    setUserFormError('');
    setConfirmModal({
      title: 'Deactivate User Account',
      message: `Are you sure you want to deactivate @${targetUser.username}? This will immediately block future logins and invalidate all active sessions. Their historical attendance records, financial logs, audit trail, and site memberships will remain 100% intact.`,
      confirmLabel: 'Deactivate Account',
      isDestructive: true,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/users', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: targetUser.id,
              action: 'DEACTIVATE',
            }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || 'Failed to deactivate user');
          setFeedback({ type: 'success', message: d.message || `User @${targetUser.username} deactivated.` });
          await fetchUsers();
        } catch (err: unknown) {
          setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Error deactivating user' });
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  const handleActivateUser = (targetUser: UserItem) => {
    setUserFormError('');
    setConfirmModal({
      title: 'Activate User Account',
      message: `Are you sure you want to reactivate @${targetUser.username}? The user will regain login access with their previous role, permissions, and site assignments.`,
      confirmLabel: 'Activate Account',
      isDestructive: false,
      onConfirm: async () => {
        try {
          const res = await fetch('/api/users', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: targetUser.id,
              action: 'ACTIVATE',
            }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error || 'Failed to activate user');
          setFeedback({ type: 'success', message: d.message || `User @${targetUser.username} activated.` });
          await fetchUsers();
        } catch (err: unknown) {
          setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Error activating user' });
        } finally {
          setConfirmModal(null);
        }
      },
    });
  };

  // --------------------------------------------------------------------------
  // Authority Badge Helper
  // --------------------------------------------------------------------------
  const renderAuthorityBadge = (tier?: AuthorityTier) => {
    switch (tier) {
      case 'KING_MAKER':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-zinc-900 text-amber-400 border border-amber-500/50">
            <Crown className="w-3 h-3 text-amber-400" />
            KING MAKER
          </span>
        );
      case 'SUPERIOR_PRIME':
      case 'CLIENT_PRIME':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-900 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-300 dark:border-purple-700/60">
            <Crown className="w-3 h-3 text-purple-600 dark:text-purple-400" />
            PRIME
          </span>
        );
      case 'STANDARD_ADMIN':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60">
            <ShieldCheck className="w-3 h-3 text-amber-600 dark:text-amber-400" />
            Admin
          </span>
        );
      case 'STANDARD':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-300 border border-slate-200 dark:border-zinc-700">
            <UserIcon className="w-3 h-3 text-slate-500 dark:text-zinc-400" />
            Standard
          </span>
        );
    }
  };

  const isUserAllSites = (u: UserItem | null, customSiteIds?: string[]) => {
    if (!u) return false;
    if (u.authorityTier === 'KING_MAKER' || u.authorityTier === 'SUPERIOR_PRIME' || u.authorityTier === 'CLIENT_PRIME') return true;
    const ids = customSiteIds !== undefined ? customSiteIds : u.assignedSiteIds;
    if (sites.length > 0 && ids && ids.length >= sites.length) return true;
    return false;
  };

  const getSiteSummary = (
    targetUser: UserItem | null,
    userAssignedIds?: string[]
  ): { label: string; countText: string; isAll: boolean; count: number } => {
    if (!targetUser) {
      return { label: 'NO SITE ACCESS', countText: 'NO SITE ACCESS', isAll: false, count: 0 };
    }

    if (targetUser.authorityTier === 'KING_MAKER') {
      return { label: 'GLOBAL PLATFORM ACCESS', countText: 'GLOBAL PLATFORM ACCESS', isAll: true, count: sites.length };
    }

    if (
      targetUser.authorityTier === 'SUPERIOR_PRIME' ||
      targetUser.authorityTier === 'CLIENT_PRIME'
    ) {
      return { label: 'ALL SITES', countText: 'ALL SITES', isAll: true, count: sites.length };
    }

    const ids = userAssignedIds !== undefined ? userAssignedIds : (targetUser.assignedSiteIds || []);
    const count = ids.length;
    const activeSiteCount = sites.length;

    if (activeSiteCount > 0 && count >= activeSiteCount) {
      return { label: 'ALL SITES', countText: 'ALL SITES', isAll: true, count };
    }

    if (count > 0) {
      const text = count === 1 ? '1 SITE' : `${count} SITES`;
      return { label: text, countText: text, isAll: false, count };
    }

    return { label: 'NO SITE ACCESS', countText: 'NO SITE ACCESS', isAll: false, count: 0 };
  };

  const pendingCount = Object.keys(pendingChanges).length;

  return (
    <div className="space-y-4 sm:space-y-6 pb-12">
      {/* -------------------------------------------------------------------- */}
      {/* 1. Header Bar */}
      {/* -------------------------------------------------------------------- */}
      <div className="bg-white dark:bg-[#18191C] p-4 sm:p-5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 block">
              Identity &amp; Governance
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400 border border-slate-200 dark:border-zinc-700">
              ACCESS GOVERNANCE
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white">
            USERS &amp; ACCESS
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Enterprise access governance, 5-stage permission evaluation, and canonical site assignments.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            type="button"
            onClick={() => {
              setUserFormError('');
              setCreateModalOpen(true);
            }}
            className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] active:bg-black dark:active:bg-[#17a34a] text-white dark:text-black text-xs sm:text-sm font-bold rounded-lg shadow-sm border border-slate-900 dark:border-[#1ED760]/30 transition-colors shrink-0 touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-[#1ED760]"
          >
            <UserPlus className="w-4 h-4 mr-1.5 text-emerald-400 dark:text-black shrink-0" />
            Create User
          </button>
        </div>
      </div>

      {/* Inline Feedback Banner */}
      {feedback && (
        <div
          className={`p-3.5 rounded-lg border text-xs font-medium flex items-center justify-between gap-3 ${
            feedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-800'
              : feedback.type === 'error'
              ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-800'
              : 'bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 border-blue-300 dark:border-blue-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {feedback.type === 'error' && <AlertTriangle className="w-4 h-4 shrink-0" />}
            {feedback.type === 'info' && <Info className="w-4 h-4 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="min-h-[32px] min-w-[32px] inline-flex items-center justify-center p-1 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* 2. Responsive Main Workspace */}
      {/* -------------------------------------------------------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* ================================================================== */}
        {/* LEFT COLUMN: User Directory (md:col-span-5 lg:col-span-4)           */}
        {/* ================================================================== */}
        <div
          className={`md:col-span-5 lg:col-span-4 space-y-4 ${
            mobileView === 'details' ? 'hidden md:block' : 'block'
          }`}
        >
          <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
            {/* User Directory Inverted Header */}
            <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
              <div className="flex items-center space-x-2 min-w-0">
                <Users className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                <h2 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                  User Directory
                </h2>
              </div>
              <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                {filteredUsers.length} {filteredUsers.length === 1 ? 'ACCOUNT' : 'ACCOUNTS'}
              </span>
            </div>

            {/* Search & Filter Controls */}
            <div className="p-3.5 border-b border-slate-100 dark:divide-[#2B2D31] dark:border-[#2B2D31] space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-500 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-slate-900 dark:focus:ring-white"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Status Filters */}
              <div className="flex items-center gap-1.5">
                {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((filterOption) => (
                  <button
                    key={filterOption}
                    type="button"
                    onClick={() => setStatusFilter(filterOption)}
                    className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-md transition-colors min-h-[36px] ${
                      statusFilter === filterOption
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-[#202225] dark:text-zinc-400 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {filterOption}
                  </button>
                ))}
              </div>
            </div>

            {/* User Directory Cards */}
            <div className="divide-y divide-slate-100 dark:divide-[#2B2D31] max-h-[calc(100vh-280px)] overflow-y-auto custom-scrollbar">
              {loading ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-zinc-400">
                  Loading directory...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-zinc-400">
                  No matching user accounts.
                </div>
              ) : (
                [
                  ...(currentUserTier === 'KING_MAKER' && groupedUsers.KING_MAKER.length > 0
                    ? [
                        {
                          title: 'KING MAKER',
                          users: groupedUsers.KING_MAKER,
                          isKingMaker: true,
                        },
                      ]
                    : []),
                  {
                    title: 'PRIME',
                    users: [...groupedUsers.SUPERIOR_PRIME, ...groupedUsers.CLIENT_PRIME],
                    isKingMaker: false,
                  },
                  {
                    title: 'ADMIN',
                    users: groupedUsers.STANDARD_ADMIN,
                    isKingMaker: false,
                  },
                  {
                    title: 'STANDARD',
                    users: groupedUsers.STANDARD,
                    isKingMaker: false,
                  },
                ].map((section) => {
                  const usersInTier = section.users;
                  if (usersInTier.length === 0) return null;

                  return (
                    <div
                      key={section.title}
                      className={`p-2 space-y-1 ${
                        section.isKingMaker
                          ? 'bg-amber-50/60 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900/50'
                          : 'bg-slate-50/50 dark:bg-zinc-900/20'
                      }`}
                    >
                      <div
                        className={`px-2 py-1 text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 ${
                          section.isKingMaker
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-400 dark:text-zinc-500'
                        }`}
                      >
                        {section.isKingMaker && <Crown className="w-3 h-3 text-amber-500 shrink-0" />}
                        {section.title} ({usersInTier.length})
                      </div>

                      {usersInTier.map((u) => {
                        const isSelected = u.id === selectedUserId;
                        const isKm = u.authorityTier === 'KING_MAKER';
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setSelectedUserId(u.id);
                              setAssignedSiteIds(u.assignedSiteIds || []);
                              setMobileView('details');
                            }}
                            className={`w-full text-left p-3 rounded-lg transition-all flex items-center justify-between gap-3 min-h-[48px] touch-manipulation ${
                              isSelected
                                ? isKm
                                  ? 'bg-zinc-950 text-white dark:bg-black dark:text-white ring-2 ring-amber-500 shadow-md border border-amber-500/50'
                                  : 'bg-slate-900 text-white dark:bg-[#202225] dark:text-white ring-2 ring-slate-900 dark:ring-white/80 shadow-sm'
                                : isKm
                                ? 'bg-amber-50/40 hover:bg-amber-100/60 dark:bg-amber-950/30 dark:hover:bg-amber-900/50 border border-amber-300/50 dark:border-amber-700/50 text-slate-900 dark:text-zinc-100'
                                : 'hover:bg-white dark:hover:bg-zinc-800/80 text-slate-800 dark:text-zinc-200'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs truncate">{u.fullName}</span>
                                <span
                                  className={`w-2 h-2 rounded-full shrink-0 ${
                                    u.isActive ? 'bg-emerald-500' : 'bg-rose-500'
                                  }`}
                                  title={u.isActive ? 'Active Account' : 'Deactivated'}
                                />
                              </div>
                              <div
                                className={`text-[11px] font-mono truncate ${
                                  isSelected ? 'text-slate-300 dark:text-zinc-400' : 'text-slate-500 dark:text-zinc-400'
                                }`}
                              >
                                @{u.username}
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {renderAuthorityBadge(u.authorityTier)}
                                {isKm ? (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold font-mono bg-purple-950 text-purple-300 border border-purple-700">
                                    GLOBAL PLATFORM ACCESS
                                  </span>
                                ) : (
                                  <>
                                    <span
                                      className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                                        isSelected
                                          ? 'bg-slate-800 text-slate-200 dark:bg-zinc-700'
                                          : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                                      }`}
                                    >
                                      {u.role === 'SITE_MANAGER' ? 'Engineer' : u.role}
                                    </span>
                                    {(() => {
                                      const userSiteIds = u.id === selectedUserId ? assignedSiteIds : u.assignedSiteIds;
                                      const summary = getSiteSummary(u, userSiteIds);
                                      if (summary.isAll) {
                                        return (
                                          <span
                                            className={`text-[10px] px-1.5 py-0.5 rounded font-bold font-mono ${
                                              isSelected
                                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                                                : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                                            }`}
                                          >
                                            ALL SITES
                                          </span>
                                        );
                                      }
                                      if (summary.count > 0) {
                                        return (
                                          <span
                                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                                              isSelected
                                                ? 'bg-slate-800 text-slate-200 dark:bg-zinc-700'
                                                : 'bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300'
                                            }`}
                                          >
                                            {summary.countText}
                                          </span>
                                        );
                                      }
                                      return (
                                        <span
                                          className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                                            isSelected
                                              ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                              : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                                          }`}
                                        >
                                          NO SITE ACCESS
                                        </span>
                                      );
                                    })()}
                                  </>
                                )}
                              </div>
                            </div>

                            <ChevronRight
                              className={`w-4 h-4 shrink-0 transition-transform ${
                                isSelected ? 'text-white dark:text-white translate-x-0.5' : 'text-slate-400 dark:text-zinc-600'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ================================================================== */}
        {/* RIGHT COLUMN: Access & Permission Management (md:col-span-7 lg:8)  */}
        {/* ================================================================== */}
        <div
          className={`md:col-span-7 lg:col-span-8 space-y-4 ${
            mobileView === 'list' ? 'hidden md:block' : 'block'
          }`}
        >
          {/* Mobile Back Button */}
          <div className="md:hidden flex items-center justify-between pb-2">
            <button
              type="button"
              onClick={() => setMobileView('list')}
              className="inline-flex items-center gap-1.5 py-2 px-3 text-xs font-bold text-slate-700 dark:text-zinc-300 bg-white dark:bg-[#18191C] border border-slate-200 dark:border-zinc-700 rounded-lg min-h-[44px]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to User Directory
            </button>
          </div>

          {!selectedUser ? (
            <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-12 text-center text-slate-500 dark:text-zinc-400 text-sm shadow-sm">
              <UserIcon className="w-12 h-12 mx-auto mb-3 text-slate-300 dark:text-zinc-600" />
              <div className="font-bold text-slate-800 dark:text-white">No User Selected</div>
              <p className="text-xs mt-1">Select a user account from the left directory to view and configure permissions.</p>
            </div>
          ) : (
            <>
              {/* Selected User Header Card */}
              <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] p-4 sm:p-5 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-lg font-black text-slate-900 dark:text-white">
                        {selectedUser.fullName}
                      </h2>
                      <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">
                        @{selectedUser.username}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          selectedUser.isActive
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                        }`}
                      >
                        {selectedUser.isActive ? 'Active' : 'Deactivated'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {renderAuthorityBadge(selectedUser.authorityTier)}
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-semibold border border-slate-200 dark:border-zinc-700">
                        Role: {selectedUser.role === 'SITE_MANAGER' ? 'Engineer' : selectedUser.role}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-mono border border-slate-200 dark:border-zinc-700">
                        v{permissionVersion}
                      </span>
                      {(() => {
                        const summary = getSiteSummary(selectedUser, assignedSiteIds);
                        if (summary.isAll) {
                          return (
                            <span className="text-xs px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold border border-emerald-200 dark:border-emerald-800 font-mono">
                              Scope: ALL SITES
                            </span>
                          );
                        }
                        if (summary.count > 0) {
                          return (
                            <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 font-semibold border border-slate-200 dark:border-zinc-700 font-mono">
                              Scope: {summary.countText}
                            </span>
                          );
                        }
                        return (
                          <span className="text-xs px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800 font-mono">
                            Scope: NO SITE ACCESS
                          </span>
                        );
                      })()}
                      {selectedUser.recoveryEmail && (
                        <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono">
                          Recovery: {selectedUser.recoveryEmail}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions for selected user */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={handleOpenEditModal}
                      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-white bg-slate-100 hover:bg-slate-200 dark:bg-[#202225] dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 rounded-lg transition-colors touch-manipulation"
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                      Edit User
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserFormError('');
                        setNewUsernameInput(selectedUser.username);
                        setChangeUsernameModalOpen(true);
                      }}
                      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-white bg-slate-100 hover:bg-slate-200 dark:bg-[#202225] dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 rounded-lg transition-colors touch-manipulation"
                    >
                      <span className="font-mono mr-1">@</span>
                      Username
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setUserFormError('');
                        setResetPasswordForm({ newPassword: '', confirmPassword: '' });
                        setResetPasswordModalOpen(true);
                      }}
                      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-white bg-slate-100 hover:bg-slate-200 dark:bg-[#202225] dark:hover:bg-zinc-700 border border-slate-200 dark:border-zinc-700 rounded-lg transition-colors touch-manipulation"
                    >
                      <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                      Reset Pass
                    </button>
                    {selectedUser.authorityTier !== 'KING_MAKER' && (
                      selectedUser.isActive ? (
                        <button
                          type="button"
                          onClick={() => handleDeactivateUser(selectedUser)}
                          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 py-1.5 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-800 rounded-lg transition-colors touch-manipulation"
                        >
                          <UserX className="w-3.5 h-3.5 mr-1.5" />
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleActivateUser(selectedUser)}
                          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-200 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 border border-emerald-300 dark:border-emerald-800 rounded-lg transition-colors touch-manipulation"
                        >
                          <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                          Activate
                        </button>
                      )
                    )}
                  </div>
                </div>

                {/* Sub-Navigation Tabs */}
                <div className="flex items-center gap-2 border-t border-slate-100 dark:border-zinc-800 pt-3 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setActiveTab('account')}
                    className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors min-h-[44px] whitespace-nowrap flex items-center gap-1.5 ${
                      activeTab === 'account'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black'
                        : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <UserIcon className="w-3.5 h-3.5" />
                    <span>Account &amp; Security</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('matrix')}
                    className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors min-h-[44px] whitespace-nowrap flex items-center gap-1.5 ${
                      activeTab === 'matrix'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black'
                        : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Permission Matrix</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sites')}
                    className={`px-3 py-2 text-xs font-bold rounded-lg transition-colors min-h-[44px] whitespace-nowrap flex items-center gap-1.5 ${
                      activeTab === 'sites'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black'
                        : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Building className="w-3.5 h-3.5" />
                    <span>Site Access</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200">
                      {isUserPrime ? 'ALL' : assignedSiteIds.length}
                    </span>
                  </button>
                </div>
              </div>

              {/* -------------------------------------------------------------- */}
              {/* TAB 0: Account & Security                                      */}
              {/* -------------------------------------------------------------- */}
              {activeTab === 'account' && (
                <div className="space-y-4">
                  {/* Section 1: Account Identity */}
                  <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                    <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <UserIcon className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                        <h3 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                          Identity &amp; Profile
                        </h3>
                      </div>
                      <button
                        type="button"
                        onClick={handleOpenEditModal}
                        className="inline-flex items-center min-h-[32px] px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-700 dark:border-[#4A4D52] bg-slate-800 hover:bg-slate-700 dark:bg-[#2B2D31] dark:hover:bg-[#3A3D42] text-white dark:text-[#F2F3F5] transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5 mr-1.5" />
                        Edit Profile
                      </button>
                    </div>

                    <div className="p-4 sm:p-5 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs">
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Full Name
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white text-sm">
                            {selectedUser.fullName}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800 flex items-center justify-between">
                          <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                              Username
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white font-mono text-sm">
                              @{selectedUser.username}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setUserFormError('');
                              setNewUsernameInput(selectedUser.username);
                              setChangeUsernameModalOpen(true);
                            }}
                            className="min-h-[36px] px-2.5 py-1 text-[11px] font-bold rounded bg-slate-200 hover:bg-slate-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-slate-800 dark:text-zinc-200"
                          >
                            Change
                          </button>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            User ID (Immutable)
                          </span>
                          <span className="font-mono text-[11px] text-slate-700 dark:text-zinc-300 select-all break-all">
                            {selectedUser.id}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Authority Tier
                          </span>
                          <div className="mt-1">
                            {renderAuthorityBadge(selectedUser.authorityTier)}
                          </div>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Operational Role
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white">
                            {selectedUser.role === 'SITE_MANAGER' ? 'Site Manager (Engineer)' : selectedUser.role}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Account Status
                          </span>
                          <div className="mt-1">
                            {selectedUser.isActive ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                Active Account
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                <XCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                                Deactivated (Login Blocked)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 2: Security & Credential Governance */}
                  <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                    <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <KeyRound className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                        <h3 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                          Security &amp; Credential Governance
                        </h3>
                      </div>
                      <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                        TOKEN v{selectedUser.tokenVersion || 1}
                      </span>
                    </div>

                    <div className="p-4 sm:p-5 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                        {/* Recovery Email */}
                        <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800 flex flex-col justify-between gap-3">
                          <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                              Recovery Email
                            </span>
                            <span className="font-mono text-slate-800 dark:text-zinc-200 break-all">
                              {selectedUser.recoveryEmail ? selectedUser.recoveryEmail : 'None configured (Self-recovery disabled)'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleOpenEditModal}
                            className="self-start min-h-[36px] px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700"
                          >
                            Update Recovery Email
                          </button>
                        </div>

                        {/* Password Reset */}
                        <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800 flex flex-col justify-between gap-3">
                          <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                              Password Governance
                            </span>
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                              Reset user credentials. New password will be bcrypt hashed and all active sessions immediately revoked.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setUserFormError('');
                              setResetPasswordForm({ newPassword: '', confirmPassword: '' });
                              setResetPasswordModalOpen(true);
                            }}
                            className="self-start min-h-[36px] px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 flex items-center gap-1.5"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            Reset Password
                          </button>
                        </div>

                        {/* Active Sessions & Token Version */}
                        <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Session Security &amp; Token Version
                          </span>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="px-2 py-0.5 rounded font-mono font-bold text-xs bg-slate-200 dark:bg-zinc-700 text-slate-800 dark:text-zinc-200">
                              Token v{selectedUser.tokenVersion || 1}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-zinc-400">
                              Active sessions validate this version on every request.
                            </span>
                          </div>
                        </div>

                        {/* Account Lifecycle Action */}
                        <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800 flex flex-col justify-between gap-3">
                          <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                              Account Lifecycle Management
                            </span>
                            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                              {selectedUser.isActive
                                ? 'Deactivating blocks login and revokes sessions without deleting historical data.'
                                : 'Activating restores immediate access and unlocks login.'}
                            </p>
                          </div>
                          {selectedUser.authorityTier !== 'KING_MAKER' && (
                            selectedUser.isActive ? (
                              <button
                                type="button"
                                onClick={() => handleDeactivateUser(selectedUser)}
                                className="self-start min-h-[36px] px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 flex items-center gap-1.5"
                              >
                                <UserX className="w-3.5 h-3.5" />
                                Deactivate Account
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleActivateUser(selectedUser)}
                                className="self-start min-h-[36px] px-3 py-1.5 text-xs font-bold rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 flex items-center gap-1.5"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                                Activate Account
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Section 3: System Metadata & Governance */}
                  <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                    <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <FileText className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                        <h3 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                          System Metadata &amp; Access Summary
                        </h3>
                      </div>
                      <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                        v{permissionVersion}
                      </span>
                    </div>

                    <div className="p-4 sm:p-5 space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Account Created
                          </span>
                          <span className="font-mono text-slate-700 dark:text-zinc-300 text-[11px]">
                            {new Date(selectedUser.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Last Updated
                          </span>
                          <span className="font-mono text-slate-700 dark:text-zinc-300 text-[11px]">
                            {selectedUser.updatedAt ? new Date(selectedUser.updatedAt).toLocaleDateString() : 'Baseline'}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800">
                          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                            Permission Version
                          </span>
                          <span className="font-mono font-bold text-slate-900 dark:text-white text-xs">
                            v{permissionVersion}
                          </span>
                        </div>

                        <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-800 flex items-center justify-between">
                          <div>
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-0.5">
                              Assigned Sites
                            </span>
                            <span className="font-bold text-slate-900 dark:text-white text-xs">
                              {assignedSiteIds.length} site(s)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveTab('sites')}
                            className="text-[11px] font-bold text-slate-600 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white underline"
                          >
                            Manage
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------- */}
              {/* TAB 1: Permission Matrix                                       */}
              {/* -------------------------------------------------------------- */}
              {activeTab === 'matrix' && (
                <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      <Layers className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                      <h3 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                        Permission Matrix &amp; Functional Governance
                      </h3>
                    </div>
                    <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                      {MODULE_GROUPS.length} MODULE GROUPS
                    </span>
                  </div>

                  <div className="p-4 sm:p-5 space-y-4">
                    {/* Matrix Header Controls */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-100 dark:border-zinc-800">
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                          Access Scope:
                        </span>
                        <select
                          value={selectedSiteScope}
                          onChange={(e) => setSelectedSiteScope(e.target.value)}
                          className="py-1 px-2.5 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-xs font-bold text-slate-900 dark:text-white min-h-[40px] focus:ring-1 focus:ring-slate-900 dark:focus:ring-white"
                        >
                          <option value="GLOBAL">Global Overrides (All Sites)</option>
                          {sites.map((s) => (
                            <option key={s.id} value={s.id}>
                              Site: {s.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-zinc-400 flex-wrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded border border-slate-400 dark:border-zinc-600 bg-slate-900 dark:bg-[#1ED760] inline-block" />
                          Checked = Allowed
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded border border-slate-300 dark:border-zinc-700 bg-transparent inline-block" />
                          Unchecked = Not Allowed
                        </span>
                        <span className="inline-flex items-center gap-1 text-slate-400 font-mono">
                          — = Not Configured
                        </span>
                      </div>
                    </div>


                    {/* King Maker Authority Banner */}
                    {selectedUser.authorityTier === 'KING_MAKER' && (
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 p-3.5 rounded-lg flex items-center gap-3 text-xs text-amber-900 dark:text-amber-200">
                        <Crown className="w-5 h-5 text-amber-500 shrink-0" />
                        <div>
                          <div className="font-bold">ROOT KING MAKER PLATFORM AUTHORITY</div>
                          <div className="text-[11px] text-amber-700 dark:text-amber-300">
                            King Maker possesses permanent, unrestricted root platform authority across all operational modules, security layers, and sites.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Prime Authority Banner */}
                    {isTargetPrime && (
                      <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 p-3.5 rounded-lg flex items-center gap-3 text-xs text-purple-900 dark:text-purple-200">
                        <Crown className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0" />
                        <div>
                          <div className="font-bold">PRIME ADMINISTRATIVE AUTHORITY</div>
                          <div className="text-[11px] text-purple-700 dark:text-purple-300">
                            {isActorKingMaker
                              ? 'Client Prime platform authority. Fully configurable by King Maker authority.'
                              : 'Prime administrators hold root platform authority. All operational modules and canonical pages are inherently enabled.'}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Read-Only Notice for Lower Callers */}
                    {isReadOnlyUser && !isTargetPrime && selectedUser.authorityTier !== 'KING_MAKER' && (
                      <div className="bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800 p-3 rounded-lg flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-400">
                        <Lock className="w-4 h-4 shrink-0 text-slate-400 dark:text-zinc-500" />
                        <span>Viewing permission matrix in read-only mode (insufficient administrative authority to modify).</span>
                      </div>
                    )}

                    {/* Matrix Checkbox Table */}
                    {loadingPermissions ? (
                      <div className="py-12 text-center text-xs text-slate-500 dark:text-zinc-400">
                        Loading permissions catalog...
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {MODULE_GROUPS.map((group) => {
                          return (
                            <div
                              key={group.name}
                              className="border border-slate-900 dark:border-[#3A3D42] rounded-lg overflow-hidden"
                            >
                              <div className="bg-slate-900 dark:bg-[#202225] px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white dark:text-[#F2F3F5] border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
                                <span>{group.name}</span>
                                <span className="text-[10px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2 py-0.5 rounded">
                                  {group.pages.length} {group.pages.length === 1 ? 'AREA' : 'AREAS'}
                                </span>
                              </div>

                            <div className="overflow-x-auto custom-scrollbar">
                              <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                  <tr className="bg-slate-100/50 dark:bg-zinc-900/40 text-[10px] font-bold uppercase text-slate-400 dark:text-zinc-500 border-b border-slate-100 dark:border-zinc-800">
                                    <th className="py-2.5 px-3 min-w-[160px]">Feature Area</th>
                                    {MATRIX_ACTIONS.map((action) => (
                                      <th key={action} className="py-2.5 px-2 text-center min-w-[80px]">
                                        {action}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-zinc-800 font-medium">
                                  {group.pages.map((pageId) => {
                                    const pageLabel = pageId
                                      .replace('PAGE_', '')
                                      .replace(/_/g, ' ')
                                      .toLowerCase()
                                      .replace(/\b\w/g, (c) => c.toUpperCase());

                                    return (
                                      <tr
                                        key={pageId}
                                        className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/30 transition-colors"
                                      >
                                        <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-white">
                                          {pageLabel}
                                        </td>

                                        {MATRIX_ACTIONS.map((action) => {
                                          const def = getDefinitionForCell(pageId, action);

                                          if (!def) {
                                            return (
                                              <td key={action} className="py-2.5 px-2 text-center text-slate-400 dark:text-zinc-600 font-mono text-sm select-none">
                                                —
                                              </td>
                                            );
                                          }

                                          const isAllowed = isActionAllowed(def);
                                          const isDisabled = isReadOnlyUser || isUserPrime;
                                          const checkboxId = `chk-${pageId}-${action}`;

                                          return (
                                            <td key={action} className="p-0 text-center">
                                              <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
                                                <label
                                                  htmlFor={checkboxId}
                                                  className={`min-w-[44px] min-h-[44px] w-full h-full flex items-center justify-center ${
                                                    isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                                                  }`}
                                                  title={
                                                    isUserPrime
                                                      ? 'Prime authority: full platform access'
                                                      : isDisabled
                                                      ? 'Read-only access'
                                                      : `${isAllowed ? 'Allowed' : 'Not Allowed'} (${action} on ${pageLabel})`
                                                  }
                                                >
                                                  <input
                                                    id={checkboxId}
                                                    type="checkbox"
                                                    checked={isUserPrime ? true : isAllowed}
                                                    disabled={isDisabled}
                                                    onChange={() => toggleAction(def)}
                                                    aria-label={`${action} permission on ${pageLabel}`}
                                                    className={`w-5 h-5 rounded border-2 transition-all ${
                                                      isDisabled
                                                        ? 'cursor-not-allowed opacity-60 border-slate-300 dark:border-zinc-600 bg-slate-100 dark:bg-zinc-800'
                                                        : 'cursor-pointer border-slate-400 dark:border-zinc-500 hover:border-slate-600 dark:hover:border-zinc-300 hover:scale-105'
                                                    } text-slate-900 dark:text-[#1ED760] focus:ring-2 focus:ring-offset-1 focus:ring-slate-900 dark:focus:ring-[#1ED760]`}
                                                  />
                                                </label>
                                              </div>
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}

                      {/* Control Bar Directly Below Permission Matrix */}
                      <div className="pt-4 border-t border-slate-200 dark:border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-xs">
                          {pendingCount > 0 ? (
                            <span className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                              {pendingCount} unsaved permission change{pendingCount > 1 ? 's' : ''} staged
                            </span>
                          ) : (
                            <span className="flex items-center gap-1.5 text-slate-500 dark:text-zinc-400 font-medium">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                              All permission changes saved
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-3 w-full sm:w-auto">
                          {pendingCount > 0 && (
                            <button
                              type="button"
                              onClick={handleDiscardChanges}
                              disabled={savingChanges}
                              className="flex-1 sm:flex-none min-h-[44px] px-5 py-2 text-xs font-bold text-slate-700 dark:text-zinc-300 bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 rounded-lg transition-colors border border-slate-300 dark:border-zinc-600 disabled:opacity-50"
                            >
                              DISCARD
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleSaveChanges}
                            disabled={pendingCount === 0 || savingChanges || isReadOnlyUser || isUserPrime}
                            className={`flex-1 sm:flex-none min-h-[44px] px-6 py-2 text-xs font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 shadow-sm ${
                              pendingCount > 0 && !isReadOnlyUser && !isUserPrime
                                ? 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-[#1ED760] dark:hover:bg-[#1DB954] dark:text-black cursor-pointer ring-2 ring-slate-900/20 dark:ring-[#1ED760]/30'
                                : 'bg-slate-100 dark:bg-zinc-800/80 text-slate-400 dark:text-zinc-600 cursor-not-allowed border border-slate-200 dark:border-zinc-700'
                            }`}
                          >
                            {savingChanges ? (
                              <>
                                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                                <span>APPLYING...</span>
                              </>
                            ) : (
                              <>
                                <Save className="w-4 h-4" />
                                <span>APPLY CHANGES</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                </div>
              )}

              {/* -------------------------------------------------------------- */}
              {/* TAB 2: Site Access                                             */}
              {/* -------------------------------------------------------------- */}
              {activeTab === 'sites' && (
                <div className="bg-white dark:bg-[#18191C] rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                  <div className="bg-slate-900 dark:bg-[#202225] px-4 sm:px-5 py-2.5 border-b border-slate-900 dark:border-[#3A3D42] flex justify-between items-center gap-2">
                    <div className="flex items-center space-x-2 min-w-0">
                      <Building className="w-4 h-4 text-emerald-400 dark:text-[#1ED760] shrink-0" />
                      <h3 className="text-xs sm:text-sm font-black text-white dark:text-[#F2F3F5] uppercase tracking-wider truncate">
                        Site Access Configuration
                      </h3>
                    </div>
                    <span className="text-[11px] font-bold bg-slate-800 text-slate-200 border border-slate-700 dark:bg-[#2B2D31] dark:text-[#F2F3F5] dark:border-[#4A4D52] px-2.5 py-0.5 rounded shrink-0">
                      {isUserPrime ? 'GLOBAL ACCESS' : `${assignedSiteIds.length} SITES`}
                    </span>
                  </div>

                  <div className="p-4 sm:p-5 space-y-5">
                    {/* King Maker Authority Banner */}
                    {selectedUser.authorityTier === 'KING_MAKER' && (
                      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 p-3.5 rounded-lg flex items-start gap-3 text-xs text-amber-900 dark:text-amber-200">
                        <Crown className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">ALL SITES (ROOT KING MAKER AUTHORITY)</div>
                          <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                            King Maker automatically holds permanent global access across all existing and future construction sites. Site restrictions cannot be applied.
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Prime Authority Banner */}
                    {isTargetPrime && (
                      <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 p-3.5 rounded-lg flex items-start gap-3 text-xs text-purple-900 dark:text-purple-200">
                        <Crown className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                        <div>
                          <div className="font-bold">ALL SITES (PRIME AUTHORITY)</div>
                          <div className="text-[11px] text-purple-700 dark:text-purple-300 mt-0.5">
                            {isActorKingMaker
                              ? 'Client Prime holds root platform site scope by default. King Maker may explicitly assign or restrict site access.'
                              : 'Prime administrators automatically hold global access across all sites. Site assignment restrictions do not apply.'}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Read-Only Notice for Lower Callers */}
                    {isReadOnlyUser && !isTargetPrime && selectedUser.authorityTier !== 'KING_MAKER' && (
                      <div className="bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-800 p-3 rounded-lg flex items-center gap-2 text-xs text-slate-600 dark:text-zinc-400">
                        <Lock className="w-4 h-4 shrink-0 text-slate-400 dark:text-zinc-500" />
                        <span>Viewing site access in read-only mode (insufficient administrative authority to modify).</span>
                      </div>
                    )}

                    {/* Staged Changes Toolbar for Site Access */}
                    {isSiteAccessDirty && (
                      <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 p-3.5 rounded-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                        <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>Unsaved site access changes staged.</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleDiscardSiteChanges}
                            disabled={savingSites}
                            className="min-h-[40px] px-3 py-1.5 bg-white dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-700 border border-slate-300 dark:border-zinc-600 rounded-md font-bold transition-colors"
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            onClick={handleApplySiteChanges}
                            disabled={savingSites}
                            className="min-h-[40px] px-4 py-1.5 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black rounded-md font-bold transition-colors flex items-center gap-1.5"
                          >
                            {savingSites ? (
                              'Applying...'
                            ) : (
                              <>
                                <Save className="w-3.5 h-3.5" />
                                Apply Site Access
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Site Access Checkboxes */}
                    <div className="space-y-4">
                      {/* ALL SITES Checkbox Card */}
                      {(() => {
                        const isKmTarget = selectedUser?.authorityTier === 'KING_MAKER';
                        return (
                          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-[#202225] flex items-center justify-between">
                            <label className={`flex items-center gap-3 select-none ${isUserPrime || isKmTarget || isReadOnlyUser ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}>
                              <input
                                type="checkbox"
                                checked={isUserPrime || isKmTarget ? true : draftAllSites}
                                disabled={isUserPrime || isKmTarget || isReadOnlyUser}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setDraftAllSites(checked);
                                  if (checked) {
                                    setDraftSiteIds(sites.map((s) => s.id));
                                  } else {
                                    setDraftSiteIds([]);
                                  }
                                }}
                                className="w-4 h-4 rounded border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-[#1ED760] focus:ring-slate-900 dark:focus:ring-[#1ED760]"
                              />
                              <div>
                                <span className="font-bold text-xs text-slate-900 dark:text-white uppercase tracking-wider">
                                  ALL SITES
                                </span>
                                <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                                  Grants access across all current and future construction sites.
                                </p>
                              </div>
                            </label>
                          </div>
                        );
                      })()}

                      {/* Dynamic Site Checkboxes List */}
                      <div className="space-y-3">
                        <div className="bg-slate-100 dark:bg-[#202225] px-3.5 py-2 rounded-lg border border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
                          <span className="text-[11px] font-black uppercase tracking-wider text-slate-900 dark:text-[#F2F3F5]">
                            Individual Construction Sites
                          </span>
                          <span className="text-[10px] font-bold bg-slate-200 dark:bg-[#2B2D31] text-slate-800 dark:text-[#F2F3F5] px-2 py-0.5 rounded border border-slate-300 dark:border-[#4A4D52]">
                            {sites.length} {sites.length === 1 ? 'SITE' : 'SITES'}
                          </span>
                        </div>

                        {sites.length === 0 ? (
                          <div className="p-6 text-center text-xs text-slate-500 dark:text-zinc-400 border border-dashed border-slate-200 dark:border-zinc-800 rounded-lg">
                            No construction sites configured in the database.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {sites.map((site) => {
                              const isKmTarget = selectedUser?.authorityTier === 'KING_MAKER';
                              const isChecked = isUserPrime || isKmTarget || draftAllSites || draftSiteIds.includes(site.id);
                              const isDisabled = isUserPrime || isKmTarget || draftAllSites || isReadOnlyUser;

                              return (
                                <label
                                  key={site.id}
                                  className={`p-3 rounded-lg border transition-all flex items-center gap-3 ${
                                    isChecked
                                      ? 'border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900/60 shadow-xs'
                                      : 'border-slate-200 dark:border-zinc-800 bg-slate-50/50 dark:bg-zinc-900/20'
                                  } ${isDisabled ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-zinc-800/40'}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    disabled={isDisabled}
                                    onChange={(e) => {
                                      if (isDisabled) return;
                                      if (e.target.checked) {
                                        const nextIds = [...draftSiteIds, site.id];
                                        setDraftSiteIds(nextIds);
                                        if (sites.length > 0 && nextIds.length >= sites.length) {
                                          setDraftAllSites(true);
                                        }
                                      } else {
                                        setDraftSiteIds((prev) => prev.filter((id) => id !== site.id));
                                        setDraftAllSites(false);
                                      }
                                    }}
                                    className="w-4 h-4 rounded border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-[#1ED760] focus:ring-slate-900 dark:focus:ring-[#1ED760]"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-bold text-xs text-slate-900 dark:text-white truncate">
                                      {site.name}
                                    </div>
                                    <div className="text-[11px] font-mono text-slate-500 dark:text-zinc-400 truncate">
                                      Code: {site.code || 'N/A'} &bull; ID: {site.id}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>



      {/* ==================================================================== */}
      {/* MODAL 2: Create User Modal                                           */}
      {/* ==================================================================== */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  Create User Account
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  Provision new system account and configure initial authority.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userFormError && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium">
                {userFormError}
              </div>
            )}

            <form onSubmit={handleCreateSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  Username *
                </label>
                <input
                  type="text"
                  required
                  value={createForm.username}
                  onChange={(e) => setCreateForm({ ...createForm, username: e.target.value })}
                  placeholder="e.g. john_engineer"
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={createForm.fullName}
                  onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
                  placeholder="e.g. John Doe"
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Role *
                  </label>
                  <select
                    value={createForm.role}
                    onChange={(e) => setCreateForm({ ...createForm, role: e.target.value as any })}
                    className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                  >
                    <option value="SITE_MANAGER">Site Manager (Engineer)</option>
                    <option value="VIEWER">Viewer</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Authority Tier
                  </label>
                  <select
                    value={createForm.authorityTier}
                    onChange={(e) => setCreateForm({ ...createForm, authorityTier: e.target.value as any })}
                    className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                  >
                    <option value="STANDARD">Standard</option>
                    <option value="STANDARD_ADMIN">Standard Admin</option>
                    {currentUserTier === 'SUPERIOR_PRIME' && (
                      <option value="CLIENT_PRIME">Prime</option>
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Confirm Password *
                  </label>
                  <input
                    type="password"
                    required
                    value={createForm.confirmPassword}
                    onChange={(e) => setCreateForm({ ...createForm, confirmPassword: e.target.value })}
                    className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  Recovery Email (Optional)
                </label>
                <input
                  type="email"
                  value={createForm.recoveryEmail}
                  onChange={(e) => setCreateForm({ ...createForm, recoveryEmail: e.target.value })}
                  placeholder="recovery@example.com"
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="createMustChangePassword"
                  checked={createForm.mustChangePassword}
                  onChange={(e) => setCreateForm({ ...createForm, mustChangePassword: e.target.checked })}
                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 w-4 h-4"
                />
                <label htmlFor="createMustChangePassword" className="text-xs text-slate-700 dark:text-zinc-300 select-none">
                  Require password change on first login
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black font-bold rounded-lg"
                >
                  {submittingUser ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: Edit User Modal                                             */}
      {/* ==================================================================== */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  Edit User Account
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  Update profile information, authority tier, and account status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userFormError && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium">
                {userFormError}
              </div>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  required
                  value={editForm.fullName}
                  onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Role *
                  </label>
                  <select
                    disabled={editForm.authorityTier === 'KING_MAKER'}
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value as any })}
                    className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="SITE_MANAGER">Site Manager (Engineer)</option>
                    <option value="VIEWER">Viewer</option>
                    <option value="ADMIN">Administrator</option>
                  </select>
                  {editForm.authorityTier === 'KING_MAKER' && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                      King Maker role is permanent Administrator.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                    Account Status
                  </label>
                  <select
                    disabled={editForm.authorityTier === 'KING_MAKER'}
                    value={editForm.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                    onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === 'ACTIVE' })}
                    className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <option value="ACTIVE">Active Account</option>
                    <option value="DEACTIVATED">Deactivated (Blocks Login)</option>
                  </select>
                  {editForm.authorityTier === 'KING_MAKER' && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                      King Maker cannot be deactivated.
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  Recovery Email
                </label>
                <input
                  type="email"
                  value={editForm.recoveryEmail}
                  onChange={(e) => setEditForm({ ...editForm, recoveryEmail: e.target.value })}
                  placeholder="recovery@example.com"
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black font-bold rounded-lg"
                >
                  {submittingUser ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 4: Reset Password Modal                                        */}
      {/* ==================================================================== */}
      {resetPasswordModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  Reset Password
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  Reset credentials for @{selectedUser?.username}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setResetPasswordModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userFormError && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium">
                {userFormError}
              </div>
            )}

            <form onSubmit={handleResetPasswordSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  New Password (min 8 chars) *
                </label>
                <input
                  type="password"
                  required
                  value={resetPasswordForm.newPassword}
                  onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, newPassword: e.target.value })}
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  Confirm New Password *
                </label>
                <input
                  type="password"
                  required
                  value={resetPasswordForm.confirmPassword}
                  onChange={(e) => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: e.target.value })}
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetPasswordModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black font-bold rounded-lg"
                >
                  {submittingUser ? 'Updating...' : 'Set Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 4.5: Change Username Modal                                     */}
      {/* ==================================================================== */}
      {changeUsernameModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  Change Username
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
                  Update login identifier for {selectedUser?.fullName}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChangeUsernameModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white min-h-[44px] min-w-[44px] inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {userFormError && (
              <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-medium">
                {userFormError}
              </div>
            )}

            <form onSubmit={handleChangeUsernameSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  Current Username
                </label>
                <input
                  type="text"
                  disabled
                  value={selectedUser?.username || ''}
                  className="w-full py-2 px-3 bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-500 dark:text-zinc-400 min-h-[40px] font-mono cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-zinc-300 mb-1">
                  New Username (min 3 chars, alphanumeric, ., -, _) *
                </label>
                <input
                  type="text"
                  required
                  value={newUsernameInput}
                  onChange={(e) => setNewUsernameInput(e.target.value)}
                  placeholder="e.g. new_username"
                  className="w-full py-2 px-3 bg-slate-50 dark:bg-[#202225] border border-slate-200 dark:border-zinc-700 rounded-lg text-slate-900 dark:text-white min-h-[40px] font-mono"
                />
                <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1 leading-relaxed">
                  The user ID and all historical attendance, finance, and audit records remain unchanged. Old active sessions will be invalidated.
                </p>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setChangeUsernameModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingUser}
                  className="min-h-[44px] px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black font-bold rounded-lg"
                >
                  {submittingUser ? 'Saving...' : 'Update Username'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 5: In-App Confirmation Modal (Destructive / Safety Notice)     */}
      {/* ==================================================================== */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18191C] border border-slate-900 dark:border-[#3A3D42] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`p-2 rounded-full shrink-0 ${
                  confirmModal.isDestructive
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  {confirmModal.title}
                </h3>
                <p className="text-xs text-slate-600 dark:text-zinc-300 mt-1 leading-relaxed">
                  {confirmModal.message}
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="min-h-[44px] px-4 py-2 text-xs font-bold text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmModal.onConfirm}
                className={`min-h-[44px] px-4 py-2 text-xs font-bold rounded-lg transition-colors ${
                  confirmModal.isDestructive
                    ? 'bg-rose-600 hover:bg-rose-700 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-[#1ED760] dark:hover:bg-[#1DB954] text-white dark:text-black'
                }`}
              >
                {confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
