process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { GET as getArchive } from '../app/api/lifecycle/archive/route';
import { GET as getRecycleBin, PATCH as patchRecycleBin } from '../app/api/lifecycle/recycle-bin/route';
import { POST as postRestore } from '../app/api/lifecycle/restore/route';
import { POST as postPermanentDelete } from '../app/api/lifecycle/permanent-delete/route';
import { UserSession } from '../lib/auth/session';
import { 
  registerArchivedEntity, 
  registerRecycledEntity, 
  getLifecycleRecord, 
  removeLifecycleRecord,
  getGlobalArchivedItems,
  getGlobalRecycledItems,
  toggleLifecycleKeepPermanently
} from '../lib/db/repositories/global-lifecycle-repo';
import { 
  executePermanentDelete, 
  PermanentDeleteConflictError, 
  PermanentDeleteNotFoundError 
} from '../lib/lifecycle/permanent-delete-engine';
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

test('STEP 2F: Global Lifecycle Governance (Archive, Recycle Bin, Restore & Permanent Delete)', async (t) => {
  const db = new DatabaseSync(process.env.DATABASE_PATH!);

  // Clean up any test records from prior runs
  db.prepare(`DELETE FROM system_lifecycle_records WHERE entity_id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM site_role_rates WHERE site_id LIKE 'test-2f-%' OR role_id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM site_users WHERE site_id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM attendance_records WHERE site_id LIKE 'test-2f-%' OR role_id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM financial_transactions WHERE site_id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM work_roles WHERE id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM work_categories WHERE id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM sites WHERE id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM audit_logs WHERE entity_id LIKE 'test-2f-%'`).run();

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

  // Helper to create test entities
  const setupTestCategory = (id: string, name: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO work_categories (id, name, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, 100, 1, datetime('now'), datetime('now'))
    `).run(id, name);
  };

  const setupTestRole = (id: string, categoryId: string, name: string, ratePaise = 50000) => {
    db.prepare(`
      INSERT OR REPLACE INTO work_roles (id, category_id, name, default_rate_paise, sort_order, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 100, 1, datetime('now'), datetime('now'))
    `).run(id, categoryId, name, ratePaise);
  };

  const setupTestSite = (id: string, name: string, code: string) => {
    db.prepare(`
      INSERT OR REPLACE INTO sites (id, name, code, location, is_archived, created_at, updated_at)
      VALUES (?, ?, ?, 'Test Location', 0, datetime('now'), datetime('now'))
    `).run(id, name, code);
  };

  // =========================================================================
  // PROOF 1: RBAC Enforcement on Archive & Recycle Bin Endpoints
  // =========================================================================
  await t.test('1. RBAC: Archive and Recycle Bin reject unprivileged viewers and site managers', async () => {
    // Viewer -> 403
    setTestSession(viewerSession);
    const resArchiveView = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(resArchiveView.status, 403, 'Viewer should be forbidden from GET /api/lifecycle/archive');

    const resRecycleView = await getRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin'));
    assert.equal(resRecycleView.status, 403, 'Viewer should be forbidden from GET /api/lifecycle/recycle-bin');

    const resPermDelete = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: 'none' }),
    }));
    assert.equal(resPermDelete.status, 403, 'Viewer should be forbidden from permanent delete');

    // Site Manager -> 403
    setTestSession(siteManagerSession);
    const resArchiveMgr = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(resArchiveMgr.status, 403, 'Site Manager should be forbidden from GET /api/lifecycle/archive');

    // Unauthenticated -> 401
    setTestSession(null);
    const resUnauth = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(resUnauth.status, 401, 'Unauthenticated user should get 401');

    // Superior Prime & Standard Admin -> 200
    setTestSession(superiorPrimeSession);
    const resPrime = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(resPrime.status, 200, 'Superior Prime should be allowed');

    setTestSession(standardAdminSession);
    const resStd = await getArchive(new Request('http://localhost:3001/api/lifecycle/archive'));
    assert.equal(resStd.status, 200, 'Standard Admin should be allowed');
  });

  // =========================================================================
  // PROOF 2: State Transitions: ACTIVE -> ARCHIVED -> ACTIVE (Role, Category, Site)
  // =========================================================================
  await t.test('2. State transitions: ACTIVE -> ARCHIVED -> ACTIVE with full source tracking', async () => {
    setTestSession(standardAdminSession);

    // 2.1 Category
    const catId = 'test-2f-cat-arc';
    setupTestCategory(catId, '2F Archived Category');
    archiveCategory(catId, standardAdminSession.userId);

    let lfc = getLifecycleRecord('WORK_CATEGORY', catId);
    assert.ok(lfc, 'Lifecycle record must exist for archived category');
    assert.equal(lfc!.state, 'ARCHIVED');
    assert.equal(lfc!.source_module, 'Categories');
    assert.equal(lfc!.source_route, '/setup/categories');
    assert.equal(lfc!.restore_destination, '/setup/categories');

    // Restore category via API
    const resCatRestore = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_CATEGORY', entityId: catId }),
    }));
    assert.equal(resCatRestore.status, 200);
    assert.equal(getLifecycleRecord('WORK_CATEGORY', catId), null, 'Lifecycle record must be removed on restore');

    // 2.2 Role
    const roleCatId = 'test-2f-cat-role';
    const roleId = 'test-2f-role-arc';
    setupTestCategory(roleCatId, '2F Role Parent Cat');
    setupTestRole(roleId, roleCatId, '2F Archived Role');
    archiveRole(roleId, standardAdminSession.userId);

    lfc = getLifecycleRecord('WORK_ROLE', roleId);
    assert.ok(lfc);
    assert.equal(lfc!.state, 'ARCHIVED');
    assert.equal(lfc!.source_module, 'Roles');

    const resRoleRestore = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_ROLE', entityId: roleId }),
    }));
    assert.equal(resRoleRestore.status, 200);
    assert.equal(getLifecycleRecord('WORK_ROLE', roleId), null);

    // 2.3 Site
    const siteId = 'test-2f-site-arc';
    setupTestSite(siteId, '2F Archived Site', '2F-ARC');
    toggleSiteArchived(siteId, true, standardAdminSession.userId);

    lfc = getLifecycleRecord('SITE', siteId);
    assert.ok(lfc);
    assert.equal(lfc!.state, 'ARCHIVED');
    assert.equal(lfc!.source_module, 'Sites');

    const resSiteRestore = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteId }),
    }));
    assert.equal(resSiteRestore.status, 200);
    assert.equal(getLifecycleRecord('SITE', siteId), null);
  });

  // =========================================================================
  // PROOF 3: State Transitions: ACTIVE -> RECYCLE_BIN -> ACTIVE (Role, Category, Site)
  // =========================================================================
  await t.test('3. State transitions: ACTIVE -> RECYCLE_BIN -> ACTIVE', async () => {
    setTestSession(standardAdminSession);

    // 3.1 Role
    const catId = 'test-2f-cat-rcy';
    const roleId = 'test-2f-role-rcy';
    setupTestCategory(catId, '2F Recycle Parent Cat');
    setupTestRole(roleId, catId, '2F Recycled Role');
    recycleRole(roleId, standardAdminSession.userId);

    let lfc = getLifecycleRecord('WORK_ROLE', roleId);
    assert.ok(lfc);
    assert.equal(lfc!.state, 'RECYCLE_BIN');

    const resRoleRestore = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_ROLE', entityId: roleId }),
    }));
    assert.equal(resRoleRestore.status, 200);
    assert.equal(getLifecycleRecord('WORK_ROLE', roleId), null);

    // 3.2 Site
    const siteId = 'test-2f-site-rcy';
    setupTestSite(siteId, '2F Recycled Site', '2F-RCY');
    moveSiteToRecycleBin(siteId, standardAdminSession.userId);

    lfc = getLifecycleRecord('SITE', siteId);
    assert.ok(lfc);
    assert.equal(lfc!.state, 'RECYCLE_BIN');

    const resSiteRestore = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteId }),
    }));
    assert.equal(resSiteRestore.status, 200);
    assert.equal(getLifecycleRecord('SITE', siteId), null);
  });

  // =========================================================================
  // PROOF 4: State Transitions: ARCHIVED -> RECYCLE_BIN
  // =========================================================================
  await t.test('4. State transitions: ARCHIVED -> RECYCLE_BIN', async () => {
    setTestSession(standardAdminSession);

    const siteId = 'test-2f-site-arc-rcy';
    setupTestSite(siteId, '2F Arc To Rcy Site', '2F-ARCRCY');
    toggleSiteArchived(siteId, true, standardAdminSession.userId);

    let lfc = getLifecycleRecord('SITE', siteId);
    assert.equal(lfc!.state, 'ARCHIVED');

    // Move to Recycle Bin
    moveSiteToRecycleBin(siteId, standardAdminSession.userId);

    lfc = getLifecycleRecord('SITE', siteId);
    assert.equal(lfc!.state, 'RECYCLE_BIN');
  });

  // =========================================================================
  // PROOF 5: Metadata & Retention Policy Persistence
  // =========================================================================
  await t.test('5. Metadata persistence: original_source_route, retention_policy: 30_DAYS, retention_until', async () => {
    const catId = 'test-2f-cat-meta';
    setupTestCategory(catId, '2F Meta Cat');
    recycleCategory(catId, standardAdminSession.userId);

    const lfc = getLifecycleRecord('WORK_CATEGORY', catId);
    assert.ok(lfc);
    assert.ok(lfc!.metadata, 'Metadata must be stored as JSON');
    const parsed = JSON.parse(lfc!.metadata!);
    assert.equal(parsed.retention_policy, '30_DAYS');
    assert.ok(parsed.retention_until, 'retention_until must be populated');
    assert.equal(parsed.original_source_route, '/setup/categories');
  });

  // =========================================================================
  // PROOF 6: Recycle Bin Listing & Live Dependency Enrichment
  // =========================================================================
  await t.test('6. Recycle bin listing enriches items with canPermanentlyDelete and blockingReason', async () => {
    setTestSession(standardAdminSession);

    // Create a site in recycle bin that has an attendance record (blocking permanent delete)
    const blockedSiteId = 'test-2f-site-blocked';
    const testCatId = 'test-2f-cat-blk';
    const testRoleId = 'test-2f-role-blk';
    setupTestCategory(testCatId, '2F Blk Cat');
    setupTestRole(testRoleId, testCatId, '2F Blk Role');
    setupTestSite(blockedSiteId, '2F Blocked Site', '2F-BLK');
    db.prepare(`
      INSERT INTO attendance_records (id, site_id, role_id, date, rate_snapshot_paise, total_workers, worker_days, total_cost_paise, created_at, updated_at)
      VALUES ('att-2f-blk', ?, ?, '2026-09-19', 50000, 5, 5, 250000, datetime('now'), datetime('now'))
    `).run(blockedSiteId, testRoleId);
    moveSiteToRecycleBin(blockedSiteId, standardAdminSession.userId);

    // Create a clean site in recycle bin with zero dependencies
    const cleanSiteId = 'test-2f-site-clean';
    setupTestSite(cleanSiteId, '2F Clean Site', '2F-CLN');
    moveSiteToRecycleBin(cleanSiteId, standardAdminSession.userId);

    const res = await getRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin'));
    assert.equal(res.status, 200);
    const data = await res.json();
    const items = data.items as any[];

    const blockedItem = items.find((i) => i.entity_id === blockedSiteId);
    assert.ok(blockedItem, 'Blocked site must be listed');
    assert.equal(blockedItem.canPermanentlyDelete, false, 'Blocked site must have canPermanentlyDelete=false');
    assert.ok(blockedItem.blockingReason && blockedItem.blockingReason.length > 0, 'Blocking reason must be populated');

    const cleanItem = items.find((i) => i.entity_id === cleanSiteId);
    assert.ok(cleanItem, 'Clean site must be listed');
    assert.equal(cleanItem.canPermanentlyDelete, true, 'Clean site must have canPermanentlyDelete=true');
    assert.equal(cleanItem.blockingReason, null);
  });

  // =========================================================================
  // PROOF 7: Retention Policy Toggle (PATCH /api/lifecycle/recycle-bin)
  // =========================================================================
  await t.test('7. Retention policy toggle: keep_permanently can be toggled with audit', async () => {
    setTestSession(standardAdminSession);

    const siteId = 'test-2f-site-toggle';
    setupTestSite(siteId, '2F Toggle Site', '2F-TGL');
    moveSiteToRecycleBin(siteId, standardAdminSession.userId);

    const lfcBefore = getLifecycleRecord('SITE', siteId);
    assert.equal(lfcBefore!.keep_permanently, 0);

    // Toggle on (keep = true)
    const patchRes1 = await patchRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lfcBefore!.id, keep: true }),
    }));
    assert.equal(patchRes1.status, 200);
    const data1 = await patchRes1.json();
    assert.equal(data1.keepPermanently, true);

    const lfcAfter1 = getLifecycleRecord('SITE', siteId);
    assert.equal(lfcAfter1!.keep_permanently, 1);

    // Toggle off (keep = false)
    const patchRes2 = await patchRecycleBin(new Request('http://localhost:3001/api/lifecycle/recycle-bin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lfcBefore!.id, keep: false }),
    }));
    assert.equal(patchRes2.status, 200);
    const data2 = await patchRes2.json();
    assert.equal(data2.keepPermanently, false);

    const lfcAfter2 = getLifecycleRecord('SITE', siteId);
    assert.equal(lfcAfter2!.keep_permanently, 0);
  });

  // =========================================================================
  // PROOF 8: Restore Collision Safety — Role Parent Category in Recycle Bin
  // =========================================================================
  await t.test('8. Collision safety: Restoring role blocked when parent category is in Recycle Bin (409 Conflict)', async () => {
    setTestSession(standardAdminSession);

    const catId = 'test-2f-cat-col-1';
    const roleId = 'test-2f-role-col-1';
    setupTestCategory(catId, '2F Collision Cat 1');
    setupTestRole(roleId, catId, '2F Collision Role 1');

    // Put both category and role in Recycle Bin
    recycleRole(roleId, standardAdminSession.userId);
    recycleCategory(catId, standardAdminSession.userId);

    // Attempt to restore role while parent category is in Recycle Bin -> must fail with 409
    const res = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_ROLE', entityId: roleId }),
    }));

    assert.equal(res.status, 409, 'Must return 409 Conflict');
    const data = await res.json();
    assert.equal(data.isBlocked, true);
    assert.match(data.error, /parent category/i);

    // Now restore the parent category first
    const resCat = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_CATEGORY', entityId: catId }),
    }));
    assert.equal(resCat.status, 200);

    // Now role restore succeeds
    const resRole = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_ROLE', entityId: roleId }),
    }));
    assert.equal(resRole.status, 200);
  });

  // =========================================================================
  // PROOF 9: Restore Collision Safety — Role Name Duplicate in Category
  // =========================================================================
  await t.test('9. Collision safety: Restoring role blocked if duplicate active role name exists (409 Conflict)', async () => {
    setTestSession(standardAdminSession);

    const catId = 'test-2f-cat-dup';
    setupTestCategory(catId, '2F Duplicate Parent Cat');

    const role1 = 'test-2f-role-dup1';
    const role2 = 'test-2f-role-dup2';
    setupTestRole(role1, catId, 'Mason');
    recycleRole(role1, standardAdminSession.userId);

    // While role1 is in Recycle Bin, a new active role with the same name "Mason" is created
    setupTestRole(role2, catId, 'Mason');

    // Attempting to restore role1 must fail with 409
    const res = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_ROLE', entityId: role1 }),
    }));

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.isBlocked, true);
    assert.match(data.error, /already exists/i);
  });

  // =========================================================================
  // PROOF 10: Restore Collision Safety — Category Name Duplicate
  // =========================================================================
  await t.test('10. Collision safety: Restoring category blocked if duplicate active category name exists (409 Conflict)', async () => {
    setTestSession(standardAdminSession);

    const cat1 = 'test-2f-cat-dup1';
    const cat2 = 'test-2f-cat-dup2';
    setupTestCategory(cat1, 'Electrical Works');
    recycleCategory(cat1, standardAdminSession.userId);

    // New active category with same name created
    setupTestCategory(cat2, 'Electrical Works');

    const res = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_CATEGORY', entityId: cat1 }),
    }));

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.isBlocked, true);
    assert.match(data.error, /already exists/i);
  });

  // =========================================================================
  // PROOF 11: Restore Collision Safety — Site Name / Code Duplicate
  // =========================================================================
  await t.test('11. Collision safety: Restoring site blocked if duplicate active site name or code exists (409 Conflict)', async () => {
    setTestSession(standardAdminSession);

    const site1 = 'test-2f-site-dup1';
    const site2 = 'test-2f-site-dup2';
    setupTestSite(site1, 'Metro Station Alpha', 'MSA-01');
    moveSiteToRecycleBin(site1, standardAdminSession.userId);

    // New active site with same name
    setupTestSite(site2, 'Metro Station Alpha', 'MSA-02');

    const resNameConflict = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: site1 }),
    }));
    assert.equal(resNameConflict.status, 409);
    const dataName = await resNameConflict.json();
    assert.equal(dataName.isBlocked, true);
    assert.match(dataName.error, /already exists/i);

    // Fix name but collide on code
    db.prepare(`UPDATE sites SET name = 'Metro Station Alpha Renamed' WHERE id = ?`).run(site2);
    db.prepare(`UPDATE sites SET code = 'MSA-01' WHERE id = ?`).run(site2);

    const resCodeConflict = await postRestore(new Request('http://localhost:3001/api/lifecycle/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: site1 }),
    }));
    assert.equal(resCodeConflict.status, 409);
    const dataCode = await resCodeConflict.json();
    assert.equal(dataCode.isBlocked, true);
    assert.match(dataCode.error, /code 'MSA-01' already exists/i);
  });

  // =========================================================================
  // PROOF 12: Permanent Delete Restriction: Must Be In RECYCLE_BIN
  // =========================================================================
  await t.test('12. Permanent delete restriction: Active and Archived entities cannot be permanently deleted (409 Conflict)', async () => {
    setTestSession(superiorPrimeSession);

    // 12.1 Active Site -> rejected
    const activeSiteId = 'test-2f-site-active';
    setupTestSite(activeSiteId, '2F Active Site', '2F-ACT');

    const resActive = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: activeSiteId }),
    }));
    assert.equal(resActive.status, 409);
    const dataActive = await resActive.json();
    assert.match(dataActive.error, /not in the Recycle Bin/i);

    // 12.2 Archived Site -> rejected
    const archivedSiteId = 'test-2f-site-archived';
    setupTestSite(archivedSiteId, '2F Archived Site Only', '2F-ARCONLY');
    toggleSiteArchived(archivedSiteId, true, superiorPrimeSession.userId);

    const resArchived = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: archivedSiteId }),
    }));
    assert.equal(resArchived.status, 409);
    const dataArchived = await resArchived.json();
    assert.match(dataArchived.error, /ARCHIVED/i);
  });

  // =========================================================================
  // PROOF 13: Permanent Delete Dependency Safety: Category with Active Roles
  // =========================================================================
  await t.test('13. Permanent delete dependency safety: Category with active roles is blocked (409 Conflict)', async () => {
    setTestSession(superiorPrimeSession);

    const catId = 'test-2f-cat-dep';
    const roleId = 'test-2f-role-in-cat';
    setupTestCategory(catId, '2F Dependent Cat');
    setupTestRole(roleId, catId, '2F Role In Cat');
    recycleCategory(catId, superiorPrimeSession.userId);

    const res = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_CATEGORY', entityId: catId }),
    }));
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.isBlocked, true);
    assert.match(data.error, /dependent role|active role|dependency/i);
  });

  // =========================================================================
  // PROOF 14: Permanent Delete Dependency Safety: Role with Attendance Records
  // =========================================================================
  await t.test('14. Permanent delete dependency safety: Role with attendance history is blocked (409 Conflict)', async () => {
    setTestSession(superiorPrimeSession);

    const catId = 'test-2f-cat-att';
    const roleId = 'test-2f-role-att';
    setupTestCategory(catId, '2F Cat For Att Role');
    setupTestRole(roleId, catId, '2F Role With Att');
    db.prepare(`
      INSERT INTO attendance_records (id, site_id, role_id, date, rate_snapshot_paise, total_workers, worker_days, total_cost_paise, created_at, updated_at)
      VALUES ('att-2f-role-hist', 'site-1', ?, '2026-09-19', 50000, 3, 3, 150000, datetime('now'), datetime('now'))
    `).run(roleId);

    recycleRole(roleId, superiorPrimeSession.userId);

    const res = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'WORK_ROLE', entityId: roleId }),
    }));
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.isBlocked, true);
    assert.match(data.error, /attendance/i);
  });

  // =========================================================================
  // PROOF 15: Permanent Delete Dependency Safety: Site with Financial Transactions
  // =========================================================================
  await t.test('15. Permanent delete dependency safety: Site with financial history is blocked (409 Conflict)', async () => {
    setTestSession(superiorPrimeSession);

    const siteId = 'test-2f-site-fin';
    setupTestSite(siteId, '2F Site With Finance', '2F-FIN');
    db.prepare(`
      INSERT INTO financial_transactions (id, site_id, type, debit_category, amount_paise, description, date, created_at, updated_at)
      VALUES ('fin-2f-site-hist', ?, 'DEBIT', 'SUPPLIES', 100000, 'Test Supplies', '2026-09-19', datetime('now'), datetime('now'))
    `).run(siteId);

    moveSiteToRecycleBin(siteId, superiorPrimeSession.userId);

    const res = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityType: 'SITE', entityId: siteId }),
    }));
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.isBlocked, true);
    assert.match(data.error, /financial/i);
  });

  // =========================================================================
  // PROOF 16: Clean Permanent Delete Execution & Primary/Lifecycle Purge
  // =========================================================================
  await t.test('16. Clean permanent delete purges entity from primary table and system_lifecycle_records', async () => {
    setTestSession(superiorPrimeSession);

    // Unencumbered site
    const siteId = 'test-2f-site-purge';
    setupTestSite(siteId, '2F Purgeable Site', '2F-PURGE');
    moveSiteToRecycleBin(siteId, superiorPrimeSession.userId);

    assert.ok(getLifecycleRecord('SITE', siteId));
    assert.ok(db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId));

    const res = await postPermanentDelete(new Request('http://localhost:3001/api/lifecycle/permanent-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        entityType: 'SITE', 
        entityId: siteId,
        reason: 'Clean test permanent deletion' 
      }),
    }));

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.entityId, siteId);

    // Verify completely purged from primary table
    const siteInDb = db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId);
    assert.equal(siteInDb, undefined, 'Site must be purged from sites table');

    // Verify purged from system_lifecycle_records
    const lfcInDb = getLifecycleRecord('SITE', siteId);
    assert.equal(lfcInDb, null, 'Lifecycle record must be purged');

    // Verify audit log exists
    const audit = db.prepare(`
      SELECT * FROM audit_logs 
      WHERE entity_id = ? AND action = 'SITE_PERMANENTLY_DELETED'
    `).get(siteId);
    assert.ok(audit, 'Audit log for permanent delete must exist');
  });

  // =========================================================================
  // PROOF 17: Permanent Delete Transactional Atomicity & Rollback
  // =========================================================================
  await t.test('17. Transactional atomicity: Error during permanent deletion causes complete rollback', async () => {
    const siteId = 'test-2f-site-rollback';
    setupTestSite(siteId, '2F Rollback Site', '2F-RBK');
    moveSiteToRecycleBin(siteId, superiorPrimeSession.userId);

    // Call executePermanentDelete with simulated failure
    assert.throws(() => {
      executePermanentDelete('SITE', siteId, superiorPrimeSession.userId, 'Testing rollback', {
        _simulateAuditFailure: true,
      });
    }, /FORCED_AUDIT_FAILURE_SIMULATION/);

    // Verify site STILL exists in primary table
    const siteInDb = db.prepare('SELECT id FROM sites WHERE id = ?').get(siteId);
    assert.ok(siteInDb, 'Site must NOT be deleted if transaction rolled back');

    // Verify lifecycle record STILL exists
    const lfcInDb = getLifecycleRecord('SITE', siteId);
    assert.ok(lfcInDb, 'Lifecycle record must NOT be deleted if transaction rolled back');
  });

  // =========================================================================
  // PROOF 18: Audit Events Coverage for Lifecycle Operations
  // =========================================================================
  await t.test('18. Audit event coverage: Verify distinct audit logs for all lifecycle states', async () => {
    // Audit actions present for test entities
    const actions = db.prepare(`
      SELECT DISTINCT action FROM audit_logs WHERE entity_id LIKE 'test-2f-%'
    `).all().map((r: any) => r.action);

    // Should include archive, recycle, restore, permanent delete
    assert.ok(actions.includes('SITE_ARCHIVED') || actions.includes('SITE_RESTORED'), 'Site archive/restore audited');
    assert.ok(actions.includes('SITE_DELETED_TO_RECYCLE_BIN') || actions.includes('SITE_RESTORED_FROM_RECYCLE_BIN'), 'Site recycle/restore audited');
    assert.ok(actions.includes('SITE_PERMANENTLY_DELETED'), 'Site permanent deletion audited');
    assert.ok(actions.includes('ROLE_ARCHIVED') || actions.includes('ROLE_RESTORED'), 'Role archive/restore audited');
    assert.ok(actions.includes('CATEGORY_ARCHIVED') || actions.includes('CATEGORY_RESTORED'), 'Category archive/restore audited');
  });

  // =========================================================================
  // PROOF 19: Database Integrity and Foreign Key Checks
  // =========================================================================
  await t.test('19. Database integrity and foreign key constraints clean', async () => {
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    assert.equal(integrity.integrity_check, 'ok');

    const fkChecks = db.prepare('PRAGMA foreign_key_check').all();
    assert.equal(fkChecks.length, 0, 'Foreign key check must return 0 errors');
  });

  // Clean up test entities created during test run
  db.prepare(`DELETE FROM system_lifecycle_records WHERE entity_id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM attendance_records WHERE id LIKE 'att-2f-%'`).run();
  db.prepare(`DELETE FROM financial_transactions WHERE id LIKE 'fin-2f-%'`).run();
  db.prepare(`DELETE FROM work_roles WHERE id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM work_categories WHERE id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM sites WHERE id LIKE 'test-2f-%'`).run();
  db.prepare(`DELETE FROM audit_logs WHERE entity_id LIKE 'test-2f-%'`).run();
});
