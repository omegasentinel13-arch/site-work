import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { runSeed } from './seed';

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
}

export function getDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
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
