import http from 'http';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';

const SESSION_SECRET = process.env.SESSION_SECRET || 'site_work_super_secret_session_key_min_32_characters_long_2026_engineering';
const SECRET_KEY = new TextEncoder().encode(SESSION_SECRET);


async function makeToken(payload: {
  userId: string;
  username: string;
  fullName: string;
  role: string;
  assignedSiteIds: string[];
  tokenVersion: number;
}): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SECRET_KEY);
}

function apiRequest(
  urlPath: string,
  method: string,
  token?: string,
  body?: any
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, 'http://localhost:3001');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Cookie'] = `site_work_session=${token}`;
    }

    const req = http.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      }
    );

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

export async function runStep0QASuite() {
  console.log('================================================================');
  console.log('SITE WORK — STEP 0 FORENSIC REGRESSION QA SUITE');
  console.log('CRITICAL AUTHORIZATION / SITE-ISOLATION PATCH');
  console.log('Target: http://localhost:3001 (Isolated Test DB)');
  console.log('================================================================\n');

  // 1. Production DB Pre-Check
  console.log('--- 1. Production DB Baseline Pre-Check ---');
  const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodUsers = prodDb.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
  const prodSites = prodDb.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
  const prodRoles = prodDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCats = prodDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodAtt = prodDb.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
  const prodFin = prodDb.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
  const prodAudit = prodDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodLfc = prodDb.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
  const prodInteg = (prodDb.prepare('PRAGMA integrity_check').get() as any).integrity_check;
  const prodFk = prodDb.prepare('PRAGMA foreign_key_check').all().length;
  prodDb.close();

  assert.equal(prodUsers.c, 4, 'Prod users must be 4');
  assert.equal(prodSites.c, 6, 'Prod sites must be 6');
  assert.equal(prodCats.c, 4, 'Prod work_categories must be 4');
  assert.equal(prodRoles.c, 23, 'Prod work_roles must be 23');
  assert.equal(prodAtt.c, 18, 'Prod attendance must be 18');
  assert.equal(prodFin.c, 4, 'Prod finance must be 4');
  assert.equal(prodAudit.c, 429, 'Prod audit logs must be exactly 429');
  assert.equal(prodLfc.c, 0, 'Prod lifecycle must be 0');
  assert.equal(prodInteg, 'ok', 'Prod integrity must be ok');
  assert.equal(prodFk, 0, 'Prod FK check must be 0 errors');
  console.log('✓ Production database pre-check passed (Baseline: 429 audit logs, 4 users, 4 transactions)\n');

  // 2. Prepare Isolated Test Database
  console.log('--- 2. Setting Up Test Database with Disposable Test Fixtures ---');
  let testDb: DatabaseSync;
  try {
    if (fs.existsSync('data/test_site_work.db')) fs.unlinkSync('data/test_site_work.db');
    if (fs.existsSync('data/test_site_work.db-wal')) fs.unlinkSync('data/test_site_work.db-wal');
    if (fs.existsSync('data/test_site_work.db-shm')) fs.unlinkSync('data/test_site_work.db-shm');

    const pDb = new DatabaseSync('data/site_work.db', { readOnly: true });
    pDb.prepare("VACUUM INTO 'data/test_site_work.db'").run();
    pDb.close();
    testDb = new DatabaseSync('data/test_site_work.db');
  } catch {
    testDb = new DatabaseSync('data/test_site_work.db');
    testDb.prepare("DELETE FROM financial_transactions WHERE id LIKE 'tx-qa-%'").run();
  }


  // Insert disposable test transactions
  // tx-qa-site2-001: belongs to site-2
  testDb.prepare(`
    INSERT INTO financial_transactions (
      id, site_id, date, type, debit_category, amount_paise, description, reference_note, created_by, updated_by, created_at, updated_at
    ) VALUES (
      'tx-qa-site2-001', 'site-2', '2026-09-02', 'DEBIT', 'SUPPLIES', 1500000, 'Site 2 Initial Test Outflow', 'REF-S2-ORIG', 'usr-eng-1', 'usr-eng-1', datetime('now'), datetime('now')
    )
  `).run();

  // tx-qa-site1-001: belongs to site-1
  testDb.prepare(`
    INSERT INTO financial_transactions (
      id, site_id, date, type, debit_category, amount_paise, description, reference_note, created_by, updated_by, created_at, updated_at
    ) VALUES (
      'tx-qa-site1-001', 'site-1', '2026-09-02', 'CREDIT', NULL, 2000000, 'Site 1 Initial Test Inflow', 'REF-S1-ORIG', 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', datetime('now'), datetime('now')
    )
  `).run();

  testDb.close();
  console.log('✓ Test fixtures inserted: tx-qa-site2-001 (Site 2) and tx-qa-site1-001 (Site 1)\n');

  // 3. Generate Auth Tokens
  console.log('--- 3. Generating Session Tokens ---');
  // Engineer 1: assigned to Site 1 only
  const eng1Token = await makeToken({
    userId: 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0',
    username: 'engineer1',
    fullName: 'Live Site Engineer',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
    tokenVersion: 6,
  });

  // Engineer 2: assigned to Site 2 only
  const eng2Token = await makeToken({
    userId: 'usr-eng-1',
    username: 'engineer2',
    fullName: 'Site Engineer (Demo)',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-2'],
    tokenVersion: 4,
  });

  // Viewer: assigned to Site 1, role VIEWER
  const viewToken = await makeToken({
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Site Auditor (Demo)',
    role: 'VIEWER',
    assignedSiteIds: ['site-1'],
    tokenVersion: 4,
  });

  // Admin: role ADMIN, global
  const adminToken = await makeToken({
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Head Administrator',
    role: 'ADMIN',
    assignedSiteIds: [],
    tokenVersion: 11,
  });
  console.log('✓ Tokens generated for Engineer 1 (Site 1), Engineer 2 (Site 2), Viewer 1 (Site 1), Admin (Global)\n');

  // Helpers to read transaction from test DB
  function getTxState(txId: string) {
    const db = new DatabaseSync('data/test_site_work.db', { readOnly: true });
    const row = db.prepare('SELECT id, site_id, date, type, debit_category, amount_paise, description FROM financial_transactions WHERE id = ?').get(txId);
    db.close();
    return row as any;
  }

  // =========================================================================
  // MANDATORY REGRESSION TESTS A THROUGH J
  // =========================================================================

  console.log('--- 4. Executing Mandatory Security Regression Matrix ---\n');

  // -------------------------------------------------------------------------
  // TEST A: Engineer assigned to Site 1 can edit Site 1 transaction
  // -------------------------------------------------------------------------
  console.log('Test A: Engineer 1 (assigned to Site 1) editing Site 1 transaction (tx-qa-site1-001)');
  const resA = await apiRequest('/api/finance/tx-qa-site1-001', 'PUT', eng1Token, {
    siteId: 'site-1',
    date: '2026-09-02',
    type: 'CREDIT',
    amountPaise: 2750000,
    description: 'Site 1 Legitimate Edit by Assigned Engineer',
  });
  console.log('  -> Status:', resA.status, '| Response:', JSON.stringify(resA.body));
  assert.equal(resA.status, 200, 'Engineer 1 must be allowed to edit their assigned site transaction');
  const txAfterA = getTxState('tx-qa-site1-001');
  assert.equal(txAfterA.amount_paise, 2750000, 'Amount must be updated');
  assert.equal(txAfterA.description, 'Site 1 Legitimate Edit by Assigned Engineer');
  console.log('✓ Test A Passed: Legitimate Site 1 edit succeeded.\n');

  // -------------------------------------------------------------------------
  // TEST B: Engineer assigned to Site 1 CANNOT edit Site 2 transaction even if body.siteId="site-1"
  // -------------------------------------------------------------------------
  console.log('Test B: Engineer 1 attempting cross-site edit of Site 2 transaction (tx-qa-site2-001) with spoofed body.siteId="site-1"');
  const txBeforeB = getTxState('tx-qa-site2-001');
  const resB = await apiRequest('/api/finance/tx-qa-site2-001', 'PUT', eng1Token, {
    siteId: 'site-1', // Spoofing caller's allowed site
    date: '2026-09-02',
    type: 'DEBIT',
    debitCategory: 'SUPPLIES',
    amountPaise: 99999999,
    description: 'MALICIOUS_CROSS_SITE_EDIT_ATTEMPT',
  });
  console.log('  -> Status:', resB.status, '| Response:', JSON.stringify(resB.body));
  assert.equal(resB.status, 400, 'Request must be rejected with 400 Bad Request due to site mismatch/immutable site');
  const txAfterB = getTxState('tx-qa-site2-001');
  assert.deepEqual(txAfterB, txBeforeB, 'Site 2 transaction must remain completely UNCHANGED in DB');
  console.log('✓ Test B Passed: Cross-site edit with spoofed siteId rejected, DB unchanged.\n');

  // -------------------------------------------------------------------------
  // TEST C: Engineer assigned to Site 1 CANNOT delete Site 2 transaction even when siteId is omitted
  // -------------------------------------------------------------------------
  console.log('Test C: Engineer 1 attempting delete of Site 2 transaction (tx-qa-site2-001) with siteId OMITTED');
  const txBeforeC = getTxState('tx-qa-site2-001');
  const resC = await apiRequest('/api/finance/tx-qa-site2-001', 'DELETE', eng1Token);
  console.log('  -> Status:', resC.status, '| Response:', JSON.stringify(resC.body));
  assert.equal(resC.status, 403, 'Request must be rejected with 403 Forbidden because caller does not have access to Site 2');
  const txAfterC = getTxState('tx-qa-site2-001');
  assert.ok(txAfterC, 'Site 2 transaction must still exist in DB');
  assert.deepEqual(txAfterC, txBeforeC, 'Site 2 transaction must remain completely intact');
  console.log('✓ Test C Passed: Delete without siteId parameter was blocked by persisted site check.\n');

  // -------------------------------------------------------------------------
  // TEST D: Engineer assigned to Site 1 CANNOT delete Site 2 transaction by supplying siteId="site-1"
  // -------------------------------------------------------------------------
  console.log('Test D: Engineer 1 attempting delete of Site 2 transaction (tx-qa-site2-001) with query param ?siteId=site-1');
  const txBeforeD = getTxState('tx-qa-site2-001');
  const resD = await apiRequest('/api/finance/tx-qa-site2-001?siteId=site-1', 'DELETE', eng1Token);
  console.log('  -> Status:', resD.status, '| Response:', JSON.stringify(resD.body));
  assert.equal(resD.status, 400, 'Request must be rejected with 400 Bad Request due to site mismatch with persisted transaction');
  const txAfterD = getTxState('tx-qa-site2-001');
  assert.ok(txAfterD, 'Site 2 transaction must still exist in DB');
  assert.deepEqual(txAfterD, txBeforeD, 'Site 2 transaction must remain completely intact');
  console.log('✓ Test D Passed: Delete with conflicting query siteId rejected.\n');

  // -------------------------------------------------------------------------
  // TEST E: Engineer assigned to Site 1 CANNOT edit Site 2 transaction by manipulating body.siteId="site-2"
  // -------------------------------------------------------------------------
  console.log('Test E: Engineer 1 attempting edit of Site 2 transaction (tx-qa-site2-001) with body.siteId="site-2"');
  const txBeforeE = getTxState('tx-qa-site2-001');
  const resE = await apiRequest('/api/finance/tx-qa-site2-001', 'PUT', eng1Token, {
    siteId: 'site-2',
    date: '2026-09-02',
    type: 'DEBIT',
    debitCategory: 'SUPPLIES',
    amountPaise: 88888888,
    description: 'MALICIOUS_TARGETING_SITE_2',
  });
  console.log('  -> Status:', resE.status, '| Response:', JSON.stringify(resE.body));
  assert.equal(resE.status, 403, 'Request must be rejected with 403 Forbidden because Engineer 1 is not assigned to site-2');
  const txAfterE = getTxState('tx-qa-site2-001');
  assert.deepEqual(txAfterE, txBeforeE, 'Site 2 transaction must remain completely intact');
  console.log('✓ Test E Passed: Direct site-2 edit rejected with 403.\n');

  // -------------------------------------------------------------------------
  // TEST F: Viewer remains blocked from mutation
  // -------------------------------------------------------------------------
  console.log('Test F: Viewer attempting mutation on Site 1 transaction (tx-qa-site1-001)');
  const resF_PUT = await apiRequest('/api/finance/tx-qa-site1-001', 'PUT', viewToken, {
    siteId: 'site-1',
    date: '2026-09-02',
    type: 'CREDIT',
    amountPaise: 11111111,
    description: 'VIEWER_UNAUTHORIZED_EDIT',
  });
  console.log('  -> PUT Status:', resF_PUT.status, '| Response:', JSON.stringify(resF_PUT.body));
  assert.equal(resF_PUT.status, 403, 'Viewer PUT must be rejected with 403 Forbidden');

  const resF_DEL = await apiRequest('/api/finance/tx-qa-site1-001', 'DELETE', viewToken);
  console.log('  -> DELETE Status:', resF_DEL.status, '| Response:', JSON.stringify(resF_DEL.body));
  assert.equal(resF_DEL.status, 403, 'Viewer DELETE must be rejected with 403 Forbidden');
  console.log('✓ Test F Passed: Viewer strictly blocked from all mutations.\n');

  // -------------------------------------------------------------------------
  // TEST G: ADMIN can legitimately operate on both sites
  // -------------------------------------------------------------------------
  console.log('Test G: Admin operating legitimately across both sites');
  // Admin edits Site 2 transaction
  const resG_PUT2 = await apiRequest('/api/finance/tx-qa-site2-001', 'PUT', adminToken, {
    siteId: 'site-2',
    date: '2026-09-02',
    type: 'DEBIT',
    debitCategory: 'SUPPLIES',
    amountPaise: 1750000,
    description: 'Site 2 Legitimate Admin Edit',
  });
  console.log('  -> Admin PUT Site 2 Status:', resG_PUT2.status, '| Response:', JSON.stringify(resG_PUT2.body));
  assert.equal(resG_PUT2.status, 200, 'Admin must be allowed to edit Site 2 transaction');
  assert.equal(getTxState('tx-qa-site2-001').amount_paise, 1750000, 'Site 2 amount updated by Admin');

  // Admin edits Site 1 transaction
  const resG_PUT1 = await apiRequest('/api/finance/tx-qa-site1-001', 'PUT', adminToken, {
    siteId: 'site-1',
    date: '2026-09-02',
    type: 'CREDIT',
    amountPaise: 3500000,
    description: 'Site 1 Legitimate Admin Edit',
  });
  console.log('  -> Admin PUT Site 1 Status:', resG_PUT1.status, '| Response:', JSON.stringify(resG_PUT1.body));
  assert.equal(resG_PUT1.status, 200, 'Admin must be allowed to edit Site 1 transaction');
  assert.equal(getTxState('tx-qa-site1-001').amount_paise, 3500000, 'Site 1 amount updated by Admin');

  // Admin deletes Site 2 transaction
  const resG_DEL2 = await apiRequest('/api/finance/tx-qa-site2-001', 'DELETE', adminToken);
  console.log('  -> Admin DELETE Site 2 Status:', resG_DEL2.status, '| Response:', JSON.stringify(resG_DEL2.body));
  assert.equal(resG_DEL2.status, 200, 'Admin must be allowed to delete Site 2 transaction');
  assert.equal(getTxState('tx-qa-site2-001'), undefined, 'Site 2 transaction successfully deleted by Admin');

  // Admin deletes Site 1 transaction
  const resG_DEL1 = await apiRequest('/api/finance/tx-qa-site1-001', 'DELETE', adminToken);
  console.log('  -> Admin DELETE Site 1 Status:', resG_DEL1.status, '| Response:', JSON.stringify(resG_DEL1.body));
  assert.equal(resG_DEL1.status, 200, 'Admin must be allowed to delete Site 1 transaction');
  assert.equal(getTxState('tx-qa-site1-001'), undefined, 'Site 1 transaction successfully deleted by Admin');
  console.log('✓ Test G Passed: Admin global access verified on both sites.\n');


  // -------------------------------------------------------------------------
  // TEST H: Not Found handling (404)
  // -------------------------------------------------------------------------
  console.log('Test H: Handling non-existent transaction IDs');
  const resH_PUT = await apiRequest('/api/finance/tx-non-existent-999', 'PUT', adminToken, {
    siteId: 'site-1',
    amountPaise: 1000,
  });
  console.log('  -> Non-existent PUT Status:', resH_PUT.status, '| Response:', JSON.stringify(resH_PUT.body));
  assert.equal(resH_PUT.status, 404, 'Must return 404 Not Found');

  const resH_DEL = await apiRequest('/api/finance/tx-non-existent-999', 'DELETE', adminToken);
  console.log('  -> Non-existent DELETE Status:', resH_DEL.status, '| Response:', JSON.stringify(resH_DEL.body));
  assert.equal(resH_DEL.status, 404, 'Must return 404 Not Found');
  console.log('✓ Test H Passed: 404 Not Found properly returned for non-existent IDs.\n');

  // -------------------------------------------------------------------------
  // TEST I: Unauthenticated requests (401)
  // -------------------------------------------------------------------------
  console.log('Test I: Unauthenticated requests');
  const resI_PUT = await apiRequest('/api/finance/tx-c09a8bd6-b4f3-41a1-9425-3b79c519bce3', 'PUT', undefined, {
    siteId: 'site-1',
  });
  assert.equal(resI_PUT.status, 401, 'Must return 401 Unauthorized without session');

  const resI_DEL = await apiRequest('/api/finance/tx-c09a8bd6-b4f3-41a1-9425-3b79c519bce3', 'DELETE');
  assert.equal(resI_DEL.status, 401, 'Must return 401 Unauthorized without session');
  console.log('✓ Test I Passed: 401 returned for unauthenticated requests.\n');

  // -------------------------------------------------------------------------
  // TEST J: Audit Trail Verification on Test DB
  // -------------------------------------------------------------------------
  console.log('--- 5. Audit Trail Verification on Test DB ---');
  const tDb = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const testAuditRows = tDb.prepare(`
    SELECT id, entity_type, entity_id, action, site_id, user_id, created_at 
    FROM audit_logs 
    WHERE entity_type = 'FINANCE' AND entity_id IN ('tx-qa-site1-001', 'tx-qa-site2-001')
    ORDER BY created_at DESC
  `).all();
  console.log(`Test DB Audit Logs count for Step 0 test transactions: ${testAuditRows.length}`);
  assert.ok(testAuditRows.length >= 4, 'Audit logs must capture update and delete actions across runs without deletion');


  
  for (const row of testAuditRows as any[]) {
    assert.ok(row.site_id === 'site-1' || row.site_id === 'site-2', `Audit row site_id must be valid site: ${row.site_id}`);
    assert.ok(row.user_id, 'Audit row must have user_id');
  }
  
  const testIntegrity = (tDb.prepare('PRAGMA integrity_check').get() as any).integrity_check;
  const testFk = tDb.prepare('PRAGMA foreign_key_check').all().length;
  tDb.close();

  assert.equal(testIntegrity, 'ok', 'Test DB integrity must be ok');
  assert.equal(testFk, 0, 'Test DB foreign key check must have 0 errors');
  console.log('✓ Test J Passed: Test DB audit logs verified and PRAGMA checks clean.\n');

  // -------------------------------------------------------------------------
  // 6. Post-Test Production Database Safety Verification
  // -------------------------------------------------------------------------
  console.log('--- 6. Final Production Database Safety Verification ---');
  const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodUsersPost = prodDbPost.prepare('SELECT COUNT(*) c FROM users').get() as { c: number };
  const prodSitesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM sites').get() as { c: number };
  const prodRolesPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as { c: number };
  const prodCatsPost = prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as { c: number };
  const prodAttPost = prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as { c: number };
  const prodFinPost = prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as { c: number };
  const prodAuditPost = prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as { c: number };
  const prodLfcPost = prodDbPost.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as { c: number };
  const prodIntegPost = (prodDbPost.prepare('PRAGMA integrity_check').get() as any).integrity_check;
  const prodFkPost = prodDbPost.prepare('PRAGMA foreign_key_check').all().length;
  prodDbPost.close();

  assert.equal(prodUsersPost.c, 4, 'Prod users must remain 4');
  assert.equal(prodSitesPost.c, 6, 'Prod sites must remain 6');
  assert.equal(prodCatsPost.c, 4, 'Prod work_categories must remain 4');
  assert.equal(prodRolesPost.c, 23, 'Prod work_roles must remain 23');
  assert.equal(prodAttPost.c, 18, 'Prod attendance must remain 18');
  assert.equal(prodFinPost.c, 4, 'Prod finance must remain exactly 4');
  assert.equal(prodAuditPost.c, 429, 'Prod audit logs must remain exactly 429');
  assert.equal(prodLfcPost.c, 0, 'Prod lifecycle must remain 0');
  assert.equal(prodIntegPost, 'ok', 'Prod integrity must remain ok');
  assert.equal(prodFkPost, 0, 'Prod FK check must remain 0 errors');
  console.log('✓ Final production database verification: 100% UNTOUCHED (audit_logs: 429, finance: 4, integrity: ok)\n');

  console.log('================================================================');
  console.log('ALL STEP 0 SECURITY REGRESSION TESTS PASSED COMPLETELY!');
  console.log('================================================================');
}

runStep0QASuite().catch((err) => {
  console.error('FATAL TEST FAILURE:', err);
  process.exit(1);
});
