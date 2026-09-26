process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GET as getAuditList } from '../app/api/audit/route';
import { GET as getAuditDetail } from '../app/api/audit/[id]/route';
import { UserSession } from '../lib/auth/session';
import { AuditRepository } from '../lib/db/repositories/audit-repo';
import { redactPayload } from '../lib/audit/redaction';

import { getDb } from '../lib/db';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2G: Audit Trail & Security Activity Backend & Query Foundation (32 Scenarios)', { concurrency: 1 }, async (t) => {
  const db = getDb();

  t.after(() => {
    // Post-test cleanup of test entities in test DB
    try {
      db.prepare(`DELETE FROM audit_logs WHERE id LIKE 'aud-g-test%'`).run();
      db.prepare(`DELETE FROM user_permission_overrides WHERE permission_id = 'perm-gov-audit-view'`).run();
    } catch {
      // ignore
    }
  });

  // Clean up any existing test audit records
  db.prepare(`DELETE FROM audit_logs WHERE id LIKE 'aud-g-test%'`).run();
  db.prepare(`DELETE FROM user_permission_overrides WHERE permission_id = 'perm-gov-audit-view'`).run();

  // Ensure test users exist with canonical authority tiers
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Superior Prime', 'ADMIN', 'SUPERIOR_PRIME', 1, 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Site Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
      ('usr-view-1', 'viewer1', 'hash', 'Viewer User', 'VIEWER', 'STANDARD', 1, 1, 1)
  `).run();

  db.prepare(`UPDATE users SET authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'CLIENT_PRIME' WHERE id = 'usr-client-prime-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'STANDARD_ADMIN' WHERE id = 'usr-std-admin-1'`).run();

  // Ensure site assignments for test operational users: usr-eng-1 and usr-view-1 to site-1 only
  db.prepare(`DELETE FROM site_users WHERE user_id IN ('usr-eng-1', 'usr-view-1')`).run();
  db.prepare(`INSERT OR IGNORE INTO site_users (user_id, site_id) VALUES ('usr-eng-1', 'site-1'), ('usr-view-1', 'site-1')`).run();

  // Seed controlled test audit records
  const insertAuditStmt = db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 1. SP Security event (Must be completely hidden from non-SP)
  insertAuditStmt.run(
    'aud-g-test-sp-sec-1',
    'SECURITY',
    'usr-admin-1',
    'PASSWORD_RESET',
    null,
    'usr-admin-1',
    JSON.stringify({ username: 'Iamadmin', authorityTier: 'SUPERIOR_PRIME' }),
    JSON.stringify({ password_hash: '$2a$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqr' }),
    '2099-09-19 10:00:00'
  );

  // 2. SP Login event (Must be completely hidden from non-SP)
  insertAuditStmt.run(
    'aud-g-test-sp-auth-1',
    'AUTH',
    'usr-admin-1',
    'LOGIN_SUCCESS',
    null,
    'usr-admin-1',
    null,
    JSON.stringify({ username: 'Iamadmin', token: 'jwt-header.jwt-payload.jwt-sig' }),
    '2099-09-19 10:05:00'
  );

  // 3. SP Operational Site Event (Visible to lower authorities as "System Administrator")
  insertAuditStmt.run(
    'aud-g-test-sp-op-site1',
    'SITE',
    'site-1',
    'SITE_ARCHIVED',
    'site-1',
    'usr-admin-1',
    JSON.stringify({ is_archived: 0, adminUser: 'Iamadmin', internalPath: 'C:\\Users\\Admin\\Desktop\\SITE WORK' }),
    JSON.stringify({ is_archived: 1, adminUser: 'Iamadmin' }),
    '2099-09-19 10:10:00'
  );

  // 4. SP Operational Global Export Event (Visible to global admins as "System Administrator")
  insertAuditStmt.run(
    'aud-g-test-sp-op-export',
    'EXPORT',
    'exp-1',
    'COMPLETE_EXPORT_GENERATED',
    null,
    'usr-admin-1',
    null,
    JSON.stringify({ fileName: 'export-2026.zip', requestedBy: 'Iamadmin' }),
    '2099-09-19 10:15:00'
  );

  // 5. Engineer Attendance Event on Site-1
  insertAuditStmt.run(
    'aud-g-test-eng-att',
    'ATTENDANCE',
    'att-1',
    'CREATE',
    'site-1',
    'usr-eng-1',
    null,
    JSON.stringify({ date: '2099-09-19', total_workers: 15, siteId: 'site-1' }),
    '2099-09-19 10:20:00'
  );

  // 6. Finance Event on Site-2 (usr-eng-1 not assigned to site-2)
  insertAuditStmt.run(
    'aud-g-test-site2-fin',
    'FINANCE',
    'fin-2',
    'CREATE',
    'site-2',
    'usr-std-admin-1',
    null,
    JSON.stringify({ amount_paise: 500000, type: 'DEBIT' }),
    '2099-09-19 10:25:00'
  );

  // 7. Event containing sensitive keys to test metadata redaction
  insertAuditStmt.run(
    'aud-g-test-sensitive-payload',
    'FINANCE',
    'fin-secret-1',
    'UPDATE',
    'site-1',
    'usr-std-admin-1',
    JSON.stringify({ password: 'SuperSecretPassword!', token: 'tok-xyz-123', otp: '654321', api_key: 'key-999' }),
    JSON.stringify({ status: 'PROCESSED', session_secret: 'session-secret-key-12345' }),
    '2099-09-19 10:30:00'
  );

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

  // Proof 1: Authenticated access succeeds for authorized users
  await t.test('1. Authenticated access: Standard Admin receives HTTP 200 with structured audit list', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.items));
    assert.equal(typeof body.totalCount, 'number');
  });

  // Proof 2: Unauthenticated denial (HTTP 401)
  await t.test('2. Unauthenticated denial: Missing session receives HTTP 401', async () => {
    setTestSession(null);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /Authentication required/i);
  });

  // Proof 3: Superior Prime full visibility
  await t.test('3. Superior Prime full visibility: SP sees own security events and unmasked identity', async () => {
    setTestSession(superiorPrimeSession);
    const req = new Request('http://localhost:3000/api/audit?entityType=SECURITY');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    const spSec = body.items.find((i: any) => i.id === 'aud-g-test-sp-sec-1');
    assert.ok(spSec, 'Superior Prime MUST see aud-g-test-sp-sec-1');
    assert.equal(spSec.actor.id, 'usr-admin-1');
    assert.ok(spSec.actor.name, 'Superior Prime actor name must be present');
    assert.notEqual(spSec.actor.name, 'System Administrator');
  });

  // Proof 4: Client Prime authorization
  await t.test('4. Client Prime authorization: Receives HTTP 200 via role baseline', async () => {
    setTestSession(clientPrimeSession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.items.length > 0);
  });

  // Proof 5: Standard Admin authorization
  await t.test('5. Standard Admin authorization: Receives HTTP 200 via role baseline', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.items.length > 0);
  });

  // Proof 6: Site Manager denial (default deny)
  await t.test('6. Site Manager denial: Default deny returns HTTP 403', async () => {
    setTestSession(siteManagerSession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 403);
  });

  // Proof 7: Viewer denial (default deny)
  await t.test('7. Viewer denial: Default deny returns HTTP 403', async () => {
    setTestSession(viewerSession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 403);
  });

  // Proof 8: Explicit permission ALLOW for Site Manager
  await t.test('8. Explicit permission ALLOW: Site Manager with override can access audit trail', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES ('usr-eng-allow', 'engallow', 'hash', 'Allowed Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
    `).run();
    db.prepare(`INSERT OR IGNORE INTO site_users (user_id, site_id) VALUES ('usr-eng-allow', 'site-1')`).run();

    PermissionRepository.setUserOverride({
      userId: 'usr-eng-allow',
      permissionId: 'perm-gov-audit-view',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });

    const engAllowSession: UserSession = {
      userId: 'usr-eng-allow',
      username: 'engallow',
      fullName: 'Allowed Engineer',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    setTestSession(engAllowSession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.items));
  });

  // Proof 9: Explicit permission DENY for Standard Admin
  await t.test('9. Explicit permission DENY: Standard Admin with explicit DENY receives HTTP 403', async () => {
    db.prepare(`
      INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
      VALUES ('usr-std-admin-deny', 'stdadmindeny', 'hash', 'Denied Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1)
    `).run();

    PermissionRepository.setUserOverride({
      userId: 'usr-std-admin-deny',
      permissionId: 'perm-gov-audit-view',
      siteId: null,
      effect: 'DENY',
      grantedBy: 'usr-admin-1',
    });

    const denySession: UserSession = {
      userId: 'usr-std-admin-deny',
      username: 'stdadmindeny',
      fullName: 'Denied Standard Admin',
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      assignedSiteIds: [],
      tokenVersion: 1,
    };

    setTestSession(denySession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /USER_GLOBAL_EXPLICIT_DENY|Access denied|Explicit user global DENY override/i);
  });

  // Proof 10: NOT CONFIGURED behavior (Legacy role fallback)
  await t.test('10. NOT CONFIGURED behavior: ADMIN gets legacy fallback allow, SITE_MANAGER gets default deny', async () => {
    // Standard admin without override has access
    setTestSession(standardAdminSession);
    const resAdmin = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resAdmin.status, 200);

    // Viewer without override is denied
    setTestSession(viewerSession);
    const resViewer = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resViewer.status, 403);
  });

  // Proof 11: Site A cannot access Site B records
  await t.test('11. Site Scope Isolation: Site Manager assigned to Site-1 cannot see Site-2 records', async () => {
    const engAllowSession: UserSession = {
      userId: 'usr-eng-allow',
      username: 'engallow',
      fullName: 'Allowed Engineer',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    setTestSession(engAllowSession);
    const req = new Request('http://localhost:3000/api/audit');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    
    // Check that NO record from site-2 exists
    const hasSite2 = body.items.some((i: any) => i.site && i.site.id === 'site-2');
    assert.equal(hasSite2, false, 'Site Manager assigned to site-1 must NEVER see site-2 records');

    // Check that NO global record (site === null) exists
    const hasGlobal = body.items.some((i: any) => i.site === null);
    assert.equal(hasGlobal, false, 'Site Manager must NEVER see global (null site) records');
  });

  // Proof 12: Caller-supplied siteId spoofing
  await t.test('12. Anti-Spoofing: Site Manager querying siteId=site-2 receives 0 records (zero leak)', async () => {
    const engAllowSession: UserSession = {
      userId: 'usr-eng-allow',
      username: 'engallow',
      fullName: 'Allowed Engineer',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    };

    setTestSession(engAllowSession);
    const req = new Request('http://localhost:3000/api/audit?site=site-2');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.length, 0, 'Spoofed unassigned site must return 0 records');
    assert.equal(body.totalCount, 0);
  });

  // Proof 13: Pagination
  await t.test('13. Pagination: page=1 and page=2 return non-overlapping sets', async () => {
    setTestSession(standardAdminSession);
    const res1 = await getAuditList(new Request('http://localhost:3000/api/audit?page=1&pageSize=2'));
    const body1 = await res1.json();
    assert.equal(body1.items.length, 2);
    assert.equal(body1.page, 1);
    assert.equal(body1.pageSize, 2);

    const res2 = await getAuditList(new Request('http://localhost:3000/api/audit?page=2&pageSize=2'));
    const body2 = await res2.json();
    assert.equal(body2.items.length, 2);
    assert.equal(body2.page, 2);

    const idSet1 = new Set(body1.items.map((i: any) => i.id));
    for (const item of body2.items) {
      assert.equal(idSet1.has(item.id), false, 'Page 2 items must not overlap with Page 1');
    }
  });

  // Proof 14: Maximum page size bounded server-side
  await t.test('14. Maximum page size: pageSize=1000000 is clamped to 50', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?pageSize=1000000'));
    const body = await res.json();
    assert.equal(body.pageSize, 50, 'pageSize must be clamped to maximum 50');
    assert.ok(body.items.length <= 50);
  });

  // Proof 15: Deterministic ordering (created_at DESC, id DESC)
  await t.test('15. Deterministic ordering: Records strictly sorted by created_at DESC, id DESC', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?pageSize=50'));
    const body = await res.json();
    for (let i = 0; i < body.items.length - 1; i++) {
      const cur = body.items[i];
      const nxt = body.items[i + 1];
      const timeComp = cur.timestamp.localeCompare(nxt.timestamp);
      assert.ok(timeComp >= 0, `Ordering violation: ${cur.timestamp} < ${nxt.timestamp}`);
      if (timeComp === 0) {
        assert.ok(cur.id.localeCompare(nxt.id) >= 0, `Tie-breaker violation: ${cur.id} < ${nxt.id}`);
      }
    }
  });

  // Proof 16: Date filter
  await t.test('16. Date filter: from and to filter correctly', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?from=2099-09-19&to=2099-09-19');
    const res = await getAuditList(req);
    const body = await res.json();
    assert.ok(body.items.length > 0);
    body.items.forEach((item: any) => {
      assert.ok(item.timestamp.startsWith('2099-09-19'));
    });
  });

  // Proof 17: Site filter
  await t.test('17. Site filter: Filtering by site=site-1 returns only site-1 records', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?site=site-1');
    const res = await getAuditList(req);
    const body = await res.json();
    assert.ok(body.items.length > 0);
    body.items.forEach((item: any) => {
      assert.equal(item.site.id, 'site-1');
    });
  });

  // Proof 18: Actor filter
  await t.test('18. Actor filter: Filtering by user_id returns matching actor logs', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?actor=usr-eng-1');
    const res = await getAuditList(req);
    const body = await res.json();
    assert.ok(body.items.length > 0);
    body.items.forEach((item: any) => {
      assert.equal(item.actor.id, 'usr-eng-1');
    });
  });

  // Proof 19: Action filter
  await t.test('19. Action filter: Filtering by action=SITE_ARCHIVED returns only site archival logs', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?action=SITE_ARCHIVED');
    const res = await getAuditList(req);
    const body = await res.json();
    assert.ok(body.items.length > 0);
    body.items.forEach((item: any) => {
      assert.equal(item.action, 'SITE_ARCHIVED');
    });
  });

  // Proof 20: Entity filter
  await t.test('20. Entity filter: Filtering by entityType=ATTENDANCE returns only attendance logs', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?entityType=ATTENDANCE');
    const res = await getAuditList(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.items.length > 0);
    body.items.forEach((item: any) => {
      assert.equal(item.entityType, 'ATTENDANCE');
    });
  });

  // Proof 21: Search
  await t.test('21. Search: Free text search matches entity or action', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?search=att-1');
    const res = await getAuditList(req);
    const body = await res.json();
    assert.ok(body.items.length > 0);
    assert.ok(body.items.some((i: any) => i.id === 'aud-g-test-eng-att'));
  });

  // Proof 22: Empty result
  await t.test('22. Empty result: Non-existent filter returns clean empty array with totalCount=0', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?search=non_existent_search_token_99999');
    const res = await getAuditList(req);
    const body = await res.json();
    assert.equal(body.items.length, 0);
    assert.equal(body.totalCount, 0);
    assert.equal(body.hasMore, false);
  });

  // Proof 23: Invalid filter (Safe handling)
  await t.test('23. Invalid filter: Negative page or invalid pageSize safely defaults', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?page=-5&pageSize=notanumber');
    const res = await getAuditList(req);
    const body = await res.json();
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 25);
  });

  // Proof 24: Metadata redaction
  await t.test('24. Metadata redaction: Passwords and tokens replaced with [REDACTED]', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?search=fin-secret-1');
    const res = await getAuditList(req);
    const body = await res.json();
    const item = body.items.find((i: any) => i.id === 'aud-g-test-sensitive-payload');
    assert.ok(item, 'aud-g-test-sensitive-payload must be found');

    const before = item.metadata.before;
    assert.equal(before.password, '[REDACTED]');
    assert.equal(before.token, '[REDACTED]');
    assert.equal(before.otp, '[REDACTED]');
    assert.equal(before.api_key, '[REDACTED]');

    const after = item.metadata.after;
    assert.equal(after.session_secret, '[REDACTED]');
  });

  // Proof 25: Centralized password/token/OTP redaction function unit validation
  await t.test('25. Centralized redaction function: redactPayload eliminates all secret keys and hashes', () => {
    const raw = {
      user: 'john',
      password: 'mypassword',
      password_hash: '$2a$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqr',
      token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.abc',
      otp: '123456',
      recoveryToken: 'tok-abc',
      dbPath: 'C:\\Users\\Admin\\Desktop\\SITE WORK\\data\\site_work.db',
      normalField: 'hello world'
    };

    const cleaned = redactPayload(raw) as any;
    assert.equal(cleaned.password, '[REDACTED]');
    assert.equal(cleaned.password_hash, '[REDACTED]');
    assert.equal(cleaned.token, '[REDACTED]');
    assert.equal(cleaned.otp, '[REDACTED]');
    assert.equal(cleaned.recoveryToken, '[REDACTED]');
    assert.equal(cleaned.dbPath, '[REDACTED]');
    assert.equal(cleaned.normalField, 'hello world');
  });

  // Proof 26: Superior Prime actor pseudonymization for lower authorities
  await t.test('26. Superior Prime pseudonymization: Operational events show "System Administrator" with null user_id', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?action=SITE_ARCHIVED');
    const res = await getAuditList(req);
    const body = await res.json();
    const opItem = body.items.find((i: any) => i.id === 'aud-g-test-sp-op-site1');
    assert.ok(opItem, 'aud-g-test-sp-op-site1 must be present');
    assert.equal(opItem.actor.name, 'System Administrator');
    assert.equal(opItem.actor.id, null);
    assert.equal(opItem.actor.role, null);

    // Verify metadata does not leak Iamadmin
    const beforeStr = JSON.stringify(opItem.metadata.before);
    assert.equal(beforeStr.includes('Iamadmin'), false, 'before_state must NOT contain Iamadmin');
  });

  // Proof 27: Superior Prime security-event hiding
  await t.test('27. Superior Prime security-event hiding: Standard Admin CANNOT see SP password reset or login', async () => {
    setTestSession(standardAdminSession);
    const req = new Request('http://localhost:3000/api/audit?entityType=SECURITY');
    const res = await getAuditList(req);
    const body = await res.json();
    const hasSpSec = body.items.some((i: any) => i.id === 'aud-g-test-sp-sec-1');
    assert.equal(hasSpSec, false, 'aud-g-test-sp-sec-1 MUST NOT be visible to Standard Admin');

    const resAuth = await getAuditList(new Request('http://localhost:3000/api/audit?entityType=AUTH'));
    const bodyAuth = await resAuth.json();
    const hasSpAuth = bodyAuth.items.some((i: any) => i.id === 'aud-g-test-sp-auth-1');
    assert.equal(hasSpAuth, false, 'aud-g-test-sp-auth-1 MUST NOT be visible to Standard Admin');
  });

  // Proof 28: Hidden-record count leakage (totalCount does NOT leak hidden records)
  await t.test('28. Count Leakage Prevention: totalCount for non-SP excludes hidden SP security events', async () => {
    setTestSession(superiorPrimeSession);
    const resSp = await getAuditList(new Request('http://localhost:3000/api/audit?entityType=SECURITY'));
    const bodySp = await resSp.json();

    setTestSession(standardAdminSession);
    const resStd = await getAuditList(new Request('http://localhost:3000/api/audit?entityType=SECURITY'));
    const bodyStd = await resStd.json();

    assert.ok(
      bodySp.totalCount > bodyStd.totalCount,
      `SP count (${bodySp.totalCount}) must be strictly greater than Standard Admin count (${bodyStd.totalCount})`
    );
  });

  // Proof 29: Hidden-record pagination leakage
  await t.test('29. Pagination Leakage Prevention: Searching or filtering for Superior Prime identifier returns 0 results', async () => {
    setTestSession(standardAdminSession);
    // Lower authority tries actor filter for Iamadmin
    const resActor = await getAuditList(new Request('http://localhost:3000/api/audit?actor=Iamadmin'));
    const bodyActor = await resActor.json();
    assert.equal(bodyActor.items.length, 0);
    assert.equal(bodyActor.totalCount, 0);

    // Lower authority tries search for Iamadmin
    const resSearch = await getAuditList(new Request('http://localhost:3000/api/audit?search=Iamadmin'));
    const bodySearch = await resSearch.json();
    assert.equal(bodySearch.items.length, 0);
    assert.equal(bodySearch.totalCount, 0);
  });

  // Proof 30: Audit detail endpoint authorization (GET /api/audit/[id])
  await t.test('30. Detail Endpoint Authorization: GET /api/audit/[id] succeeds for permitted records, returns 404 for hidden SP security records', async () => {
    // Standard Admin viewing operational site event -> 200
    setTestSession(standardAdminSession);
    const resOp = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/aud-g-test-sp-op-site1'),
      { params: { id: 'aud-g-test-sp-op-site1' } }
    );
    assert.equal(resOp.status, 200);
    const bodyOp = await resOp.json();
    assert.equal(bodyOp.item.id, 'aud-g-test-sp-op-site1');
    assert.equal(bodyOp.item.actor.name, 'System Administrator');

    // Standard Admin attempting to view SP security record -> 404 Not Found (Zero existence disclosure)
    const resSec = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/aud-g-test-sp-sec-1'),
      { params: { id: 'aud-g-test-sp-sec-1' } }
    );
    assert.equal(resSec.status, 404, 'Must return 404 to avoid disclosing record existence');

    // Superior Prime viewing same SP security record -> 200 OK
    setTestSession(superiorPrimeSession);
    const resSpSec = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/aud-g-test-sp-sec-1'),
      { params: { id: 'aud-g-test-sp-sec-1' } }
    );
    assert.equal(resSpSec.status, 200);
  });

  // Proof 31: Concurrent reads
  await t.test('31. Concurrency: Multiple concurrent queries execute without database locks or crashes', async () => {
    setTestSession(standardAdminSession);
    const requests = Array.from({ length: 20 }, (_, idx) => 
      getAuditList(new Request(`http://localhost:3000/api/audit?page=${(idx % 3) + 1}&pageSize=10`))
    );
    const responses = await Promise.all(requests);
    responses.forEach((res) => {
      assert.equal(res.status, 200);
    });
  });

  // Proof 32: Production database remains untouched
  await t.test('32. Production Database Safety: Production site_work.db metrics remain exactly intact', () => {
    const prodDb = new DatabaseSync('data/site_work.db');
    const users = prodDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    const sites = prodDb.prepare('SELECT COUNT(*) as c FROM sites').get() as { c: number };
    const categories = prodDb.prepare('SELECT COUNT(*) as c FROM work_categories').get() as { c: number };
    const roles = prodDb.prepare('SELECT COUNT(*) as c FROM work_roles').get() as { c: number };
    const attendance = prodDb.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as { c: number };
    const finance = prodDb.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as { c: number };
    const audit = prodDb.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as { c: number };
    const lifecycle = prodDb.prepare('SELECT COUNT(*) as c FROM system_lifecycle_records').get() as { c: number };

    const integrity = prodDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const fk = prodDb.prepare('PRAGMA foreign_key_check').all();

    assert.equal(users.c, 4, 'Production users must equal 4');
    assert.equal(sites.c, 6, 'Production sites must equal 6');
    assert.equal(categories.c, 4, 'Production categories must equal 4');
    assert.equal(roles.c, 23, 'Production roles must equal 23');
    assert.equal(attendance.c, 18, 'Production attendance must equal 18');
    assert.equal(finance.c, 4, 'Production finance must equal 4');
    assert.equal(audit.c, 429, 'Production audit logs must equal 429');
    assert.equal(lifecycle.c, 0, 'Production lifecycle records must equal 0');

    assert.equal(integrity.integrity_check, 'ok');
    assert.equal(fk.length, 0);
  });
});
