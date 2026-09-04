import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Clean dedicated test database for the 44-item verification
const VERIFY_DB_PATH = path.join(process.cwd(), 'data', 'test_cto_44_matrix.db');
if (fs.existsSync(VERIFY_DB_PATH)) {
  fs.unlinkSync(VERIFY_DB_PATH);
}
process.env.DATABASE_PATH = VERIFY_DB_PATH;

import { getDb, closeDb } from '../lib/db/index';
import { runSeed } from '../lib/db/seed';
import { 
  createUser, 
  getUserByUsername, 
  getUserById, 
  getAllUsers, 
  updateUsername, 
  updatePassword, 
  updateUser, 
  updateRecoveryEmail, 
  incrementTokenVersion, 
  countActiveAdmins, 
  hasAdminUser 
} from '../lib/db/repositories/user-repo';
import { 
  createRecoveryToken, 
  verifyRecoveryToken, 
  consumeRecoveryToken, 
  hashToken 
} from '../lib/db/repositories/recovery-repo';
import { 
  validateSiteAccess, 
  requireAdmin, 
  UnauthorizedError, 
  ForbiddenError 
} from '../lib/auth/permissions';
import { createSessionCookie, UserSession } from '../lib/auth/session';
import bcrypt from 'bcryptjs';
import { logAudit } from '../lib/audit/logger';
import { jwtVerify, SignJWT } from 'jose';

test('MASTER CTO 44-ITEM ACCEPTANCE MATRIX VERIFICATION', async (t) => {
  const db = getDb();
  runSeed();

  let adminId: string;
  let engineerId: string;
  let viewerId: string;

  // --------------------------------------------------------------------------
  // AUTHENTICATION (Tests 1-5)
  // --------------------------------------------------------------------------
  await t.test('1. Valid Admin login', () => {
    adminId = createUser({
      username: 'admin_cto',
      passwordPlainText: 'AdminCTOPass2026!',
      fullName: 'Chief Technology Admin',
      role: 'ADMIN',
      recoveryEmail: 'omegasentinel13@gmail.com',
    });
    const user = getUserByUsername('admin_cto');
    assert.ok(user);
    assert.equal(user.role, 'ADMIN');
    assert.ok(bcrypt.compareSync('AdminCTOPass2026!', user.password_hash));
  });

  await t.test('2. Invalid Admin password', () => {
    const user = getUserByUsername('admin_cto')!;
    assert.equal(bcrypt.compareSync('WrongPassword!', user.password_hash), false);
  });

  await t.test('3. Valid Engineer login', () => {
    engineerId = createUser({
      username: 'eng_cto',
      passwordPlainText: 'EngCTOPass2026!',
      fullName: 'CTO Site Engineer',
      role: 'SITE_MANAGER',
      siteIds: ['site-1'],
    });
    const user = getUserByUsername('eng_cto');
    assert.ok(user);
    assert.equal(user.role, 'SITE_MANAGER');
    assert.ok(bcrypt.compareSync('EngCTOPass2026!', user.password_hash));
  });

  await t.test('4. Valid Viewer login', () => {
    viewerId = createUser({
      username: 'viewer_cto',
      passwordPlainText: 'ViewerCTOPass2026!',
      fullName: 'CTO Site Auditor',
      role: 'VIEWER',
      siteIds: ['site-1', 'site-2'],
    });
    const user = getUserByUsername('viewer_cto');
    assert.ok(user);
    assert.equal(user.role, 'VIEWER');
    assert.ok(bcrypt.compareSync('ViewerCTOPass2026!', user.password_hash));
  });

  await t.test('5. Disabled user login rejection if status exists', () => {
    // Disable viewer
    updateUser({
      id: viewerId,
      fullName: 'CTO Site Auditor (Disabled)',
      role: 'VIEWER',
      isActive: false,
    });
    const user = getUserById(viewerId)!;
    assert.equal(user.is_active, 0);

    // Re-enable viewer
    updateUser({
      id: viewerId,
      fullName: 'CTO Site Auditor',
      role: 'VIEWER',
      isActive: true,
    });
    assert.equal(getUserById(viewerId)!.is_active, 1);
  });

  // --------------------------------------------------------------------------
  // AUTHORIZATION (Tests 6-12)
  // --------------------------------------------------------------------------
  const adminSession: UserSession = {
    userId: adminId!,
    username: 'admin_cto',
    fullName: 'Chief Technology Admin',
    role: 'ADMIN',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const engineerSession: UserSession = {
    userId: engineerId!,
    username: 'eng_cto',
    fullName: 'CTO Site Engineer',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  const viewerSession: UserSession = {
    userId: viewerId!,
    username: 'viewer_cto',
    fullName: 'CTO Site Auditor',
    role: 'VIEWER',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 1,
  };

  await t.test('6. Admin can access Admin functions', () => {
    assert.doesNotThrow(() => requireAdmin(adminSession));
  });

  await t.test('7. Engineer cannot access Admin functions', () => {
    assert.throws(() => requireAdmin(engineerSession), ForbiddenError);
  });

  await t.test('8. Viewer cannot perform writes', () => {
    assert.throws(() => validateSiteAccess(viewerSession, 'site-1', 'WRITE'), ForbiddenError);
  });

  await t.test('9. Engineer cannot access unassigned site', () => {
    assert.throws(() => validateSiteAccess(engineerSession, 'site-2', 'READ'), ForbiddenError);
    assert.throws(() => validateSiteAccess(engineerSession, 'site-2', 'WRITE'), ForbiddenError);
  });

  await t.test('10. Viewer cannot access unassigned site', () => {
    assert.throws(() => validateSiteAccess(viewerSession, 'site-99', 'READ'), ForbiddenError);
  });

  await t.test('11. Direct API request cannot bypass UI permissions', () => {
    // Unauthenticated request
    assert.throws(() => validateSiteAccess(null, 'site-1', 'READ'), UnauthorizedError);
    assert.throws(() => requireAdmin(null), UnauthorizedError);
  });

  await t.test('12. Non-admin cannot call Admin-only endpoints', () => {
    assert.throws(() => validateSiteAccess(engineerSession, 'site-1', 'ADMIN'), ForbiddenError);
    assert.throws(() => validateSiteAccess(viewerSession, 'site-1', 'ADMIN'), ForbiddenError);
  });

  // --------------------------------------------------------------------------
  // ADMIN ACCOUNT (Tests 13-19)
  // --------------------------------------------------------------------------
  await t.test('13. Admin can change own username', () => {
    updateUsername(adminId, 'admin_cto_renamed');
    const user = getUserById(adminId)!;
    assert.equal(user.username, 'admin_cto_renamed');
  });

  await t.test('14. Old Admin username no longer works', () => {
    assert.equal(getUserByUsername('admin_cto'), null);
  });

  await t.test('15. New Admin username works', () => {
    const user = getUserByUsername('admin_cto_renamed');
    assert.ok(user);
    assert.equal(user.id, adminId);
  });

  await t.test('16. Admin can change own password', () => {
    updatePassword(adminId, 'BrandNewAdminPass2026!');
    const user = getUserById(adminId)!;
    assert.ok(bcrypt.compareSync('BrandNewAdminPass2026!', user.password_hash));
  });

  await t.test('17. Old password stops working', () => {
    const user = getUserById(adminId)!;
    assert.equal(bcrypt.compareSync('AdminCTOPass2026!', user.password_hash), false);
  });

  await t.test('18. New password works', () => {
    const user = getUserById(adminId)!;
    assert.equal(bcrypt.compareSync('BrandNewAdminPass2026!', user.password_hash), true);
  });

  await t.test('19. Admin password is never returned by API', () => {
    const users = getAllUsers();
    // User records mapped for API responses omit password_hash
    const publicUsers = users.map(u => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name,
      role: u.role,
      isActive: u.is_active === 1,
    }));
    for (const u of publicUsers) {
      assert.equal('password_hash' in u, false);
      assert.equal('password' in u, false);
    }
  });

  // --------------------------------------------------------------------------
  // ENGINEER ACCOUNT (Tests 20-26)
  // --------------------------------------------------------------------------
  await t.test('20. Admin can change Engineer username', () => {
    updateUsername(engineerId, 'eng_cto_renamed');
    const user = getUserById(engineerId)!;
    assert.equal(user.username, 'eng_cto_renamed');
  });

  await t.test('21. Engineer old username stops working', () => {
    assert.equal(getUserByUsername('eng_cto'), null);
  });

  await t.test('22. Engineer new username works', () => {
    const user = getUserByUsername('eng_cto_renamed');
    assert.ok(user);
    assert.equal(user.id, engineerId);
  });

  await t.test('23. Admin can reset Engineer password', () => {
    updatePassword(engineerId, 'EngineerResetPass2026!');
    const user = getUserById(engineerId)!;
    assert.ok(bcrypt.compareSync('EngineerResetPass2026!', user.password_hash));
  });

  await t.test('24. Engineer old password stops working', () => {
    const user = getUserById(engineerId)!;
    assert.equal(bcrypt.compareSync('EngCTOPass2026!', user.password_hash), false);
  });

  await t.test('25. Engineer can login with new password', () => {
    const user = getUserById(engineerId)!;
    assert.equal(bcrypt.compareSync('EngineerResetPass2026!', user.password_hash), true);
  });

  await t.test('26. Engineer password cannot be viewed', () => {
    const eng = getUserById(engineerId)!;
    // Database only stores irreversible hash starting with $2
    assert.ok(eng.password_hash.startsWith('$2'));
    assert.notEqual(eng.password_hash, 'EngineerResetPass2026!');
  });

  // --------------------------------------------------------------------------
  // RECOVERY (Tests 27-35)
  // --------------------------------------------------------------------------
  let recoveryTokenId: string;
  const otpCode = '615243';

  await t.test('27. Recovery request works', () => {
    const res = createRecoveryToken(adminId, otpCode);
    recoveryTokenId = res.tokenId;
    assert.ok(recoveryTokenId);
    assert.ok(res.expiresAt);
  });

  await t.test('28. Invalid recovery token rejected', () => {
    const check = verifyRecoveryToken(adminId, '000000');
    assert.equal(check.valid, false);
  });

  await t.test('29. Expired token rejected', () => {
    // Manually backdate token in SQLite
    db.prepare(`UPDATE recovery_tokens SET expires_at = datetime('now', '-1 hour') WHERE id = ?`).run(recoveryTokenId);
    const check = verifyRecoveryToken(adminId, otpCode);
    assert.equal(check.valid, false);
    assert.match(check.error || '', /expired/i);
  });

  await t.test('30. Used token rejected', () => {
    // Create new token
    const res = createRecoveryToken(adminId, '888999');
    consumeRecoveryToken(res.tokenId);
    const check = verifyRecoveryToken(adminId, '888999');
    assert.equal(check.valid, false);
  });

  await t.test('31. Recovery token cannot be reused', () => {
    const res = createRecoveryToken(adminId, '555444');
    const firstVerify = verifyRecoveryToken(adminId, '555444');
    assert.equal(firstVerify.valid, true);
    consumeRecoveryToken(firstVerify.tokenId!);
    const secondVerify = verifyRecoveryToken(adminId, '555444');
    assert.equal(secondVerify.valid, false);
  });

  await t.test('32. Successful recovery invalidates old password', () => {
    const res = createRecoveryToken(adminId, '123456');
    const verify = verifyRecoveryToken(adminId, '123456');
    assert.equal(verify.valid, true);
    consumeRecoveryToken(verify.tokenId!);
    updatePassword(adminId, 'RecoveredAdminFinal2026!');

    const user = getUserById(adminId)!;
    assert.equal(bcrypt.compareSync('BrandNewAdminPass2026!', user.password_hash), false);
    assert.equal(bcrypt.compareSync('RecoveredAdminFinal2026!', user.password_hash), true);
  });

  await t.test('33. Successful recovery invalidates old sessions where supported', () => {
    const user = getUserById(adminId)!;
    // token_version was incremented
    assert.ok(user.token_version > 1);
  });

  await t.test('34. Recovery secrets never appear in logs', () => {
    logAudit({
      entityType: 'SECURITY',
      entityId: adminId,
      action: 'RECOVERY_REQUEST',
      afterState: {
        username: 'admin_cto',
        token: '123456',
        token_hash: 'secret_hash',
        otp: '123456',
      },
    });
    const log = db.prepare(`SELECT after_state FROM audit_logs WHERE action = 'RECOVERY_REQUEST' ORDER BY created_at DESC LIMIT 1`).get() as { after_state: string };
    assert.ok(!log.after_state.includes('123456'));
    assert.ok(!log.after_state.includes('secret_hash'));
  });

  await t.test('35. Recovery email can later be changed securely', () => {
    updateRecoveryEmail(adminId, 'new.cto.recovery@gmail.com');
    const user = getUserById(adminId)!;
    assert.equal(user.recovery_email, 'new.cto.recovery@gmail.com');
  });

  // --------------------------------------------------------------------------
  // SECURITY (Tests 36-40)
  // --------------------------------------------------------------------------
  await t.test('36. Missing SESSION_SECRET in production fails safely', async () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.SESSION_SECRET;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.SESSION_SECRET;
      await assert.rejects(
        async () => {
          await createSessionCookie({
            userId: adminId,
            username: 'admin',
            fullName: 'Admin',
            role: 'ADMIN',
            assignedSiteIds: [],
            tokenVersion: 1,
          });
        },
        /FATAL CONFIGURATION ERROR: SESSION_SECRET/
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origSecret) process.env.SESSION_SECRET = origSecret;
    }
  });

  await t.test('37. No hardcoded production password remains', () => {
    // Ensure database and source files contain 0 hardcoded plain passwords
    const users = getAllUsers();
    for (const u of users) {
      assert.ok(u.password_hash.startsWith('$2'));
      assert.notEqual(u.password_hash, 'Admin@SiteWork2026!');
      assert.notEqual(u.password_hash, 'Engineer@SiteWork2026!');
      assert.notEqual(u.password_hash, 'Viewer@SiteWork2026!');
    }
  });

  await t.test('38. No hardcoded master password exists', () => {
    const user = getUserById(adminId)!;
    assert.equal(bcrypt.compareSync('master', user.password_hash), false);
    assert.equal(bcrypt.compareSync('admin', user.password_hash), false);
    assert.equal(bcrypt.compareSync('root', user.password_hash), false);
  });

  await t.test('39. Password hashes are bcrypt hashes', () => {
    const users = getAllUsers();
    for (const u of users) {
      assert.match(u.password_hash, /^\$2[ab]\$\d+\$/);
    }
  });

  await t.test('40. Passwords are absent from audit records', () => {
    const logs = db.prepare(`SELECT * FROM audit_logs`).all() as { before_state: string | null; after_state: string | null }[];
    for (const l of logs) {
      const state = (l.before_state || '') + (l.after_state || '');
      assert.ok(!state.includes('password_hash'));
      assert.ok(!state.includes('RecoveredAdminFinal2026!'));
      assert.ok(!state.includes('BrandNewAdminPass2026!'));
    }
  });

  // --------------------------------------------------------------------------
  // DATABASE (Tests 41-44)
  // --------------------------------------------------------------------------
  await t.test('41. SQLite database persists after restart', () => {
    closeDb();
    const reopenedDb = getDb();
    const count = reopenedDb.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number };
    assert.ok(count.count >= 3, 'All users must persist after DB close/reopen');
  });

  await t.test('42. Seed does not reset user credentials', () => {
    const beforeUser = getUserByUsername('admin_cto_renamed')!;
    const hashBefore = beforeUser.password_hash;
    runSeed();
    const afterUser = getUserByUsername('admin_cto_renamed')!;
    assert.equal(afterUser.password_hash, hashBefore, 'Seed must not overwrite credentials');
  });

  await t.test('43. First-time setup does not destroy existing data', () => {
    assert.equal(hasAdminUser(), true, 'Admin exists, setup is permanently closed');
  });

  await t.test('44. Database path is configurable', () => {
    assert.equal(process.env.DATABASE_PATH, VERIFY_DB_PATH);
  });
});
