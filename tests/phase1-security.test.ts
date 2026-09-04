import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Set up clean isolated test database
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_phase1_security.db');
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}
process.env.DATABASE_PATH = TEST_DB_PATH;

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
import { createSessionCookie, getSession, UserSession } from '../lib/auth/session';
import bcrypt from 'bcryptjs';
import { logAudit } from '../lib/audit/logger';

test('PHASE 1: Master Security, Authentication, Authorization & Recovery Test Suite', async (t) => {
  const db = getDb();
  assert.ok(db, 'SQLite Database must be initialized');

  // ==========================================
  // 1. FIRST-TIME SETUP & ZERO HARDCODED PASSWORDS
  // ==========================================
  await t.test('1. First-time Admin setup & password hashing', () => {
    // Seed master data
    runSeed();

    // Verify no users exist yet in fresh database
    assert.equal(hasAdminUser(), false, 'Fresh database must require initial admin setup');

    // Create Initial Admin with custom recovery email
    const adminId = createUser({
      username: 'admin_security',
      passwordPlainText: 'SuperSecretAdmin2026!',
      fullName: 'Primary Security Admin',
      role: 'ADMIN',
      recoveryEmail: 'omegasentinel13@gmail.com',
    });

    assert.ok(adminId, 'Admin ID should be returned');
    assert.equal(hasAdminUser(), true, 'Admin user must now exist');

    const admin = getUserByUsername('admin_security');
    assert.ok(admin, 'Admin must be queryable by username');
    assert.equal(admin.role, 'ADMIN');
    assert.equal(admin.recovery_email, 'omegasentinel13@gmail.com');
    assert.equal(admin.is_active, 1);
    assert.equal(admin.token_version, 1);

    // Verify bcrypt hash (starts with $2a$ or $2b$)
    assert.ok(admin.password_hash.startsWith('$2'), 'Password must be stored as bcrypt hash');
    assert.notEqual(admin.password_hash, 'SuperSecretAdmin2026!', 'Plaintext password must never be stored');
    assert.ok(bcrypt.compareSync('SuperSecretAdmin2026!', admin.password_hash), 'Password compare must succeed');
    assert.ok(!bcrypt.compareSync('WrongPassword!', admin.password_hash), 'Wrong password must fail compare');
  });

  // ==========================================
  // 2. ENGINEER & VIEWER CREATION & ACL
  // ==========================================
  let engineerId: string;
  let viewerId: string;

  await t.test('2. Provision Engineer & Viewer with Site-Level ACL', () => {
    engineerId = createUser({
      username: 'eng_rajesh',
      passwordPlainText: 'EngineerSecret2026!',
      fullName: 'Rajesh Engineer',
      role: 'SITE_MANAGER',
      siteIds: ['site-1'],
    });

    viewerId = createUser({
      username: 'viewer_sunil',
      passwordPlainText: 'ViewerSecret2026!',
      fullName: 'Sunil Auditor',
      role: 'VIEWER',
      siteIds: ['site-1', 'site-2'],
    });

    const eng = getUserByUsername('eng_rajesh');
    assert.ok(eng);
    assert.equal(eng.role, 'SITE_MANAGER');

    const viewer = getUserByUsername('viewer_sunil');
    assert.ok(viewer);
    assert.equal(viewer.role, 'VIEWER');
  });

  // ==========================================
  // 3. AUTHORIZATION & RBAC GUARDS
  // ==========================================
  await t.test('3. Server-side Authorization & Boundary Enforcement', () => {
    const adminSession: UserSession = {
      userId: 'usr-admin',
      username: 'admin_security',
      fullName: 'Admin',
      role: 'ADMIN',
      assignedSiteIds: [],
      tokenVersion: 1,
    };

    const engineerSession: UserSession = {
      userId: engineerId,
      username: 'eng_rajesh',
      fullName: 'Rajesh Engineer',
      role: 'SITE_MANAGER',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    const viewerSession: UserSession = {
      userId: viewerId,
      username: 'viewer_sunil',
      fullName: 'Sunil Auditor',
      role: 'VIEWER',
      assignedSiteIds: ['site-1', 'site-2'],
      tokenVersion: 1,
    };

    // A. requireAdmin
    assert.doesNotThrow(() => requireAdmin(adminSession), 'Admin must pass requireAdmin');
    assert.throws(() => requireAdmin(engineerSession), ForbiddenError, 'Engineer must be rejected by requireAdmin');
    assert.throws(() => requireAdmin(viewerSession), ForbiddenError, 'Viewer must be rejected by requireAdmin');
    assert.throws(() => requireAdmin(null), UnauthorizedError, 'Unauthenticated must throw UnauthorizedError');

    // B. validateSiteAccess
    // Admin full access
    assert.doesNotThrow(() => validateSiteAccess(adminSession, 'site-1', 'WRITE'));
    assert.doesNotThrow(() => validateSiteAccess(adminSession, 'site-999', 'WRITE'));

    // Engineer assigned to site-1: allowed READ & WRITE on site-1, denied on site-2
    assert.doesNotThrow(() => validateSiteAccess(engineerSession, 'site-1', 'WRITE'));
    assert.doesNotThrow(() => validateSiteAccess(engineerSession, 'site-1', 'READ'));
    assert.throws(() => validateSiteAccess(engineerSession, 'site-2', 'READ'), ForbiddenError);
    assert.throws(() => validateSiteAccess(engineerSession, 'site-1', 'ADMIN'), ForbiddenError);

    // Viewer assigned to site-1, site-2: allowed READ, denied all WRITE
    assert.doesNotThrow(() => validateSiteAccess(viewerSession, 'site-1', 'READ'));
    assert.doesNotThrow(() => validateSiteAccess(viewerSession, 'site-2', 'READ'));
    assert.throws(() => validateSiteAccess(viewerSession, 'site-1', 'WRITE'), ForbiddenError);
    assert.throws(() => validateSiteAccess(viewerSession, 'site-3', 'READ'), ForbiddenError);
  });

  // ==========================================
  // 4. ADMIN SELF-ACCOUNT MANAGEMENT
  // ==========================================
  await t.test('4. Admin self-service: Username, Password & Recovery Email changes', () => {
    const admin = getUserByUsername('admin_security')!;

    // A. Change Username
    updateUsername(admin.id, 'admin_super');
    assert.equal(getUserByUsername('admin_security'), null, 'Old username must stop working');
    const updatedAdmin = getUserByUsername('admin_super');
    assert.ok(updatedAdmin, 'New username must work');
    assert.equal(updatedAdmin.id, admin.id, 'User ID must be preserved');
    assert.equal(updatedAdmin.token_version, 2, 'Token version must be incremented to invalidate stale sessions');

    // B. Change Password
    updatePassword(admin.id, 'NewAdminPassword2026!');
    const freshAdmin = getUserById(admin.id)!;
    assert.ok(bcrypt.compareSync('NewAdminPassword2026!', freshAdmin.password_hash), 'New password must match');
    assert.ok(!bcrypt.compareSync('SuperSecretAdmin2026!', freshAdmin.password_hash), 'Old password must no longer match');
    assert.equal(freshAdmin.token_version, 3, 'Token version must be incremented again');

    // C. Update Recovery Email
    updateRecoveryEmail(admin.id, 'security.director@abconstructions.com');
    const finalAdmin = getUserById(admin.id)!;
    assert.equal(finalAdmin.recovery_email, 'security.director@abconstructions.com', 'Recovery email must be updated');
  });

  // ==========================================
  // 5. ADMIN -> ENGINEER ACCOUNT MANAGEMENT
  // ==========================================
  await t.test('5. Admin manages Engineer: Reset Password, Change Username, Disable Account', () => {
    // A. Admin resets Engineer password
    updatePassword(engineerId, 'NewEngineerPass2026!');
    const eng = getUserById(engineerId)!;
    assert.ok(bcrypt.compareSync('NewEngineerPass2026!', eng.password_hash));
    assert.ok(!bcrypt.compareSync('EngineerSecret2026!', eng.password_hash));
    assert.equal(eng.token_version, 2);

    // B. Admin changes Engineer username
    updateUsername(engineerId, 'eng_rajesh_site1');
    assert.equal(getUserByUsername('eng_rajesh'), null);
    const updatedEng = getUserByUsername('eng_rajesh_site1');
    assert.ok(updatedEng);
    assert.equal(updatedEng.id, engineerId);
    assert.equal(updatedEng.token_version, 3);

    // C. Deactivate account
    updateUser({
      id: engineerId,
      fullName: 'Rajesh Engineer (Suspended)',
      role: 'SITE_MANAGER',
      isActive: false,
    });
    const deactivatedEng = getUserById(engineerId)!;
    assert.equal(deactivatedEng.is_active, 0, 'Engineer must be disabled');
    assert.equal(deactivatedEng.token_version, 4, 'Token version must increment on deactivation');

    // D. Re-activate account
    updateUser({
      id: engineerId,
      fullName: 'Rajesh Engineer',
      role: 'SITE_MANAGER',
      isActive: true,
    });
    assert.equal(getUserById(engineerId)!.is_active, 1, 'Engineer must be re-activated');
  });

  // ==========================================
  // 6. LAST ADMIN LOCKOUT PROTECTION
  // ==========================================
  await t.test('6. Prevent deactivating or removing role from last active Administrator', () => {
    const admin = getUserByUsername('admin_super')!;
    assert.equal(countActiveAdmins(), 1, 'Only 1 active admin exists');

    assert.throws(
      () => {
        updateUser({
          id: admin.id,
          fullName: 'Admin Attempting Disable',
          role: 'ADMIN',
          isActive: false,
        });
      },
      /Cannot deactivate or remove the role of the last active Administrator/,
      'Must block deactivating last active admin'
    );
  });

  // ==========================================
  // 7. PASSWORD RECOVERY FLOW (OTP & TOKEN HASHING)
  // ==========================================
  await t.test('7. Cryptographically Secure OTP Recovery Flow', () => {
    const admin = getUserByUsername('admin_super')!;
    const plainOtp = '749201';

    // Create OTP
    const { tokenId, expiresAt } = createRecoveryToken(admin.id, plainOtp);
    assert.ok(tokenId);
    assert.ok(expiresAt);

    // Verify token hash is stored, NOT plaintext OTP
    const tokenRow = db.prepare(`SELECT * FROM recovery_tokens WHERE id = ?`).get(tokenId) as { token_hash: string; is_used: number };
    assert.equal(tokenRow.token_hash, hashToken(plainOtp), 'Token must be stored as SHA-256 hash');
    assert.notEqual(tokenRow.token_hash, plainOtp, 'Plaintext OTP must not exist in database');

    // Verify invalid OTP fails
    const invalidResult = verifyRecoveryToken(admin.id, '000000');
    assert.equal(invalidResult.valid, false, 'Wrong OTP must fail');

    // Verify valid OTP succeeds
    const validResult = verifyRecoveryToken(admin.id, plainOtp);
    assert.equal(validResult.valid, true, 'Correct OTP must succeed');
    assert.equal(validResult.tokenId, tokenId);

    // Consume Token & Reset Password
    consumeRecoveryToken(tokenId);
    updatePassword(admin.id, 'RecoveredPassword2026!');

    // Verify token cannot be reused
    const reusedResult = verifyRecoveryToken(admin.id, plainOtp);
    assert.equal(reusedResult.valid, false, 'Used token must not be reusable');

    // Verify password is updated
    const freshAdmin = getUserById(admin.id)!;
    assert.ok(bcrypt.compareSync('RecoveredPassword2026!', freshAdmin.password_hash));
  });

  // ==========================================
  // 8. AUDIT LOG SANITIZATION
  // ==========================================
  await t.test('8. Audit Trail strictly sanitizes passwords, hashes, and OTP tokens', () => {
    logAudit({
      entityType: 'SECURITY',
      entityId: 'test-user',
      action: 'PASSWORD_CHANGE',
      beforeState: {
        username: 'test_user',
        password: 'AttemptedSecretPassword123!',
        password_hash: '$2a$10$xyzFakeHashValue',
      },
      afterState: {
        username: 'test_user',
        newPassword: 'BrandNewSecretPassword456!',
        otp: '999888',
        token_hash: 'abc123hash',
        action: 'PASSWORD_UPDATED',
      },
    });

    const row = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = 'test-user' ORDER BY created_at DESC LIMIT 1`).get() as {
      before_state: string;
      after_state: string;
    };

    assert.ok(row, 'Audit record should exist');
    assert.ok(!row.before_state.includes('AttemptedSecretPassword123!'), 'Plaintext password must be omitted');
    assert.ok(!row.before_state.includes('xyzFakeHashValue'), 'Password hash must be omitted');
    assert.ok(!row.after_state.includes('BrandNewSecretPassword456!'), 'New password must be omitted');
    assert.ok(!row.after_state.includes('999888'), 'OTP must be omitted');
    assert.ok(!row.after_state.includes('abc123hash'), 'Token hash must be omitted');
    assert.ok(row.after_state.includes('PASSWORD_UPDATED'), 'Safe audit metadata must remain preserved');
  });

  // ==========================================
  // 9. PRODUCTION FAIL-CLOSED TEST
  // ==========================================
  await t.test('9. Session manager fails closed in production when SESSION_SECRET is missing', async () => {
    const originalEnv = process.env.NODE_ENV;
    const originalSecret = process.env.SESSION_SECRET;

    try {
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.SESSION_SECRET;

      // Creating a session without SESSION_SECRET in production must throw fatal error
      await assert.rejects(
        async () => {
          await createSessionCookie({
            userId: 'u1',
            username: 'admin',
            fullName: 'Admin',
            role: 'ADMIN',
            assignedSiteIds: [],
            tokenVersion: 1,
          });
        },
        /FATAL CONFIGURATION ERROR: SESSION_SECRET/,
        'Missing SESSION_SECRET in production must fail closed'
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
      if (originalSecret) {
        process.env.SESSION_SECRET = originalSecret;
      }
    }
  });
});
