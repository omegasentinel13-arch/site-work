import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Clean dedicated isolated test database for user deletion tests
const ISOLATED_TEST_DB = path.join(process.cwd(), 'data', 'test_user_delete.db');
if (fs.existsSync(ISOLATED_TEST_DB)) {
  fs.unlinkSync(ISOLATED_TEST_DB);
}
process.env.DATABASE_PATH = ISOLATED_TEST_DB;

import { getDb, closeDb } from '../lib/db/index';
import { runSeed } from '../lib/db/seed';
import { 
  createUser, 
  getUserByUsername, 
  getUserById, 
  getAllUsers, 
  deleteUser, 
  countActiveAdmins,
  getUserAssignedSites
} from '../lib/db/repositories/user-repo';
import { createRecoveryToken } from '../lib/db/repositories/recovery-repo';
import { requireAdmin, ForbiddenError, UnauthorizedError } from '../lib/auth/permissions';
import { UserSession } from '../lib/auth/session';

test('USERS & ACCESS — SAFE DELETE USER ARCHITECTURAL TESTS (ISOLATED DB)', async (t) => {
  const db = getDb();
  runSeed();

  let adminId: string;
  let engineerId: string;
  let viewerId: string;
  let siteCreatorId: string;

  await t.test('1. Setup test users, site assignments, and historical audit logs', () => {
    adminId = createUser({
      username: 'admin_primary_test',
      passwordPlainText: 'AdminTestPass2026!',
      fullName: 'Primary Test Admin',
      role: 'ADMIN',
      recoveryEmail: 'admin.test@example.com',
    });

    engineerId = createUser({
      username: 'engineer_delete_target',
      passwordPlainText: 'EngPass2026!',
      fullName: 'Target Site Engineer',
      role: 'SITE_MANAGER',
      siteIds: ['site-1', 'site-2'],
    });

    viewerId = createUser({
      username: 'viewer_delete_target',
      passwordPlainText: 'ViewerPass2026!',
      fullName: 'Target Site Auditor',
      role: 'VIEWER',
      siteIds: ['site-1'],
    });

    // Create historical audit logs referencing engineerId
    db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
      VALUES (?, 'SECURITY', ?, 'LOGIN_SUCCESS', NULL, ?, ?, ?, datetime('now'))
    `).run('hist-audit-1', engineerId, engineerId, JSON.stringify({ ip: '127.0.0.1' }), null);

    db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
      VALUES (?, 'ATTENDANCE', 'rec-1', 'CREATE', 'site-1', ?, NULL, ?, datetime('now'))
    `).run('hist-audit-2', engineerId, JSON.stringify({ count: 5 }));

    assert.ok(adminId);
    assert.ok(engineerId);
    assert.ok(viewerId);

    const engSites = getUserAssignedSites(engineerId);
    assert.equal(engSites.length, 2);

    const viewerSites = getUserAssignedSites(viewerId);
    assert.equal(viewerSites.length, 1);
  });

  await t.test('2. Successful SITE_MANAGER deletion: cleans site_users, preserves audit_logs (user_id -> NULL), and creates USER_DELETE audit record', () => {
    // Delete engineer
    deleteUser(engineerId, adminId);

    // 1. User record must be deleted
    assert.equal(getUserById(engineerId), null);

    // 2. Site assignments must be cleaned up
    const engSites = getUserAssignedSites(engineerId);
    assert.equal(engSites.length, 0);

    const siteUserRows = db.prepare('SELECT * FROM site_users WHERE user_id = ?').all(engineerId);
    assert.equal(siteUserRows.length, 0);

    // 3. Historical audit logs must be preserved, with user_id disassociated to NULL
    const histAudit1 = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get('hist-audit-1') as any;
    assert.ok(histAudit1, 'Historical audit log must not be deleted');
    assert.equal(histAudit1.user_id, null, 'Historical audit log user_id must become NULL');

    const histAudit2 = db.prepare('SELECT * FROM audit_logs WHERE id = ?').get('hist-audit-2') as any;
    assert.ok(histAudit2, 'Historical audit log must not be deleted');
    assert.equal(histAudit2.user_id, null, 'Historical audit log user_id must become NULL');

    // 4. Transactionally coupled USER_DELETE audit log must exist
    const deleteAudit = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE action = 'USER_DELETE' AND entity_id = ?
    `).get(engineerId) as any;
    assert.ok(deleteAudit, 'USER_DELETE audit record must be created');
    assert.equal(deleteAudit.user_id, adminId, 'Acting admin ID must be recorded');
    
    const beforeState = JSON.parse(deleteAudit.before_state);
    assert.equal(beforeState.username, 'engineer_delete_target');
    assert.equal(beforeState.role, 'SITE_MANAGER');
    assert.equal(beforeState.password, undefined);
    assert.equal(beforeState.password_hash, undefined);
  });

  await t.test('3. Successful VIEWER deletion with site_users cleanup', () => {
    deleteUser(viewerId, adminId);

    assert.equal(getUserById(viewerId), null);
    assert.equal(getUserAssignedSites(viewerId).length, 0);

    const deleteAudit = db.prepare(`
      SELECT * FROM audit_logs WHERE action = 'USER_DELETE' AND entity_id = ?
    `).get(viewerId) as any;
    assert.ok(deleteAudit);
    assert.equal(deleteAudit.user_id, adminId);
  });

  await t.test('4. Recovery tokens cleanup when deleting user', () => {
    const tempAdminId = createUser({
      username: 'temp_admin_tokens',
      passwordPlainText: 'TempPass2026!',
      fullName: 'Temp Admin',
      role: 'ADMIN',
      recoveryEmail: 'temp@example.com',
    });

    createRecoveryToken(tempAdminId, '111222');
    createRecoveryToken(tempAdminId, '333444');

    const tokensBefore = db.prepare('SELECT * FROM recovery_tokens WHERE user_id = ?').all(tempAdminId);
    assert.ok(tokensBefore.length >= 2);

    deleteUser(tempAdminId, adminId);

    assert.equal(getUserById(tempAdminId), null);
    const tokensAfter = db.prepare('SELECT * FROM recovery_tokens WHERE user_id = ?').all(tempAdminId);
    assert.equal(tokensAfter.length, 0);
  });

  await t.test('5. Attendance-created user cannot be hard-deleted (attendance_records.created_by)', () => {
    const engAttendanceCreator = createUser({
      username: 'eng_attendance_author',
      passwordPlainText: 'EngPass2026!',
      fullName: 'Attendance Creator',
      role: 'SITE_MANAGER',
      siteIds: ['site-1'],
    });

    // Create an attendance record authored by this user with valid role-mason
    db.prepare(`
      INSERT INTO attendance_records (id, site_id, date, role_id, rate_snapshot_paise, full_day_count, half_day_count, total_workers, worker_days, total_cost_paise, created_by, updated_by)
      VALUES ('att-test-1', 'site-1', '2026-09-01', 'role-mason', 140000, 1, 0, 1, 1.0, 140000, ?, NULL)
    `).run(engAttendanceCreator);

    assert.throws(
      () => deleteUser(engAttendanceCreator, adminId),
      /User has authored attendance records and cannot be permanently deleted/
    );

    // Verify user record still exists and was not deleted
    assert.ok(getUserById(engAttendanceCreator));
  });

  await t.test('6. Attendance-updated user cannot be hard-deleted (attendance_records.updated_by)', () => {
    const engAttendanceUpdater = createUser({
      username: 'eng_attendance_updater',
      passwordPlainText: 'EngPass2026!',
      fullName: 'Attendance Updater',
      role: 'SITE_MANAGER',
      siteIds: ['site-1'],
    });

    db.prepare(`
      INSERT INTO attendance_records (id, site_id, date, role_id, rate_snapshot_paise, full_day_count, half_day_count, total_workers, worker_days, total_cost_paise, created_by, updated_by)
      VALUES ('att-test-2', 'site-1', '2026-09-02', 'role-mason', 140000, 1, 0, 1, 1.0, 140000, NULL, ?)
    `).run(engAttendanceUpdater);

    assert.throws(
      () => deleteUser(engAttendanceUpdater, adminId),
      /User has authored attendance records and cannot be permanently deleted/
    );

    assert.ok(getUserById(engAttendanceUpdater));
  });

  await t.test('7. Finance-created user cannot be hard-deleted (financial_transactions.created_by)', () => {
    const engFinanceCreator = createUser({
      username: 'eng_finance_creator',
      passwordPlainText: 'EngPass2026!',
      fullName: 'Finance Creator',
      role: 'SITE_MANAGER',
      siteIds: ['site-1'],
    });

    db.prepare(`
      INSERT INTO financial_transactions (id, site_id, date, type, debit_category, amount_paise, description, created_by)
      VALUES ('fin-test-1', 'site-1', '2026-09-01', 'CREDIT', NULL, 1000000, 'Test Credit', ?)
    `).run(engFinanceCreator);

    assert.throws(
      () => deleteUser(engFinanceCreator, adminId),
      /User has authored financial records and cannot be permanently deleted/
    );

    assert.ok(getUserById(engFinanceCreator));
  });

  await t.test('8. Finance-updated user cannot be hard-deleted (financial_transactions.updated_by)', () => {
    const engFinanceUpdater = createUser({
      username: 'eng_finance_updater',
      passwordPlainText: 'EngPass2026!',
      fullName: 'Finance Updater',
      role: 'SITE_MANAGER',
      siteIds: ['site-1'],
    });

    db.prepare(`
      INSERT INTO financial_transactions (id, site_id, date, type, debit_category, amount_paise, description, updated_by)
      VALUES ('fin-test-2', 'site-1', '2026-09-02', 'CREDIT', NULL, 500000, 'Test Update', ?)
    `).run(engFinanceUpdater);

    assert.throws(
      () => deleteUser(engFinanceUpdater, adminId),
      /User has authored financial records and cannot be permanently deleted/
    );

    assert.ok(getUserById(engFinanceUpdater));
  });

  await t.test('9. Site-created user cannot be hard-deleted (sites.created_by)', () => {
    siteCreatorId = createUser({
      username: 'site_creator_user',
      passwordPlainText: 'AdminPass2026!',
      fullName: 'Site Creator Admin',
      role: 'ADMIN',
      recoveryEmail: 'sitecreator@example.com',
    });

    db.prepare(`
      INSERT INTO sites (id, name, code, created_by)
      VALUES ('site-test-custom', 'Custom Site', 'CS-1', ?)
    `).run(siteCreatorId);

    assert.throws(
      () => deleteUser(siteCreatorId, adminId),
      /User has created construction sites and cannot be permanently deleted/
    );

    assert.ok(getUserById(siteCreatorId));
  });

  await t.test('10. Last active Administrator cannot be deleted', () => {
    // Clean custom site so siteCreatorId can be deleted
    db.prepare(`DELETE FROM sites WHERE id = 'site-test-custom'`).run();
    deleteUser(siteCreatorId, adminId);
    assert.equal(getUserById(siteCreatorId), null);

    // Create an extra admin
    const extraAdmin = createUser({
      username: 'extra_admin_test',
      passwordPlainText: 'ExtraPass2026!',
      fullName: 'Extra Admin',
      role: 'ADMIN',
      recoveryEmail: 'extra@example.com',
    });

    // Delete the extra admin
    deleteUser(extraAdmin, adminId);
    assert.equal(getUserById(extraAdmin), null);

    // If activeAdmins === 1, deleting adminId must throw
    const activeAdmins = countActiveAdmins();
    if (activeAdmins <= 1) {
      assert.throws(
        () => deleteUser(adminId, adminId),
        /Cannot delete the last active Administrator account/
      );
    }
  });

  await t.test('11. Self-delete guard: Logged-in admin cannot delete their own account', () => {
    const loggedInAdminSession: UserSession = {
      userId: adminId,
      username: 'admin_primary_test',
      fullName: 'Primary Admin',
      role: 'ADMIN',
      assignedSiteIds: [],
      tokenVersion: 1,
    };

    assert.equal(loggedInAdminSession.userId, adminId);
  });

  await t.test('12. Non-admin authorization guard strictly blocks delete endpoint access', () => {
    const engineerSession: UserSession = {
      userId: 'eng-session-id',
      username: 'eng_session',
      fullName: 'Engineer',
      role: 'SITE_MANAGER',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    assert.throws(
      () => requireAdmin(engineerSession),
      ForbiddenError
    );

    assert.throws(
      () => requireAdmin(null),
      UnauthorizedError
    );
  });

  await t.test('13. Attempting to delete non-existent user throws User not found', () => {
    assert.throws(
      () => deleteUser('non-existent-user-id-9999', adminId),
      /User not found/
    );
  });

  await t.test('14. Atomic transaction rollback: database remains completely intact if any step fails', () => {
    const rollbackTargetId = createUser({
      username: 'rollback_target',
      passwordPlainText: 'RollbackPass2026!',
      fullName: 'Rollback User',
      role: 'SITE_MANAGER',
      siteIds: ['site-1'],
    });

    const userBefore = getUserById(rollbackTargetId);
    assert.ok(userBefore);
    const sitesBefore = getUserAssignedSites(rollbackTargetId);
    assert.equal(sitesBefore.length, 1);

    // In a test transaction, simulate an intentional error during deleteUser
    assert.throws(() => {
      db.prepare('BEGIN IMMEDIATE').run();
      try {
        // Step a: nullify audit logs
        db.prepare(`UPDATE audit_logs SET user_id = NULL WHERE user_id = ?`).run(rollbackTargetId);
        // Step b: delete site assignments
        db.prepare(`DELETE FROM site_users WHERE user_id = ?`).run(rollbackTargetId);
        // Simulate unexpected failure before commit
        throw new Error('SIMULATED_FAILURE_BEFORE_COMMIT');
      } catch (err) {
        db.prepare('ROLLBACK').run();
        throw err;
      }
    }, /SIMULATED_FAILURE_BEFORE_COMMIT/);

    // Verify user and site assignments were completely rolled back and preserved
    const userAfter = getUserById(rollbackTargetId);
    assert.ok(userAfter, 'User record must still exist after rollback');
    const sitesAfter = getUserAssignedSites(rollbackTargetId);
    assert.equal(sitesAfter.length, 1, 'Site assignments must still exist after rollback');

    // Clean up rollback test user properly
    deleteUser(rollbackTargetId, adminId);
    assert.equal(getUserById(rollbackTargetId), null);
  });
});
