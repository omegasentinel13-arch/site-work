import { getDb, runTransaction } from '../index';
import crypto from 'crypto';

export interface RecoveryTokenRecord {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  is_used: number;
  attempts: number;
  created_at: string;
}

/**
 * Computes a SHA-256 hash of a plaintext OTP/token.
 */
export function hashToken(plainToken: string): string {
  return crypto.createHash('sha256').update(plainToken.trim()).digest('hex');
}

/**
 * Creates and stores a secure recovery OTP record for a user (valid for 15 minutes).
 * Atomically invalidates any previous unused tokens for the user.
 */
export function createRecoveryToken(userId: string, plainToken: string): { tokenId: string; expiresAt: string } {
  const db = getDb();
  const tokenId = `rec-${crypto.randomUUID()}`;
  const tokenHash = hashToken(plainToken);
  
  // 15 minutes expiration
  const expiresDate = new Date(Date.now() + 15 * 60 * 1000);
  const expiresAt = expiresDate.toISOString();

  runTransaction(db, () => {
    // Invalidate existing unused tokens for this user
    db.prepare(`UPDATE recovery_tokens SET is_used = 1 WHERE user_id = ? AND is_used = 0`).run(userId);

    // Insert new token record
    db.prepare(`
      INSERT INTO recovery_tokens (id, user_id, token_hash, expires_at, is_used, attempts, created_at)
      VALUES (?, ?, ?, ?, 0, 0, datetime('now'))
    `).run(tokenId, userId, tokenHash, expiresAt);
  });

  return { tokenId, expiresAt };
}

/**
 * Verifies a recovery token for a user.
 * Returns the token record if valid, or throws/returns null.
 */
export function verifyRecoveryToken(userId: string, plainToken: string): { valid: boolean; error?: string; tokenId?: string } {
  const db = getDb();
  const tokenHash = hashToken(plainToken);

  const row = db.prepare(`
    SELECT * FROM recovery_tokens 
    WHERE user_id = ? AND is_used = 0
    ORDER BY created_at DESC 
    LIMIT 1
  `).get(userId) as RecoveryTokenRecord | undefined;

  if (!row) {
    return { valid: false, error: 'No active recovery request found or code already used.' };
  }

  // Check attempt limit
  if (row.attempts >= 5) {
    db.prepare(`UPDATE recovery_tokens SET is_used = 1 WHERE id = ?`).run(row.id);
    return { valid: false, error: 'Too many failed attempts. This recovery code has been invalidated.' };
  }

  // Check expiration
  const now = new Date();
  const expiry = new Date(row.expires_at);
  if (now > expiry) {
    db.prepare(`UPDATE recovery_tokens SET is_used = 1 WHERE id = ?`).run(row.id);
    return { valid: false, error: 'Recovery code has expired. Please request a new code.' };
  }

  // Check hash match
  if (row.token_hash !== tokenHash) {
    db.prepare(`UPDATE recovery_tokens SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
    return { valid: false, error: 'Invalid recovery code.' };
  }

  return { valid: true, tokenId: row.id };
}

/**
 * Marks a recovery token as used and consumes it.
 */
export function consumeRecoveryToken(tokenId: string): void {
  const db = getDb();
  db.prepare(`UPDATE recovery_tokens SET is_used = 1 WHERE id = ?`).run(tokenId);
}
