/**
 * SITE WORK — Granular Permission Definitions Registry
 * Canonical Page and Action definitions according to Step 2.1 Approved Architecture.
 */

export type PageId =
  // Public / Auth
  | 'PAGE_LOGIN'
  | 'PAGE_FORGOT_PASSWORD'
  | 'PAGE_SETUP_INITIAL_ADMIN'
  // Overview
  | 'PAGE_DASHBOARD'
  // Workforce
  | 'PAGE_ATTENDANCE_DAILY'
  | 'PAGE_ATTENDANCE_WEEKLY'
  | 'PAGE_ATTENDANCE_MONTHLY'
  // Financials
  | 'PAGE_FINANCE_TRANSACTIONS'
  | 'PAGE_FINANCE_LEDGER'
  // Analytics
  | 'PAGE_REPORTS_ROLE'
  | 'PAGE_REPORTS_CATEGORY'
  | 'PAGE_REPORTS_SITE'
  // Governance & Admin
  | 'PAGE_COMPLETE_EXPORT'
  | 'PAGE_DATA_PROTECTION'
  | 'PAGE_BACKUP_CONSOLE'
  | 'PAGE_GLOBAL_ARCHIVE'
  | 'PAGE_GLOBAL_RECYCLE_BIN'
  | 'PAGE_AUDIT_TRAIL'
  // System Config
  | 'PAGE_SETUP_SITES'
  | 'PAGE_SETUP_CATEGORIES'
  | 'PAGE_SETUP_ROLES'
  | 'PAGE_SETUP_USERS'
  | 'PAGE_ACCESS_REQUESTS'
  // Self-Service
  | 'PAGE_MY_ACCOUNT';

export type ActionId =
  | 'VIEW'
  | 'CREATE'
  | 'EDIT'
  | 'DELETE'
  | 'EXPORT'
  | 'MANAGE'
  | 'RESTORE'
  | 'ARCHIVE'
  | 'RECYCLE'
  | 'PERMANENT_DELETE'
  | 'ASSIGN_SITE'
  | 'MANAGE_PERMISSIONS'
  | 'MANAGE_USERS'
  | 'RESET_PASSWORD'
  | 'CHANGE_USERNAME'
  | 'CHANGE_RECOVERY'
  | 'ACCESS_REQUEST_REVIEW';

export type RoleScopeType = 'GLOBAL' | 'ASSIGNED_SITES' | 'SPECIFIC_SITE';

export type OverrideEffect = 'ALLOW' | 'DENY';

export interface PermissionDefinition {
  id: string;
  page_id: PageId;
  action_id: ActionId;
  display_name: string;
  description: string;
  is_site_scoped: number; // 1 = true, 0 = false
}

export interface PageMetadata {
  id: PageId;
  displayName: string;
  route: string;
  module: string;
  isSiteScoped: boolean;
  unhideable: boolean;
}

export const REGISTERED_PAGES: Record<PageId, PageMetadata> = {
  PAGE_LOGIN: { id: 'PAGE_LOGIN', displayName: 'Login', route: '/login', module: 'Auth', isSiteScoped: false, unhideable: true },
  PAGE_FORGOT_PASSWORD: { id: 'PAGE_FORGOT_PASSWORD', displayName: 'Forgot Password', route: '/forgot-password', module: 'Auth', isSiteScoped: false, unhideable: true },
  PAGE_SETUP_INITIAL_ADMIN: { id: 'PAGE_SETUP_INITIAL_ADMIN', displayName: 'Setup Initial Admin', route: '/setup/initial-admin', module: 'Auth', isSiteScoped: false, unhideable: true },
  PAGE_DASHBOARD: { id: 'PAGE_DASHBOARD', displayName: 'Dashboard', route: '/', module: 'Overview', isSiteScoped: false, unhideable: false },
  PAGE_ATTENDANCE_DAILY: { id: 'PAGE_ATTENDANCE_DAILY', displayName: 'Daily Attendance', route: '/attendance/daily', module: 'Workforce', isSiteScoped: true, unhideable: false },
  PAGE_ATTENDANCE_WEEKLY: { id: 'PAGE_ATTENDANCE_WEEKLY', displayName: 'Weekly Attendance', route: '/attendance/weekly', module: 'Workforce', isSiteScoped: true, unhideable: false },
  PAGE_ATTENDANCE_MONTHLY: { id: 'PAGE_ATTENDANCE_MONTHLY', displayName: 'Monthly Attendance', route: '/attendance/monthly', module: 'Workforce', isSiteScoped: true, unhideable: false },
  PAGE_FINANCE_TRANSACTIONS: { id: 'PAGE_FINANCE_TRANSACTIONS', displayName: 'Daily Finance', route: '/finance', module: 'Financials', isSiteScoped: true, unhideable: false },
  PAGE_FINANCE_LEDGER: { id: 'PAGE_FINANCE_LEDGER', displayName: 'Master Ledger', route: '/finance/monthly', module: 'Financials', isSiteScoped: true, unhideable: false },
  PAGE_REPORTS_ROLE: { id: 'PAGE_REPORTS_ROLE', displayName: 'Role Analytics', route: '/reports/role', module: 'Analytics', isSiteScoped: true, unhideable: false },
  PAGE_REPORTS_CATEGORY: { id: 'PAGE_REPORTS_CATEGORY', displayName: 'Category Analytics', route: '/reports/category', module: 'Analytics', isSiteScoped: true, unhideable: false },
  PAGE_REPORTS_SITE: { id: 'PAGE_REPORTS_SITE', displayName: 'Site Analytics', route: '/reports/site', module: 'Analytics', isSiteScoped: true, unhideable: false },
  PAGE_COMPLETE_EXPORT: { id: 'PAGE_COMPLETE_EXPORT', displayName: 'Complete Export', route: '/reports/complete-export', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_DATA_PROTECTION: { id: 'PAGE_DATA_PROTECTION', displayName: 'Data Protection Console', route: '/admin/data-protection', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_BACKUP_CONSOLE: { id: 'PAGE_BACKUP_CONSOLE', displayName: 'Backup Console', route: '/admin/backup', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_GLOBAL_ARCHIVE: { id: 'PAGE_GLOBAL_ARCHIVE', displayName: 'Global Archive', route: '/setup/archive', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_GLOBAL_RECYCLE_BIN: { id: 'PAGE_GLOBAL_RECYCLE_BIN', displayName: 'Global Recycle Bin', route: '/setup/recycle-bin', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_AUDIT_TRAIL: { id: 'PAGE_AUDIT_TRAIL', displayName: 'Audit Trail', route: '/setup/audit', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_ACCESS_REQUESTS: { id: 'PAGE_ACCESS_REQUESTS', displayName: 'Access Requests', route: '/setup/users?accessRequests=true', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_SETUP_SITES: { id: 'PAGE_SETUP_SITES', displayName: 'Site Management', route: '/setup/sites', module: 'System Config', isSiteScoped: false, unhideable: false },
  PAGE_SETUP_CATEGORIES: { id: 'PAGE_SETUP_CATEGORIES', displayName: 'Category Management', route: '/setup/categories', module: 'System Config', isSiteScoped: false, unhideable: false },
  PAGE_SETUP_ROLES: { id: 'PAGE_SETUP_ROLES', displayName: 'Role Management', route: '/setup/roles', module: 'System Config', isSiteScoped: false, unhideable: false },
  PAGE_SETUP_USERS: { id: 'PAGE_SETUP_USERS', displayName: 'Users & Access', route: '/setup/users', module: 'Governance', isSiteScoped: false, unhideable: false },
  PAGE_MY_ACCOUNT: { id: 'PAGE_MY_ACCOUNT', displayName: 'My Account', route: '/setup/account', module: 'Self-Service', isSiteScoped: false, unhideable: true }
};

/**
 * Standard canonical permissions seeded into the catalog.
 */
export const STANDARD_PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  // Dashboard
  { id: 'perm-dash-view', page_id: 'PAGE_DASHBOARD', action_id: 'VIEW', display_name: 'View Dashboard', description: 'Access dashboard overview cards and metrics', is_site_scoped: 0 },

  // Daily Attendance
  { id: 'perm-att-daily-view', page_id: 'PAGE_ATTENDANCE_DAILY', action_id: 'VIEW', display_name: 'View Daily Attendance', description: 'View daily attendance roster for a site', is_site_scoped: 1 },
  { id: 'perm-att-daily-create', page_id: 'PAGE_ATTENDANCE_DAILY', action_id: 'CREATE', display_name: 'Create Attendance Record', description: 'Mark and save new attendance headcounts', is_site_scoped: 1 },
  { id: 'perm-att-daily-edit', page_id: 'PAGE_ATTENDANCE_DAILY', action_id: 'EDIT', display_name: 'Edit Attendance Record', description: 'Modify existing attendance headcounts', is_site_scoped: 1 },
  { id: 'perm-att-daily-export', page_id: 'PAGE_ATTENDANCE_DAILY', action_id: 'EXPORT', display_name: 'Export Daily Attendance', description: 'Download daily attendance PDF/Excel', is_site_scoped: 1 },

  // Weekly & Monthly Attendance
  { id: 'perm-att-weekly-view', page_id: 'PAGE_ATTENDANCE_WEEKLY', action_id: 'VIEW', display_name: 'View Weekly Attendance', description: 'Inspect weekly attendance aggregate matrix', is_site_scoped: 1 },
  { id: 'perm-att-monthly-view', page_id: 'PAGE_ATTENDANCE_MONTHLY', action_id: 'VIEW', display_name: 'View Monthly Attendance', description: 'Inspect monthly calendar and drilldowns', is_site_scoped: 1 },

  // Daily Finance (Transactions)
  { id: 'perm-fin-tx-view', page_id: 'PAGE_FINANCE_TRANSACTIONS', action_id: 'VIEW', display_name: 'View Transactions', description: 'Inspect site financial transaction ledger', is_site_scoped: 1 },
  { id: 'perm-fin-tx-create', page_id: 'PAGE_FINANCE_TRANSACTIONS', action_id: 'CREATE', display_name: 'Create Transaction', description: 'Record new cash outflow or receipt', is_site_scoped: 1 },
  { id: 'perm-fin-tx-edit', page_id: 'PAGE_FINANCE_TRANSACTIONS', action_id: 'EDIT', display_name: 'Edit Transaction', description: 'Update existing financial transaction details', is_site_scoped: 1 },
  { id: 'perm-fin-tx-delete', page_id: 'PAGE_FINANCE_TRANSACTIONS', action_id: 'DELETE', display_name: 'Delete Transaction', description: 'Soft delete transaction and send to recycle bin', is_site_scoped: 1 },
  { id: 'perm-fin-tx-export', page_id: 'PAGE_FINANCE_TRANSACTIONS', action_id: 'EXPORT', display_name: 'Export Financial Ledger', description: 'Export transactions to Excel/PDF', is_site_scoped: 1 },

  // Master Ledger & Investor
  { id: 'perm-fin-ledger-view', page_id: 'PAGE_FINANCE_LEDGER', action_id: 'VIEW', display_name: 'View Master Ledger', description: 'Inspect monthly company ledger and investor balances', is_site_scoped: 1 },
  { id: 'perm-fin-ledger-create', page_id: 'PAGE_FINANCE_LEDGER', action_id: 'CREATE', display_name: 'Record Investor Transaction', description: 'Deposit or draw investor capital', is_site_scoped: 0 },
  { id: 'perm-fin-ledger-edit', page_id: 'PAGE_FINANCE_LEDGER', action_id: 'EDIT', display_name: 'Edit Investor Transaction', description: 'Modify investor records', is_site_scoped: 0 },
  { id: 'perm-fin-ledger-delete', page_id: 'PAGE_FINANCE_LEDGER', action_id: 'DELETE', display_name: 'Delete Investor Transaction', description: 'Delete investor records', is_site_scoped: 0 },

  // Reports & Analytics
  { id: 'perm-rep-role-view', page_id: 'PAGE_REPORTS_ROLE', action_id: 'VIEW', display_name: 'View Role Analytics', description: 'Inspect workforce labor breakdown by role', is_site_scoped: 1 },
  { id: 'perm-rep-cat-view', page_id: 'PAGE_REPORTS_CATEGORY', action_id: 'VIEW', display_name: 'View Category Analytics', description: 'Inspect workforce labor breakdown by category', is_site_scoped: 1 },
  { id: 'perm-rep-site-view', page_id: 'PAGE_REPORTS_SITE', action_id: 'VIEW', display_name: 'View Site Analytics', description: 'Inspect site financial and labor overview', is_site_scoped: 1 },
  { id: 'perm-rep-complete-export', page_id: 'PAGE_COMPLETE_EXPORT', action_id: 'EXPORT', display_name: 'Execute Complete Export', description: 'Generate comprehensive project archive bundle', is_site_scoped: 0 },

  // Governance & Admin
  { id: 'perm-gov-prot-view', page_id: 'PAGE_DATA_PROTECTION', action_id: 'VIEW', display_name: 'View Data Protection', description: 'Inspect data safety and recovery status', is_site_scoped: 0 },
  { id: 'perm-gov-backup-view', page_id: 'PAGE_BACKUP_CONSOLE', action_id: 'VIEW', display_name: 'View Backup Console', description: 'Inspect snapshot history and package validator', is_site_scoped: 0 },
  { id: 'perm-gov-backup-manage', page_id: 'PAGE_BACKUP_CONSOLE', action_id: 'MANAGE', display_name: 'Manage Backups', description: 'Generate snapshots, validate packages, execute restores', is_site_scoped: 0 },
  { id: 'perm-gov-archive-view', page_id: 'PAGE_GLOBAL_ARCHIVE', action_id: 'VIEW', display_name: 'View Global Archive', description: 'Inspect archived entities across all modules', is_site_scoped: 0 },
  { id: 'perm-gov-archive-restore', page_id: 'PAGE_GLOBAL_ARCHIVE', action_id: 'RESTORE', display_name: 'Restore Archived Entity', description: 'Unarchive entities back to active status', is_site_scoped: 0 },
  { id: 'perm-gov-recycle-view', page_id: 'PAGE_GLOBAL_RECYCLE_BIN', action_id: 'VIEW', display_name: 'View Recycle Bin', description: 'Inspect soft-deleted records', is_site_scoped: 0 },
  { id: 'perm-gov-recycle-restore', page_id: 'PAGE_GLOBAL_RECYCLE_BIN', action_id: 'RESTORE', display_name: 'Restore Recycled Record', description: 'Recover soft-deleted items back to active state', is_site_scoped: 0 },
  { id: 'perm-gov-recycle-purge', page_id: 'PAGE_GLOBAL_RECYCLE_BIN', action_id: 'PERMANENT_DELETE', display_name: 'Permanently Purge Records', description: 'Hard wipe records from the database', is_site_scoped: 0 },
  { id: 'perm-gov-audit-view', page_id: 'PAGE_AUDIT_TRAIL', action_id: 'VIEW', display_name: 'View Audit Trail', description: 'Inspect security and data mutation logs', is_site_scoped: 0 },
  { id: 'perm-gov-audit-restore', page_id: 'PAGE_AUDIT_TRAIL', action_id: 'RESTORE', display_name: 'Execute Audit Recovery', description: 'Controlled recovery and restoration of eligible historical entities', is_site_scoped: 0 },
  { id: 'perm-gov-access-view', page_id: 'PAGE_ACCESS_REQUESTS', action_id: 'VIEW', display_name: 'View Access Requests', description: 'Inspect incoming account requests and approval history', is_site_scoped: 0 },
  { id: 'perm-gov-access-review', page_id: 'PAGE_ACCESS_REQUESTS', action_id: 'ACCESS_REQUEST_REVIEW', display_name: 'Access Request Review & Approval', description: 'Review, accept, or deny access requests and receive notification emails', is_site_scoped: 0 },

  // System Setup (Sites, Categories, Roles)
  { id: 'perm-set-site-view', page_id: 'PAGE_SETUP_SITES', action_id: 'VIEW', display_name: 'View Sites', description: 'List project site profiles', is_site_scoped: 0 },
  { id: 'perm-set-site-create', page_id: 'PAGE_SETUP_SITES', action_id: 'CREATE', display_name: 'Create Site', description: 'Add new construction site', is_site_scoped: 0 },
  { id: 'perm-set-site-edit', page_id: 'PAGE_SETUP_SITES', action_id: 'EDIT', display_name: 'Edit Site', description: 'Modify site profile information', is_site_scoped: 0 },
  { id: 'perm-set-site-delete', page_id: 'PAGE_SETUP_SITES', action_id: 'DELETE', display_name: 'Delete Site', description: 'Soft-delete site with dependency check', is_site_scoped: 0 },

  { id: 'perm-set-cat-view', page_id: 'PAGE_SETUP_CATEGORIES', action_id: 'VIEW', display_name: 'View Categories', description: 'Inspect trade category list', is_site_scoped: 0 },
  { id: 'perm-set-cat-manage', page_id: 'PAGE_SETUP_CATEGORIES', action_id: 'MANAGE', display_name: 'Manage Categories', description: 'Create, edit, reorder, delete trade categories', is_site_scoped: 0 },

  { id: 'perm-set-role-view', page_id: 'PAGE_SETUP_ROLES', action_id: 'VIEW', display_name: 'View Work Roles', description: 'Inspect wage rate and role list', is_site_scoped: 0 },
  { id: 'perm-set-role-manage', page_id: 'PAGE_SETUP_ROLES', action_id: 'MANAGE', display_name: 'Manage Work Roles', description: 'Create, edit, archive work roles and wage rates', is_site_scoped: 0 },

  // Users & Access
  { id: 'perm-set-user-view', page_id: 'PAGE_SETUP_USERS', action_id: 'VIEW', display_name: 'View Users', description: 'Inspect user accounts and access lists', is_site_scoped: 0 },
  { id: 'perm-set-user-manage', page_id: 'PAGE_SETUP_USERS', action_id: 'MANAGE_USERS', display_name: 'Manage Users', description: 'Create, edit, and deactivate user accounts', is_site_scoped: 0 },
  { id: 'perm-set-user-perms', page_id: 'PAGE_SETUP_USERS', action_id: 'MANAGE_PERMISSIONS', display_name: 'Manage Permissions', description: 'Configure role baselines and user overrides', is_site_scoped: 0 },
  { id: 'perm-set-user-sites', page_id: 'PAGE_SETUP_USERS', action_id: 'ASSIGN_SITE', display_name: 'Assign Sites', description: 'Assign users to sites via site_users', is_site_scoped: 0 },
  { id: 'perm-set-user-reset', page_id: 'PAGE_SETUP_USERS', action_id: 'RESET_PASSWORD', display_name: 'Reset User Password', description: 'Trigger password recovery or admin reset', is_site_scoped: 0 },
  { id: 'perm-set-user-access-review', page_id: 'PAGE_SETUP_USERS', action_id: 'ACCESS_REQUEST_REVIEW', display_name: 'Access Request Review Delegation', description: 'Allows this administrator to receive and review new account access requests', is_site_scoped: 0 },

  // My Account (Self-Service)
  { id: 'perm-acc-view', page_id: 'PAGE_MY_ACCOUNT', action_id: 'VIEW', display_name: 'View My Account', description: 'Inspect own profile, username, and recovery info', is_site_scoped: 0 },
  { id: 'perm-acc-edit', page_id: 'PAGE_MY_ACCOUNT', action_id: 'EDIT', display_name: 'Edit My Account', description: 'Change own password, username, or recovery email', is_site_scoped: 0 }
];
