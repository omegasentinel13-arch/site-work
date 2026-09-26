import { getDb } from '../db';
import type { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';

export interface AuditEntry {
  entityType: 
    | 'ATTENDANCE' 
    | 'FINANCE' 
    | 'SITE' 
    | 'ROLE' 
    | 'CATEGORY'
    | 'RATE' 
    | 'USER' 
    | 'AUTH' 
    | 'SECURITY' 
    | 'EXPORT' 
    | 'LIFECYCLE'
    | 'NAVIGATION'
    | 'PERMISSION'
    | 'ACCESS_REQUEST';
  entityId: string;
  action: 
    | 'CREATE' 
    | 'UPDATE' 
    | 'DELETE' 
    | 'ARCHIVE' 
    | 'DEACTIVATE' 
    | 'ACTIVATE'
    | 'LOGIN_SUCCESS'
    | 'LOGIN_FAILURE'
    | 'LOGOUT'
    | 'ADMIN_SETUP'
    | 'USERNAME_CHANGE'
    | 'PASSWORD_CHANGE'
    | 'PASSWORD_RESET'
    | 'RECOVERY_REQUEST'
    | 'RECOVERY_COMPLETE'
    | 'RECOVERY_EMAIL_CHANGE'
    | 'RECOVERY_EMAIL_CHANGED'
    | 'USER_CREATE'
    | 'USER_CREATED'
    | 'USER_UPDATE'
    | 'USER_UPDATED'
    | 'USER_DELETE'
    | 'ACCOUNT_ACTIVATED'
    | 'ACCOUNT_DEACTIVATED'
    | 'USER_ACTIVATED'
    | 'USER_DEACTIVATED'
    | 'USERNAME_CHANGE'
    | 'USERNAME_CHANGED'
    | 'ROLE_CHANGED'
    | 'COMPLETE_EXPORT_REQUESTED'
    | 'COMPLETE_EXPORT_GENERATED'
    | 'COMPLETE_EXPORT_FAILED'
    | 'FINANCE_TRANSACTION_CREATED'
    | 'FINANCE_INVESTOR_CREATED'
    | 'FINANCE_INVESTOR_ARCHIVED'
    | 'SITE_ARCHIVED'
    | 'SITE_RECYCLED'
    | 'SITE_RESTORED'
    | 'SITE_MOVED_TO_RECYCLE_BIN'
    | 'SITE_DELETED_TO_RECYCLE_BIN'
    | 'SITE_RESTORED_FROM_RECYCLE_BIN'
    | 'SITE_PERMANENTLY_DELETED'
    | 'SITE_KEEP_PERMANENTLY_TOGGLED'
    | 'ROLE_CREATED'
    | 'ROLE_UPDATED'
    | 'ROLE_ACTIVATED'
    | 'ROLE_DEACTIVATED'
    | 'ROLE_ARCHIVED'
    | 'ROLE_RECYCLED'
    | 'ROLE_DELETED_TO_RECYCLE_BIN'
    | 'ROLE_RESTORED'
    | 'ROLE_RESTORED_FROM_RECYCLE_BIN'
    | 'ROLE_PERMANENTLY_DELETED'
    | 'CATEGORY_CREATED'
    | 'CATEGORY_UPDATED'
    | 'CATEGORY_ACTIVATED'
    | 'CATEGORY_DEACTIVATED'
    | 'CATEGORY_ARCHIVED'
    | 'CATEGORY_RECYCLED'
    | 'CATEGORY_DELETED_TO_RECYCLE_BIN'
    | 'CATEGORY_RESTORED'
    | 'CATEGORY_RESTORED_FROM_RECYCLE_BIN'
    | 'CATEGORY_PERMANENTLY_DELETED'
    | 'SITE_ROLE_RATE_UPDATED'
    | 'SITE_ROLE_RATE_REMOVED'
    | 'PAGE_HIDDEN'
    | 'PAGE_SHOWN'
    | 'PERMISSION_GRANTED'
    | 'PERMISSION_DENIED'
    | 'PERMISSION_REMOVED'
    | 'ROLE_PERMISSION_CHANGED'
    | 'PERMISSIONS_BATCH_UPDATED'
    | 'SITE_ACCESS_CHANGED'
    | 'REQUEST_SUBMITTED'
    | 'REQUEST_VIEWED'
    | 'REQUEST_APPROVED'
    | 'REQUEST_DENIED'
    | 'REQUEST_CANCELLED'
    | 'REQUEST_EXPIRED'
    | 'NOTIFICATION_SENT'
    | 'NOTIFICATION_FAILED'
    | 'EMAIL_LINK_CHANGED'
    | 'REQUEST_HISTORY_DELETED'
    | 'REQUEST_DELETED';
  siteId?: string | null;
  userId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}

const REDACTED_KEYS = new Set([
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'passwordplaintext',
  'password_hash',
  'passwordhash',
  'token',
  'token_hash',
  'tokenhash',
  'otp',
  'recoverytoken',
  'recoverycode',
  'secret',
  'session_secret'
]);

function sanitizePayload(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null;

  const sanitized: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (REDACTED_KEYS.has(lower)) {
      continue; // Strictly omit sensitive fields
    }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      sanitized[key] = sanitizePayload(val as Record<string, unknown>);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export function logAudit(entry: AuditEntry): { id: string } | null {
  try {
    const db = getDb();
    const id = `aud-${crypto.randomUUID()}`;
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const cleanBefore = sanitizePayload(entry.beforeState);
    const cleanAfter = sanitizePayload(entry.afterState);

    stmt.run(
      id,
      entry.entityType,
      entry.entityId,
      entry.action,
      entry.siteId || null,
      entry.userId || null,
      cleanBefore ? JSON.stringify(cleanBefore) : null,
      cleanAfter ? JSON.stringify(cleanAfter) : null
    );
    return { id };
  } catch (err) {
    console.error('Failed to write audit log entry:', err);
    return null;
  }
}

/**
 * Transaction-compatible audit writer.
 * Participates in an already-open database transaction.
 * Does NOT swallow errors: throws immediately if audit insertion fails,
 * forcing SQLite to rollback the surrounding business mutation.
 */
export function logAuditInTransaction(db: DatabaseSync, entry: AuditEntry): void {
  const id = `aud-${crypto.randomUUID()}`;
  const stmt = db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  const cleanBefore = sanitizePayload(entry.beforeState);
  const cleanAfter = sanitizePayload(entry.afterState);

  stmt.run(
    id,
    entry.entityType,
    entry.entityId,
    entry.action,
    entry.siteId || null,
    entry.userId || null,
    cleanBefore ? JSON.stringify(cleanBefore) : null,
    cleanAfter ? JSON.stringify(cleanAfter) : null
  );
}
