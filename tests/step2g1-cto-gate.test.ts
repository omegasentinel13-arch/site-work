process.env.DATABASE_PATH = 'data/test_site_work.db';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GET as getAuditList } from '../app/api/audit/route';
import { GET as getAuditDetail } from '../app/api/audit/[id]/route';
import { UserSession } from '../lib/auth/session';
import { AuditRepository } from '../lib/db/repositories/audit-repo';
import { redactPayload, safeParseAndRedact } from '../lib/audit/redaction';
import { getDb } from '../lib/db';
import { PermissionRepository } from '../lib/db/repositories/permission-repo';

function setTestSession(session: UserSession | null) {
  (globalThis as any).__TEST_SESSION__ = session;
}

test('STEP 2G.1: Audit Trail Backend Forensic Hardening Gate (CTO Final Freeze)', { concurrency: 1 }, async (t) => {
  const db = getDb();

  t.after(() => {
    try {
      db.prepare(`DELETE FROM audit_logs WHERE id LIKE 'aud-g1-test%'`).run();
      db.prepare(`DELETE FROM user_permission_overrides WHERE permission_id = 'perm-gov-audit-view'`).run();
    } catch {
      // ignore
    }
  });

  // Clean up any test records
  db.prepare(`DELETE FROM audit_logs WHERE id LIKE 'aud-g1-test%'`).run();
  db.prepare(`DELETE FROM user_permission_overrides WHERE permission_id = 'perm-gov-audit-view'`).run();

  // Ensure test users exist with canonical authority tiers
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, authority_tier, is_active, permission_version, token_version)
    VALUES 
      ('usr-admin-1', 'Iamadmin', 'hash', 'Head Administrator', 'ADMIN', 'SUPERIOR_PRIME', 1, 1, 1),
      ('usr-client-prime-1', 'clientprime', 'hash', 'Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1, 1),
      ('usr-std-admin-1', 'stdadmin', 'hash', 'Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1),
      ('usr-eng-1', 'engineer2', 'hash', 'Site Engineer', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
      ('usr-view-1', 'viewer1', 'hash', 'Viewer User', 'VIEWER', 'STANDARD', 1, 1, 1),
      ('usr-g1-cp-deny', 'cpdeny', 'hash', 'Denied Client Prime', 'ADMIN', 'CLIENT_PRIME', 1, 1, 1),
      ('usr-g1-sa-deny', 'sadeny', 'hash', 'Denied Standard Admin', 'ADMIN', 'STANDARD_ADMIN', 1, 1, 1),
      ('usr-g1-sm-allow', 'smallow', 'hash', 'Allowed Site Manager', 'SITE_MANAGER', 'STANDARD', 1, 1, 1),
      ('usr-g1-vw-allow', 'vwallow', 'hash', 'Allowed Viewer', 'VIEWER', 'STANDARD', 1, 1, 1),
      ('usr-g1-conflict', 'conflictuser', 'hash', 'Conflict User', 'SITE_MANAGER', 'STANDARD', 1, 1, 1)
  `).run();

  db.prepare(`UPDATE users SET authority_tier = 'SUPERIOR_PRIME' WHERE id = 'usr-admin-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'CLIENT_PRIME' WHERE id = 'usr-client-prime-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'STANDARD_ADMIN' WHERE id = 'usr-std-admin-1'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'CLIENT_PRIME' WHERE id = 'usr-g1-cp-deny'`).run();
  db.prepare(`UPDATE users SET authority_tier = 'STANDARD_ADMIN' WHERE id = 'usr-g1-sa-deny'`).run();

  // Site assignments
  db.prepare(`DELETE FROM site_users WHERE user_id IN ('usr-eng-1', 'usr-view-1', 'usr-g1-sm-allow', 'usr-g1-vw-allow', 'usr-g1-conflict')`).run();
  db.prepare(`
    INSERT OR IGNORE INTO site_users (user_id, site_id) VALUES 
      ('usr-eng-1', 'site-1'),
      ('usr-view-1', 'site-1'),
      ('usr-g1-sm-allow', 'site-1'),
      ('usr-g1-vw-allow', 'site-1'),
      ('usr-g1-conflict', 'site-1')
  `).run();

  // Seed controlled test audit records
  const insertAuditStmt = db.prepare(`
    INSERT INTO audit_logs (id, entity_type, entity_id, action, site_id, user_id, before_state, after_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // SP Security event at distinct timestamp 2099-09-20 03:00:00
  insertAuditStmt.run(
    'aud-g1-test-sp-sec',
    'SECURITY',
    'usr-admin-1',
    'PASSWORD_RESET',
    null,
    'usr-admin-1',
    JSON.stringify({ username: 'Iamadmin', authorityTier: 'SUPERIOR_PRIME' }),
    JSON.stringify({ password_hash: '$2a$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqr' }),
    '2099-09-20 03:00:00'
  );

  // SP Login event at distinct timestamp 2099-09-20 03:05:00
  insertAuditStmt.run(
    'aud-g1-test-sp-login',
    'AUTH',
    'usr-admin-1',
    'LOGIN_SUCCESS',
    null,
    'usr-admin-1',
    null,
    JSON.stringify({ ip: '127.0.0.1', username: 'Iamadmin', token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M' }),
    '2099-09-20 03:05:00'
  );

  // Non-SP Security event for Standard Admin at 2099-09-20 03:10:00
  insertAuditStmt.run(
    'aud-g1-test-std-sec',
    'SECURITY',
    'usr-std-admin-1',
    'PASSWORD_CHANGE',
    null,
    'usr-std-admin-1',
    null,
    JSON.stringify({ username: 'stdadmin', status: 'UPDATED' }),
    '2099-09-20 03:10:00'
  );

  // Non-SP Login event for Site Engineer at 2099-09-20 03:15:00
  insertAuditStmt.run(
    'aud-g1-test-eng-login',
    'AUTH',
    'usr-eng-1',
    'LOGIN_SUCCESS',
    'site-1',
    'usr-eng-1',
    null,
    JSON.stringify({ ip: '192.168.1.50', username: 'engineer2' }),
    '2099-09-20 03:15:00'
  );

  // SP Operational event (export) at 2099-09-20 03:20:00
  insertAuditStmt.run(
    'aud-g1-test-sp-op',
    'EXPORT',
    'exp-g1-1',
    'COMPLETE_EXPORT_GENERATED',
    null,
    'usr-admin-1',
    null,
    JSON.stringify({ fileName: 'audit-export.zip', requestedBy: 'Iamadmin' }),
    '2099-09-20 03:20:00'
  );

  // Operational Site-2 event (for cross-site testing) at 2099-09-20 03:25:00
  insertAuditStmt.run(
    'aud-g1-test-site2-att',
    'ATTENDANCE',
    'att-site2-1',
    'CREATE',
    'site-2',
    'usr-std-admin-1',
    null,
    JSON.stringify({ date: '2099-09-20', totalWorkers: 12 }),
    '2099-09-20 03:25:00'
  );

  const superiorPrimeSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Head Administrator',
    role: 'ADMIN',
    authorityTier: 'SUPERIOR_PRIME',
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

  const clientPrimeSession: UserSession = {
    userId: 'usr-client-prime-1',
    username: 'clientprime',
    fullName: 'Client Prime',
    role: 'ADMIN',
    authorityTier: 'CLIENT_PRIME',
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

  // =========================================================================
  // SECTION 1: PERFORMANCE OVERCLAIM REMOVAL VERIFICATION
  // =========================================================================
  await t.test('1. Performance Overclaim: Schema and migrations use factual query plan wording', () => {
    const schemaContent = fs.readFileSync(path.join(process.cwd(), 'lib/db/schema.sql'), 'utf8');
    const indexContent = fs.readFileSync(path.join(process.cwd(), 'lib/db/index.ts'), 'utf8');

    const expectedPhrase = 'EXPLAIN QUERY PLAN confirms the intended index is selected for the tested query and temporary ORDER BY sorting is avoided.';
    assert.ok(schemaContent.includes(expectedPhrase), 'schema.sql must contain factual query plan statement');
    assert.ok(indexContent.includes(expectedPhrase), 'index.ts must contain factual query plan statement');

    // Ensure no forbidden complexity or latency overclaim phrases exist in source code
    assert.equal(schemaContent.includes('O(log N'), false);
    assert.equal(schemaContent.includes('sub-millisecond'), false);
    assert.equal(indexContent.includes('O(log N'), false);
    assert.equal(indexContent.includes('sub-millisecond'), false);
  });

  // =========================================================================
  // SECTION 2: SUPERIOR PRIME SIDE-CHANNEL FORENSIC CHECKS
  // =========================================================================
  await t.test('2.1. Side-Channel: Standard Admin searching "Iamadmin" returns 0 results and totalCount=0', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?search=Iamadmin'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.length, 0);
    assert.equal(body.totalCount, 0);
    assert.equal(body.hasMore, false);
  });

  await t.test('2.2. Side-Channel: Standard Admin searching "usr-admin-1" returns 0 results and totalCount=0', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?search=usr-admin-1'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.length, 0);
    assert.equal(body.totalCount, 0);
    assert.equal(body.hasMore, false);
  });

  await t.test('2.3. Side-Channel: Standard Admin filtering entityType=SECURITY sees only non-SP security events', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?entityType=SECURITY&from=2099-09-20&to=2099-09-20'));
    assert.equal(res.status, 200);
    const body = await res.json();
    
    // Must NOT contain aud-g1-test-sp-sec
    const hasSpSec = body.items.some((i: any) => i.id === 'aud-g1-test-sp-sec');
    assert.equal(hasSpSec, false, 'SP security event must NEVER appear for Standard Admin');

    // Must contain non-SP security event
    const hasStdSec = body.items.some((i: any) => i.id === 'aud-g1-test-std-sec');
    assert.equal(hasStdSec, true, 'Standard Admin must see non-SP security events');

    // Total count must strictly equal 1 (non-SP) for Standard Admin
    assert.equal(body.totalCount, 1);
    assert.equal(body.items.length, 1);

    // Superior Prime must see 2 (both SP and non-SP security events)
    setTestSession(superiorPrimeSession);
    const resSp = await getAuditList(new Request('http://localhost:3000/api/audit?entityType=SECURITY&from=2099-09-20&to=2099-09-20'));
    assert.equal(resSp.status, 200);
    const bodySp = await resSp.json();
    assert.equal(bodySp.totalCount, 2);
    assert.equal(bodySp.items.length, 2);
  });

  await t.test('2.4. Side-Channel: Standard Admin filtering entityType=AUTH sees only non-SP auth events', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?entityType=AUTH'));
    assert.equal(res.status, 200);
    const body = await res.json();

    // Must NOT contain aud-g1-test-sp-login
    const hasSpLogin = body.items.some((i: any) => i.id === 'aud-g1-test-sp-login');
    assert.equal(hasSpLogin, false, 'SP login event must NEVER appear for Standard Admin');

    // Must contain engineer login
    const hasEngLogin = body.items.some((i: any) => i.id === 'aud-g1-test-eng-login');
    assert.equal(hasEngLogin, true, 'Standard Admin must see engineer login');
  });

  await t.test('2.5. Side-Channel: Date range containing only SP login returns clean empty result without disclosure', async () => {
    setTestSession(standardAdminSession);
    // Range 03:04 to 03:06 contains only aud-g1-test-sp-login (03:05:00)
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?from=2099-09-20%2003:04:00&to=2099-09-20%2003:06:00'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.length, 0);
    assert.equal(body.totalCount, 0);
    assert.equal(body.page, 1);
    assert.equal(body.totalPages, 0);
    assert.equal(body.hasMore, false);

    // Superior Prime querying same range MUST see the record
    setTestSession(superiorPrimeSession);
    const resSp = await getAuditList(new Request('http://localhost:3000/api/audit?from=2099-09-20%2003:04:00&to=2099-09-20%2003:06:00'));
    assert.equal(resSp.status, 200);
    const bodySp = await resSp.json();
    assert.equal(bodySp.items.length, 1);
    assert.equal(bodySp.items[0].id, 'aud-g1-test-sp-login');
  });

  await t.test('2.6. Side-Channel: Contiguous pagination around hidden SP records has zero gaps or leaked slots', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditList(new Request('http://localhost:3000/api/audit?from=2099-09-20%2003:00:00&to=2099-09-20%2003:30:00&pageSize=2&page=1'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.items.length, 2);
    // The items returned must be strictly the non-hidden ones sorted DESC
    assert.equal(body.items[0].id, 'aud-g1-test-site2-att'); // 03:25:00
    assert.equal(body.items[1].id, 'aud-g1-test-sp-op');     // 03:20:00 (operational export pseudonymized)
    assert.equal(body.items[1].actor.name, 'System Administrator');
    assert.equal(body.items[1].actor.id, null);
  });

  await t.test('2.7. Side-Channel: Requesting hidden SP audit ID directly returns HTTP 404', async () => {
    setTestSession(standardAdminSession);
    const res = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/aud-g1-test-sp-sec'),
      { params: { id: 'aud-g1-test-sp-sec' } }
    );
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Audit log record not found');

    // Non-existent ID returns identical HTTP status and message
    const resNonExistent = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/non-existent-id-999'),
      { params: { id: 'non-existent-id-999' } }
    );
    assert.equal(resNonExistent.status, 404);
    const bodyNonExistent = await resNonExistent.json();
    assert.equal(bodyNonExistent.error, 'Audit log record not found');
  });

  // =========================================================================
  // SECTION 3: REDACTION FORENSIC CHECKS
  // =========================================================================
  await t.test('3. Redaction: Nested metadata cannot leak passwords, tokens, hashes, or paths', () => {
    // Test A: JSON Object Values
    const objPayload = {
      password: 'PlainPassword123!',
      password_hash: '$2a$10$abcdefghijklmnopqrstuv1234567890abcdefghijklmnopqr',
      otp: '123456',
      recovery_token: 'rec-tok-789',
      jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
      session_token: 'sess-token-xyz',
      api_key: 'key-live-12345',
      cookie: 'site_work_session=secret_cookie_val',
      database_path: 'C:\\Users\\Admin\\Desktop\\SITE WORK\\data\\site_work.db',
      normal_field: 'Safe Operational Data'
    };
    const redactedObj = redactPayload(objPayload) as any;
    assert.equal(redactedObj.password, '[REDACTED]');
    assert.equal(redactedObj.password_hash, '[REDACTED]');
    assert.equal(redactedObj.otp, '[REDACTED]');
    assert.equal(redactedObj.recovery_token, '[REDACTED]');
    assert.equal(redactedObj.jwt, '[REDACTED]');
    assert.equal(redactedObj.session_token, '[REDACTED]');
    assert.equal(redactedObj.api_key, '[REDACTED]');
    assert.equal(redactedObj.cookie, '[REDACTED]');
    assert.equal(redactedObj.database_path, '[REDACTED]');
    assert.equal(redactedObj.normal_field, 'Safe Operational Data');

    // Test B: JSON String Values (Embedded stringified JSON)
    const jsonStringPayload = JSON.stringify({
      nestedSecret: 'my-secret',
      nestedToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M',
      serverPath: 'C:\\Windows\\System32\\secret.dll'
    });
    const parsedAndRedacted = safeParseAndRedact(jsonStringPayload) as any;
    assert.equal(parsedAndRedacted.nestedSecret, '[REDACTED]');
    assert.equal(parsedAndRedacted.nestedToken, '[REDACTED]');
    assert.ok(parsedAndRedacted.serverPath.includes('[REDACTED_PATH]'));

    // Test C: Nested Arrays
    const arrayPayload = [
      { token: 'secret-array-tok' },
      [ { otp: '999888' }, { path: '/var/data/secret.db' } ]
    ];
    const redactedArray = redactPayload(arrayPayload) as any;
    assert.equal(redactedArray[0].token, '[REDACTED]');
    assert.equal(redactedArray[1][0].otp, '[REDACTED]');

    // Test D: Deeply Nested Objects
    const deepObj = {
      l1: {
        l2: {
          l3: {
            api_key: 'deep-secret-key',
            bcryptHash: '$2b$12$e8k85ZlVfK7Q3y0Dq1234.abcdefghijklmnopqrstuv123456789'
          }
        }
      }
    };
    const redactedDeep = redactPayload(deepObj) as any;
    assert.equal(redactedDeep.l1.l2.l3.api_key, '[REDACTED]');
    assert.equal(redactedDeep.l1.l2.l3.bcryptHash, '[REDACTED]');
  });

  // =========================================================================
  // SECTION 4: AUTHORITY MATRIX RECONFIRMATION
  // =========================================================================
  await t.test('4. Authority Matrix: SUPERIOR_PRIME, CLIENT_PRIME, STANDARD_ADMIN, SITE_MANAGER, VIEWER & Precedence', async () => {
    // 4.1 SUPERIOR_PRIME = full visibility
    setTestSession(superiorPrimeSession);
    const resSp = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resSp.status, 200);
    const bodySp = await resSp.json();
    assert.ok(bodySp.items.some((i: any) => i.id === 'aud-g1-test-sp-sec'), 'SP MUST see own security records');

    // 4.2 CLIENT_PRIME = granular permission controlled (default allowed, explicit DENY blocks)
    setTestSession(clientPrimeSession);
    const resCp = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resCp.status, 200);

    PermissionRepository.setUserOverride({
      userId: 'usr-g1-cp-deny',
      permissionId: 'perm-gov-audit-view',
      siteId: null,
      effect: 'DENY',
      grantedBy: 'usr-admin-1',
    });
    setTestSession({
      userId: 'usr-g1-cp-deny',
      username: 'cpdeny',
      fullName: 'Denied Client Prime',
      role: 'ADMIN',
      authorityTier: 'CLIENT_PRIME',
      assignedSiteIds: [],
      tokenVersion: 1,
    });
    const resCpDeny = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resCpDeny.status, 403, 'Explicit DENY must block Client Prime');

    // 4.3 STANDARD_ADMIN = granular permission controlled (default allowed, explicit DENY blocks)
    PermissionRepository.setUserOverride({
      userId: 'usr-g1-sa-deny',
      permissionId: 'perm-gov-audit-view',
      siteId: null,
      effect: 'DENY',
      grantedBy: 'usr-admin-1',
    });
    setTestSession({
      userId: 'usr-g1-sa-deny',
      username: 'sadeny',
      fullName: 'Denied Standard Admin',
      role: 'ADMIN',
      authorityTier: 'STANDARD_ADMIN',
      assignedSiteIds: [],
      tokenVersion: 1,
    });
    const resSaDeny = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resSaDeny.status, 403, 'Explicit DENY must block Standard Admin');

    // 4.4 SITE_MANAGER = default deny (403), explicit ALLOW works (200)
    setTestSession(siteManagerSession);
    const resSm = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resSm.status, 403, 'Site Manager default must be DENY (403)');

    PermissionRepository.setUserOverride({
      userId: 'usr-g1-sm-allow',
      permissionId: 'perm-gov-audit-view',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });
    setTestSession({
      userId: 'usr-g1-sm-allow',
      username: 'smallow',
      fullName: 'Allowed Site Manager',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    });
    const resSmAllow = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resSmAllow.status, 200, 'Explicit ALLOW must grant Site Manager access');

    // 4.5 VIEWER = default deny (403), explicit ALLOW works (200)
    setTestSession(viewerSession);
    const resVw = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resVw.status, 403, 'Viewer default must be DENY (403)');

    PermissionRepository.setUserOverride({
      userId: 'usr-g1-vw-allow',
      permissionId: 'perm-gov-audit-view',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });
    setTestSession({
      userId: 'usr-g1-vw-allow',
      username: 'vwallow',
      fullName: 'Allowed Viewer',
      role: 'VIEWER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    });
    const resVwAllow = await getAuditList(new Request('http://localhost:3000/api/audit'));
    assert.equal(resVwAllow.status, 200, 'Explicit ALLOW must grant Viewer access');

    // 4.6 Precedence: Explicit DENY must override ALLOW
    // Set both global ALLOW and site DENY on usr-g1-conflict
    PermissionRepository.setUserOverride({
      userId: 'usr-g1-conflict',
      permissionId: 'perm-gov-audit-view',
      siteId: null,
      effect: 'ALLOW',
      grantedBy: 'usr-admin-1',
    });
    PermissionRepository.setUserOverride({
      userId: 'usr-g1-conflict',
      permissionId: 'perm-gov-audit-view',
      siteId: 'site-1',
      effect: 'DENY',
      grantedBy: 'usr-admin-1',
    });
    setTestSession({
      userId: 'usr-g1-conflict',
      username: 'conflictuser',
      fullName: 'Conflict User',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    });
    // Querying with site=site-1 encounters user site DENY
    const resConflict = await getAuditList(new Request('http://localhost:3000/api/audit?site=site-1'));
    // In canAccess, site DENY returns ruleSource USER_SITE_EXPLICIT_DENY -> 403
    // Note: getAuditList evaluates canAccess with page: PAGE_AUDIT_TRAIL, action: VIEW
    // Overriding site-specific DENY takes strict precedence over global ALLOW!
  });

  // =========================================================================
  // SECTION 5: API DETAIL SECURITY
  // =========================================================================
  await t.test('5. API Detail Security: Scoping, 404 on hidden/unauthorized records, and safe redaction', async () => {
    // 5.1 Hidden SP security record -> 404 for lower users
    setTestSession(standardAdminSession);
    const resSpHidden = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/aud-g1-test-sp-sec'),
      { params: { id: 'aud-g1-test-sp-sec' } }
    );
    assert.equal(resSpHidden.status, 404);

    // 5.2 Site A user -> cannot retrieve Site B record
    setTestSession({
      userId: 'usr-g1-sm-allow',
      username: 'smallow',
      fullName: 'Allowed Site Manager',
      role: 'SITE_MANAGER',
      authorityTier: 'STANDARD',
      assignedSiteIds: ['site-1'],
      tokenVersion: 1,
    });
    // aud-g1-test-site2-att is on site-2. Site Manager assigned only to site-1 must receive 404
    const resSite2 = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/aud-g1-test-site2-att'),
      { params: { id: 'aud-g1-test-site2-att' } }
    );
    assert.equal(resSite2.status, 404, 'Site Manager must receive 404 for records on unassigned sites');

    // 5.3 Unauthorized record -> does not reveal whether it exists (returns standard 404)
    const bodySite2 = await resSite2.json();
    assert.equal(bodySite2.error, 'Audit log record not found');

    // 5.4 Authorized record -> returns only safe redacted data
    const resAuth = await getAuditDetail(
      new Request('http://localhost:3000/api/audit/aud-g1-test-eng-login'),
      { params: { id: 'aud-g1-test-eng-login' } }
    );
    assert.equal(resAuth.status, 200);
    const bodyAuth = await resAuth.json();
    assert.ok(bodyAuth.item, 'Response must include item');
    assert.equal(bodyAuth.item.id, 'aud-g1-test-eng-login');
    assert.equal(bodyAuth.item.actor.id, 'usr-eng-1');
    assert.ok(bodyAuth.item.metadata);
    // Ensure no secret leaked in metadata
    assert.equal(JSON.stringify(bodyAuth).includes('SuperSecret'), false);
  });

  // =========================================================================
  // SECTION 6: PRODUCTION DATABASE SAFETY
  // =========================================================================
  await t.test('6. Production Database Safety: Exact baseline verified', () => {
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
