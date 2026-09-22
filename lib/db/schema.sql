-- SQLite Database Schema for SITE WORK
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('ADMIN', 'SITE_MANAGER', 'VIEWER')),
  recovery_email TEXT,
  token_version INTEGER NOT NULL DEFAULT 1,
  authority_tier TEXT NOT NULL DEFAULT 'STANDARD' CHECK(authority_tier IN ('KING_MAKER', 'SUPERIOR_PRIME', 'CLIENT_PRIME', 'STANDARD_ADMIN', 'STANDARD')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recovery Tokens for Password Reset
CREATE TABLE IF NOT EXISTS recovery_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_used INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recovery_user ON recovery_tokens(user_id);

-- Construction Sites
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  location TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User-Site Assignments
CREATE TABLE IF NOT EXISTS site_users (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, user_id)
);

-- Work Categories
CREATE TABLE IF NOT EXISTS work_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Work Roles
CREATE TABLE IF NOT EXISTS work_roles (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES work_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  default_rate_paise INTEGER NOT NULL CHECK(default_rate_paise >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Site-Specific Role Rate Overrides
CREATE TABLE IF NOT EXISTS site_role_rates (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  role_id TEXT NOT NULL REFERENCES work_roles(id) ON DELETE RESTRICT,
  rate_paise INTEGER NOT NULL CHECK(rate_paise >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, role_id)
);

-- Daily Attendance Records
CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  date TEXT NOT NULL, -- Format: YYYY-MM-DD
  role_id TEXT NOT NULL REFERENCES work_roles(id) ON DELETE RESTRICT,
  rate_snapshot_paise INTEGER NOT NULL CHECK(rate_snapshot_paise >= 0),
  full_day_count INTEGER NOT NULL DEFAULT 0 CHECK(full_day_count >= 0),
  half_day_count INTEGER NOT NULL DEFAULT 0 CHECK(half_day_count >= 0),
  total_workers INTEGER NOT NULL CHECK(total_workers >= 0),
  worker_days REAL NOT NULL CHECK(worker_days >= 0),
  total_cost_paise INTEGER NOT NULL CHECK(total_cost_paise >= 0),
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, date, role_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_site_date ON attendance_records(site_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_role ON attendance_records(role_id);

-- Investors Table
CREATE TABLE IF NOT EXISTS investors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Supply Memory Items (Site-Scoped)
CREATE TABLE IF NOT EXISTS supply_items (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, normalized_name)
);

CREATE INDEX IF NOT EXISTS idx_supply_items_site ON supply_items(site_id, is_archived, usage_count DESC);

-- Financial Transactions
CREATE TABLE IF NOT EXISTS financial_transactions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  date TEXT NOT NULL, -- Format: YYYY-MM-DD
  type TEXT NOT NULL CHECK(type IN ('CREDIT', 'DEBIT')),
  debit_category TEXT CHECK(
    (type = 'DEBIT' AND debit_category IS NOT NULL AND debit_category IN ('SUPPLIES', 'SALARY', 'SPECIAL_WORKER_TASK')) OR
    (type = 'CREDIT' AND debit_category IS NULL)
  ),
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  description TEXT NOT NULL,
  reference_note TEXT,
  investor_id TEXT REFERENCES investors(id),
  investor_name TEXT,
  work_category_id TEXT REFERENCES work_categories(id),
  work_role_id TEXT REFERENCES work_roles(id),
  attachment_url TEXT,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_finance_site_date ON financial_transactions(site_id, date);

-- Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, -- 'ATTENDANCE', 'FINANCE', 'SITE', 'ROLE', 'RATE', 'USER', 'AUTH', 'SECURITY'
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'ARCHIVE', 'DEACTIVATE', 'ACTIVATE', 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'RECOVERY_REQUEST', 'RECOVERY_COMPLETE'
  site_id TEXT,
  user_id TEXT REFERENCES users(id),
  before_state TEXT, -- JSON (sanitized, zero secrets)
  after_state TEXT, -- JSON (sanitized, zero secrets)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_site ON audit_logs(site_id);
-- EXPLAIN QUERY PLAN confirms the intended index is selected for the tested query and temporary ORDER BY sorting is avoided.
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_site_created ON audit_logs(site_id, created_at DESC);

-- System Lifecycle Records (Global Archive & Global Recycle Bin)
CREATE TABLE IF NOT EXISTS system_lifecycle_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  source_module TEXT NOT NULL,
  source_route TEXT NOT NULL,
  restore_destination TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('ARCHIVED', 'RECYCLE_BIN')),
  keep_permanently INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  recycled_at TEXT,
  performed_by TEXT REFERENCES users(id),
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_state ON system_lifecycle_records(state, entity_type);

-- ============================================================================
-- Granular Permission Engine (Step 2A Foundation)
-- ============================================================================

-- Permission Definitions Catalog
CREATE TABLE IF NOT EXISTS permission_definitions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  is_site_scoped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(page_id, action_id)
);

CREATE INDEX IF NOT EXISTS idx_perm_def_page_action 
ON permission_definitions(page_id, action_id);

-- Role Baseline Permissions
CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  permission_id TEXT NOT NULL REFERENCES permission_definitions(id) ON DELETE RESTRICT,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('GLOBAL', 'ASSIGNED_SITES', 'SPECIFIC_SITE')),
  site_id TEXT REFERENCES sites(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (scope_type IN ('GLOBAL', 'ASSIGNED_SITES') AND site_id IS NULL) OR
    (scope_type = 'SPECIFIC_SITE' AND site_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_perms_unique_global_or_assigned
ON role_permissions(role, permission_id, scope_type)
WHERE site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_perms_unique_specific_site
ON role_permissions(role, permission_id, site_id)
WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_perms_lookup
ON role_permissions(role, permission_id);

-- User Permission Overrides
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permission_definitions(id) ON DELETE RESTRICT,
  site_id TEXT REFERENCES sites(id) ON DELETE RESTRICT,
  effect TEXT NOT NULL CHECK(effect IN ('ALLOW', 'DENY')),
  granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_upo_unique_global 
ON user_permission_overrides(user_id, permission_id) 
WHERE site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_upo_unique_site 
ON user_permission_overrides(user_id, permission_id, site_id) 
WHERE site_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_upo_lookup 
ON user_permission_overrides(user_id, permission_id, site_id);

