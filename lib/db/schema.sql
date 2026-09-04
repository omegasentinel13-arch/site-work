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

-- Financial Transactions
CREATE TABLE IF NOT EXISTS financial_transactions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  date TEXT NOT NULL, -- Format: YYYY-MM-DD
  type TEXT NOT NULL CHECK(type IN ('CREDIT', 'DEBIT')),
  debit_category TEXT CHECK(
    (type = 'DEBIT' AND debit_category IN ('SUPPLIES', 'SPECIAL_WORKER_TASK')) OR
    (type = 'CREDIT' AND debit_category IS NULL)
  ),
  amount_paise INTEGER NOT NULL CHECK(amount_paise > 0),
  description TEXT NOT NULL,
  reference_note TEXT,
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
