process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

import { GET as getUsers } from '../app/api/users/route';
import { GET as getPermissions } from '../app/api/permissions/route';
import { GET as getEffectivePermissions } from '../app/api/permissions/effective/route';
import { PUT as putUserOverride, DELETE as deleteUserOverride } from '../app/api/permissions/user/route';
import { POST as postSiteAssignment, DELETE as deleteSiteAssignment } from '../app/api/permissions/sites/route';
import { UserSession } from '../lib/auth/session';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2D: Users & Access UI Integration Verification (16 Focused Tests)', async (t) => {
  const db = new DatabaseSync(process.env.DATABASE_PATH!);

  // Setup test principals
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Superior Prime', 'ADMIN', 'SUPERIOR_PRIME', 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Operational Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1),
      ('usr-target-test', 'targetuser', 'hash', 'Target User', 'SITE_MANAGER', 'STANDARD', 1, 1)
  `).run();

  db.prepare(`UPDATE users SET authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run();

  // Ensure target test user has site-1 in site_users
  db.prepare(`
    INSERT OR IGNORE INTO site_users (id, site_id, user_id, created_at)
    VALUES ('su-test-target-s1', 'site-1', 'usr-target-test', datetime('now'))
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

  const operationalEngineerSession: UserSession = {
    userId: 'usr-eng-1',
    username: 'engineer2',
    fullName: 'Operational Engineer',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 1,
  };

  // ---------------------------------------------------------------------------
  // 1. Admin can open Users & Access (GET /api/users returns 200)
  // ---------------------------------------------------------------------------
  await t.test('1. Admin can open Users & Access', async () => {
    setTestSession(clientPrimeSession);
    const res = await getUsers();
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.ok(Array.isArray(data.users), 'users must be returned as an array');
    assert.ok(data.users.length > 0, 'directory must contain active users');
  });

  // ---------------------------------------------------------------------------
  // 2. Client Prime sees lower users
  // ---------------------------------------------------------------------------
  await t.test('2. Client Prime sees lower users', async () => {
    setTestSession(clientPrimeSession);
    const res = await getUsers();
    const data = await res.json();
    const usernames = data.users.map((u: any) => u.username);

    assert.ok(usernames.includes('clientprime'));
    assert.ok(usernames.includes('stdadmin'));
    assert.ok(usernames.includes('engineer2'));
    assert.ok(usernames.includes('targetuser'));
  });

  // ---------------------------------------------------------------------------
  // 3. Client Prime cannot see Superior Prime
  // ---------------------------------------------------------------------------
  await t.test('3. Client Prime cannot see Superior Prime', async () => {
    setTestSession(clientPrimeSession);
    const res = await getUsers();
    const data = await res.json();
    const userIds = data.users.map((u: any) => u.id);

    assert.equal(
      userIds.includes('usr-admin-1'),
      false,
      'Superior Prime (usr-admin-1) must be completely filtered out from Client Prime view'
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Standard Admin cannot manage Prime
  // ---------------------------------------------------------------------------
  await t.test('4. Standard Admin cannot manage Prime', async () => {
    setTestSession(standardAdminSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-client-prime-1',
        permissionId: 'perm-dash-view',
        effect: 'DENY',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 403, 'Standard admin cannot manage Client Prime');
  });

  // ---------------------------------------------------------------------------
  // 5. Engineer cannot manage permissions
  // ---------------------------------------------------------------------------
  await t.test('5. Engineer cannot manage permissions', async () => {
    setTestSession(operationalEngineerSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-att-daily-create',
        siteId: 'site-1',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 403, 'SITE_MANAGER cannot mutate permissions');
  });

  // ---------------------------------------------------------------------------
  // 6. Permission definitions render from API
  // ---------------------------------------------------------------------------
  await t.test('6. Permission definitions render from API', async () => {
    setTestSession(clientPrimeSession);
    const req = new Request('http://localhost:3001/api/permissions');
    const res = await getPermissions(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.ok(data.definitions.length >= 20, 'API must return full canonical permission registry');
    const pageIds = new Set(data.definitions.map((d: any) => d.page_id));
    assert.ok(pageIds.has('PAGE_DASHBOARD'));
    assert.ok(pageIds.has('PAGE_ATTENDANCE_DAILY'));
    assert.ok(pageIds.has('PAGE_FINANCE_TRANSACTIONS'));
    assert.ok(pageIds.has('PAGE_SETUP_USERS'));
  });

  // ---------------------------------------------------------------------------
  // 7. User ALLOW updates through API
  // ---------------------------------------------------------------------------
  await t.test('7. User ALLOW updates through API', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-fin-tx-delete',
        siteId: 'site-1',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.permissionVersion > 1);
  });

  // ---------------------------------------------------------------------------
  // 8. User DENY updates through API
  // ---------------------------------------------------------------------------
  await t.test('8. User DENY updates through API', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-att-daily-view',
        siteId: 'site-1',
        effect: 'DENY',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
  });

  // ---------------------------------------------------------------------------
  // 9. Reset removes override
  // ---------------------------------------------------------------------------
  await t.test('9. Reset removes override', async () => {
    setTestSession(clientPrimeSession);

    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-att-daily-view',
        siteId: 'site-1',
      }),
    });
    const res = await deleteUserOverride(req);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.equal(data.removed, true);
  });

  // ---------------------------------------------------------------------------
  // 10. Site assignment updates canonical site_users
  // ---------------------------------------------------------------------------
  await t.test('10. Site assignment updates canonical site_users', async () => {
    setTestSession(clientPrimeSession);

    // Assign site-2
    const postReq = new Request('http://localhost:3001/api/permissions/sites', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        siteId: 'site-2',
      }),
    });
    const postRes = await postSiteAssignment(postReq);
    assert.equal(postRes.status, 200);

    const row = db.prepare(`SELECT 1 FROM site_users WHERE user_id = ? AND site_id = ?`).get('usr-target-test', 'site-2');
    assert.ok(row, 'site_users must have site-2 assignment');

    // Remove site-2
    const delReq = new Request('http://localhost:3001/api/permissions/sites', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        siteId: 'site-2',
      }),
    });
    const delRes = await deleteSiteAssignment(delReq);
    assert.equal(delRes.status, 200);

    const afterRow = db.prepare(`SELECT 1 FROM site_users WHERE user_id = ? AND site_id = ?`).get('usr-target-test', 'site-2');
    assert.equal(afterRow, undefined, 'site_users must no longer have site-2');
  });

  // ---------------------------------------------------------------------------
  // 11. Effective access reflects saved changes
  // ---------------------------------------------------------------------------
  await t.test('11. Effective access reflects saved changes', async () => {
    setTestSession(clientPrimeSession);

    // Check effective status for perm-fin-tx-delete which was ALLOWed in test 7
    const effReq = new Request(
      'http://localhost:3001/api/permissions/effective?userId=usr-target-test&page=PAGE_FINANCE_TRANSACTIONS&action=DELETE&siteId=site-1'
    );
    const effRes = await getEffectivePermissions(effReq);
    assert.equal(effRes.status, 200);

    const data = await effRes.json();
    assert.equal(data.allowed, true);
    assert.equal(data.ruleSource, 'USER_SITE_EXPLICIT_ALLOW');
  });

  // ---------------------------------------------------------------------------
  // 12. Unauthorized API responses are displayed safely
  // ---------------------------------------------------------------------------
  await t.test('12. Unauthorized API responses are displayed safely', async () => {
    setTestSession(operationalEngineerSession);

    // Call permissions mutation
    const req = new Request('http://localhost:3001/api/permissions/user', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr-target-test',
        permissionId: 'perm-dash-view',
        effect: 'ALLOW',
      }),
    });
    const res = await putUserOverride(req);
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.ok(data.error, 'Safe user-facing error message must be returned');
    assert.equal(typeof data.error, 'string');
    assert.equal(data.error.includes('stack'), false, 'Stack trace must not be exposed');
  });

  // ---------------------------------------------------------------------------
  // 13. Light theme structure and classes
  // ---------------------------------------------------------------------------
  await t.test('13. Light theme classes verified in UI source', () => {
    const uiSource = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/setup/users/page.tsx'), 'utf-8');
    assert.ok(uiSource.includes('bg-white'), 'Light theme bg-white class present');
    assert.ok(uiSource.includes('text-slate-900'), 'Light theme text-slate-900 present');
    assert.ok(uiSource.includes('border-slate-900'), 'Light theme border tokens present');
    assert.ok(uiSource.includes('bg-emerald-50'), 'Light theme status badges present');
  });

  // ---------------------------------------------------------------------------
  // 14. Dark theme structure and classes
  // ---------------------------------------------------------------------------
  await t.test('14. Dark theme classes verified in UI source', () => {
    const uiSource = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/setup/users/page.tsx'), 'utf-8');
    assert.ok(uiSource.includes('dark:bg-[#18191C]'), 'Dark theme container bg-[#18191C] present');
    assert.ok(uiSource.includes('dark:text-white'), 'Dark theme text-white present');
    assert.ok(uiSource.includes('dark:border-[#3A3D42]'), 'Dark theme border tokens present');
    assert.ok(uiSource.includes('dark:bg-[#1ED760]'), 'Dark theme Spotify emerald accent present');
  });

  // ---------------------------------------------------------------------------
  // 15. Mobile layout responsiveness verified
  // ---------------------------------------------------------------------------
  await t.test('15. Mobile layout responsiveness verified', () => {
    const uiSource = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/setup/users/page.tsx'), 'utf-8');
    assert.ok(uiSource.includes('min-h-[44px]'), '44px minimum touch targets present');
    assert.ok(uiSource.includes('mobileView'), 'Mobile view switcher state present');
    assert.ok(uiSource.includes('Back to User Directory'), 'Mobile back navigation button present');
    assert.ok(uiSource.includes('overflow-x-auto'), 'Horizontal scroll containment present');
  });

  // ---------------------------------------------------------------------------
  // 16. Desktop layout responsiveness verified
  // ---------------------------------------------------------------------------
  await t.test('16. Desktop layout responsiveness verified', () => {
    const uiSource = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/setup/users/page.tsx'), 'utf-8');
    assert.ok(uiSource.includes('md:grid-cols-12'), '12-column responsive grid present');
    assert.ok(uiSource.includes('md:col-span-5'), 'Left user list column present');
    assert.ok(uiSource.includes('md:col-span-7'), 'Right permissions detail column present');
    assert.ok(uiSource.includes('MODULE_GROUPS'), 'Module group categorization present');
  });

  setTestSession(null);
});
