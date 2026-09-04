import { getDb, runTransaction } from '../index';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export interface UserDbRecord {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  recovery_email: string | null;
  token_version: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function getUserByUsername(username: string): UserDbRecord | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM users WHERE username = ? COLLATE NOCASE`).get(username.trim()) as UserDbRecord) || null;
}

export function getUserById(id: string): UserDbRecord | null {
  const db = getDb();
  return (db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserDbRecord) || null;
}

export function getAllUsers(): UserDbRecord[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM users ORDER BY role ASC, full_name ASC`).all() as UserDbRecord[];
}

export function getUserAssignedSites(userId: string): string[] {
  const db = getDb();
  const rows = db.prepare(`SELECT site_id FROM site_users WHERE user_id = ?`).all(userId) as { site_id: string }[];
  return rows.map(r => r.site_id);
}

export function hasAdminUser(): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN'`).get() as { count: number };
  return (row?.count || 0) > 0;
}

export function countActiveAdmins(): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND is_active = 1`).get() as { count: number };
  return row?.count || 0;
}

export function createUser(data: {
  username: string;
  passwordPlainText?: string;
  passwordHash?: string;
  fullName: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  recoveryEmail?: string | null;
  siteIds?: string[];
}): string {
  const db = getDb();
  const id = `usr-${crypto.randomUUID()}`;
  const hash = data.passwordHash || (data.passwordPlainText ? bcrypt.hashSync(data.passwordPlainText, 10) : '');

  if (!hash) {
    throw new Error('Password is required to create a user account');
  }

  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, recovery_email, token_version, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 1, datetime('now'), datetime('now'))
  `);

  const insertSiteUser = db.prepare(`
    INSERT INTO site_users (id, site_id, user_id, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  runTransaction(db, () => {
    insertUser.run(
      id, 
      data.username.trim(), 
      hash, 
      data.fullName.trim(), 
      data.role, 
      data.recoveryEmail ? data.recoveryEmail.trim().toLowerCase() : null
    );

    if (data.siteIds && data.siteIds.length > 0) {
      for (const siteId of data.siteIds) {
        insertSiteUser.run(`su-${crypto.randomUUID()}`, siteId, id);
      }
    }
  });

  return id;
}

export function updateUser(data: {
  id: string;
  fullName: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  isActive: boolean;
  recoveryEmail?: string | null;
  siteIds?: string[];
}): void {
  const db = getDb();

  // Guard: If deactivating an admin or changing admin role, ensure at least 1 active admin remains
  if (data.role !== 'ADMIN' || !data.isActive) {
    const existing = getUserById(data.id);
    if (existing && existing.role === 'ADMIN') {
      const activeAdminCount = countActiveAdmins();
      if (activeAdminCount <= 1 && existing.is_active === 1) {
        throw new Error('Cannot deactivate or remove the role of the last active Administrator.');
      }
    }
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE users 
      SET full_name = ?, role = ?, is_active = ?, recovery_email = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      data.fullName.trim(), 
      data.role, 
      data.isActive ? 1 : 0, 
      data.recoveryEmail !== undefined ? (data.recoveryEmail ? data.recoveryEmail.trim().toLowerCase() : null) : null,
      data.id
    );

    if (data.siteIds !== undefined) {
      db.prepare(`DELETE FROM site_users WHERE user_id = ?`).run(data.id);
      const insertSiteUser = db.prepare(`INSERT INTO site_users (id, site_id, user_id, created_at) VALUES (?, ?, ?, datetime('now'))`);
      for (const siteId of data.siteIds) {
        insertSiteUser.run(`su-${crypto.randomUUID()}`, siteId, data.id);
      }
    }

    // If account was deactivated, increment token version to kill active sessions immediately
    if (!data.isActive) {
      db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).run(data.id);
    }
  });
}

export function updateUsername(userId: string, newUsername: string): void {
  const db = getDb();
  const normalized = newUsername.trim();

  // Check uniqueness
  const existing = db.prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id != ?`).get(normalized, userId);
  if (existing) {
    throw new Error('Username already in use. Please choose another username.');
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE users 
      SET username = ?, token_version = token_version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(normalized, userId);
  });
}

export function updatePassword(userId: string, newPasswordPlainText: string): void {
  const db = getDb();
  const hash = bcrypt.hashSync(newPasswordPlainText, 10);

  runTransaction(db, () => {
    db.prepare(`
      UPDATE users 
      SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(hash, userId);
  });
}

export function updateRecoveryEmail(userId: string, email: string): void {
  const db = getDb();
  const normalized = email.trim().toLowerCase();

  db.prepare(`
    UPDATE users 
    SET recovery_email = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(normalized, userId);
}

export function incrementTokenVersion(userId: string): number {
  const db = getDb();
  db.prepare(`UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`).run(userId);
  const user = getUserById(userId);
  return user?.token_version || 1;
}

export function deleteUser(userId: string, actingAdminId: string): void {
  const db = getDb();
  const user = getUserById(userId);
  if (!user) {
    throw new Error('User not found.');
  }

  // 1. Prevent deleting the last active administrator
  if (user.role === 'ADMIN' && user.is_active === 1) {
    const activeAdmins = countActiveAdmins();
    if (activeAdmins <= 1) {
      throw new Error('Cannot delete the last active Administrator account.');
    }
  }

  // 2. Attendance record protection: created_by or updated_by
  const attendanceCount = (db.prepare(`
    SELECT COUNT(*) as c FROM attendance_records WHERE created_by = ? OR updated_by = ?
  `).get(userId, userId) as { c: number }).c;
  if (attendanceCount > 0) {
    throw new Error('User has authored attendance records and cannot be permanently deleted. Deactivate the account instead.');
  }

  // 3. Financial record protection: created_by or updated_by
  const financeCount = (db.prepare(`
    SELECT COUNT(*) as c FROM financial_transactions WHERE created_by = ? OR updated_by = ?
  `).get(userId, userId) as { c: number }).c;
  if (financeCount > 0) {
    throw new Error('User has authored financial records and cannot be permanently deleted. Deactivate the account instead.');
  }

  // 4. Site ownership protection: created_by
  const siteCount = (db.prepare(`
    SELECT COUNT(*) as c FROM sites WHERE created_by = ?
  `).get(userId) as { c: number }).c;
  if (siteCount > 0) {
    throw new Error('User has created construction sites and cannot be permanently deleted. Deactivate the account instead.');
  }

  // 5 & 6. Transactionally coupled delete & audit inside ONE atomic transaction
  runTransaction(db, () => {
    // a. Preserve historical audit logs by disassociating foreign key
    db.prepare(`UPDATE audit_logs SET user_id = NULL WHERE user_id = ?`).run(userId);

    // b. Clean up site assignments
    db.prepare(`DELETE FROM site_users WHERE user_id = ?`).run(userId);

    // c. Clean up recovery tokens
    db.prepare(`DELETE FROM recovery_tokens WHERE user_id = ?`).run(userId);

    // d. Transactionally insert USER_DELETE audit record inside this exact transaction
    db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
      VALUES (?, 'SECURITY', ?, 'USER_DELETE', NULL, ?, ?, ?, datetime('now'))
    `).run(
      `audit-${crypto.randomUUID()}`,
      userId,
      actingAdminId,
      JSON.stringify({
        username: user.username,
        fullName: user.full_name,
        role: user.role,
      }),
      JSON.stringify({ deleted: true })
    );

    // e. Delete user record
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  });
}


