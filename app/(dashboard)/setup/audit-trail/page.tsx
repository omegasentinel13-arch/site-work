'use client';

import React, { useState, useEffect, useCallback, useId, useMemo } from 'react';
import { useSite } from '@/context/site-context';
import { 
  Shield, 
  Filter, 
  Search, 
  RotateCcw, 
  Check, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  User, 
  Building2, 
  Layers, 
  Activity, 
  Eye, 
  AlertCircle,
  Calendar,
  Lock,
  FileSpreadsheet,
  Settings,
  Database,
  Users,
  Briefcase
} from 'lucide-react';
import { DatePicker } from '@/components/ui/DatePicker';
import { AuditDetailModal } from '@/components/audit/AuditDetailModal';
import { SafeAuditLogItem, AuditListResult, AuditStats } from '@/lib/db/repositories/audit-repo';

// --------------------------------------------------------------------------
// 1. REAL AUDIT DATA TAXONOMY (Strictly derived from existing entity_type & action)
// --------------------------------------------------------------------------
type PresentationCategory = 
  | 'ALL'
  | 'SECURITY'
  | 'USERS'
  | 'PERMISSIONS'
  | 'SITES'
  | 'ROLES'
  | 'ATTENDANCE'
  | 'FINANCE'
  | 'RATES'
  | 'EXPORT'
  | 'LIFECYCLE';

interface CategoryConfig {
  id: PresentationCategory;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeColor: string;
  badgeDarkColor: string;
}

const CATEGORY_CONFIGS: CategoryConfig[] = [
  { id: 'ALL', label: 'All Categories', icon: Activity, badgeColor: 'bg-slate-100 text-slate-800', badgeDarkColor: 'dark:bg-zinc-800 dark:text-zinc-200' },
  { id: 'SECURITY', label: 'Security & Auth', icon: Lock, badgeColor: 'bg-rose-50 text-rose-700 border-rose-200', badgeDarkColor: 'dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40' },
  { id: 'USERS', label: 'Users & Accounts', icon: Users, badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200', badgeDarkColor: 'dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/40' },
  { id: 'PERMISSIONS', label: 'Permissions & Access', icon: Shield, badgeColor: 'bg-purple-50 text-purple-700 border-purple-200', badgeDarkColor: 'dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900/40' },
  { id: 'SITES', label: 'Sites & Locations', icon: Building2, badgeColor: 'bg-sky-50 text-sky-700 border-sky-200', badgeDarkColor: 'dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/40' },
  { id: 'ROLES', label: 'Roles & Positions', icon: Briefcase, badgeColor: 'bg-amber-50 text-amber-700 border-amber-200', badgeDarkColor: 'dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40' },
  { id: 'ATTENDANCE', label: 'Attendance & Labor', icon: Clock, badgeColor: 'bg-teal-50 text-teal-700 border-teal-200', badgeDarkColor: 'dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900/40' },
  { id: 'FINANCE', label: 'Finance & Ledgers', icon: Database, badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200', badgeDarkColor: 'dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40' },
  { id: 'RATES', label: 'Rates & Wage Cards', icon: Settings, badgeColor: 'bg-cyan-50 text-cyan-700 border-cyan-200', badgeDarkColor: 'dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-900/40' },
  { id: 'EXPORT', label: 'Reports & Exports', icon: FileSpreadsheet, badgeColor: 'bg-blue-50 text-blue-700 border-blue-200', badgeDarkColor: 'dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/40' },
  { id: 'LIFECYCLE', label: 'System Lifecycle', icon: Layers, badgeColor: 'bg-stone-50 text-stone-700 border-stone-200', badgeDarkColor: 'dark:bg-stone-900 dark:text-stone-300 dark:border-stone-800' },
];

const AVAILABLE_ACTIONS = [
  { value: '', label: 'All Actions' },
  { value: 'LOGIN_SUCCESS', label: 'Sign In Successful (LOGIN_SUCCESS)' },
  { value: 'LOGIN_FAILURE', label: 'Sign In Failed (LOGIN_FAILURE)' },
  { value: 'LOGOUT', label: 'Sign Out (LOGOUT)' },
  { value: 'CREATE', label: 'Record Created (CREATE)' },
  { value: 'UPDATE', label: 'Record Updated (UPDATE)' },
  { value: 'DELETE', label: 'Record Deleted (DELETE)' },
  { value: 'ARCHIVE', label: 'Archived (ARCHIVE)' },
  { value: 'SITE_ARCHIVED', label: 'Site Archived (SITE_ARCHIVED)' },
  { value: 'SITE_RESTORED', label: 'Site Restored (SITE_RESTORED)' },
  { value: 'SITE_DELETED_TO_RECYCLE_BIN', label: 'Site Moved to Recycle Bin' },
  { value: 'USER_CREATE', label: 'User Created (USER_CREATE)' },
  { value: 'USER_UPDATE', label: 'User Updated (USER_UPDATE)' },
  { value: 'USER_DELETE', label: 'User Deleted (USER_DELETE)' },
  { value: 'PASSWORD_CHANGE', label: 'Password Changed (PASSWORD_CHANGE)' },
  { value: 'PASSWORD_RESET', label: 'Password Reset (PASSWORD_RESET)' },
  { value: 'RECOVERY_REQUEST', label: 'Recovery Link Requested' },
  { value: 'RECOVERY_COMPLETE', label: 'Recovery Completed' },
  { value: 'ROLE_ACTIVATED', label: 'Role Activated' },
  { value: 'ROLE_DEACTIVATED', label: 'Role Deactivated' },
  { value: 'ROLE_CREATED', label: 'Role Created' },
  { value: 'ROLE_UPDATED', label: 'Role Updated' },
  { value: 'ROLE_RESTORED', label: 'Role Restored' },
  { value: 'CATEGORY_CREATED', label: 'Category Created' },
  { value: 'CATEGORY_UPDATED', label: 'Category Updated' },
  { value: 'CATEGORY_RESTORED', label: 'Category Restored' },
  { value: 'SITE_ACCESS_CHANGED', label: 'Site Access Changed' },
  { value: 'PERMISSION_GRANTED', label: 'Permission Granted' },
  { value: 'PERMISSION_DENIED', label: 'Permission Denied' },
  { value: 'COMPLETE_EXPORT_REQUESTED', label: 'Export Requested' },
  { value: 'COMPLETE_EXPORT_GENERATED', label: 'Export Generated' },
];

function resolvePresentationCategory(entityType: string, action: string): PresentationCategory {
  const normEntity = (entityType || '').toUpperCase();
  const normAction = (action || '').toUpperCase();

  if (normEntity === 'AUTH' || normEntity === 'SECURITY') {
    if (normAction.includes('PERMISSION') || normAction.includes('SITE_ACCESS')) {
      return 'PERMISSIONS';
    }
    if (normAction.includes('USER_')) {
      return 'USERS';
    }
    return 'SECURITY';
  }

  if (normEntity === 'USER') return 'USERS';
  if (normEntity === 'PERMISSION') return 'PERMISSIONS';
  if (normEntity === 'SITE') return 'SITES';
  if (normEntity === 'ROLE') return 'ROLES';
  if (normEntity === 'ATTENDANCE') return 'ATTENDANCE';
  if (normEntity === 'FINANCE' || normEntity === 'TRANSACTION') return 'FINANCE';
  if (normEntity === 'RATE' || normEntity === 'CATEGORY') return 'RATES';
  if (normEntity === 'EXPORT') return 'EXPORT';
  if (normEntity === 'LIFECYCLE' || normEntity === 'BACKUP') return 'LIFECYCLE';

  return 'ALL';
}

// --------------------------------------------------------------------------
// 2. CONTEXTUAL NARRATIVE FORMATTER (Plain-English presentation of existing data)
// --------------------------------------------------------------------------
function formatActivityNarrative(item: SafeAuditLogItem): string {
  const actorName = item.actor?.name || 'System';
  const targetName = item.entityName || (item.entityId && item.entityId !== 'system' ? item.entityId : '');
  const siteSuffix = item.site?.name ? ` for ${item.site.name}` : '';

  switch (item.action) {
    case 'LOGIN_SUCCESS':
      return `${actorName} logged in successfully`;
    case 'LOGIN_FAILURE':
      return `Failed sign-in attempt for '${targetName || 'user'}'`;
    case 'LOGOUT':
      return `${actorName} signed out`;
    case 'PASSWORD_CHANGE':
      return `${actorName} updated account password`;
    case 'PASSWORD_RESET':
      return `${actorName} reset password for ${targetName || 'account'}`;
    case 'USERNAME_CHANGE':
      return `${actorName} modified username to ${targetName || 'new value'}`;
    case 'RECOVERY_EMAIL_CHANGE':
      return `${actorName} updated recovery email`;
    case 'RECOVERY_REQUEST':
      return `Password recovery link requested for ${targetName || 'account'}`;
    case 'RECOVERY_COMPLETE':
      return `Password recovery successfully completed for ${targetName || 'account'}`;
    case 'USER_CREATE':
    case 'USER_CREATED':
      return `${actorName} created user account ${targetName ? `"${targetName}"` : ''}`;
    case 'USER_UPDATE':
    case 'USER_UPDATED':
      return `${actorName} updated profile for ${targetName || 'user'}`;
    case 'USER_DELETE':
      return `${actorName} deleted user ${targetName || 'account'}`;
    case 'ACCOUNT_ACTIVATED':
    case 'USER_ACTIVATED':
      return `${actorName} activated account for ${targetName || 'user'}`;
    case 'ACCOUNT_DEACTIVATED':
    case 'USER_DEACTIVATED':
      return `${actorName} deactivated account for ${targetName || 'user'}`;
    case 'SITE_ACCESS_CHANGED':
      return `${actorName} updated site access assignments${targetName ? ` for ${targetName}` : ''}`;
    case 'PERMISSION_GRANTED':
      return `${actorName} granted permission${targetName ? ` "${targetName}"` : ''}`;
    case 'PERMISSION_DENIED':
    case 'PERMISSION_REMOVED':
      return `${actorName} removed permission${targetName ? ` "${targetName}"` : ''}`;
    case 'ROLE_PERMISSION_CHANGED':
      return `${actorName} updated role permissions${targetName ? ` for ${targetName}` : ''}`;
    case 'SITE_ARCHIVED':
      return `${actorName} archived site ${targetName || ''}`;
    case 'SITE_RESTORED':
      return `${actorName} restored site ${targetName || ''}`;
    case 'SITE_DELETED_TO_RECYCLE_BIN':
      return `${actorName} moved site ${targetName || ''} to Recycle Bin`;
    case 'SITE_PERMANENTLY_DELETED':
      return `${actorName} permanently deleted site ${targetName || ''}`;
    case 'ROLE_CREATED':
      return `${actorName} created role "${targetName || 'Role'}"`;
    case 'ROLE_UPDATED':
      return `${actorName} updated role "${targetName || 'Role'}"`;
    case 'ROLE_ACTIVATED':
      return `${actorName} activated role "${targetName || 'Role'}"`;
    case 'ROLE_DEACTIVATED':
      return `${actorName} deactivated role "${targetName || 'Role'}"`;
    case 'ATTENDANCE_RECORD_CREATED':
      return `${actorName} created attendance record${siteSuffix}`;
    case 'ATTENDANCE_RECORD_UPDATED':
      return `${actorName} updated attendance record${siteSuffix}`;
    case 'ATTENDANCE_RECORD_DELETED':
      return `${actorName} deleted attendance record${siteSuffix}`;
    case 'FINANCIAL_TRANSACTION_CREATED':
    case 'FINANCE_TRANSACTION_CREATED':
      return `${actorName} recorded financial entry${targetName ? ` (${targetName})` : ''}${siteSuffix}`;
    case 'FINANCIAL_TRANSACTION_UPDATED':
      return `${actorName} updated financial entry${targetName ? ` (${targetName})` : ''}${siteSuffix}`;
    case 'FINANCIAL_TRANSACTION_DELETED':
      return `${actorName} removed financial entry${siteSuffix}`;
    case 'COMPLETE_EXPORT_REQUESTED':
      return `${actorName} requested complete system export`;
    case 'COMPLETE_EXPORT_GENERATED':
      return `${actorName} generated data export`;
    case 'COMPLETE_EXPORT_FAILED':
      return `Data export operation failed for ${actorName}`;
    default:
      if (item.actionDisplay && item.actionDisplay.trim()) {
        return `${actorName}: ${item.actionDisplay}${targetName ? ` (${targetName})` : ''}${siteSuffix}`;
      }
      return `${actorName} performed ${item.action.replace(/_/g, ' ').toLowerCase()}${targetName ? ` on ${targetName}` : ''}${siteSuffix}`;
  }
}

// --------------------------------------------------------------------------
// 3. TIMELINE GROUPING UTILITIES
// --------------------------------------------------------------------------
function getTimelineGroup(timestamp: string): 'Today' | 'Yesterday' | 'Earlier This Week' | 'Older' {
  if (!timestamp) return 'Older';
  const itemDate = new Date(timestamp.replace(' ', 'T') + 'Z');
  const now = new Date();

  // Reset to midnight for day difference
  const itemDay = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate()).getTime();
  const todayDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const diffDays = Math.round((todayDay - itemDay) / oneDayMs);

  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays <= 7) return 'Earlier This Week';
  return 'Older';
}

interface FilterState {
  from: string;
  to: string;
  actor: string;
  site: string;
  category: PresentationCategory;
  action: string;
  search: string;
}

const INITIAL_FILTERS: FilterState = {
  from: '',
  to: '',
  actor: '',
  site: '',
  category: 'ALL',
  action: '',
  search: '',
};

export default function AuditTrailPage() {
  const { user, sites } = useSite();

  // Draft filters (local state until APPLY is clicked)
  const [draftFilters, setDraftFilters] = useState<FilterState>(INITIAL_FILTERS);

  // Applied filters (authoritative active query state)
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(INITIAL_FILTERS);

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const pageSize = 25;

  // Data state
  const [items, setItems] = useState<SafeAuditLogItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [canRestore, setCanRestore] = useState<boolean>(false);
  const [stats, setStats] = useState<AuditStats | null>(null);

  // Status states
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState<boolean>(false);

  // Modal inspection state
  const [selectedItem, setSelectedItem] = useState<SafeAuditLogItem | null>(null);

  // Accessibility IDs
  const searchInputId = useId();
  const actorInputId = useId();
  const siteSelectId = useId();
  const categorySelectId = useId();
  const actionSelectId = useId();

  // Check if draft has unsaved changes compared to applied
  const hasDraftChanges = useMemo(() => {
    return (
      draftFilters.from !== appliedFilters.from ||
      draftFilters.to !== appliedFilters.to ||
      draftFilters.actor !== appliedFilters.actor ||
      draftFilters.site !== appliedFilters.site ||
      draftFilters.category !== appliedFilters.category ||
      draftFilters.action !== appliedFilters.action ||
      draftFilters.search !== appliedFilters.search
    );
  }, [draftFilters, appliedFilters]);

  // Active filter count calculated from real filter state
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.from) count++;
    if (appliedFilters.to) count++;
    if (appliedFilters.actor.trim()) count++;
    if (appliedFilters.site.trim()) count++;
    if (appliedFilters.category !== 'ALL') count++;
    if (appliedFilters.action.trim()) count++;
    if (appliedFilters.search.trim()) count++;
    return count;
  }, [appliedFilters]);

  // Recoverable actions count in currently loaded items
  const recoverableCount = useMemo(() => {
    return items.filter((item) => item.recovery && item.recovery.isEligible).length;
  }, [items]);

  // Map category to entityType for backend query
  const categoryToEntityType = (cat: PresentationCategory): string | null => {
    switch (cat) {
      case 'SECURITY': return 'SECURITY';
      case 'USERS': return 'USER';
      case 'PERMISSIONS': return 'PERMISSION';
      case 'SITES': return 'SITE';
      case 'ROLES': return 'ROLE';
      case 'ATTENDANCE': return 'ATTENDANCE';
      case 'FINANCE': return 'FINANCE';
      case 'RATES': return 'RATE';
      case 'EXPORT': return 'EXPORT';
      case 'LIFECYCLE': return 'LIFECYCLE';
      default: return null;
    }
  };

  // Fetch Audit Records from API
  const fetchAuditLogs = useCallback(async (activeFilters: FilterState, targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('page', String(targetPage));
      queryParams.set('pageSize', String(pageSize));

      if (activeFilters.from) queryParams.set('from', activeFilters.from);
      if (activeFilters.to) queryParams.set('to', activeFilters.to);
      if (activeFilters.actor.trim()) queryParams.set('actor', activeFilters.actor.trim());
      if (activeFilters.site.trim()) queryParams.set('site', activeFilters.site.trim());
      if (activeFilters.action.trim()) queryParams.set('action', activeFilters.action.trim());
      if (activeFilters.search.trim()) queryParams.set('search', activeFilters.search.trim());

      const backendEntity = categoryToEntityType(activeFilters.category);
      if (backendEntity) {
        queryParams.set('entityType', backendEntity);
      }

      const res = await fetch(`/api/audit?${queryParams.toString()}`);

      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        setItems([]);
        setTotalCount(0);
        setStats(null);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Unable to load audit activity.');
      }

      const data: AuditListResult & { canRestore?: boolean } = await res.json();
      setItems(data.items || []);
      setTotalCount(data.totalCount || 0);
      setTotalPages(data.totalPages || 0);
      setCanRestore(Boolean(data.canRestore));
      setStats(data.stats || null);
      setAccessDenied(false);
    } catch (err: unknown) {
      console.error('Audit query error:', err);
      setError('Unable to load audit activity.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and page change trigger
  useEffect(() => {
    fetchAuditLogs(appliedFilters, page);
  }, [fetchAuditLogs, appliedFilters, page]);

  // Handle APPLY Filters
  const handleApplyFilters = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPage(1);
    setAppliedFilters(draftFilters);
  };

  // Handle RESET Filters
  const handleResetFilters = () => {
    setDraftFilters(INITIAL_FILTERS);
    setAppliedFilters(INITIAL_FILTERS);
    setPage(1);
  };

  // Group items by timeline section
  const timelineGroups = useMemo(() => {
    const groups: Record<'Today' | 'Yesterday' | 'Earlier This Week' | 'Older', SafeAuditLogItem[]> = {
      Today: [],
      Yesterday: [],
      'Earlier This Week': [],
      Older: [],
    };

    items.forEach((item) => {
      const g = getTimelineGroup(item.timestamp);
      groups[g].push(item);
    });

    return groups;
  }, [items]);

  // Access Denied Fallback
  if (accessDenied) {
    return (
      <div className="bg-white dark:bg-[#18191C] p-8 sm:p-12 rounded-2xl border border-slate-200 dark:border-[#3A3D42] text-center shadow-sm max-w-xl mx-auto my-12">
        <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white mb-2">
          Access Denied
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
          Insufficient permissions to view the Audit Trail. Administrative authorization is required.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 max-w-7xl mx-auto pb-12">
      {/* ============================================================ */}
      {/* 1. CANONICAL INVERTED PAGE BANNER                             */}
      {/* ============================================================ */}
      <div className="bg-slate-900 dark:bg-[#202225] text-white p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
            <Shield className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                AUDIT TRAIL
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Immutable Log
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 dark:text-zinc-400 mt-0.5">
              System governance, security transactions &amp; activity history
            </p>
          </div>
        </div>

        {/* Real-time Query Counter */}
        <div className="flex items-center gap-2 self-start md:self-center">
          <div className="px-3.5 py-1.5 rounded-xl bg-white/10 border border-white/10 text-xs font-mono font-bold flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>{totalCount} Total Recorded Events</span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 1.5 COMPACT REAL SUMMARY METRICS CARDS                       */}
      {/* ============================================================ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
        {/* Total Recorded */}
        <div className="bg-white dark:bg-[#18191C] p-3 sm:p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
          <div className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Total Recorded
          </div>
          <div className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
            {stats?.totalRecorded ?? totalCount}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">Authoritative base</div>
        </div>

        {/* Filtered Count */}
        <div className="bg-white dark:bg-[#18191C] p-3 sm:p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
          <div className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Filtered Events
          </div>
          <div className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
            {totalCount}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">Matching criteria</div>
        </div>

        {/* Security & Auth */}
        <div className="bg-white dark:bg-[#18191C] p-3 sm:p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
          <div className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Security &amp; Auth
          </div>
          <div className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
            {stats?.securityCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">Logins &amp; Access</div>
        </div>

        {/* System Changes */}
        <div className="bg-white dark:bg-[#18191C] p-3 sm:p-3.5 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm">
          <div className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            System Changes
          </div>
          <div className="text-lg sm:text-xl font-black font-mono text-slate-900 dark:text-white mt-1">
            {stats?.systemCount ?? 0}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">Config &amp; Lifecycle</div>
        </div>

        {/* Recoverable Actions */}
        <div className={`p-3 sm:p-3.5 rounded-xl border shadow-sm transition-colors ${
          recoverableCount > 0 
            ? 'bg-amber-500/10 border-amber-500/30' 
            : 'bg-white dark:bg-[#18191C] border-slate-900 dark:border-[#3A3D42]'
        }`}>
          <div className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Recoverable
          </div>
          <div className={`text-lg sm:text-xl font-black font-mono mt-1 ${
            recoverableCount > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-slate-900 dark:text-white'
          }`}>
            {recoverableCount}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">
            {recoverableCount > 0 ? 'Eligible for restore' : 'None in current view'}
          </div>
        </div>

        {/* Active Filters */}
        <div className={`p-3 sm:p-3.5 rounded-xl border shadow-sm transition-colors ${
          activeFilterCount > 0 
            ? 'bg-emerald-500/10 border-emerald-500/30' 
            : 'bg-white dark:bg-[#18191C] border-slate-900 dark:border-[#3A3D42]'
        }`}>
          <div className="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
            Active Filters
          </div>
          <div className={`text-lg sm:text-xl font-black font-mono mt-1 ${
            activeFilterCount > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'
          }`}>
            {activeFilterCount}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">
            {activeFilterCount > 0 ? `${activeFilterCount} dimension${activeFilterCount > 1 ? 's' : ''} active` : 'No filters applied'}
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 2. DRAFT -> APPLY FILTER CONTROLS                            */}
      {/* ============================================================ */}
      <form
        onSubmit={handleApplyFilters}
        className="bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-visible"
      >
        {/* Inverted Subheader for Filters */}
        <div className="bg-slate-900 dark:bg-[#202225] text-white px-4 py-2.5 rounded-t-xl sm:rounded-t-2xl border-b border-slate-900 dark:border-[#3A3D42] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-300 dark:text-zinc-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-white">
              Filter Activity Logs
            </span>
          </div>
          {hasDraftChanges && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 animate-pulse">
              Unapplied Changes
            </span>
          )}
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {/* Date From */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Date From
              </label>
              <DatePicker
                value={draftFilters.from}
                onChange={(val) => setDraftFilters({ ...draftFilters, from: val })}
                placeholder="Select start date"
                variant="full"
                aria-label="Filter audit start date"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Date To
              </label>
              <DatePicker
                value={draftFilters.to}
                onChange={(val) => setDraftFilters({ ...draftFilters, to: val })}
                placeholder="Select end date"
                variant="full"
                aria-label="Filter audit end date"
              />
            </div>

            {/* Category Taxonomy Selector */}
            <div>
              <label htmlFor={categorySelectId} className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Category
              </label>
              <select
                id={categorySelectId}
                value={draftFilters.category}
                onChange={(e) => setDraftFilters({ ...draftFilters, category: e.target.value as PresentationCategory })}
                className="w-full min-h-[44px] px-3 py-2 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
              >
                {CATEGORY_CONFIGS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Site Scope Filter */}
            <div>
              <label htmlFor={siteSelectId} className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Site Scope
              </label>
              <select
                id={siteSelectId}
                value={draftFilters.site}
                onChange={(e) => setDraftFilters({ ...draftFilters, site: e.target.value })}
                className="w-full min-h-[44px] px-3 py-2 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
              >
                <option value="">All Sites &amp; Global</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-1">
            {/* Action / Operation Selector */}
            <div>
              <label htmlFor={actionSelectId} className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Action / Operation
              </label>
              <select
                id={actionSelectId}
                value={draftFilters.action}
                onChange={(e) => setDraftFilters({ ...draftFilters, action: e.target.value })}
                className="w-full min-h-[44px] px-3 py-2 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm text-slate-900 dark:text-white font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
              >
                {AVAILABLE_ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Actor Search */}
            <div>
              <label htmlFor={actorInputId} className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Actor / Username
              </label>
              <input
                id={actorInputId}
                type="text"
                value={draftFilters.actor}
                onChange={(e) => setDraftFilters({ ...draftFilters, actor: e.target.value })}
                placeholder="Filter by actor username or ID..."
                className="w-full min-h-[44px] px-3 py-2 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
              />
            </div>

            {/* Free Search */}
            <div>
              <label htmlFor={searchInputId} className="block text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-zinc-400 mb-1">
                Search Terms
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input
                  id={searchInputId}
                  type="text"
                  value={draftFilters.search}
                  onChange={(e) => setDraftFilters({ ...draftFilters, search: e.target.value })}
                  placeholder="Search ID, action, or metadata..."
                  className="w-full min-h-[44px] pl-10 pr-3 py-2 bg-slate-50 dark:bg-[#111214] border border-slate-200 dark:border-[#3A3D42] rounded-lg text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400"
                />
              </div>
            </div>
          </div>

          {/* Action Bar (Apply & Reset) */}
          <div className="pt-2 border-t border-slate-100 dark:border-[#2D3035] flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleResetFilters}
              className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-200 dark:border-[#3A3D42] text-xs font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-[#222428] flex items-center gap-1.5 transition-colors touch-action-manipulation"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>

            <button
              type="submit"
              className={`min-h-[44px] px-6 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 transition-all shadow-sm touch-action-manipulation ${
                hasDraftChanges
                  ? 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white ring-2 ring-slate-900/20 shadow-md'
                  : 'bg-slate-900 text-white dark:bg-emerald-600 dark:text-white hover:bg-slate-800'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>APPLY FILTERS</span>
            </button>
          </div>
        </div>
      </form>

      {/* ============================================================ */}
      {/* 3. ACTIVITY FEED & TIMELINE                                  */}
      {/* ============================================================ */}
      {loading ? (
        <div className="bg-white dark:bg-[#18191C] p-12 rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] text-center shadow-sm">
          <div className="inline-block animate-spin w-8 h-8 border-4 border-slate-300 dark:border-zinc-700 border-t-slate-900 dark:border-t-emerald-400 rounded-full mb-3" />
          <p className="text-xs sm:text-sm font-bold text-slate-600 dark:text-zinc-400">
            Querying authoritative audit trail...
          </p>
        </div>
      ) : error ? (
        <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 p-6 rounded-xl sm:rounded-2xl text-center space-y-2">
          <AlertCircle className="w-8 h-8 text-rose-600 dark:text-rose-400 mx-auto" />
          <p className="text-sm font-bold text-rose-800 dark:text-rose-300">{error}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-[#18191C] p-12 rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] text-center shadow-sm space-y-2">
          <Shield className="w-10 h-10 text-slate-400 mx-auto" />
          <h3 className="text-base font-bold text-slate-800 dark:text-zinc-200">
            No Activity Records Found
          </h3>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 max-w-sm mx-auto">
            No audit records match the selected date range and filter criteria.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {(['Today', 'Yesterday', 'Earlier This Week', 'Older'] as const).map((groupName) => {
            const groupItems = timelineGroups[groupName];
            if (groupItems.length === 0) return null;

            return (
              <div key={groupName} className="space-y-3">
                {/* Timeline Section Header */}
                <div className="flex items-center gap-2 px-1">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                    {groupName}
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                    ({groupItems.length})
                  </span>
                  <div className="flex-1 h-px bg-slate-200 dark:bg-[#2D3035] ml-2" />
                </div>

                {/* DESKTOP TABLE VIEW (>= 768px) */}
                <div className="hidden md:block bg-white dark:bg-[#18191C] rounded-xl sm:rounded-2xl border border-slate-900 dark:border-[#3A3D42] shadow-sm overflow-hidden">
                  <table className="w-full text-left text-xs sm:text-sm border-collapse">
                    <thead>
                      <tr className="bg-slate-900 dark:bg-[#202225] text-white border-b border-slate-900 dark:border-[#3A3D42]">
                        <th className="py-3 px-4 font-black uppercase tracking-wider text-[11px]">Time</th>
                        <th className="py-3 px-4 font-black uppercase tracking-wider text-[11px]">Category</th>
                        <th className="py-3 px-4 font-black uppercase tracking-wider text-[11px]">Action &amp; Status</th>
                        <th className="py-3 px-4 font-black uppercase tracking-wider text-[11px]">Activity Narrative &amp; Target</th>
                        <th className="py-3 px-4 font-black uppercase tracking-wider text-[11px]">Actor</th>
                        <th className="py-3 px-4 font-black uppercase tracking-wider text-[11px]">Site Scope</th>
                        <th className="py-3 px-4 font-black uppercase tracking-wider text-[11px] text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-[#2D3035]">
                      {groupItems.map((item) => {
                        const cat = resolvePresentationCategory(item.entityType, item.action);
                        const catCfg = CATEGORY_CONFIGS.find((c) => c.id === cat) || CATEGORY_CONFIGS[0];
                        const narrative = formatActivityNarrative(item);
                        const isRecoverable = Boolean(item.recovery && item.recovery.isEligible);
                        const isFailed = item.action.includes('FAILURE') || item.action.includes('DENIED');
                        const isRestored = item.action.includes('RESTORE');

                        return (
                          <tr
                            key={item.id}
                            className="hover:bg-slate-50/70 dark:hover:bg-[#202225]/40 transition-colors"
                          >
                            {/* Timestamp */}
                            <td className="py-3.5 px-4 whitespace-nowrap text-slate-500 dark:text-zinc-400 font-mono text-xs">
                              {item.timestamp}
                            </td>

                            {/* Category Badge */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${catCfg.badgeColor} ${catCfg.badgeDarkColor}`}>
                                <catCfg.icon className="w-3 h-3" />
                                {catCfg.label}
                              </span>
                            </td>

                            {/* Action & Status */}
                            <td className="py-3.5 px-4 whitespace-nowrap space-y-1">
                              <div className="font-bold text-xs text-slate-900 dark:text-white">
                                {item.actionDisplay}
                              </div>
                              {isRecoverable ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700/50">
                                  <RotateCcw className="w-2.5 h-2.5 text-amber-700 dark:text-amber-400" />
                                  RECOVERY ({item.recovery?.currentState})
                                </span>
                              ) : isFailed ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                  FAILED
                                </span>
                              ) : isRestored ? (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                  RESTORED
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium uppercase bg-slate-100 text-slate-600 dark:bg-[#202225] dark:text-zinc-400 border border-slate-200 dark:border-zinc-700">
                                  RECORDED
                                </span>
                              )}
                            </td>

                            {/* Narrative Sentence & Target */}
                            <td className="py-3.5 px-4 max-w-md">
                              <p className="font-bold text-slate-900 dark:text-white leading-snug">
                                {narrative}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400 dark:text-zinc-500 mt-0.5">
                                Target: <span className="font-bold text-slate-700 dark:text-zinc-300">{item.entityType}</span> &bull; ID: {item.entityId}
                                {item.entityName && item.entityName !== item.entityId && (
                                  <span> ({item.entityName})</span>
                                )}
                              </p>
                            </td>

                            {/* Actor */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                <span className="font-bold text-slate-800 dark:text-zinc-200">
                                  {item.actor?.name || 'System'}
                                </span>
                              </div>
                              {item.actor?.role && (
                                <span className="inline-block text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-slate-100 dark:bg-[#222428] text-slate-600 dark:text-zinc-400 mt-0.5">
                                  {item.actor.role}
                                </span>
                              )}
                            </td>

                            {/* Site Scope */}
                            <td className="py-3.5 px-4 whitespace-nowrap text-slate-600 dark:text-zinc-300">
                              {item.site?.name || (
                                <span className="text-slate-400 dark:text-zinc-500 font-medium">
                                  Global
                                </span>
                              )}
                            </td>

                            {/* Action Button */}
                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setSelectedItem(item)}
                                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#3A3D42] text-slate-700 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#2A2D32] font-bold text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400 touch-action-manipulation"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>Inspect</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* MOBILE STACKED CARDS (< 768px: 430, 412, 390, 375) */}
                <div className="md:hidden space-y-2.5">
                  {groupItems.map((item) => {
                    const cat = resolvePresentationCategory(item.entityType, item.action);
                    const catCfg = CATEGORY_CONFIGS.find((c) => c.id === cat) || CATEGORY_CONFIGS[0];
                    const narrative = formatActivityNarrative(item);
                    const isRecoverable = Boolean(item.recovery && item.recovery.isEligible);
                    const isFailed = item.action.includes('FAILURE') || item.action.includes('DENIED');
                    const isRestored = item.action.includes('RESTORE');

                    return (
                      <div
                        key={item.id}
                        className="bg-white dark:bg-[#18191C] p-4 rounded-xl border border-slate-900 dark:border-[#3A3D42] shadow-sm space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2 border-b border-slate-100 dark:border-[#2D3035] pb-2.5">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${catCfg.badgeColor} ${catCfg.badgeDarkColor}`}>
                            <catCfg.icon className="w-3 h-3" />
                            {catCfg.label}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">
                            {item.timestamp}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-xs text-slate-800 dark:text-zinc-200">
                              {item.actionDisplay}
                            </span>
                            {isRecoverable ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-300 dark:border-amber-700/50">
                                <RotateCcw className="w-2.5 h-2.5 text-amber-700 dark:text-amber-400" />
                                RECOVERY ({item.recovery?.currentState})
                              </span>
                            ) : isFailed ? (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                                FAILED
                              </span>
                            ) : isRestored ? (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                RESTORED
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium uppercase bg-slate-100 text-slate-600 dark:bg-[#202225] dark:text-zinc-400 border border-slate-200 dark:border-zinc-700">
                                RECORDED
                              </span>
                            )}
                          </div>

                          <p className="font-bold text-sm text-slate-900 dark:text-white leading-snug">
                            {narrative}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400 dark:text-zinc-500 mt-1">
                            Target: <span className="font-bold text-slate-700 dark:text-zinc-300">{item.entityType}</span> &bull; ID: {item.entityId}
                            {item.entityName && item.entityName !== item.entityId && (
                              <span> ({item.entityName})</span>
                            )}
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100 dark:border-[#2D3035]">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Actor</span>
                            <span className="font-semibold text-slate-800 dark:text-zinc-200">{item.actor?.name || 'System'}</span>
                          </div>
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">Scope</span>
                            <span className="font-semibold text-slate-800 dark:text-zinc-200">{item.site?.name || 'Global'}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setSelectedItem(item)}
                          className="w-full min-h-[44px] rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-[#222428] dark:hover:bg-[#2e3035] text-slate-900 dark:text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400 touch-action-manipulation"
                        >
                          <Eye className="w-4 h-4" />
                          INSPECT EVENT
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Pagination Controls */}
          <div className="bg-white dark:bg-[#18191C] p-3.5 sm:p-4 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-[#3A3D42] shadow-sm flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:text-sm">
            <div className="text-slate-600 dark:text-zinc-400 text-center sm:text-left">
              Showing page <span className="font-bold text-slate-900 dark:text-white">{page}</span> of{' '}
              <span className="font-bold text-slate-900 dark:text-white">{totalPages || 1}</span> ({totalCount} items)
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#3A3D42] font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-[#222428] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400 touch-action-manipulation"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>

              <span className="px-3 py-2 font-mono text-xs font-bold text-slate-500 dark:text-zinc-400">
                {page} / {totalPages || 1}
              </span>

              <button
                type="button"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-[#3A3D42] font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-[#222428] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-emerald-400 touch-action-manipulation"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Read-Only Detail Modal with Controlled Recovery */}
      <AuditDetailModal
        item={selectedItem}
        canRestore={canRestore}
        onRestoreSuccess={() => {
          setSelectedItem(null);
          fetchAuditLogs(appliedFilters, page);
        }}
        onClose={() => setSelectedItem(null)}
      />
    </div>
  );
}
