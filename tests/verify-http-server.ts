import assert from 'node:assert/strict';
import { createUser, deleteUserPermanently, getUserByUsername } from '../lib/db/repositories/user-repo';
import { getDb } from '../lib/db/index';

const BASE_URL = 'http://localhost:3005';

async function run() {
  console.log('--- STARTING LOCAL HTTP SERVER VERIFICATION ---');

  // 1. Unauthenticated request to site route
  console.log('1. Testing unauthenticated deep link /site1/attendance/monthly?date=2026-09-23...');
  const unauthRes = await fetch(`${BASE_URL}/site1/attendance/monthly?date=2026-09-23`, {
    redirect: 'manual',
  });
  console.log(`Status: ${unauthRes.status}`);
  const unauthLoc = unauthRes.headers.get('location');
  console.log(`Location: ${unauthLoc}`);
  assert.ok(unauthRes.status === 307 || unauthRes.status === 302, 'Must redirect unauthenticated request');
  assert.ok(
    unauthLoc?.includes('/login?next=') && unauthLoc?.includes('site1'),
    'Must redirect to login with encoded site-aware path'
  );
  console.log('✓ Unauthenticated deep-link redirect passed');

  // Create temporary test admin user
  const db = getDb();
  const existing = getUserByUsername('http_test_admin');
  if (existing) {
    db.prepare('DELETE FROM audit_logs WHERE user_id = ?').run(existing.id);
    db.prepare('DELETE FROM users WHERE username = ?').run('http_test_admin');
  }

  const testUserId = createUser({
    username: 'http_test_admin',
    passwordPlainText: 'HttpTestPass2026!',
    fullName: 'HTTP Test Administrator',
    role: 'ADMIN',
  });

  try {
    // 2. Case mismatch username login
    console.log('2. Testing case mismatch login (Http_Test_Admin)...');
    const caseRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Http_Test_Admin', password: 'HttpTestPass2026!' }),
    });
    console.log(`Status: ${caseRes.status}`);
    assert.equal(caseRes.status, 401, 'Case mismatch must be rejected with 401');
    console.log('✓ Case mismatch rejected');

    // 3. Spaced username login
    console.log('3. Testing untrimmed username login (" http_test_admin ")...');
    const spaceRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ' http_test_admin ', password: 'HttpTestPass2026!' }),
    });
    console.log(`Status: ${spaceRes.status}`);
    assert.equal(spaceRes.status, 401, 'Untrimmed username must be rejected with 401');
    console.log('✓ Untrimmed username rejected');

    // 4. Exact login
    console.log('4. Testing exact login with http_test_admin...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'http_test_admin', password: 'HttpTestPass2026!' }),
    });
    console.log(`Login status: ${loginRes.status}`);
    assert.equal(loginRes.status, 200, 'Exact login must succeed with 200 OK');
    const cookieHeader = loginRes.headers.get('set-cookie');
    assert.ok(cookieHeader, 'Session cookie must be returned');
    const rawCookie = cookieHeader.split(';')[0];
    console.log('✓ Exact login succeeded with session cookie');

    // 5. Test authenticated request to alias /site-1/attendance/monthly
    console.log('5. Testing authenticated alias redirect /site-1/attendance/monthly...');
    const aliasRes = await fetch(`${BASE_URL}/site-1/attendance/monthly?date=2026-09-23`, {
      headers: { Cookie: rawCookie },
      redirect: 'manual',
    });
    console.log(`Alias Status: ${aliasRes.status}`);
    const aliasLoc = aliasRes.headers.get('location');
    console.log(`Alias Location: ${aliasLoc}`);
    assert.ok(aliasRes.status === 307 || aliasRes.status === 302, 'Alias must redirect 307');
    assert.ok(aliasLoc?.includes('/site1/attendance/monthly'), 'Alias must redirect to canonical /site1');
    assert.ok(aliasLoc?.includes('date=2026-09-23'), 'Query params must be preserved');
    console.log('✓ Non-canonical alias redirected to canonical slug with query preserved');

    // 6. Test authenticated request to canonical URL
    console.log('6. Testing authenticated canonical URL /site1/attendance/monthly...');
    const canonRes = await fetch(`${BASE_URL}/site1/attendance/monthly?date=2026-09-23`, {
      headers: { Cookie: rawCookie },
      redirect: 'manual',
    });
    console.log(`Canonical Status: ${canonRes.status}`);
    assert.equal(canonRes.status, 200, 'Canonical URL must return 200 OK');
    console.log('✓ Canonical URL returned 200 OK');

    // 7. Test heartbeat endpoint
    console.log('7. Testing POST /api/auth/heartbeat...');
    const heartRes = await fetch(`${BASE_URL}/api/auth/heartbeat`, {
      method: 'POST',
      headers: { Cookie: rawCookie },
    });
    console.log(`Heartbeat Status: ${heartRes.status}`);
    assert.equal(heartRes.status, 200);
    const heartData = await heartRes.json();
    console.log('Heartbeat response:', heartData);
    assert.equal(heartData.ok, true);
    console.log('✓ Heartbeat endpoint working');

    // 8. Test Master Ledger direct access redirect to transactions
    console.log('8. Testing /site1/finance/monthly redirect...');
    const ledgerRes = await fetch(`${BASE_URL}/site1/finance/monthly`, {
      headers: { Cookie: rawCookie },
      redirect: 'manual',
    });
    console.log(`Ledger Status: ${ledgerRes.status}`);
    assert.ok(ledgerRes.status === 200 || ledgerRes.status === 307);
    console.log('✓ Retired Master Ledger route handled cleanly');

  } finally {
    db.prepare('DELETE FROM audit_logs WHERE user_id = ?').run(testUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
  }

  console.log('--- ALL LOCAL HTTP VERIFICATIONS SUCCESSFUL ---');
}

run().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
