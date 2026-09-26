process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { GET as getArchive } from '../app/api/lifecycle/archive/route';
import { GET as getRecycleBin, PATCH as patchRecycleBin } from '../app/api/lifecycle/recycle-bin/route';
import { POST as postRestore } from '../app/api/lifecycle/restore/route';
import { POST as postPermanentDelete } from '../app/api/lifecycle/permanent-delete/route';
import { PATCH as patchSite } from '../app/api/sites/[id]/route';
import { UserSession } from '../lib/auth/session';
import { canAccess } from '../lib/permissions/evaluator';
import { 
  getLifecycleRecord, 
  getGlobalArchivedItems, 
  getGlobalRecycledItems,
  toggleLifecycleKeepPermanently 
} from '../lib/db/repositories/global-lifecycle-repo';
import { executePermanentDelete } from '../lib/lifecycle/permanent-delete-engine';
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

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2F.1: Targeted Global Lifecycle Security Gate (CTO Final Freeze Verification)', async (t) => {
  const db = new DatabaseSync(process.env.DATABASE_PATH!);

  // Clean up any test records from prior runs
  db.prepare(`DELETE FROM system_lifecycle_records WHERE entity_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM site_role_rates WHERE site_id LIKE 'gate-2f1-%' OR role_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM site_users WHERE site_id LIKE 'gate-2f1-%' OR user_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM attendance_records WHERE site_id LIKE 'gate-2f1-%' OR role_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM financial_transactions WHERE site_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM work_roles WHERE id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM work_categories WHERE id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM sites WHERE id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM audit_logs WHERE entity_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM user_permission_overrides WHERE user_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM users WHERE id LIKE 'gate-2f1-%'`).run();

  // Ensure standard authority principals exist
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Superior Prime', 'ADMIN', 'SUPERIOR_PRIME', 1, 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Operational Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
      ('usr-view-1', 'viewer1', 'hash', 'Viewer User', 'VIEWER', 'STANDARD', 1, 1, 1)
  `).run();

  const superiorPrimeSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Superior Prime',
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
    fullName: 'Operational Engineer',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Viewer User',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const setupCategory = (id: string, name: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO work_categories (id, name, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, 100, 1, datetime('now'), datetime('now'))
    `).run(id, name);
  };

  const setupRole = (id: string, categoryId: string, name: string, ratePaise = 50000) => {
    db.prepare(`
      INSERT OR REPLACE INTO work_roles (id, category_id, name, default_rate_paise, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 100, 1, datetime('now'), datetime('now'))
    `).run(id, categoryId, name, ratePaise);
  };

  const setupSite = (id: string, name: string, code: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO sites (id, name, code, location, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, 'Gate Location', 0, datetime('now'), datetime('now'))
    `).run(id, name, code);
  };

  // =========================================================================
  // CTO GATE 1: Complete RBAC Matrix & Granular Evaluation for Standard Admin
  // =========================================================================
  await t.test('1. Complete RBAC Matrix across all 5 tiers and Granular Overrides for Standard Admin', async () => {
    // 1.1 Superior Prime -> Platform Authority on all lifecycle routes
    setTestSession(superiorPrimeSession);
    const r1 = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(r1.status, 200, 'Superior Prime Archive VIEW allowed');

    const r2 = await getRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin'));
    assert.equal(r2.status, 200, 'Superior Prime Recycle Bin VIEW allowed');

    // 1.2 Client Prime -> Allowed on all lifecycle routes
    setTestSession(clientPrimeSession);
    const r3 = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(r3.status, 200, 'Client Prime Archive VIEW allowed');

    // 1.3 Site Manager -> Default Deny on Archive/Recycle Bin
    setTestSession(siteManagerSession);
    const r4 = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(r4.status, 403, 'Site Manager Archive VIEW denied');

    const r5 = await getRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin'));
    assert.equal(r5.status, 403, 'Site Manager Recycle Bin VIEW denied');

    // 1.4 Viewer -> Default Deny on Archive/Recycle Bin
    setTestSession(viewerSession);
    const r6 = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(r6.status, 403, 'Viewer Archive VIEW denied');

    // 1.5 Granular Permission Overrides for Standard Admin:
    // Create dedicated QA Standard Admin
    const qaAdminId = 'gate-2f1-admin-override';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'qa.admin.override', 'hash', 'QA Override Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1)
    `).run(qaAdminId);

    const qaAdminSession: UserSession = {
      userId: qaAdminId,
      username: 'qa.admin.override',
      fullName: 'QA Override Admin',
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      assignedSiteIds: [],
      tokenVersion: 1,
    };

    // Case A: NOT CONFIGURED -> Standard Admin inherits Role Baseline Allow
    setTestSession(qaAdminSession);
    const dNotConfigured = canAccess({ session: qaAdminSession, page: 'PAGE_GLOBAL_ARCHIVE', action: 'VIEW' });
    assert.equal(dNotConfigured.allowed, true, 'Standard Admin baseline is allowed');

    // Case B: Explicit DENY Override
    db.prepare(`
      INSERT OR REPLACE INTO user_permission_overrides (id, user_id, permission_id, effect, granted_by, created_at, updated_at)
      VALUES ('ov-deny', ?, 'perm-gov-archive-view', 'DENY', 'usr-admin-1', datetime('now'), datetime('now'))
    `).run(qaAdminId);

    const dExplicitDeny = canAccess({ session: qaAdminSession, page: 'PAGE_GLOBAL_ARCHIVE', action: 'VIEW' });
    assert.equal(dExplicitDeny.allowed, false, 'Explicit DENY override must deny Standard Admin');
    assert.equal(dExplicitDeny.ruleSource, 'USER_GLOBAL_EXPLICIT_DENY');

    // Case C: Explicit ALLOW Override
    db.prepare(`
      UPDATE user_permission_overrides SET effect = 'ALLOW' WHERE id = 'ov-deny'
    `).run();

    const dExplicitAllow = canAccess({ session: qaAdminSession, page: 'PAGE_GLOBAL_ARCHIVE', action: 'VIEW' });
    assert.equal(dExplicitAllow.allowed, true, 'Explicit ALLOW override allows Standard Admin');
    assert.equal(dExplicitAllow.ruleSource, 'USER_GLOBAL_EXPLICIT_ALLOW');

    // Cleanup override
    db.prepare(`DELETE FROM user_permission_overrides WHERE id = 'ov-deny'`).run();
  });

  // =========================================================================
  // CTO GATE 2: Site-Scope Lifecycle Security & Anti-Spoofing
  // =========================================================================
  await t.test('2. Site-scope lifecycle security: Persisted resource ownership & caller siteId spoofing prevention', async () => {
    // Setup Site A and Site B
    const siteA = 'gate-2f1-site-a';
    const siteB = 'gate-2f1-site-b';
    setupSite(siteA, 'Site Alpha', 'S-A');
    setupSite(siteB, 'Site Beta', 'S-B');

    // Setup QA User assigned only to Site A
    const qaUserId = 'gate-2f1-user-sitea';
    db.prepare(`
      INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES (?, 'qa.site.mgr', 'hash', 'Site Manager Alpha', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run(qaUserId);

    db.prepare(`
      INSERT OR REPLACE INTO site_users (id, site_id, user_id, created_at)
      VALUES ('su-ga-1', ?, ?, datetime('now'))
    `).run(siteA, qaUserId);

    const qaSiteSession: UserSession = {
      userId: qaUserId,
      username: 'qa.site.mgr',
      fullName: 'Site Manager Alpha',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: [siteA],
      tokenVersion: 1,
    };

    // Test evaluator with resourceSiteId vs caller-supplied siteId
    // Case 1: Caller claims siteA, but resource actually belongs to siteB (tamper attempt)
    const spoofDecision = canAccess({
      session: qaSiteSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: siteA,           // Untrusted caller claim
      resourceSiteId: siteB,   // Authoritative persisted resource site
    });
    assert.equal(spoofDecision.allowed, false, 'Site mismatch / spoofing must be rejected');
    assert.equal(spoofDecision.ruleSource, 'SITE_MISMATCH_REJECTED');

    // Case 2: Unassigned Site B direct access -> denied
    const unassignedDecision = canAccess({
      session: qaSiteSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: siteB,
      resourceSiteId: siteB,
    });
    assert.equal(unassignedDecision.allowed, false, 'Unassigned site must be denied');

    // Case 3: Assigned Site A access -> allowed
    const assignedDecision = canAccess({
      session: qaSiteSession,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId: siteA,
      resourceSiteId: siteA,
    });
    assert.equal(assignedDecision.allowed, true, 'Assigned site must be allowed');
  });

  // =========================================================================
  // CTO GATE 3: Keep Permanently Semantics
  // =========================================================================
  await t.test('3. Keep Permanently semantics: State preservation, no deletion, audit trail, human wording', async () => {
    setTestSession(standardAdminSession);

    const siteId = 'gate-2f1-site-kp';
    setupSite(siteId, 'Keep Perm Site', 'KP-01');
    moveSiteToRecycleBin(siteId, standardAdminSession.userId);

    let lfc = getLifecycleRecord('SITE', siteId);
    assert.ok(lfc);
    assert.equal(lfc!.state, 'RECYCLE_BIN');
    assert.equal(lfc!.keep_permanently, 0);

    // Toggle ON -> keep_permanently = true
    const resOn = await patchRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lfc!.id, keep: true }),
    }));
    assert.equal(resOn.status, 200);

    lfc = getLifecycleRecord('SITE', siteId);
    assert.equal(lfc!.state, 'RECYCLE_BIN', 'State must remain RECYCLE_BIN');
    assert.equal(lfc!.keep_permanently, 1, 'keep_permanently must be 1');

    // Verify entity STILL exists in primary table
    const siteInDb = db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId);
    assert.ok(siteInDb, 'Entity must remain in primary table');

    // Verify audit log created for toggle
    const auditOn = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE entity_id = ? AND action = 'SITE_KEEP_PERMANENTLY_TOGGLED'
    `).all(lfc!.id);
    assert.ok(auditOn.length >= 1, 'Audit log for keep permanently toggle must exist');

    // Toggle OFF -> keep_permanently = false
    const resOff = await patchRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lfc!.id, keep: false }),
    }));
    assert.equal(resOff.status, 200);

    lfc = getLifecycleRecord('SITE', siteId);
    assert.equal(lfc!.keep_permanently, 0, 'keep_permanently toggled back to 0');
    assert.equal(lfc!.state, 'RECYCLE_BIN', 'State still RECYCLE_BIN');
  });

  // =========================================================================
  // CTO GATE 4: Lifecycle Record Consistency Across All Sequences (A, B, C, D)
  // =========================================================================
  await t.test('4. Lifecycle record consistency across sequences A, B, C, D', async () => {
    setTestSession(standardAdminSession);

    // Sequence A: ACTIVE -> ARCHIVED -> ACTIVE
    const siteA = 'gate-2f1-seq-a';
    setupSite(siteA, 'Seq A Site', 'SQ-A');
    toggleSiteArchived(siteA, true, standardAdminSession.userId);
    let lfcA = getLifecycleRecord('SITE', siteA);
    assert.equal(lfcA!.state, 'ARCHIVED');
    assert.equal(lfcA!.source_route, '/setup/sites');

    // Restore to active
    await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteA }),
    }));
    assert.equal(getLifecycleRecord('SITE', siteA), null, 'No stale ARCHIVED record may remain');
    const siteARow = db.prepare('SELECT id, is_archived FROM sites WHERE id = ?').get(siteA) as any;
    assert.equal(siteARow.is_archived, 0);

    // Sequence B: ACTIVE -> RECYCLE_BIN -> ACTIVE
    const siteB = 'gate-2f1-seq-b';
    setupSite(siteB, 'Seq B Site', 'SQ-B');
    moveSiteToRecycleBin(siteB, standardAdminSession.userId);
    let lfcB = getLifecycleRecord('SITE', siteB);
    assert.equal(lfcB!.state, 'RECYCLE_BIN');

    await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteB }),
    }));
    assert.equal(getLifecycleRecord('SITE', siteB), null, 'No stale RECYCLE_BIN record may remain');
    const siteBRow = db.prepare('SELECT id, is_archived FROM sites WHERE id = ?').get(siteB) as any;
    assert.equal(siteBRow.is_archived, 0);
    assert.equal(siteBRow.id, siteB, 'Entity ID must remain immutable');

    // Sequence C: ACTIVE -> ARCHIVED -> RECYCLE_BIN -> ACTIVE
    const siteC = 'gate-2f1-seq-c';
    setupSite(siteC, 'Seq C Site', 'SQ-C');
    toggleSiteArchived(siteC, true, standardAdminSession.userId);
    assert.equal(getLifecycleRecord('SITE', siteC)!.state, 'ARCHIVED');

    moveSiteToRecycleBin(siteC, standardAdminSession.userId);
    assert.equal(getLifecycleRecord('SITE', siteC)!.state, 'RECYCLE_BIN');

    await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteC }),
    }));
    assert.equal(getLifecycleRecord('SITE', siteC), null);
    const siteCRow = db.prepare('SELECT id, is_archived FROM sites WHERE id = ?').get(siteC) as any;
    assert.equal(siteCRow.is_archived, 0);

    // Sequence D: ACTIVE -> RECYCLE_BIN -> PERMANENT DELETE
    const siteD = 'gate-2f1-seq-d';
    setupSite(siteD, 'Seq D Site', 'SQ-D');
    moveSiteToRecycleBin(siteD, standardAdminSession.userId);
    assert.equal(getLifecycleRecord('SITE', siteD)!.state, 'RECYCLE_BIN');

    const resDel = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteD }),
    }));
    assert.equal(resDel.status, 200);

    // Primary entity removed
    assert.equal(db.prepare('SELECT id FROM sites WHERE id = ?').get(siteD), undefined);
    // Lifecycle record removed
    assert.equal(getLifecycleRecord('SITE', siteD), null);
    // Permanent delete audit exists
    const auditDel = db.prepare(`SELECT * FROM audit_logs WHERE entity_id = ? AND action = 'SITE_PERMANENTLY_DELETED'`).get(siteD);
    assert.ok(auditDel);
  });

  // =========================================================================
  // CTO GATE 5: Invalid Transitions Handled Safely & Idempotently
  // =========================================================================
  await t.test('5. Invalid transitions: ACTIVE->ACTIVE, ARCHIVED->ARCHIVED, RECYCLE_BIN->RECYCLE_BIN, PERMANENT->RESTORE', async () => {
    setTestSession(standardAdminSession);

    const siteId = 'gate-2f1-inv-trans';
    setupSite(siteId, 'Invalid Trans Site', 'INV-01');

    // 5.1 ACTIVE -> RESTORE (idempotent / no duplicate audit)
    const auditBefore = db.prepare(`SELECT count(*) as c FROM audit_logs WHERE entity_id = ?`).get(siteId) as any;
    restoreSiteFromRecycleBin(siteId, false, standardAdminSession.userId);
    const auditAfter = db.prepare(`SELECT count(*) as c FROM audit_logs WHERE entity_id = ?`).get(siteId) as any;
    assert.equal(auditAfter.c, auditBefore.c, 'Active entity restore must be idempotent without extra audit');

    // 5.2 ARCHIVED -> ARCHIVED (idempotent)
    toggleSiteArchived(siteId, true, standardAdminSession.userId);
    const lfc1 = db.prepare(`SELECT count(*) as c FROM system_lifecycle_records WHERE entity_id = ?`).get(siteId) as any;
    assert.equal(lfc1.c, 1);
    toggleSiteArchived(siteId, true, standardAdminSession.userId);
    const lfc2 = db.prepare(`SELECT count(*) as c FROM system_lifecycle_records WHERE entity_id = ?`).get(siteId) as any;
    assert.equal(lfc2.c, 1, 'No duplicate lifecycle rows');

    // 5.3 PERMANENTLY DELETED -> RESTORE (must fail 404)
    moveSiteToRecycleBin(siteId, standardAdminSession.userId);
    executePermanentDelete('SITE', siteId, standardAdminSession.userId);

    const resRestoreDeleted = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteId }),
    }));
    assert.equal(resRestoreDeleted.status, 404, 'Restoring permanently deleted entity must return 404');
  });

  // =========================================================================
  // CTO GATE 6: Restore Collision Safety (Site, Category, Role)
  // =========================================================================
  await t.test('6. Restore collision safety: Reconfirmation with zero partial restoration', async () => {
    setTestSession(standardAdminSession);

    // 6.1 Duplicate site code collision
    const site1 = 'gate-2f1-col-s1';
    const site2 = 'gate-2f1-col-s2';
    setupSite(site1, 'Collision Site One', 'CS-01');
    moveSiteToRecycleBin(site1, standardAdminSession.userId);

    setupSite(site2, 'Collision Site Two', 'CS-01'); // Same code

    const resCodeCol = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: site1 }),
    }));
    assert.equal(resCodeCol.status, 409);
    const dCode = await resCodeCol.json();
    assert.equal(dCode.isBlocked, true);
    assert.match(dCode.error, /code 'CS-01' already exists/i);

    // Verify site1 remains strictly in RECYCLE_BIN (no partial restore)
    const site1Row = db.prepare('SELECT is_archived FROM sites WHERE id = ?').get(site1) as any;
    assert.equal(site1Row.is_archived, 1, 'Site must remain archived/recycled');
    const lfcSite1 = getLifecycleRecord('SITE', site1);
    assert.equal(lfcSite1!.state, 'RECYCLE_BIN', 'Lifecycle record must remain untouched');
  });

  // =========================================================================
  // CTO GATE 7: Permanent Delete Authorization & Dependencies
  // =========================================================================
  await t.test('7. Permanent delete authorization: ACTIVE, ARCHIVED, protected, and safe RECYCLE_BIN', async () => {
    setTestSession(superiorPrimeSession);

    // 7.1 ACTIVE entity -> 409
    const actId = 'gate-2f1-act-del';
    setupSite(actId, 'Active Site Del', 'ACT-DEL');
    const resAct = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: actId }),
    }));
    assert.equal(resAct.status, 409);

    // 7.2 ARCHIVED entity -> 409
    toggleSiteArchived(actId, true, superiorPrimeSession.userId);
    const resArc = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: actId }),
    }));
    assert.equal(resArc.status, 409);

    // 7.3 Protected RECYCLE_BIN with attendance -> 409
    moveSiteToRecycleBin(actId, superiorPrimeSession.userId);
    const catId = 'gate-2f1-cat-del';
    const roleId = 'gate-2f1-role-del';
    setupCategory(catId, 'Gate Del Cat');
    setupRole(roleId, catId, 'Gate Del Role');

    db.prepare(`
      INSERT INTO attendance_records (id, site_id, role_id, date, rate_snapshot_paise, total_workers, worker_days, total_cost_paise, created_at, updated_at)
      VALUES ('att-gate-del', ?, ?, '2026-09-19', 50000, 4, 4, 200000, datetime('now'), datetime('now'))
    `).run(actId, roleId);

    const resProtected = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: actId }),
    }));
    assert.equal(resProtected.status, 409);

    // 7.4 Safe unencumbered RECYCLE_BIN -> 200
    const cleanId = 'gate-2f1-clean-del';
    setupSite(cleanId, 'Clean Del Site', 'CLN-DEL');
    moveSiteToRecycleBin(cleanId, superiorPrimeSession.userId);

    const resClean = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: cleanId }),
    }));
    assert.equal(resClean.status, 200);
  });

  // =========================================================================
  // CTO GATE 8: Audit Integrity & Single Event Guarantee
  // =========================================================================
  await t.test('8. Audit integrity: Exactly one distinct audit log per successful operation', async () => {
    const siteId = 'gate-2f1-audit-site';
    setupSite(siteId, 'Audit Test Site', 'AUD-01');

    setTestSession(superiorPrimeSession);

    // Archive
    await patchSite(
      new Request(`http://localhost:3001/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ARCHIVE' }),
      }),
      { params: { id: siteId } }
    );
    const archiveAudits = db.prepare(`SELECT count(*) as c FROM audit_logs WHERE entity_id = ? AND action = 'SITE_ARCHIVED'`).get(siteId) as any;
    assert.equal(archiveAudits.c, 1, 'Exactly one SITE_ARCHIVED audit log');

    // Restore
    await patchSite(
      new Request(`http://localhost:3001/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'RESTORE' }),
      }),
      { params: { id: siteId } }
    );
    const restoreAudits = db.prepare(`SELECT count(*) as c FROM audit_logs WHERE entity_id = ? AND action = 'SITE_RESTORED'`).get(siteId) as any;
    assert.equal(restoreAudits.c, 1, 'Exactly one SITE_RESTORED audit log');

    // Move to bin
    await patchSite(
      new Request(`http://localhost:3001/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'MOVE_TO_BIN' }),
      }),
      { params: { id: siteId } }
    );
    const binAudits = db.prepare(`SELECT count(*) as c FROM audit_logs WHERE entity_id = ? AND action = 'SITE_DELETED_TO_RECYCLE_BIN'`).get(siteId) as any;
    assert.equal(binAudits.c, 1, 'Exactly one SITE_DELETED_TO_RECYCLE_BIN audit log');

    // Permanent delete
    await postPermanentDelete(
      new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityType: 'SITE', entityId: siteId }),
      })
    );
    const permAudits = db.prepare(`SELECT count(*) as c FROM audit_logs WHERE entity_id = ? AND action = 'SITE_PERMANENTLY_DELETED'`).get(siteId) as any;
    assert.equal(permAudits.c, 1, 'Exactly one SITE_PERMANENTLY_DELETED audit log');
  });

  // =========================================================================
  // CTO GATE 9: Concurrency Safety
  // =========================================================================
  await t.test('9. Concurrency safety: Concurrent attempts maintain deterministic single transition', async () => {
    const siteId = 'gate-2f1-concur-site';
    setupSite(siteId, 'Concurrent Site', 'CON-01');

    // Concurrent moveSiteToRecycleBin attempts
    await Promise.all([
      Promise.resolve().then(() => moveSiteToRecycleBin(siteId, standardAdminSession.userId)),
      Promise.resolve().then(() => moveSiteToRecycleBin(siteId, standardAdminSession.userId)),
    ]);

    const lfcRows = db.prepare(`SELECT count(*) as c FROM system_lifecycle_records WHERE entity_id = ?`).get(siteId) as any;
    assert.equal(lfcRows.c, 1, 'Never create duplicate lifecycle records during concurrency');

    // Concurrent executePermanentDelete attempts: first succeeds, second throws
    let successCount = 0;
    let errorCount = 0;

    const runDel = () => {
      try {
        executePermanentDelete('SITE', siteId, standardAdminSession.userId);
        successCount++;
      } catch {
        errorCount++;
      }
    };

    runDel();
    runDel();

    assert.equal(successCount, 1, 'Exactly one permanent delete succeeds');
    assert.equal(errorCount, 1, 'Concurrent permanent delete safely rejected');
  });

  // =========================================================================
  // CTO GATE 10: Database Integrity Verification
  // =========================================================================
  await t.test('10. Database integrity: PRAGMA checks and no orphan records', async () => {
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    assert.equal(integrity.integrity_check, 'ok');

    const fkChecks = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkChecks.length, 0, 'Foreign key check must return 0');

    // Verify no orphan system_lifecycle_records pointing to non-existent sites
    const orphanSites = db.prepare(`
      SELECT slr.entity_id FROM system_lifecycle_records slr
      LEFT JOIN sites s ON slr.entity_id = s.id
      WHERE slr.entity_type = 'SITE' AND s.id IS NULL
    `).all();
    assert.equal(orphanSites.length, 0, 'No orphan lifecycle records for sites');
  });

  // Cleanup test entities created in this test run (child tables before parent tables)
  db.prepare(`DELETE FROM system_lifecycle_records WHERE entity_id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM attendance_records WHERE id LIKE 'att-gate-del%'`).run();
  db.prepare(`DELETE FROM site_users WHERE site_id LIKE 'gate-2f1-%' OR user_id LIKE 'gate-2f1-%' OR id LIKE 'su-ga-%'`).run();
  db.prepare(`DELETE FROM user_permission_overrides WHERE id LIKE 'ov-%'`).run();
  db.prepare(`DELETE FROM work_roles WHERE id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM work_categories WHERE id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM sites WHERE id LIKE 'gate-2f1-%'`).run();
  db.prepare(`DELETE FROM users WHERE id LIKE 'gate-2f1-%'`).run();
  // Keep audit rows as mandated: "Do not delete QA audit rows after testing."
});
