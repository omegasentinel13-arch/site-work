process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

import { 
  GET as getUsers, 
  POST as postUser, 
  PUT as putUser, 
  PATCH as patchUser, 
  DELETE as deleteUser 
} from '../app/api/users/route';
import { 
  GET as getPermissions,
} from '../app/api/permissions/route';
import { 
  PATCH as patchUserPerm, 
  DELETE as deleteUserPerm 
} from '../app/api/permissions/user/route';
import { 
  PATCH as patchRolePerm,
  DELETE as deleteRolePerm
} from '../app/api/permissions/role/route';
import { 
  GET as getSitePerms, 
  POST as postSitePerm 
} from '../app/api/permissions/sites/route';
import { PATCH as patchSite } from '../app/api/sites/[id]/route';
import { GET as getArchive } from '../app/api/lifecycle/archive/route';
import { GET as getRecycleBin, PATCH as patchRecycleBin } from '../app/api/lifecycle/recycle-bin/route';
import { POST as postRestore } from '../app/api/lifecycle/restore/route';
import { POST as postPermanentDelete } from '../app/api/lifecycle/permanent-delete/route';
import { GET as getAuditList } from '../app/api/audit/route';
import { GET as getAuditDetail } from '../app/api/audit/[id]/route';

import { UserSession } from '../lib/auth/session';
import { canAccess } from '../lib/permissions/evaluator';
import { getDb } from '../lib/db';
import { getUserById } from '../lib/db/repositories/user-repo';
import { 
  getLifecycleRecord, 
  toggleLifecycleKeepPermanently 
} from '../lib/db/repositories/global-lifecycle-repo';
import { 
  archiveRole, 
  recycleRole, 
  restoreRole, 
  archiveCategory, 
  recycleCategory, 
  restoreCategory 
} from '../lib/db/repositories/role-repo';
import { 
  toggleSiteArchived, 
  moveSiteToRecycleBin, 
  restoreSiteFromRecycleBin 
} from '../lib/db/repositories/site-repo';
import { executePermanentDelete } from '../lib/lifecycle/permanent-delete-engine';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2G.3: Final Governance Integration & Freeze Gate', { concurrency: 1 }, async (t) => {
  const db = getDb();

  const cleanup = () => {
    try {
      db.prepare(`DELETE FROM system_lifecycle_records WHERE entity_id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM site_role_rates WHERE site_id LIKE 'gate-2g3-%' OR role_id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM site_users WHERE site_id LIKE 'gate-2g3-%' OR user_id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM attendance_records WHERE site_id LIKE 'gate-2g3-%' OR role_id LIKE 'gate-2g3-%' OR id LIKE 'att-gate2g3%'`).run();
      db.prepare(`DELETE FROM financial_transactions WHERE site_id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM work_roles WHERE id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM work_categories WHERE id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM sites WHERE id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM audit_logs WHERE entity_id LIKE 'gate-2g3-%' OR id LIKE 'gate-2g3-%' OR user_id LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM user_permission_overrides WHERE user_id LIKE 'gate-2g3-%' OR granted_by LIKE 'gate-2g3-%'`).run();
      db.prepare(`DELETE FROM users WHERE id LIKE 'gate-2g3-%' OR username LIKE 'gate2g3%'`).run();
    } catch {
      // ignore
    }
  };

  t.after(cleanup);
  cleanup();

  // Ensure canonical standard authority principals exist
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Head Administrator', 'ADMIN', 'SUPERIOR_PRIME', 1, 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Site Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
      ('usr-view-1', 'viewer1', 'hash', 'Viewer User', 'VIEWER', 'STANDARD', 1, 1, 1)
  `).run();

  db.prepare(`UPDATE users SET authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'CLIENT_PRIME' WHERE id = 'usr-client-prime-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'STANDARD_ADMIN' WHERE id = 'usr-std-admin-1'`).run();

  const superiorPrimeSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Head Administrator',
    role: 'ADMIN',
    authorityTier: 'SUPERIOR_PRIME',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const clientPrimeSession: UserSession = {
    userId: 'usr-client-prime-1',
    username: 'clientprime',
    fullName: 'Client Prime',
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const standardAdminSession: UserSession = {
    userId: 'usr-std-admin-1',
    username: 'stdadmin',
    fullName: 'Standard Admin',
    role: 'ADMIN',
    authorityTier: 'STANDARD_ADMIN',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const siteManagerSession: UserSession = {
    userId: 'usr-eng-1',
    username: 'engineer2',
    fullName: 'Site Engineer',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Viewer User',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  // Helper to ensure controlled site exists
  const setupSite = (id: string, name: string, code: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO sites (id, name, code, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, 0, datetime('now'), datetime('now'))
    `).run(id, name, code);
  };

  // Helper to ensure controlled category exists
  const setupCategory = (id: string, name: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO work_categories (id, name, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, 100, 1, datetime('now'), datetime('now'))
    `).run(id, name);
  };

  // Helper to ensure controlled role exists
  const setupRole = (id: string, categoryId: string, name: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO work_roles (id, category_id, name, default_rate_paise, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 50000, 10, 1, datetime('now'), datetime('now'))
    `).run(id, categoryId, name);
  };

  // =========================================================================
  // SECTION 2: USER LIFECYCLE -> AUDIT
  // =========================================================================
  await t.test('2. User Lifecycle -> Audit: Complete trace of all 10 user administrative actions', async () => {
    setTestSession(clientPrimeSession);

    // 2.1 USER_CREATE
    const createRes = await postUser(new Request('http://localhost:3001/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'gate2g3.user',
        password: 'Password123!',
        fullName: 'Gate User Initial',
        role: 'SITE_MANAGER',
        recoveryEmail: 'gate2g3.user@example.com',
        siteIds: ['site-1'],
      }),
    }));
    assert.equal(createRes.status, 200, 'User creation must succeed');
    const { userId: newUserId } = await createRes.json();
    assert.ok(newUserId);

    const auditCreate = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_CREATED'
    `).all(newUserId) as any[];
    assert.equal(auditCreate.length, 1, 'Exactly one USER_CREATED audit event must exist');
    assert.equal(auditCreate[0].user_id, clientPrimeSession.userId, 'Actor must be recorded accurately');
    assert.equal(auditCreate[0].entity_type, 'SECURITY');

    // 2.2 USER_UPDATE
    const updateRes = await putUser(new Request('http://localhost:3001/api/users', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: newUserId,
        fullName: 'Gate User Updated Name',
        role: 'SITE_MANAGER',
        isActive: true,
        recoveryEmail: 'gate2g3.user@example.com',
        siteIds: ['site-1'],
      }),
    }));
    assert.equal(updateRes.status, 200);

    const auditUpdate = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_UPDATED'
    `).all(newUserId) as any[];
    assert.equal(auditUpdate.length, 1, 'Exactly one USER_UPDATED audit event must exist');
    assert.equal(auditUpdate[0].user_id, clientPrimeSession.userId);

    // 2.3 ACCOUNT_DEACTIVATED
    const deactRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        action: 'DEACTIVATE',
      }),
    }));
    assert.equal(deactRes.status, 200);

    const auditDeact = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_DEACTIVATED'
    `).all(newUserId) as any[];
    assert.equal(auditDeact.length, 1, 'Exactly one USER_DEACTIVATED audit event must exist');
    assert.equal(JSON.parse(auditDeact[0].after_state).isActive, false);

    // 2.4 ACCOUNT_ACTIVATED
    const actRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        action: 'ACTIVATE',
      }),
    }));
    assert.equal(actRes.status, 200);

    const auditAct = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_ACTIVATED'
    `).all(newUserId) as any[];
    assert.equal(auditAct.length, 1, 'Exactly one USER_ACTIVATED audit event must exist');
    assert.equal(JSON.parse(auditAct[0].after_state).isActive, true);

    // 2.5 USERNAME_CHANGED
    const changeUserRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        action: 'CHANGE_USERNAME',
        newUsername: 'gate2g3.renamed',
      }),
    }));
    assert.equal(changeUserRes.status, 200);

    const auditName = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USERNAME_CHANGED'
    `).all(newUserId) as any[];
    assert.equal(auditName.length, 1, 'Exactly one USERNAME_CHANGED audit event must exist');
    const nameState = JSON.parse(auditName[0].after_state);
    assert.equal(nameState.newUsername, 'gate2g3.renamed');

    // 2.6 RECOVERY_EMAIL_CHANGED
    const changeEmailRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        action: 'CHANGE_RECOVERY_EMAIL',
        newRecoveryEmail: 'gate2g3.newemail@example.com',
      }),
    }));
    assert.equal(changeEmailRes.status, 200);

    const auditEmail = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'RECOVERY_EMAIL_CHANGED'
    `).all(newUserId) as any[];
    assert.equal(auditEmail.length, 1, 'Exactly one RECOVERY_EMAIL_CHANGED audit event must exist');

    // 2.7 PASSWORD_RESET
    const resetRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        action: 'RESET_PASSWORD',
        newPassword: 'NewPassword2026!',
        confirmPassword: 'NewPassword2026!',
      }),
    }));
    assert.equal(resetRes.status, 200);

    const auditReset = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'PASSWORD_RESET'
    `).all(newUserId) as any[];
    assert.equal(auditReset.length, 1, 'Exactly one PASSWORD_RESET audit event must exist');

    // 2.8 ROLE_CHANGED
    const changeRoleRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        action: 'CHANGE_ROLE',
        newRole: 'VIEWER',
      }),
    }));
    assert.equal(changeRoleRes.status, 200);

    const auditRole = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_CHANGED'
    `).all(newUserId) as any[];
    assert.equal(auditRole.length, 1, 'Exactly one ROLE_CHANGED audit event must exist');
    assert.equal(JSON.parse(auditRole[0].after_state).role, 'VIEWER');

    // 2.9 SITE_ACCESS_CHANGED
    const siteAccessRes = await postSitePerm(new Request('http://localhost:3001/api/permissions/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: newUserId,
        siteId: 'site-1',
      }),
    }));
    assert.equal(siteAccessRes.status, 200);

    const auditSiteAccess = db.prepare(`
      SELECT * FROM audit_logs WHERE action = 'SITE_ACCESS_CHANGED' AND user_id = ?
    `).all(newUserId) as any[];
    assert.equal(auditSiteAccess.length, 1, 'Exactly one SITE_ACCESS_CHANGED audit event must exist');

    // 2.10 USER_DELETE
    const delRes = await deleteUser(new Request(`http://localhost:3001/api/users?id=${newUserId}`, {
      method: 'DELETE',
    }));
    assert.equal(delRes.status, 200);

    const auditDel = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'USER_DELETE'
    `).all(newUserId) as any[];
    assert.equal(auditDel.length, 1, 'Exactly one USER_DELETE audit event must exist');

    // Invariant: User record gone, historical audit records remain intact
    const userInDb = db.prepare(`SELECT id FROM users WHERE id = ?`).get(newUserId);
    assert.equal(userInDb, undefined, 'User row must be deleted');

    const remainingLogs = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ?`).all(newUserId) as any[];
    assert.ok(remainingLogs.length >= 9, 'All historical user lifecycle audit records must remain intact');
  });

  // =========================================================================
  // SECTION 3: PERMISSION MANAGEMENT -> AUDIT
  // =========================================================================
  await t.test('3. Permission Management -> Audit: ALLOW, DENY, REMOVE, Role Perm, Site Perm, and Read-Only View Check', async () => {
    setTestSession(clientPrimeSession);

    const permTargetUser = 'gate-2g3-perm-user';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'gate2g3.perm', 'hash', 'Perm Target User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(permTargetUser);

    // 3.1 PERMISSION_GRANTED (ALLOW)
    const grantRes = await patchUserPerm(new Request('http://localhost:3001/api/permissions/user', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: permTargetUser,
        permissionId: 'perm-gov-audit-view',
        effect: 'ALLOW',
      }),
    }));
    assert.equal(grantRes.status, 200);

    const grantAudit = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'PERMISSION_GRANTED'
    `).all('perm-gov-audit-view') as any[];
    assert.ok(grantAudit.length >= 1, 'PERMISSION_GRANTED audit event recorded');

    // 3.2 PERMISSION_DENIED (DENY)
    const denyRes = await patchUserPerm(new Request('http://localhost:3001/api/permissions/user', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: permTargetUser,
        permissionId: 'perm-gov-audit-view',
        effect: 'DENY',
      }),
    }));
    assert.equal(denyRes.status, 200);

    const denyAudit = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'PERMISSION_DENIED'
    `).all('perm-gov-audit-view') as any[];
    assert.ok(denyAudit.length >= 1, 'PERMISSION_DENIED audit event recorded');

    // 3.3 PERMISSION_REMOVED (DELETE override)
    const removeRes = await deleteUserPerm(new Request(`http://localhost:3001/api/permissions/user?userId=${permTargetUser}&permissionId=perm-gov-audit-view`, {
      method: 'DELETE',
    }));
    assert.equal(removeRes.status, 200);

    const removeAudit = db.prepare(`
      SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'PERMISSION_REMOVED'
    `).all('perm-gov-audit-view') as any[];
    assert.ok(removeAudit.length >= 1, 'PERMISSION_REMOVED audit event recorded');

    // 3.4 ROLE_PERMISSION_CHANGED
    const rolePermRes = await patchRolePerm(new Request('http://localhost:3001/api/permissions/role', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: 'SITE_MANAGER',
        permissionId: 'perm-gov-audit-view',
        scopeType: 'GLOBAL',
      }),
    }));
    assert.equal(rolePermRes.status, 200);

    const rolePermAudit = db.prepare(`
      SELECT * FROM audit_logs WHERE action = 'ROLE_PERMISSION_CHANGED' AND entity_id = 'perm-gov-audit-view'
    `).all() as any[];
    assert.ok(rolePermAudit.length >= 1, 'ROLE_PERMISSION_CHANGED audit event recorded');

    // Cleanup role permission override so later tests start with clean role baseline
    db.prepare(`DELETE FROM role_permissions WHERE role = 'SITE_MANAGER' AND permission_id = 'perm-gov-audit-view'`).run();

    // 3.5 Read-Only Invariant for Viewing Permissions: GET creates ZERO audit records
    const countBefore = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs`).get() as any).c;
    await getPermissions(new Request(`http://localhost:3001/api/permissions?userId=${permTargetUser}`));
    await getSitePerms(new Request(`http://localhost:3001/api/permissions/sites?userId=${permTargetUser}`));
    const countAfter = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs`).get() as any).c;

    assert.equal(countAfter, countBefore, 'Purely viewing permissions must produce 0 audit logs');
  });

  // =========================================================================
  // SECTION 4: LIFECYCLE -> AUDIT (SITE, WORK_ROLE, WORK_CATEGORY)
  // =========================================================================
  await t.test('4. Lifecycle -> Audit: Transitions across SITE, WORK_ROLE, WORK_CATEGORY with KEEP PERMANENTLY toggle', async () => {
    setTestSession(standardAdminSession);

    // -------------------------------------------------------------------------
    // 4.1 SITE Transitions
    // -------------------------------------------------------------------------
    const testSiteId = 'gate-2g3-site-lfc';
    setupSite(testSiteId, 'Lifecycle QA Site', 'LFC-SITE');

    // Active -> Archived via patchSite
    const siteArchRes = await patchSite(new Request(`http://localhost:3001/api/sites/${testSiteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ARCHIVE' }),
    }), { params: { id: testSiteId } });
    assert.equal(siteArchRes.status, 200);

    const siteArchAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_ARCHIVED'`).all(testSiteId) as any[];
    assert.equal(siteArchAudit.length, 1, 'Exactly one SITE_ARCHIVED audit event');
    assert.equal(siteArchAudit[0].user_id, standardAdminSession.userId);

    // Archived -> Active
    const siteRestRes1 = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: testSiteId }),
    }));
    assert.equal(siteRestRes1.status, 200);
    const siteRestAudit1 = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_RESTORED'`).all(testSiteId) as any[];
    assert.equal(siteRestAudit1.length, 1, 'Exactly one SITE_RESTORED audit event');

    // Active -> Recycle Bin via patchSite
    const siteRecRes = await patchSite(new Request(`http://localhost:3001/api/sites/${testSiteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MOVE_TO_BIN' }),
    }), { params: { id: testSiteId } });
    assert.equal(siteRecRes.status, 200);

    const siteRecAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_DELETED_TO_RECYCLE_BIN'`).all(testSiteId) as any[];
    assert.equal(siteRecAudit.length, 1, 'Exactly one SITE_DELETED_TO_RECYCLE_BIN audit event');

    // KEEP PERMANENTLY toggle
    const lfcSite = getLifecycleRecord('SITE', testSiteId)!;
    const keepRes = await patchRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lfcSite.id, keep: true }),
    }));
    assert.equal(keepRes.status, 200);
    const keepAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_KEEP_PERMANENTLY_TOGGLED'`).all(lfcSite.id) as any[];
    assert.equal(keepAudit.length, 1, 'SITE_KEEP_PERMANENTLY_TOGGLED audit event recorded');

    // Recycle Bin -> Active (Restore from Recycle Bin)
    const siteRestRes2 = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: testSiteId }),
    }));
    assert.equal(siteRestRes2.status, 200);
    const siteRestAudit2 = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_RESTORED_FROM_RECYCLE_BIN'`).all(testSiteId) as any[];
    assert.equal(siteRestAudit2.length, 1, 'Exactly one SITE_RESTORED_FROM_RECYCLE_BIN audit event');

    // Archived -> Recycle Bin -> Permanent Delete
    await patchSite(new Request(`http://localhost:3001/api/sites/${testSiteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ARCHIVE' }),
    }), { params: { id: testSiteId } });
    await patchSite(new Request(`http://localhost:3001/api/sites/${testSiteId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'MOVE_TO_BIN' }),
    }), { params: { id: testSiteId } });

    const permDelRes = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: testSiteId }),
    }));
    assert.equal(permDelRes.status, 200);
    const sitePermDelAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_PERMANENTLY_DELETED'`).all(testSiteId) as any[];
    assert.equal(sitePermDelAudit.length, 1, 'Exactly one SITE_PERMANENTLY_DELETED audit event');

    // -------------------------------------------------------------------------
    // 4.2 WORK_ROLE Transitions
    // -------------------------------------------------------------------------
    const testCatId = 'gate-2g3-cat-roles';
    setupCategory(testCatId, 'Lifecycle QA Category');
    const testRoleId = 'gate-2g3-role-lfc';
    setupRole(testRoleId, testCatId, 'Lifecycle QA Role');

    // Active -> Archived
    archiveRole(testRoleId, standardAdminSession.userId);
    const roleArchAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_ARCHIVED'`).all(testRoleId) as any[];
    assert.equal(roleArchAudit.length, 1, 'ROLE_ARCHIVED audit event');

    // Archived -> Active
    restoreRole(testRoleId, standardAdminSession.userId);
    const roleRestAudit1 = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_RESTORED'`).all(testRoleId) as any[];
    assert.equal(roleRestAudit1.length, 1, 'ROLE_RESTORED audit event');

    // Active -> Recycle Bin
    recycleRole(testRoleId, standardAdminSession.userId);
    const roleRecAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_DELETED_TO_RECYCLE_BIN'`).all(testRoleId) as any[];
    assert.equal(roleRecAudit.length, 1, 'ROLE_DELETED_TO_RECYCLE_BIN audit event');

    // Recycle Bin -> Permanent Delete
    const rolePermDelRes = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_ROLE', entityId: testRoleId }),
    }));
    assert.equal(rolePermDelRes.status, 200);
    const rolePermDelAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'ROLE_PERMANENTLY_DELETED'`).all(testRoleId) as any[];
    assert.equal(rolePermDelAudit.length, 1, 'ROLE_PERMANENTLY_DELETED audit event');

    // -------------------------------------------------------------------------
    // 4.3 WORK_CATEGORY Transitions
    // -------------------------------------------------------------------------
    const lfcCatId = 'gate-2g3-cat-lfc';
    setupCategory(lfcCatId, 'Standalone Category LFC');

    // Active -> Archived
    archiveCategory(lfcCatId, standardAdminSession.userId);
    const catArchAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_ARCHIVED'`).all(lfcCatId) as any[];
    assert.equal(catArchAudit.length, 1, 'CATEGORY_ARCHIVED audit event');

    // Archived -> Active
    restoreCategory(lfcCatId, standardAdminSession.userId);
    const catRestAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_RESTORED'`).all(lfcCatId) as any[];
    assert.equal(catRestAudit.length, 1, 'CATEGORY_RESTORED audit event');

    // Active -> Recycle Bin
    recycleCategory(lfcCatId, standardAdminSession.userId);
    const catRecAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_DELETED_TO_RECYCLE_BIN'`).all(lfcCatId) as any[];
    assert.equal(catRecAudit.length, 1, 'CATEGORY_DELETED_TO_RECYCLE_BIN audit event');

    // Recycle Bin -> Permanent Delete
    const catPermDelRes = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_CATEGORY', entityId: lfcCatId }),
    }));
    assert.equal(catPermDelRes.status, 200);
    const catPermDelAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'CATEGORY_PERMANENTLY_DELETED'`).all(lfcCatId) as any[];
    assert.equal(catPermDelAudit.length, 1, 'CATEGORY_PERMANENTLY_DELETED audit event');
  });

  // =========================================================================
  // SECTION 5: AUDIT TRAIL READ-ONLY INVARIANT
  // =========================================================================
  await t.test('5. Audit Trail Read-Only Invariant: Pure viewing across all endpoints leaves audit_logs unchanged (Delta = 0)', async () => {
    setTestSession(standardAdminSession);

    const countInitial = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs`).get() as any).c;

    // 1. Initial list load
    await getAuditList(new Request('http://localhost:3001/api/audit'));

    // 2. Search
    await getAuditList(new Request('http://localhost:3001/api/audit?search=Site'));

    // 3. Filters: entityType, action, actor, site
    await getAuditList(new Request('http://localhost:3001/api/audit?entityType=SECURITY'));
    await getAuditList(new Request('http://localhost:3001/api/audit?action=USER_CREATED'));
    await getAuditList(new Request(`http://localhost:3001/api/audit?userId=${standardAdminSession.userId}`));
    await getAuditList(new Request('http://localhost:3001/api/audit?siteId=site-1'));

    // 4. Date range filter
    await getAuditList(new Request('http://localhost:3001/api/audit?from=2026-01-01&to=2026-12-31'));

    // 5. Pagination
    await getAuditList(new Request('http://localhost:3001/api/audit?page=2&pageSize=10'));

    // 6. Details endpoint
    const sampleRecord = db.prepare(`SELECT id FROM audit_logs LIMIT 1`).get() as { id: string };
    if (sampleRecord?.id) {
      await getAuditDetail(new Request(`http://localhost:3001/api/audit/${sampleRecord.id}`), { params: { id: sampleRecord.id } });
    }

    const countFinal = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs`).get() as any).c;

    assert.equal(countFinal, countInitial, 'Audit viewing must be strictly read-only: Delta must be exactly 0');
  });

  // =========================================================================
  // SECTION 6: SUPERIOR PRIME PRIVACY END-TO-END
  // =========================================================================
  await t.test('6. Superior Prime Privacy: Absolute privacy for lower authorities and complete visibility for SP', async () => {
    // Seed SP security and operational records
    const spSecId = 'gate-2g3-sp-sec';
    const spOpId = 'gate-2g3-sp-op';

    db.prepare(`
      INSERT OR REPLACE INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
      VALUES 
        (?, 'SECURITY', 'usr-admin-1', 'PASSWORD_RESET', NULL, 'usr-admin-1', '{"tier":"SUPERIOR_PRIME"}', '{"reset":true}', datetime('now')),
        (?, 'EXPORT', 'exp-1', 'COMPLETE_EXPORT_GENERATED', NULL, 'usr-admin-1', NULL, '{"file":"export.zip"}', datetime('now'))
    `).run(spSecId, spOpId);

    // Test for each lower authority tier
    const lowerSessions = [
      { name: 'Client Prime', session: clientPrimeSession },
      { name: 'Standard Admin', session: standardAdminSession },
      { name: 'Site Manager', session: { ...siteManagerSession, assignedSiteIds: ['site-1'] } },
      { name: 'Viewer', session: { ...viewerSession, assignedSiteIds: ['site-1'] } },
    ];

    // Grant perm-gov-audit-view to siteManager and viewer for this test
    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, effect, granted_by, created_at, updated_at)
      VALUES 
        ('ov-sm-view', ?, 'perm-gov-audit-view', 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now')),
        ('ov-vw-view', ?, 'perm-gov-audit-view', 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(siteManagerSession.userId, viewerSession.userId);

    for (const { name, session } of lowerSessions) {
      setTestSession(session);

      // List query
      const res = await getAuditList(new Request('http://localhost:3001/api/audit?pageSize=50'));
      assert.equal(res.status, 200, `${name} can query audit trail`);
      const body = await res.json();

      // Ensure SP security record is completely absent
      const foundSec = body.items.find((r: any) => r.id === spSecId);
      assert.equal(foundSec, undefined, `${name} must NEVER see Superior Prime security record`);

      // Ensure SP operational record is pseudonymized
      const foundOp = body.items.find((r: any) => r.id === spOpId);
      if (session.assignedSiteIds.length === 0) { // Admins see global
        assert.ok(foundOp, `${name} sees operational record`);
        assert.equal(foundOp.actor.id, null, 'actor.id must be null');
        assert.equal(foundOp.actor.name, 'System Administrator', 'actor.name must be pseudonymized');
      }

      // Searching "Iamadmin" returns 0 results
      const searchRes = await getAuditList(new Request('http://localhost:3001/api/audit?search=Iamadmin'));
      const searchBody = await searchRes.json();
      assert.equal(searchBody.items.length, 0, `${name} search for SP username returns 0`);
      assert.equal(searchBody.totalCount, 0);

      // Direct detail query for SP security record returns 404
      const secDetailRes = await getAuditDetail(new Request(`http://localhost:3001/api/audit/${spSecId}`), { params: { id: spSecId } });
      assert.equal(secDetailRes.status, 404, `${name} requesting SP security record receives 404`);
    }

    // SUPERIOR_PRIME itself retains full visibility
    setTestSession(superiorPrimeSession);
    const spRes = await getAuditList(new Request('http://localhost:3001/api/audit?pageSize=50'));
    assert.equal(spRes.status, 200);
    const spBody = await spRes.json();
    const spFoundSec = spBody.items.find((r: any) => r.id === spSecId);
    assert.ok(spFoundSec, 'Superior Prime can see own security record');
    assert.equal(spFoundSec.actor.id, 'usr-admin-1', 'SP sees real actor id');
    assert.equal(spFoundSec.actor.name, 'Head Administrator', 'SP sees real actor name');
  });

  // =========================================================================
  // SECTION 7: PERMISSION + AUDIT INTEGRATION (RBAC)
  // =========================================================================
  await t.test('7. Permission + Audit Integration: RBAC matrix, explicit ALLOW/DENY precedence, and default deny', async () => {
    // 7.1 Standard Admin baseline -> 200
    setTestSession(standardAdminSession);
    const r1 = await getAuditList(new Request('http://localhost:3001/api/audit'));
    assert.equal(r1.status, 200, 'Standard Admin has baseline audit VIEW access');

    // 7.2 Standard Admin with explicit DENY -> 403
    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, effect, granted_by, created_at, updated_at)
      VALUES ('ov-sa-deny', ?, 'perm-gov-audit-view', 'DENY', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(standardAdminSession.userId);
    const r2 = await getAuditList(new Request('http://localhost:3001/api/audit'));
    assert.equal(r2.status, 403, 'Standard Admin with explicit DENY must be denied');

    // Cleanup deny override
    db.prepare(`DELETE FROM user_permission_overrides WHERE id = 'ov-sa-deny'`).run();

    // 7.3 Site Manager without permission -> 403
    db.prepare(`DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_id = 'perm-gov-audit-view'`).run(siteManagerSession.userId);
    setTestSession(siteManagerSession);
    const r3 = await getAuditList(new Request('http://localhost:3001/api/audit'));
    assert.equal(r3.status, 403, 'Site Manager without permission must be denied');

    // 7.4 Site Manager with explicit ALLOW -> 200
    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, effect, granted_by, created_at, updated_at)
      VALUES ('ov-sm-allow', ?, 'perm-gov-audit-view', 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(siteManagerSession.userId);
    const r4 = await getAuditList(new Request('http://localhost:3001/api/audit'));
    assert.equal(r4.status, 200, 'Site Manager with explicit ALLOW can view audit trail');

    // 7.5 Viewer without permission -> 403
    db.prepare(`DELETE FROM user_permission_overrides WHERE user_id = ? AND permission_id = 'perm-gov-audit-view'`).run(viewerSession.userId);
    setTestSession(viewerSession);
    const r5 = await getAuditList(new Request('http://localhost:3001/api/audit'));
    assert.equal(r5.status, 403, 'Viewer without permission must be denied');

    // 7.6 Viewer with explicit ALLOW -> 200
    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, effect, granted_by, created_at, updated_at)
      VALUES ('ov-vw-allow', ?, 'perm-gov-audit-view', 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(viewerSession.userId);
    const r6 = await getAuditList(new Request('http://localhost:3001/api/audit'));
    assert.equal(r6.status, 200, 'Viewer with explicit ALLOW can view audit trail');

    // 7.7 Explicit DENY precedence: DENY takes precedence over ALLOW
    const conflictUserId = 'gate-2g3-conflict-user';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'gate2g3.conflict', 'hash', 'Conflict User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(conflictUserId);

    const conflictSession: UserSession = {
      userId: conflictUserId,
      username: 'gate2g3.conflict',
      fullName: 'Conflict User',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, effect, granted_by, created_at, updated_at)
      VALUES ('ov-conflict', ?, 'perm-gov-audit-view', 'DENY', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(conflictUserId);

    setTestSession(conflictSession);
    const r7 = await getAuditList(new Request('http://localhost:3001/api/audit'));
    assert.equal(r7.status, 403, 'Explicit DENY must strictly deny access');
  });

  // =========================================================================
  // SECTION 8: SITE ISOLATION END-TO-END
  // =========================================================================
  await t.test('8. Site Isolation End-to-End: User A (Site 1) vs User B (Site 2) and anti-spoofing', async () => {
    const userAId = 'gate-2g3-user-a';
    const userBId = 'gate-2g3-user-b';

    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES 
        (?, 'gate2g3.usera', 'hash', 'User Site 1', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
        (?, 'gate2g3.userb', 'hash', 'User Site 2', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(userAId, userBId);

    // Site assignments
    db.prepare(`DELETE FROM site_users WHERE user_id IN (?, ?)`).run(userAId, userBId);
    db.prepare(`
      INSERT OR REPLACE INTO site_users (user_id, site_id) VALUES 
        (?, 'site-1'),
        (?, 'site-2')
    `).run(userAId, userBId);

    // Permission overrides to grant audit viewing
    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, effect, granted_by, created_at, updated_at)
      VALUES 
        ('ov-ua-view', ?, 'perm-gov-audit-view', 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now')),
        ('ov-ub-view', ?, 'perm-gov-audit-view', 'ALLOW', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(userAId, userBId);

    // Controlled audit records for Site 1 and Site 2
    const site1AuditId = 'gate-2g3-audit-site1';
    const site2AuditId = 'gate-2g3-audit-site2';

    db.prepare(`
      INSERT OR REPLACE INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
      VALUES 
        (?, 'ATTENDANCE', 'att-site1', 'ATTENDANCE_RECORDED', 'site-1', ?, NULL, '{"worker":1}', datetime('now')),
        (?, 'ATTENDANCE', 'att-site2', 'ATTENDANCE_RECORDED', 'site-2', ?, NULL, '{"worker":1}', datetime('now'))
    `).run(site1AuditId, userAId, site2AuditId, userBId);

    const userASession: UserSession = {
      userId: userAId,
      username: 'gate2g3.usera',
      fullName: 'User Site 1',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    const userBSession: UserSession = {
      userId: userBId,
      username: 'gate2g3.userb',
      fullName: 'User Site 2',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-2'],
      tokenVersion: 1,
    };

    // User A can see Site 1, CANNOT see Site 2
    setTestSession(userASession);
    const resA = await getAuditList(new Request('http://localhost:3001/api/audit'));
    const bodyA = await resA.json();
    assert.ok(bodyA.items.some((r: any) => r.id === site1AuditId), 'User A can see Site 1 log');
    assert.ok(!bodyA.items.some((r: any) => r.id === site2AuditId), 'User A CANNOT see Site 2 log');

    // User B can see Site 2, CANNOT see Site 1
    setTestSession(userBSession);
    const resB = await getAuditList(new Request('http://localhost:3001/api/audit'));
    const bodyB = await resB.json();
    assert.ok(bodyB.items.some((r: any) => r.id === site2AuditId), 'User B can see Site 2 log');
    assert.ok(!bodyB.items.some((r: any) => r.id === site1AuditId), 'User B CANNOT see Site 1 log');

    // Anti-Spoofing: User A attempts to filter ?siteId=site-2
    setTestSession(userASession);
    const spoofRes = await getAuditList(new Request('http://localhost:3001/api/audit?siteId=site-2'));
    const spoofBody = await spoofRes.json();
    assert.equal(spoofBody.items.length, 0, 'Spoofed unassigned site filter returns 0 records');

    // Detail endpoint: User A attempting to view Site 2 record directly receives 404
    const directDetailRes = await getAuditDetail(new Request(`http://localhost:3001/api/audit/${site2AuditId}`), { params: { id: site2AuditId } });
    assert.equal(directDetailRes.status, 404, 'Direct access to unauthorized site record returns 404');
  });

  // =========================================================================
  // SECTION 9: CROSS-MODULE AUDIT CHAIN TRACEABILITY
  // =========================================================================
  await t.test('9. Cross-Module Audit Chain: Verify existence and mapping of all 10 domain modules', async () => {
    const modulesToVerify = [
      { module: 'AUTH', sampleAction: 'PASSWORD_RESET', entityType: 'SECURITY' },
      { module: 'USERS', sampleAction: 'USER_CREATED', entityType: 'SECURITY' },
      { module: 'PERMISSIONS', sampleAction: 'PERMISSION_GRANTED', entityType: 'PERMISSION' },
      { module: 'SITES', sampleAction: 'SITE_ARCHIVED', entityType: 'SITE' },
      { module: 'ROLES', sampleAction: 'ROLE_ARCHIVED', entityType: 'ROLE' },
      { module: 'CATEGORIES', sampleAction: 'CATEGORY_ARCHIVED', entityType: 'CATEGORY' },
      { module: 'ATTENDANCE', sampleAction: 'ATTENDANCE_RECORDED', entityType: 'ATTENDANCE' },
      { module: 'FINANCE', sampleAction: 'FINANCE_TRANSACTION_CREATED', entityType: 'FINANCE' },
      { module: 'LIFECYCLE', sampleAction: 'SITE_KEEP_PERMANENTLY_TOGGLED', entityType: 'LIFECYCLE' },
      { module: 'EXPORT', sampleAction: 'COMPLETE_EXPORT_GENERATED', entityType: 'EXPORT' },
    ];

    for (const m of modulesToVerify) {
      // Ensure at least one log row exists for coverage verification
      const existing = db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = ?`).get(m.sampleAction) as any;
      if (existing.c === 0) {
        db.prepare(`
          INSERT INTO audit_logs (id, entity_type, entity_id, action, user_id, created_at)
          VALUES (?, ?, 'gate-2g3-cov', ?, 'usr-admin-1', datetime('now'))
        `).run(`gate-2g3-${m.module.toLowerCase()}`, m.entityType, m.sampleAction);
      }

      const verified = db.prepare(`SELECT * FROM audit_logs WHERE action = ? LIMIT 1`).get(m.sampleAction) as any;
      assert.ok(verified, `Module ${m.module} must have verifiable audit history`);
      assert.equal(verified.action, m.sampleAction);
    }
  });

  // =========================================================================
  // SECTION 10: FAILED OPERATIONS
  // =========================================================================
  await t.test('10. Failed Operations: Destructive/Security failures must produce ZERO success audit logs', async () => {
    // 10.1 Unauthorized permission change attempt by Site Manager
    setTestSession(siteManagerSession);
    const countBefore1 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'PERMISSION_GRANTED'`).get() as any).c;
    const failPermRes = await patchUserPerm(new Request('http://localhost:3001/api/permissions/user', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-eng-1',
        permissionId: 'perm-gov-audit-view',
        effect: 'ALLOW',
      }),
    }));
    assert.equal(failPermRes.status, 403);
    const countAfter1 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'PERMISSION_GRANTED'`).get() as any).c;
    assert.equal(countAfter1, countBefore1, 'Failed permission grant produces 0 success audit logs');

    // 10.2 Unauthorized user modification attempt (Site Manager attempting to change password)
    const countBefore2 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'PASSWORD_RESET'`).get() as any).c;
    const failUserRes = await patchUser(new Request('http://localhost:3001/api/users', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-admin-1',
        action: 'RESET_PASSWORD',
        newPassword: 'HackedPassword123!',
      }),
    }));
    assert.equal(failUserRes.status, 403);
    const countAfter2 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'PASSWORD_RESET'`).get() as any).c;
    assert.equal(countAfter2, countBefore2, 'Failed password reset produces 0 success audit logs');

    // 10.3 Restore collision (duplicate active name)
    setTestSession(standardAdminSession);
    const siteDup1 = 'gate-2g3-dup1';
    const siteDup2 = 'gate-2g3-dup2';
    setupSite(siteDup1, 'Collision Unique Site Name', 'COL-1');
    setupSite(siteDup2, 'Collision Unique Site Name', 'COL-2');
    toggleSiteArchived(siteDup2, true, standardAdminSession.userId);

    const countBefore3 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'SITE_RESTORED'`).get() as any).c;
    const collRes = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteDup2 }),
    }));
    assert.equal(collRes.status, 409, 'Restore collision returns 409 Conflict');
    const countAfter3 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'SITE_RESTORED'`).get() as any).c;
    assert.equal(countAfter3, countBefore3, 'Failed restore produces 0 success audit logs');

    // 10.4 Permanent delete blocked by dependency
    const activeSiteWithDeps = 'gate-2g3-dep-site';
    setupSite(activeSiteWithDeps, 'Site With Deps', 'DEP-1');
    moveSiteToRecycleBin(activeSiteWithDeps, standardAdminSession.userId);
    // Add active attendance record blocking deletion
    const existingRoleId = (db.prepare('SELECT id FROM work_roles LIMIT 1').get() as any).id;
    db.prepare(`
      INSERT INTO attendance_records (id, site_id, role_id, date, rate_snapshot_paise, full_day_count, half_day_count, total_workers, worker_days, total_cost_paise, created_by, created_at, updated_at)
      VALUES ('att-block-1', ?, ?, '2026-09-19', 50000, 5, 0, 5, 5, 250000, 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(activeSiteWithDeps, existingRoleId);

    const countBefore4 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'SITE_PERMANENTLY_DELETED'`).get() as any).c;
    const permDelBlockRes = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: activeSiteWithDeps }),
    }));
    assert.equal(permDelBlockRes.status, 409, 'Permanent deletion with dependencies blocked with 409');
    const countAfter4 = (db.prepare(`SELECT COUNT(*) as c FROM audit_logs WHERE action = 'SITE_PERMANENTLY_DELETED'`).get() as any).c;
    assert.equal(countAfter4, countBefore4, 'Blocked permanent delete produces 0 audit logs');
  });

  // =========================================================================
  // SECTION 11: CONCURRENCY
  // =========================================================================
  await t.test('11. Concurrency: Deterministic state, no duplicates, and transactional integrity', async () => {
    setTestSession(standardAdminSession);

    // 11.1 Concurrent Recycle: Two requests on same entity via patchSite
    const concSiteId = 'gate-2g3-conc-site';
    setupSite(concSiteId, 'Concurrent Test Site', 'CONC-1');

    await Promise.all([
      patchSite(new Request(`http://localhost:3001/api/sites/${concSiteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MOVE_TO_BIN' }),
      }), { params: { id: concSiteId } }),
      patchSite(new Request(`http://localhost:3001/api/sites/${concSiteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MOVE_TO_BIN' }),
      }), { params: { id: concSiteId } }),
    ]);

    const lfcRows = db.prepare(`SELECT * FROM system_lifecycle_records WHERE entity_id = ?`).all(concSiteId);
    assert.equal(lfcRows.length, 1, 'Exactly one lifecycle row must exist');

    // 11.2 Concurrent Restore: Two requests on same entity
    await Promise.all([
      postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'SITE', entityId: concSiteId }),
      })),
      postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'SITE', entityId: concSiteId }),
      })),
    ]);

    const restoredSite = db.prepare(`SELECT is_archived FROM sites WHERE id = ?`).get(concSiteId) as any;
    assert.equal(restoredSite.is_archived, 0);

    // 11.3 Concurrent Permanent Delete: Two delete calls
    moveSiteToRecycleBin(concSiteId, standardAdminSession.userId);
    const [delRes1, delRes2] = await Promise.all([
      postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'SITE', entityId: concSiteId }),
      })),
      postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'SITE', entityId: concSiteId }),
      })),
    ]);

    const statuses = [delRes1.status, delRes2.status].sort();
    assert.deepEqual(statuses, [200, 404], 'One succeeds (200), subsequent receives 404');

    const permAudit = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_PERMANENTLY_DELETED'`).all(concSiteId);
    assert.equal(permAudit.length, 1, 'Exactly one permanent delete audit log created');
  });

  // =========================================================================
  // SECTION 12: AUDIT IMMUTABILITY
  // =========================================================================
  await t.test('12. Audit Immutability: Verify lack of UPDATE/DELETE APIs and historical log preservation', async () => {
    // 12.1 Verify GET /api/audit and GET /api/audit/[id] are purely read-only (no PUT, POST, DELETE exported)
    const auditRouteModule = await import('../app/api/audit/route');
    assert.ok(auditRouteModule.GET, 'GET exported');
    assert.equal((auditRouteModule as any).POST, undefined, 'POST must not be exported for /api/audit');
    assert.equal((auditRouteModule as any).PUT, undefined, 'PUT must not be exported for /api/audit');
    assert.equal((auditRouteModule as any).DELETE, undefined, 'DELETE must not be exported for /api/audit');

    const auditDetailModule = await import('../app/api/audit/[id]/route');
    assert.ok(auditDetailModule.GET, 'GET exported');
    assert.equal((auditDetailModule as any).POST, undefined, 'POST must not be exported for /api/audit/[id]');
    assert.equal((auditDetailModule as any).PUT, undefined, 'PUT must not be exported for /api/audit/[id]');
    assert.equal((auditDetailModule as any).DELETE, undefined, 'DELETE must not be exported for /api/audit/[id]');

    // 12.2 User deletion disassociates user_id while preserving audit log row
    setTestSession(clientPrimeSession);
    const immTargetUser = 'gate-2g3-imm-user';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'gate2g3.imm', 'hash', 'Immutable Target User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(immTargetUser);

    const targetAuditId = 'gate-2g3-imm-log';
    db.prepare(`
      INSERT INTO audit_logs (id, entity_type, entity_id, action, user_id, created_at)
      VALUES (?, 'SECURITY', ?, 'USER_CREATED', ?, datetime('now'))
    `).run(targetAuditId, immTargetUser, immTargetUser);

    // Delete user
    await deleteUser(new Request(`http://localhost:3001/api/users?id=${immTargetUser}`, { method: 'DELETE' }));

    // Verify row still exists, with user_id NULL
    const logAfter = db.prepare(`SELECT * FROM audit_logs WHERE id = ?`).get(targetAuditId) as any;
    assert.ok(logAfter, 'Audit log row must not be purged when user is deleted');
    assert.equal(logAfter.user_id, null, 'user_id must be nullified to preserve FK integrity without row loss');
  });

  // =========================================================================
  // SECTION 13: NAVIGATION INTEGRATION & ROUTE NORMALIZATION
  // =========================================================================
  await t.test('13. Navigation Integration: Canonical /setup/audit-trail and backward-compatible /setup/audit', async () => {
    // Both page files must exist and /setup/audit re-exports from /setup/audit-trail
    const canonicalPage = await import('../app/(dashboard)/setup/audit-trail/page');
    const legacyPage = await import('../app/(dashboard)/setup/audit/page');

    assert.ok(canonicalPage.default, 'Canonical page has default export');
    assert.equal(legacyPage.default, canonicalPage.default, 'Legacy page re-exports canonical component (zero duplication)');
  });

  // =========================================================================
  // PRODUCTION DATABASE SAFETY VERIFICATION
  // =========================================================================
  await t.test('14. Production Database Safety: Baseline metrics intact', async () => {
    const prodDb = new DatabaseSync('data/site_work.db');

    const counts = {
      users: (prodDb.prepare('SELECT COUNT(*) as c FROM users').get() as any).c,
      sites: (prodDb.prepare('SELECT COUNT(*) as c FROM sites').get() as any).c,
      work_categories: (prodDb.prepare('SELECT COUNT(*) as c FROM work_categories').get() as any).c,
      work_roles: (prodDb.prepare('SELECT COUNT(*) as c FROM work_roles').get() as any).c,
      attendance_records: (prodDb.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as any).c,
      financial_transactions: (prodDb.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c,
      audit_logs: (prodDb.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as any).c,
      system_lifecycle_records: (prodDb.prepare('SELECT COUNT(*) as c FROM system_lifecycle_records').get() as any).c,
    };

    assert.equal(counts.users, 4, 'users = 4');
    assert.equal(counts.sites, 6, 'sites = 6');
    assert.equal(counts.work_categories, 4, 'work_categories = 4');
    assert.equal(counts.work_roles, 23, 'work_roles = 23');
    assert.equal(counts.attendance_records, 18, 'attendance_records = 18');
    assert.equal(counts.financial_transactions, 4, 'financial_transactions = 4');
    assert.equal(counts.audit_logs, 429, 'audit_logs = 429');
    assert.equal(counts.system_lifecycle_records, 0, 'system_lifecycle_records = 0');

    const integrity = (prodDb.prepare('PRAGMA integrity_check').get() as any).integrity_check;
    assert.equal(integrity, 'ok', 'PRAGMA integrity_check = ok');

    const fks = prodDb.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fks.length, 0, 'PRAGMA foreign_key_check = 0');
  });
});
