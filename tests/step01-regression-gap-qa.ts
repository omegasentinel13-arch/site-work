import http from 'http';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { DatabaseSync } from 'node:sqlite';

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

export async function runStep01RegressionSuite() {
  console.log('================================================================');
  console.log('SITE WORK — STEP 0.1 FINAL REGRESSION GAP VERIFICATION');
  console.log('Target: http://localhost:3001 (Isolated Test DB)');
  console.log('================================================================\n');

  // 1. Production Database Pre-Check
  console.log('--- 1. Production Database Pre-Check ---');
  const prodDb = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodBaseline = {
    users: (prodDb.prepare('SELECT COUNT(*) c FROM users').get() as any).c,
    sites: (prodDb.prepare('SELECT COUNT(*) c FROM sites').get() as any).c,
    categories: (prodDb.prepare('SELECT COUNT(*) c FROM work_categories').get() as any).c,
    roles: (prodDb.prepare('SELECT COUNT(*) c FROM work_roles').get() as any).c,
    attendance: (prodDb.prepare('SELECT COUNT(*) c FROM attendance_records').get() as any).c,
    transactions: (prodDb.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as any).c,
    audit_logs: (prodDb.prepare('SELECT COUNT(*) c FROM audit_logs').get() as any).c,
    lifecycle: (prodDb.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as any).c,
    integrity: (prodDb.prepare('PRAGMA integrity_check').get() as any).integrity_check,
    fk_errors: prodDb.prepare('PRAGMA foreign_key_check').all().length,
  };
  prodDb.close();

  console.log('Production Pre-Check Baseline:', JSON.stringify(prodBaseline, null, 2));
  assert.equal(prodBaseline.users, 4);
  assert.equal(prodBaseline.sites, 6);
  assert.equal(prodBaseline.categories, 4);
  assert.equal(prodBaseline.roles, 23);
  assert.equal(prodBaseline.attendance, 18);
  assert.equal(prodBaseline.transactions, 4);
  assert.equal(prodBaseline.audit_logs, 429);
  assert.equal(prodBaseline.lifecycle, 0);
  assert.equal(prodBaseline.integrity, 'ok');
  assert.equal(prodBaseline.fk_errors, 0);
  console.log('✓ Production database pre-check passed.\n');

  // 2. Setup Test Fixtures in data/test_site_work.db
  console.log('--- 2. Setting Up Disposable Test Fixtures in Test DB ---');
  const testDb = new DatabaseSync('data/test_site_work.db');
  
  // Clean up any prior step01 test transactions if present
  testDb.prepare("DELETE FROM financial_transactions WHERE id LIKE 'tx-step01-%'").run();

  // Test 1 fixture: disposable Site 1 transaction
  testDb.prepare(`
    INSERT INTO financial_transactions (
      id, site_id, date, type, debit_category, amount_paise, description, reference_note, created_by, updated_by, created_at, updated_at
    ) VALUES (
      'tx-step01-put-s1', 'site-1', '2026-09-02', 'CREDIT', NULL, 1200000, 'Original Description Before Edit', 'ORIG-REF-01', 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', datetime('now'), datetime('now')
    )
  `).run();

  // Test 2 fixture: disposable Site 1 transaction
  testDb.prepare(`
    INSERT INTO financial_transactions (
      id, site_id, date, type, debit_category, amount_paise, description, reference_note, created_by, updated_by, created_at, updated_at
    ) VALUES (
      'tx-step01-del-s1', 'site-1', '2026-09-02', 'DEBIT', 'SUPPLIES', 750000, 'Disposable Tx To Delete', 'ORIG-REF-02', 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', datetime('now'), datetime('now')
    )
  `).run();

  testDb.close();
  console.log('✓ Inserted tx-step01-put-s1 and tx-step01-del-s1 into test DB.\n');

  // 3. Generate Engineer 1 Auth Token (assigned to site-1)
  console.log('--- 3. Generating Engineer 1 Auth Token (Assigned to Site 1) ---');
  const eng1Token = await makeToken({
    userId: 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0',
    username: 'engineer1',
    fullName: 'Live Site Engineer',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
    tokenVersion: 6,
  });
  console.log('✓ Token generated for Engineer 1.\n');

  // =========================================================================
  // TEST 1 — ENGINEER OWN-SITE PUT WITHOUT siteId
  // =========================================================================
  console.log('--- TEST 1 — ENGINEER OWN-SITE PUT WITHOUT siteId ---');
  console.log('Target: PUT /api/finance/tx-step01-put-s1 WITHOUT body.siteId');
  const putPayload = {
    // NOTE: body.siteId is explicitly OMITTED
    date: '2026-09-02',
    type: 'CREDIT',
    amountPaise: 1850000,
    description: 'Updated Description Without siteId In Body',
    referenceNote: 'NEW-REF-NO-SITEID',
  };

  const res1 = await apiRequest('/api/finance/tx-step01-put-s1', 'PUT', eng1Token, putPayload);
  console.log('  -> Status:', res1.status, '| Response Body:', JSON.stringify(res1.body));
  assert.equal(res1.status, 200, 'Test 1 must return HTTP 200');
  assert.equal(res1.body.success, true, 'Response body must have success: true');

  // Verify DB state for Test 1
  const testDbVerify1 = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const tx1After = testDbVerify1.prepare('SELECT * FROM financial_transactions WHERE id = ?').get('tx-step01-put-s1') as any;
  testDbVerify1.close();

  assert.ok(tx1After, 'Transaction must exist in DB');
  assert.equal(tx1After.site_id, 'site-1', 'Transaction site_id must remain site-1 (no site transfer)');
  assert.equal(tx1After.amount_paise, 1850000, 'Amount must be updated to 1850000');
  assert.equal(tx1After.description, 'Updated Description Without siteId In Body', 'Description must be updated');
  assert.equal(tx1After.reference_note, 'NEW-REF-NO-SITEID', 'Reference note must be updated');
  console.log('  -> Persisted State: site_id=' + tx1After.site_id + ', amount_paise=' + tx1After.amount_paise + ', desc=' + tx1After.description);

  // Verify Audit Log for Test 1
  const testDbAudit1 = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const audit1 = testDbAudit1.prepare(`
    SELECT * FROM audit_logs 
    WHERE entity_type = 'FINANCE' AND entity_id = 'tx-step01-put-s1' AND action = 'UPDATE'
    ORDER BY created_at DESC LIMIT 1
  `).get() as any;
  testDbAudit1.close();

  assert.ok(audit1, 'Audit log entry must exist for Test 1 update');
  assert.equal(audit1.site_id, 'site-1', 'Audit log must record actual persisted site_id = site-1');
  assert.equal(audit1.user_id, 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', 'Audit log must record Engineer 1 user_id');
  console.log('  -> Audit Entry: id=' + audit1.id + ', site_id=' + audit1.site_id + ', action=' + audit1.action);
  console.log('✓ TEST 1 PASSED COMPLETELY.\n');

  // =========================================================================
  // TEST 2 — ENGINEER OWN-SITE DELETE WITH CORRECT siteId
  // =========================================================================
  console.log('--- TEST 2 — ENGINEER OWN-SITE DELETE WITH CORRECT siteId ---');
  console.log('Target: DELETE /api/finance/tx-step01-del-s1?siteId=site-1');

  const res2 = await apiRequest('/api/finance/tx-step01-del-s1?siteId=site-1', 'DELETE', eng1Token);
  console.log('  -> Status:', res2.status, '| Response Body:', JSON.stringify(res2.body));
  assert.equal(res2.status, 200, 'Test 2 must return HTTP 200');
  assert.equal(res2.body.success, true, 'Response body must have success: true');

  // Verify DB state for Test 2
  const testDbVerify2 = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const tx2After = testDbVerify2.prepare('SELECT * FROM financial_transactions WHERE id = ?').get('tx-step01-del-s1');
  testDbVerify2.close();

  assert.equal(tx2After, undefined, 'Transaction must be deleted from SQLite');
  console.log('  -> Persisted State: Transaction tx-step01-del-s1 is confirmed deleted (undefined)');

  // Verify Audit Log for Test 2
  const testDbAudit2 = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const audit2 = testDbAudit2.prepare(`
    SELECT * FROM audit_logs 
    WHERE entity_type = 'FINANCE' AND entity_id = 'tx-step01-del-s1' AND action = 'DELETE'
    ORDER BY created_at DESC LIMIT 1
  `).get() as any;
  testDbAudit2.close();

  assert.ok(audit2, 'Audit log entry must exist for Test 2 delete');
  assert.equal(audit2.site_id, 'site-1', 'Audit log must record actual persisted site_id = site-1');
  assert.equal(audit2.user_id, 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0', 'Audit log must record Engineer 1 user_id');
  console.log('  -> Audit Entry: id=' + audit2.id + ', site_id=' + audit2.site_id + ', action=' + audit2.action);
  console.log('✓ TEST 2 PASSED COMPLETELY.\n');

  // =========================================================================
  // INTEGRITY AND SAFETY VERIFICATIONS
  // =========================================================================
  console.log('--- 4. Test Database Integrity & Foreign Key Checks ---');
  const testDbFinal = new DatabaseSync('data/test_site_work.db', { readOnly: true });
  const testInteg = (testDbFinal.prepare('PRAGMA integrity_check').get() as any).integrity_check;
  const testFk = testDbFinal.prepare('PRAGMA foreign_key_check').all().length;
  testDbFinal.close();
  assert.equal(testInteg, 'ok', 'Test DB integrity must be ok');
  assert.equal(testFk, 0, 'Test DB foreign keys must be 0 errors');
  console.log('✓ Test DB PRAGMA checks: integrity=' + testInteg + ', foreign_key_errors=' + testFk + '\n');

  console.log('--- 5. Production Database Post-Check ---');
  const prodDbPost = new DatabaseSync('data/site_work.db', { readOnly: true });
  const prodPost = {
    users: (prodDbPost.prepare('SELECT COUNT(*) c FROM users').get() as any).c,
    sites: (prodDbPost.prepare('SELECT COUNT(*) c FROM sites').get() as any).c,
    categories: (prodDbPost.prepare('SELECT COUNT(*) c FROM work_categories').get() as any).c,
    roles: (prodDbPost.prepare('SELECT COUNT(*) c FROM work_roles').get() as any).c,
    attendance: (prodDbPost.prepare('SELECT COUNT(*) c FROM attendance_records').get() as any).c,
    transactions: (prodDbPost.prepare('SELECT COUNT(*) c FROM financial_transactions').get() as any).c,
    audit_logs: (prodDbPost.prepare('SELECT COUNT(*) c FROM audit_logs').get() as any).c,
    lifecycle: (prodDbPost.prepare('SELECT COUNT(*) c FROM system_lifecycle_records').get() as any).c,
    integrity: (prodDbPost.prepare('PRAGMA integrity_check').get() as any).integrity_check,
    fk_errors: prodDbPost.prepare('PRAGMA foreign_key_check').all().length,
  };
  prodDbPost.close();

  console.log('Production Post-Check Baseline:', JSON.stringify(prodPost, null, 2));
  assert.equal(prodPost.users, 4);
  assert.equal(prodPost.sites, 6);
  assert.equal(prodPost.categories, 4);
  assert.equal(prodPost.roles, 23);
  assert.equal(prodPost.attendance, 18);
  assert.equal(prodPost.transactions, 4);
  assert.equal(prodPost.audit_logs, 429);
  assert.equal(prodPost.lifecycle, 0);
  assert.equal(prodPost.integrity, 'ok');
  assert.equal(prodPost.fk_errors, 0);
  console.log('✓ Production database remains 100% UNTOUCHED and pristine.\n');

  console.log('================================================================');
  console.log('STEP 0.1 REGRESSION GAP VERIFICATION PASSED COMPLETELY!');
  console.log('================================================================');
}

runStep01RegressionSuite().catch((err) => {
  console.error('FATAL TEST FAILURE:', err);
  process.exit(1);
});
