import { getDb } from '../db';
import crypto from 'crypto';

export interface AuditEntry {
  entityType: 'ATTENDANCE' | 'FINANCE' | 'SITE' | 'ROLE' | 'RATE' | 'USER' | 'AUTH' | 'SECURITY';
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
    | 'USER_CREATE'
    | 'USER_UPDATE'
    | 'USER_DELETE'
    | 'ACCOUNT_ACTIVATED'
    | 'ACCOUNT_DEACTIVATED';
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

export function logAudit(entry: AuditEntry): void {
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
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
