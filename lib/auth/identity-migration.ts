import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb, runTransaction } from '../db';

export interface IdentityHandoverResult {
  success: boolean;
  superiorPrimeId: string;
  superiorPrimeUsername: string;
  clientPrimeId: string;
  clientPrimeUsername: string;
  auditId: string;
}

/**
 * Atomically executes the Dual Prime controlled identity handover:
 * 1. Validates existing usr-admin-1 identity, username ('Iamadmin'), and recovery email.
 * 2. Renames usr-admin-1 to a protected username (default: 'superior_prime'), promotes to SUPERIOR_PRIME, and increments token_version.
 * 3. Provisions new Client Prime usr-client-prime-1 claiming username 'Iamadmin' with CLIENT_PRIME authority tier.
 * 4. Generates an atomic IDENTITY_RESOLUTION_MIGRATION audit log entry attributed to usr-admin-1 with zero secret leakage.
 * 
 * Entire operation is wrapped in an atomic BEGIN IMMEDIATE transaction; rolls back on any error.
 */
export function executeDualPrimeIdentityHandover(options?: {
  db?: DatabaseSync;
  targetProtectedUsername?: string;
  clientPrimeUsername?: string;
  clientPrimeRecoveryEmail?: string;
  clientPrimePasswordPlainText?: string;
  clientPrimePasswordHash?: string;
}): IdentityHandoverResult {
  const db = options?.db || getDb();
  const protectedUsername = (options?.targetProtectedUsername || 'superior_prime').trim().toLowerCase();
  const clientUsername = (options?.clientPrimeUsername || 'Iamadmin').trim();
  const clientEmail = (options?.clientPrimeRecoveryEmail || 'supermanskypton@gmail.com').trim().toLowerCase();

  return runTransaction(db, () => {
    // 1. Verify usr-admin-1 exists
    const admin = db.prepare('SELECT * FROM users WHERE id = ?').get('usr-admin-1') as any;
    if (!admin) {
      throw new Error('Fatal: Existing admin identity usr-admin-1 does not exist.');
    }

    // 2. Verify expected current username is Iamadmin
    if (admin.username.toLowerCase() !== 'iamadmin') {
      throw new Error(`Fatal: usr-admin-1 username is expected to be 'Iamadmin', found '${admin.username}'.`);
    }

    // 3. Verify expected recovery email
    if (!admin.recovery_email || admin.recovery_email.toLowerCase() !== 'omegasentinel13@gmail.com') {
      throw new Error(`Fatal: usr-admin-1 recovery email is expected to be 'omegasentinel13@gmail.com', found '${admin.recovery_email}'.`);
    }

    // 4. Verify target protected username is available
    const existingProtected = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(protectedUsername);
    if (existingProtected) {
      throw new Error(`Fatal: Protected username '${protectedUsername}' is already taken by id '${(existingProtected as any).id}'.`);
    }

    // 5. Verify Client Prime ID does not exist
    const clientPrimeId = 'usr-client-prime-1';
    const existingClientPrime = db.prepare('SELECT id FROM users WHERE id = ?').get(clientPrimeId);
    if (existingClientPrime) {
      throw new Error(`Fatal: Client Prime identity '${clientPrimeId}' already exists.`);
    }

    // 6. Rename usr-admin-1 to protectedUsername, set authority_tier = 'SUPERIOR_PRIME', increment token_version
    db.prepare(`
      UPDATE users 
      SET username = ?, authority_tier = 'SUPERIOR_PRIME', token_version = token_version + 1, updated_at = datetime('now')
      WHERE id = 'usr-admin-1'
    `).run(protectedUsername);

    // 7. Hash Client Prime password
    let clientHash = options?.clientPrimePasswordHash;
    if (!clientHash) {
      const generatedPlainText = options?.clientPrimePasswordPlainText || `CP-${crypto.randomBytes(12).toString('hex')}!`;
      clientHash = bcrypt.hashSync(generatedPlainText, 10);
    }

    // 8. Insert Client Prime claiming 'Iamadmin'
    db.prepare(`
      INSERT INTO users (
        id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'ADMIN', 'CLIENT_PRIME', ?, 1, 1, datetime('now'), datetime('now'))
    `).run(
      clientPrimeId,
      clientUsername,
      clientHash,
      'Client Administrator',
      clientEmail
    );

    // 9. Log IDENTITY_RESOLUTION_MIGRATION audit event attributed to usr-admin-1 (Zero secrets)
    const auditId = `audit-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO audit_logs (
        id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at
      ) VALUES (?, 'SECURITY', 'usr-admin-1', 'IDENTITY_RESOLUTION_MIGRATION', NULL, 'usr-admin-1', ?, ?, datetime('now'))
    `).run(
      auditId,
      JSON.stringify({
        previousUsername: 'Iamadmin',
        previousAuthorityTier: admin.authority_tier || 'STANDARD_ADMIN',
        recoveryEmail: admin.recovery_email,
      }),
      JSON.stringify({
        newUsername: protectedUsername,
        newAuthorityTier: 'SUPERIOR_PRIME',
        recoveryEmail: admin.recovery_email,
        clientPrimeId,
        clientPrimeUsername: clientUsername,
        clientPrimeRecoveryEmail: clientEmail,
      })
    );

    return {
      success: true,
      superiorPrimeId: 'usr-admin-1',
      superiorPrimeUsername: protectedUsername,
      clientPrimeId,
      clientPrimeUsername: clientUsername,
      auditId,
    };
  });
}
