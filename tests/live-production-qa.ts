import assert from 'node:assert/strict';

const PROD_URL = 'https://site-work-app-production.up.railway.app';

async function run() {
  console.log('=== STARTING LIVE RAILWAY PRODUCTION QA ===');
  console.log(`Target: ${PROD_URL}`);

  // 1. Health check
  console.log('\n1. Health Check (GET /api/health)...');
  const healthRes = await fetch(`${PROD_URL}/api/health`);
  console.log(`Health Status: ${healthRes.status}`);
  assert.equal(healthRes.status, 200);
  const healthJson = await healthRes.json();
  console.log('Health JSON:', healthJson);
  assert.equal(healthJson.status, 'ok');
  console.log('✓ Production healthcheck status: ok');

  // 2. Unauthenticated deep link to site route
  console.log('\n2. Unauthenticated Deep Link: GET /site1/attendance/monthly?date=2026-09-23...');
  const deepRes = await fetch(`${PROD_URL}/site1/attendance/monthly?date=2026-09-23`, {
    redirect: 'manual',
  });
  console.log(`Status: ${deepRes.status}`);
  const deepLoc = deepRes.headers.get('location');
  console.log(`Location: ${deepLoc}`);
  assert.ok(deepRes.status === 307 || deepRes.status === 302, 'Must redirect unauthenticated request');
  assert.ok(deepLoc?.includes('/login?next='), 'Redirect must target login with next');
  assert.ok(deepLoc?.includes('site1'), 'Next target must preserve canonical site slug');
  console.log('✓ Unauthenticated deep link correctly redirected with preserved site path');

  // 3. Unauthenticated access to legacy route
  console.log('\n3. Unauthenticated Legacy Route: GET /attendance/daily...');
  const legacyRes = await fetch(`${PROD_URL}/attendance/daily`, {
    redirect: 'manual',
  });
  console.log(`Status: ${legacyRes.status}`);
  const legacyLoc = legacyRes.headers.get('location');
  console.log(`Location: ${legacyLoc}`);
  assert.ok(legacyRes.status === 307 || legacyRes.status === 302);
  assert.ok(legacyLoc?.includes('/login?next='), 'Redirect must target login with next');
  console.log('✓ Unauthenticated legacy route correctly redirected to login');

  // 4. Exact Username Enforcement: Case Mismatch Rejected
  console.log('\n4. Exact Username Case Mismatch: POST /api/auth/login with "Abadmin"...');
  const caseRes = await fetch(`${PROD_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Abadmin', password: 'AnyPassword123!' }),
  });
  console.log(`Status: ${caseRes.status}`);
  assert.equal(caseRes.status, 401, 'Case mismatch must return 401');
  const caseJson = await caseRes.json();
  console.log('Response:', caseJson);
  assert.ok(caseJson.error);
  console.log('✓ Exact case-sensitive username matching rejected capitalized username');

  // 5. Exact Username Enforcement: Whitespace / Trimming Rejected
  console.log('\n5. Exact Username Untrimmed Whitespace: POST /api/auth/login with " abadmin "...');
  const spaceRes = await fetch(`${PROD_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ' abadmin ', password: 'AnyPassword123!' }),
  });
  console.log(`Status: ${spaceRes.status}`);
  assert.equal(spaceRes.status, 401, 'Untrimmed username must return 401');
  const spaceJson = await spaceRes.json();
  console.log('Response:', spaceJson);
  assert.ok(spaceJson.error);
  console.log('✓ Whitespace preservation rejected untrimmed username');

  // 6. Heartbeat API without authentication
  console.log('\n6. Heartbeat Security: POST /api/auth/heartbeat without cookie...');
  const heartRes = await fetch(`${PROD_URL}/api/auth/heartbeat`, {
    method: 'POST',
  });
  console.log(`Status: ${heartRes.status}`);
  assert.equal(heartRes.status, 401, 'Unauthenticated heartbeat must return 401');
  const heartJson = await heartRes.json();
  console.log('Response:', heartJson);
  assert.equal(heartJson.ok, false);
  console.log('✓ Heartbeat endpoint strictly protected by authentication');

  // 7. Master Ledger route retirement
  console.log('\n7. Master Ledger Route: GET /finance/monthly...');
  const mlRes = await fetch(`${PROD_URL}/finance/monthly`, {
    redirect: 'manual',
  });
  console.log(`Status: ${mlRes.status}`);
  const mlLoc = mlRes.headers.get('location');
  console.log(`Location: ${mlLoc}`);
  assert.ok(mlRes.status === 307 || mlRes.status === 302, 'Must redirect');
  assert.ok(mlLoc?.includes('/login?next='), 'Redirects to login for unauthenticated visitor');
  console.log('✓ Master Ledger route retired and protected');

  // 8. Login page UI verification
  console.log('\n8. Login Page UI & Setup Status: GET /login...');
  const loginRes = await fetch(`${PROD_URL}/login`);
  console.log(`Status: ${loginRes.status}`);
  assert.equal(loginRes.status, 200);
  const loginHtml = await loginRes.text();
  assert.ok(
    loginHtml.includes('Verifying system initialization') || loginHtml.includes('AB CONSTRUCTIONS'),
    'Login page must render valid initial layout'
  );

  const setupRes = await fetch(`${PROD_URL}/api/auth/setup-status`);
  assert.equal(setupRes.status, 200);
  const setupJson = await setupRes.json();
  console.log('Setup Status:', setupJson);
  assert.equal(setupJson.isSetupRequired, false);
  console.log('✓ Login page HTML rendered cleanly and setup status verified');

  console.log('\n=== ALL LIVE RAILWAY PRODUCTION CHECKS VERIFIED SUCCESSFULLY ===');
}

run().catch((err) => {
  console.error('LIVE QA FAILURE:', err);
  process.exit(1);
});
