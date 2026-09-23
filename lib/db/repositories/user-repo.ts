import { getDb, runTransaction } from '../index';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { 
  AuthorityTier, 
  AuthorityPrincipal, 
  isKingMaker,
  isSuperiorPrime, 
  canManageAuthority, 
  canModifyCredentials, 
  canAssignAuthorityTier, 
  canDeleteUser 
} from '@/lib/auth/authority';
import { DatabaseSync } from 'node:sqlite';

export interface UserDbRecord {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
  authority_tier: AuthorityTier;
  recovery_email: string | null;
  token_version: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function hasPrimeAuthority(db?: DatabaseSync): boolean {
  try {
    const database = db || getDb();
    const row = database.prepare("SELECT COUNT(*) as count FROM users WHERE authority_tier IN ('KING_MAKER', 'SUPERIOR_PRIME', 'CLIENT_PRIME')").get() as { count: number };
    return (row?.count || 0) > 0;
  } catch {
    return false;
  }
}

export function getUserByUsername(
  username: string, 
  actingActor?: AuthorityPrincipal | null
): UserDbRecord | null {
  const db = getDb();
  if (typeof username !== 'string' || !username) {
    return null;
  }
  const row = (db.prepare(`SELECT * FROM users WHERE username = ? COLLATE BINARY`).get(username) as UserDbRecord) || null;
  if (!row) return null;
  if (row.username !== username) return null;

  const actorId = actingActor?.id || (actingActor as any)?.userId;

  // Protect King Maker from discovery if caller is an operational user
  if (row.authority_tier === 'KING_MAKER' && actingActor && !isKingMaker(actingActor)) {
    if (actorId !== row.id) {
      return null;
    }
  }

  // Protect Superior Prime from discovery if caller is an operational user
  if (row.authority_tier === 'SUPERIOR_PRIME' && actingActor && !isSuperiorPrime(actingActor) && !isKingMaker(actingActor)) {
    if (actorId !== row.id) {
      return null;
    }
  }

  return row;
}

export function getUserById(
  id: string, 
  actingActor?: AuthorityPrincipal | null
): UserDbRecord | null {
  const db = getDb();
  const row = (db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserDbRecord) || null;
  if (!row) return null;

  const actorId = actingActor?.id || (actingActor as any)?.userId;

  // Protect King Maker from discovery if caller is an operational user
  if (row.authority_tier === 'KING_MAKER' && actingActor && !isKingMaker(actingActor)) {
    if (actorId !== row.id) {
      return null;
    }
  }

  // Protect Superior Prime from discovery if caller is an operational user
  if (row.authority_tier === 'SUPERIOR_PRIME' && actingActor && !isSuperiorPrime(actingActor) && !isKingMaker(actingActor)) {
    if (actorId !== row.id) {
      return null;
    }
  }

  return row;
}

export function getAllUsers(actingActor?: AuthorityPrincipal | null): UserDbRecord[] {
  const db = getDb();
  const actorId = actingActor?.id || (actingActor as any)?.userId;

  if (actingActor && isKingMaker(actingActor)) {
    // King Maker caller: include own KING_MAKER record, plus all eligible lower users
    if (actorId) {
      return db.prepare(`
        SELECT * FROM users 
        WHERE (authority_tier NOT IN ('KING_MAKER', 'SUPERIOR_PRIME')) 
           OR (authority_tier = 'KING_MAKER' AND id = ?)
        ORDER BY 
          CASE WHEN authority_tier = 'KING_MAKER' THEN 0 ELSE 1 END,
          role ASC, 
          full_name ASC
      `).all(actorId) as UserDbRecord[];
    }
    return db.prepare(`
      SELECT * FROM users 
      WHERE (authority_tier NOT IN ('KING_MAKER', 'SUPERIOR_PRIME')) 
         OR (authority_tier = 'KING_MAKER')
      ORDER BY 
        CASE WHEN authority_tier = 'KING_MAKER' THEN 0 ELSE 1 END,
        role ASC, 
        full_name ASC
    `).all() as UserDbRecord[];
  }

  // All other callers (CLIENT_PRIME, STANDARD_ADMIN, STANDARD, null):
  // King Maker and Superior Prime are permanently excluded from directory listing
  return db.prepare(`
    SELECT * FROM users 
    WHERE authority_tier NOT IN ('KING_MAKER', 'SUPERIOR_PRIME') 
    ORDER BY role ASC, full_name ASC
  `).all() as UserDbRecord[];
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

export function countActiveAdmins(actingActor?: AuthorityPrincipal | null): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND is_active = 1 AND authority_tier NOT IN ('KING_MAKER', 'SUPERIOR_PRIME')`).get() as { count: number };
  return row?.count || 0;
}

export function createUser(
  data: {
    username: string;
    passwordPlainText?: string;
    passwordHash?: string;
    fullName: string;
    role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
    authorityTier?: AuthorityTier;
    recoveryEmail?: string | null;
    siteIds?: string[];
    isActive?: boolean;
    mustChangePassword?: boolean;
  },
  actingActor?: AuthorityPrincipal | null
): string {
  const db = getDb();
  const id = `usr-${crypto.randomUUID()}`;

  // 1. Username validation & normalization
  const normalizedUsername = data.username.trim();
  if (!normalizedUsername || normalizedUsername.length < 3) {
    throw new Error('Username must be at least 3 characters long.');
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(normalizedUsername)) {
    throw new Error('Username can only contain alphanumeric characters, underscores, hyphens, and periods.');
  }

  // Pre-check case-insensitive collision
  const existingUser = db.prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`).get(normalizedUsername);
  if (existingUser) {
    throw new Error('Username already in use. Please choose another username.');
  }

  // 2. Password validation
  const hash = data.passwordHash || (data.passwordPlainText ? bcrypt.hashSync(data.passwordPlainText, 10) : '');
  if (!hash) {
    throw new Error('Password is required to create a user account');
  }

  // 3. Full name validation
  if (!data.fullName || !data.fullName.trim()) {
    throw new Error('Full name is required.');
  }

  // 4. Recovery email validation
  let normalizedRecoveryEmail: string | null = null;
  if (data.recoveryEmail && data.recoveryEmail.trim()) {
    normalizedRecoveryEmail = data.recoveryEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedRecoveryEmail)) {
      throw new Error('Invalid recovery email format.');
    }
  }

  // 5. Determine requested authority tier
  const requestedTier: AuthorityTier = data.authorityTier || (data.role === 'ADMIN' ? 'STANDARD_ADMIN' : 'STANDARD');

  // Hard security: KING_MAKER and SUPERIOR_PRIME cannot be created via standard user creation
  if (requestedTier === 'KING_MAKER' || requestedTier === 'SUPERIOR_PRIME') {
    throw new Error(`${requestedTier} accounts cannot be created via user management interfaces.`);
  }

  // Validate tier assignment permission
  if (actingActor && !canAssignAuthorityTier(actingActor, requestedTier)) {
    throw new Error(`Insufficient authority to create a user with authority tier '${requestedTier}'.`);
  }

  // If role is ADMIN, caller must have permission to assign STANDARD_ADMIN (i.e. Prime authority or Standard Admin peer provisioning)
  if (data.role === 'ADMIN' && actingActor && !canAssignAuthorityTier(actingActor, 'STANDARD_ADMIN')) {
    throw new Error('Insufficient authority to create an Administrator account.');
  }

  const tableInfo = db.prepare('PRAGMA table_info(users);').all() as { name: string }[];
  const hasMustChange = tableInfo.some(c => c.name === 'must_change_password');

  const insertUser = hasMustChange
    ? db.prepare(`
        INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, permission_version, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, datetime('now'), datetime('now'))
      `)
    : db.prepare(`
        INSERT INTO users (id, username, password_hash, full_name, role, authority_tier, recovery_email, token_version, is_active, permission_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, datetime('now'), datetime('now'))
      `);

  const insertSiteUser = db.prepare(`
    INSERT INTO site_users (id, site_id, user_id, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `);

  const initialIsActive = data.isActive !== false ? 1 : 0;
  const initialMustChange = data.mustChangePassword ? 1 : 0;

  runTransaction(db, () => {
    if (hasMustChange) {
      insertUser.run(
        id, 
        normalizedUsername, 
        hash, 
        data.fullName.trim(), 
        data.role, 
        requestedTier,
        normalizedRecoveryEmail,
        initialIsActive,
        initialMustChange
      );
    } else {
      insertUser.run(
        id, 
        normalizedUsername, 
        hash, 
        data.fullName.trim(), 
        data.role, 
        requestedTier,
        normalizedRecoveryEmail,
        initialIsActive
      );
    }

    if (data.siteIds && data.siteIds.length > 0) {
      for (const siteId of data.siteIds) {
        insertSiteUser.run(`su-${crypto.randomUUID()}`, siteId, id);
      }
    }
  });

  return id;
}

export function updateUser(
  data: {
    id: string;
    fullName: string;
    role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER';
    authorityTier?: AuthorityTier;
    isActive: boolean;
    recoveryEmail?: string | null;
    siteIds?: string[];
  },
  actingActor?: AuthorityPrincipal | null
): void {
  const db = getDb();
  const existing = getUserById(data.id, null);
  if (!existing) {
    throw new Error('User not found.');
  }

  // Security check: authority hierarchy
  if (actingActor) {
    if (!canManageAuthority(actingActor, existing)) {
      throw new Error('Insufficient authority to modify this user.');
    }
    if (data.authorityTier && data.authorityTier !== existing.authority_tier) {
      if (!canAssignAuthorityTier(actingActor, data.authorityTier)) {
        throw new Error(`Insufficient authority to assign authority tier '${data.authorityTier}'.`);
      }
    }
    // Standard admin cannot escalate role to ADMIN
    if (data.role === 'ADMIN' && existing.role !== 'ADMIN') {
      if (!canAssignAuthorityTier(actingActor, 'STANDARD_ADMIN')) {
        throw new Error('Insufficient authority to promote a user to Administrator.');
      }
    }
    // Prevent self-deactivation
    const actorId = actingActor.id || (actingActor as any).userId;
    if (actorId === data.id && !data.isActive) {
      throw new Error('You cannot deactivate your own active administrator account.');
    }
  }

  // Explicit King Maker protection
  if (existing.authority_tier === 'KING_MAKER') {
    if (data.authorityTier && data.authorityTier !== 'KING_MAKER') {
      throw new Error('King Maker authority tier cannot be altered or downgraded.');
    }
    if (data.isActive === false) {
      throw new Error('King Maker account cannot be deactivated.');
    }
    if (data.role && data.role !== 'ADMIN') {
      throw new Error('King Maker operational role cannot be altered.');
    }
  }

  if (!data.fullName || !data.fullName.trim()) {
    throw new Error('Full name is required.');
  }

  let normalizedRecoveryEmail: string | null = null;
  if (data.recoveryEmail !== undefined) {
    if (data.recoveryEmail && data.recoveryEmail.trim()) {
      normalizedRecoveryEmail = data.recoveryEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedRecoveryEmail)) {
        throw new Error('Invalid recovery email format.');
      }
    }
  } else {
    normalizedRecoveryEmail = existing.recovery_email;
  }

  const newTier: AuthorityTier = data.authorityTier || existing.authority_tier;

  // Guard: If deactivating an admin or changing admin role, ensure at least 1 active admin remains
  if (data.role !== 'ADMIN' || !data.isActive) {
    if (existing.role === 'ADMIN') {
      const activeAdminCount = countActiveAdmins(actingActor);
      if (activeAdminCount <= 1 && existing.is_active === 1) {
        throw new Error('Cannot deactivate or remove the role of the last active Administrator.');
      }
    }
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE users 
      SET full_name = ?, role = ?, authority_tier = ?, is_active = ?, recovery_email = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      data.fullName.trim(), 
      data.role, 
      newTier,
      data.isActive ? 1 : 0, 
      normalizedRecoveryEmail,
      data.id
    );

    if (data.siteIds !== undefined) {
      db.prepare(`DELETE FROM site_users WHERE user_id = ?`).run(data.id);
      const insertSiteUser = db.prepare(`INSERT INTO site_users (id, site_id, user_id, created_at) VALUES (?, ?, ?, datetime('now'))`);
      for (const siteId of data.siteIds) {
        insertSiteUser.run(`su-${crypto.randomUUID()}`, siteId, data.id);
      }
    }

    // Atomically increment permission_version ONLY when authorization-bearing attributes change
    // (role, authority tier, active status, or site assignments).
    // Name-only or email-only updates do not unnecessarily invalidate permission cache.
    const authChanged = 
      data.role !== existing.role ||
      newTier !== existing.authority_tier ||
      (data.isActive ? 1 : 0) !== existing.is_active ||
      data.siteIds !== undefined;

    if (authChanged) {
      try {
        db.prepare(`UPDATE users SET permission_version = permission_version + 1 WHERE id = ?`).run(data.id);
      } catch {
        // Safe fallback if permission_version is not yet present
      }
    }

    // If account was deactivated, increment token version to kill active sessions immediately
    if (!data.isActive && existing.is_active === 1) {
      db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).run(data.id);
    }
  });
}

export function updateUsername(
  userId: string, 
  newUsername: string,
  actingActor?: AuthorityPrincipal | null
): void {
  const db = getDb();
  const targetUser = getUserById(userId, null);
  if (!targetUser) {
    throw new Error('User not found.');
  }

  if (actingActor && !canModifyCredentials(actingActor, targetUser)) {
    throw new Error('Insufficient authority to change username for this user.');
  }

  const normalized = newUsername.trim();
  if (!normalized || normalized.length < 3) {
    throw new Error('Username must be at least 3 characters long.');
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(normalized)) {
    throw new Error('Username can only contain alphanumeric characters, underscores, hyphens, and periods.');
  }

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

export function updatePassword(
  userId: string, 
  newPasswordPlainText: string,
  actingActor?: AuthorityPrincipal | null
): void {
  const db = getDb();
  const targetUser = getUserById(userId, null);
  if (!targetUser) {
    throw new Error('User not found.');
  }

  if (actingActor && !canModifyCredentials(actingActor, targetUser)) {
    throw new Error('Insufficient authority to reset password for this user.');
  }

  if (!newPasswordPlainText || newPasswordPlainText.length < 8) {
    throw new Error('Password must be at least 8 characters long.');
  }

  const hash = bcrypt.hashSync(newPasswordPlainText, 10);

  const tableInfo = db.prepare('PRAGMA table_info(users);').all() as { name: string }[];
  const hasMustChange = tableInfo.some(c => c.name === 'must_change_password');

  runTransaction(db, () => {
    if (hasMustChange) {
      db.prepare(`
        UPDATE users 
        SET password_hash = ?, token_version = token_version + 1, must_change_password = 0, updated_at = datetime('now')
        WHERE id = ?
      `).run(hash, userId);
    } else {
      db.prepare(`
        UPDATE users 
        SET password_hash = ?, token_version = token_version + 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(hash, userId);
    }
  });
}

export function updateRecoveryEmail(
  userId: string, 
  email: string | null,
  actingActor?: AuthorityPrincipal | null
): void {
  const db = getDb();
  const targetUser = getUserById(userId, null);
  if (!targetUser) {
    throw new Error('User not found.');
  }

  if (actingActor && !canModifyCredentials(actingActor, targetUser)) {
    throw new Error('Insufficient authority to update recovery email for this user.');
  }

  let normalized: string | null = null;
  if (email && email.trim()) {
    normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error('Invalid recovery email format.');
    }
  }

  db.prepare(`
    UPDATE users 
    SET recovery_email = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(normalized, userId);
}

export function setUserActiveState(
  userId: string,
  isActive: boolean,
  actingActor?: AuthorityPrincipal | null
): void {
  const db = getDb();
  const targetUser = getUserById(userId, null);
  if (!targetUser) {
    throw new Error('User not found.');
  }

  if (targetUser.authority_tier === 'KING_MAKER' && !isActive) {
    throw new Error('King Maker account cannot be deactivated.');
  }

  if (actingActor) {
    if (!canManageAuthority(actingActor, targetUser)) {
      throw new Error('Insufficient authority to modify this user.');
    }
    const actorId = actingActor.id || (actingActor as any).userId;
    if (actorId === userId && !isActive) {
      throw new Error('You cannot deactivate your own active administrator account.');
    }
  }

  if (!isActive && targetUser.role === 'ADMIN') {
    const activeAdmins = countActiveAdmins(actingActor);
    if (activeAdmins <= 1 && targetUser.is_active === 1) {
      throw new Error('Cannot deactivate the last active Administrator.');
    }
  }

  runTransaction(db, () => {
    db.prepare(`
      UPDATE users 
      SET is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(isActive ? 1 : 0, userId);

    try {
      db.prepare(`UPDATE users SET permission_version = permission_version + 1 WHERE id = ?`).run(userId);
    } catch {}

    if (!isActive) {
      db.prepare(`UPDATE users SET token_version = token_version + 1 WHERE id = ?`).run(userId);
    }
  });
}

export function incrementTokenVersion(userId: string): number {
  const db = getDb();
  db.prepare(`UPDATE users SET token_version = token_version + 1, updated_at = datetime('now') WHERE id = ?`).run(userId);
  const user = getUserById(userId, null);
  return user?.token_version || 1;
}

export function deleteUser(
  userId: string, 
  actingAdmin: AuthorityPrincipal | string
): void {
  const db = getDb();
  const user = getUserById(userId, null);
  if (!user) {
    throw new Error('User not found.');
  }

  const actingPrincipal: AuthorityPrincipal = typeof actingAdmin === 'string'
    ? (getUserById(actingAdmin, null) || { role: 'ADMIN' })
    : actingAdmin;

  const resolvedActorId = (actingAdmin as any).userId || actingPrincipal.id || (typeof actingAdmin === 'string' ? actingAdmin : null);
  const actingAdminId = resolvedActorId && getUserById(resolvedActorId, null) ? resolvedActorId : null;

  // 1. King Maker & Prime identity protection: King Maker and Primes can NEVER be deleted
  if (user.authority_tier === 'KING_MAKER' || user.authority_tier === 'SUPERIOR_PRIME' || user.authority_tier === 'CLIENT_PRIME') {
    throw new Error('King Maker and Prime identities cannot be deleted.');
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

  // 5. Prevent deleting the last active administrator
  if (user.role === 'ADMIN' && user.is_active === 1) {
    const activeAdmins = countActiveAdmins(actingPrincipal);
    if (activeAdmins <= 1) {
      throw new Error('Cannot delete the last active Administrator account.');
    }
  }

  // 6. Authority check: Can acting authority delete target?
  if (hasPrimeAuthority(db)) {
    if (!canDeleteUser(actingPrincipal, user)) {
      throw new Error('Insufficient authority to delete this user.');
    }
  } else {
    // Legacy fallback: non-admins cannot delete, self-delete blocked
    if (actingPrincipal.role !== 'ADMIN') {
      throw new Error('Administrator privileges required.');
    }
    if (actingPrincipal.id === user.id) {
      throw new Error('You cannot delete your own active administrator account.');
    }
  }

  // 7 & 8. Transactionally coupled delete & audit inside ONE atomic transaction
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
        authorityTier: user.authority_tier,
      }),
      JSON.stringify({ deleted: true })
    );

    // e. Delete user record
    db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
  });
}
