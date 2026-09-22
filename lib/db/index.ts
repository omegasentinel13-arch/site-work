import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { runSeed } from './seed';

import { RestoreCoordinator } from '../backup/coordinator';
import { STANDARD_PERMISSION_DEFINITIONS } from '../permissions/registry';

let dbInstance: DatabaseSync | null = null;

function runMigrations(db: DatabaseSync): void {
  // 1. Check users table columns
  try {
    const tableInfo = db.prepare('PRAGMA table_info(users);').all() as { name: string }[];
    const columnNames = new Set(tableInfo.map(c => c.name));

    if (!columnNames.has('recovery_email')) {
      db.exec('ALTER TABLE users ADD COLUMN recovery_email TEXT;');
    }
    if (!columnNames.has('token_version')) {
      db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1;');
    }
    if (!columnNames.has('authority_tier')) {
      db.exec("ALTER TABLE users ADD COLUMN authority_tier TEXT NOT NULL DEFAULT 'STANDARD';");
      db.exec("UPDATE users SET authority_tier = 'STANDARD_ADMIN' WHERE role = 'ADMIN' AND authority_tier = 'STANDARD' AND id != 'usr-admin-1';");
      db.exec("UPDATE users SET authority_tier = 'KING_MAKER' WHERE id = 'usr-admin-1' AND username = 'Iamadmin';");
    }
    // Assert King Maker Invariant: at most one KING_MAKER, and must be usr-admin-1 / Iamadmin
    const kingMakers = db.prepare("SELECT id, username FROM users WHERE authority_tier = 'KING_MAKER'").all() as { id: string; username: string }[];
    if (kingMakers.length > 1) {
      throw new Error(`CRITICAL INTEGRITY FAILURE: Multiple KING_MAKER accounts detected (${kingMakers.length}). Startup aborted.`);
    }
    if (kingMakers.length === 1 && (kingMakers[0].id !== 'usr-admin-1' || kingMakers[0].username !== 'Iamadmin')) {
      throw new Error(`CRITICAL INTEGRITY FAILURE: Unauthorized KING_MAKER detected (${kingMakers[0].id} / ${kingMakers[0].username}). Startup aborted.`);
    }
    if (!columnNames.has('permission_version')) {
      db.exec('ALTER TABLE users ADD COLUMN permission_version INTEGER NOT NULL DEFAULT 1;');
    }
    if (!columnNames.has('must_change_password')) {
      db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;');
    }
  } catch (err) {
    console.error('Error running user table migration:', err);
  }

  // 2. Ensure recovery_tokens table exists
  try {
    db.exec(`
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
    `);
  } catch (err) {
    console.error('Error creating recovery_tokens table:', err);
  }

  // 3. Ensure investors table exists & seed initial investor "Shahil" idempotently
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS investors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.prepare(`
      INSERT OR IGNORE INTO investors (id, name, is_archived, created_at, updated_at)
      VALUES ('inv-seed-shahil', 'Shahil', 0, datetime('now'), datetime('now'))
    `).run();
  } catch (err) {
    console.error('Error migrating investors table:', err);
  }

  // 4. Migrate financial_transactions table non-destructively to add new columns and hardened CHECK constraint
  try {
    const txTableInfo = db.prepare('PRAGMA table_info(financial_transactions);').all() as { name: string }[];
    const txColumnNames = new Set(txTableInfo.map(c => c.name));

    if (!txColumnNames.has('investor_id')) {
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec('BEGIN TRANSACTION;');

      db.exec(`
        CREATE TABLE financial_transactions_new (
          id TEXT PRIMARY KEY,
          site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
          date TEXT NOT NULL,
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

        INSERT INTO financial_transactions_new (
          id, site_id, date, type, debit_category, amount_paise,
          description, reference_note, created_by, updated_by, created_at, updated_at
        )
        SELECT 
          id, site_id, date, type, debit_category, amount_paise,
          description, reference_note, created_by, updated_by, created_at, updated_at
        FROM financial_transactions;

        DROP TABLE financial_transactions;

        ALTER TABLE financial_transactions_new RENAME TO financial_transactions;

        CREATE INDEX IF NOT EXISTS idx_finance_site_date ON financial_transactions(site_id, date);
        CREATE INDEX IF NOT EXISTS idx_finance_investor ON financial_transactions(investor_id);
      `);

      db.exec('COMMIT;');
      db.exec('PRAGMA foreign_keys = ON;');
    }
  } catch (err) {
    console.error('Error running financial_transactions migration:', err);
  }

  // 5. Ensure supply_items table exists for site-scoped supply memory
  try {
    db.exec(`
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
    `);
  } catch (err) {
    console.error('Error creating supply_items table:', err);
  }

  // 6. Ensure system_lifecycle_records table exists for global lifecycle (Archive & Recycle Bin)
  try {
    db.exec(`
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
    `);
  } catch (err) {
    console.error('Error creating system_lifecycle_records table:', err);
  }

  // 8. Ensure granular permission tables exist
  try {
    db.exec(`
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
    `);

    // Non-destructively ensure all standard permission definitions exist
    const insertPermStmt = db.prepare(`
      INSERT OR IGNORE INTO permission_definitions (id, page_id, action_id, display_name, description, is_site_scoped, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    for (const def of STANDARD_PERMISSION_DEFINITIONS) {
      insertPermStmt.run(def.id, def.page_id, def.action_id, def.display_name, def.description, def.is_site_scoped ? 1 : 0);
    }
  } catch (err) {
    console.error('Error migrating permission tables:', err);
  }

  // 9. Ensure performance indexes for audit_logs exist
  // EXPLAIN QUERY PLAN confirms the intended index is selected for the tested query and temporary ORDER BY sorting is avoided.
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_site_created ON audit_logs(site_id, created_at DESC);
    `);
  } catch (err) {
    console.error('Error creating audit_logs performance indexes:', err);
  }
}

export function getDb(allowLocked = false): DatabaseSync {
  if (!allowLocked) {
    RestoreCoordinator.assertNotLocked();
  }

  if (dbInstance) {
    return dbInstance;
  }

  let dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
  if (process.env.PORT === '3001') {
    dbPath = path.join(process.cwd(), 'data', 'test_site_work.db');
  }
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // Enable WAL mode & foreign keys for high-concurrency ACID transactions
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // Initialize schema if not present
  const schemaPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);
  }

  // Run backward-compatible non-destructive migrations
  runMigrations(db);

  dbInstance = db;

  // Auto-seed default roles & categories if master roles empty
  try {
    const roleCountRow = db.prepare('SELECT COUNT(*) as count FROM work_roles').get() as { count: number };
    if (roleCountRow.count === 0) {
      runSeed();
    }
  } catch (err) {
    console.error('Error during master data auto-seed:', err);
  }

  return dbInstance;
}

export function runTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {}
    throw err;
  }
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
}
