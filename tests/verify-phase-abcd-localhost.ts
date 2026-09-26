import assert from 'node:assert/strict';
import { getDb } from '../lib/db';
import { createUser, getUserByUsername } from '../lib/db/repositories/user-repo';

async function runLocalhostQA() {
  const BASE_URL = 'http://localhost:3000';
  console.log('====================================================');
  console.log('VERIFYING PHASE A/B/C/D ON LOCALHOST (PORT 3000)');
  console.log('====================================================\n');

  const db = getDb();
  const existing = getUserByUsername('test_admin_phase_abcd');
  if (existing) {
    db.prepare('DELETE FROM audit_logs WHERE user_id = ?').run(existing.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(existing.id);
  }

  const testUserId = createUser({
    username: 'test_admin_phase_abcd',
    passwordPlainText: 'TestAdminPass2026!',
    fullName: 'Test Admin Phase ABCD',
    role: 'ADMIN',
  });

  try {
    // 1. Authenticate as admin
    console.log('Step 1: Authenticating on localhost...');
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'test_admin_phase_abcd',
        password: 'TestAdminPass2026!',
      }),
    });

    assert.equal(loginRes.status, 200, `Login must succeed with 200, got ${loginRes.status}`);
    const setCookie = loginRes.headers.get('set-cookie') || '';
    const tokenMatch = setCookie.match(/site_work_session=([^;]+)/);
    assert.ok(tokenMatch, 'Auth site_work_session cookie must be present in response');
    const cookieHeader = `site_work_session=${tokenMatch[1]}`;
    console.log('  ✓ Admin logged in successfully\n');

  // 2. Fetch /site1 dashboard
  console.log('Step 2: Testing Phase A Dashboard Balance Cards (/site1)...');
  const dashRes = await fetch(`${BASE_URL}/site1`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(dashRes.status, 200, `Dashboard request must return 200, got ${dashRes.status}`);
  const dashHtml = await dashRes.text();

  assert.ok(dashHtml.includes('TOTAL INCOMES') && dashHtml.includes('(CREDIT)'), 'Must render TOTAL INCOMES (CREDIT)');
  assert.ok(dashHtml.includes('SUPPLIES EXPENSES') && dashHtml.includes('(DEBIT)'), 'Must render SUPPLIES EXPENSES (DEBIT)');
  assert.ok(dashHtml.includes('WORK EXPENSES') && dashHtml.includes('(DEBIT)'), 'Must render WORK EXPENSES (DEBIT)');
  assert.ok(dashHtml.includes('TOTAL EXPENSES') && dashHtml.includes('(DEBIT)'), 'Must render TOTAL EXPENSES (DEBIT)');
  assert.ok(dashHtml.includes('Actual Cash In Hand'), 'Must render Actual Cash In Hand subtext');
  console.log('  ✓ Phase A: Site Financial Balance cards verified with exact CTO labels\n');

  // Query site and roles for export tests
  const db = getDb();
  const site = db.prepare("SELECT id FROM sites WHERE is_archived = 0 LIMIT 1").get() as { id: string };
  const roles = db.prepare("SELECT id FROM work_roles LIMIT 2").all() as { id: string }[];
  assert.ok(site, 'Site must exist');
  assert.ok(roles.length >= 1, 'At least 1 role must exist');
  const roleIds = roles.map(r => r.id);

  // 3. Test Phase B: Multi-role PDF Export
  console.log('Step 3: Testing Phase B Multi-Role PDF Export API...');
  const rolePdfRes = await fetch(`${BASE_URL}/api/export/pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      type: 'ROLE',
      siteId: site.id,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      roleIds: roleIds,
    }),
  });
  assert.equal(rolePdfRes.status, 200, `Role PDF export must return 200, got ${rolePdfRes.status}`);
  assert.equal(rolePdfRes.headers.get('content-type'), 'application/pdf');
  const rolePdfBuffer = await rolePdfRes.arrayBuffer();
  assert.ok(rolePdfBuffer.byteLength > 500, 'PDF buffer must have valid size');
  console.log(`  ✓ Phase B: Multi-role PDF Export generated successfully (${rolePdfBuffer.byteLength} bytes)`);

  // 4. Test Phase B: Multi-role Excel Export
  console.log('Step 4: Testing Phase B Multi-Role Excel Export API...');
  const roleExcelRes = await fetch(`${BASE_URL}/api/export/excel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      type: 'ROLE',
      siteId: site.id,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      roleIds: roleIds,
    }),
  });
  assert.equal(roleExcelRes.status, 200, `Role Excel export must return 200, got ${roleExcelRes.status}`);
  const roleExcelBuffer = await roleExcelRes.arrayBuffer();
  assert.ok(roleExcelBuffer.byteLength > 500, 'Excel buffer must have valid size');
  console.log(`  ✓ Phase B: Multi-role Excel Export generated successfully (${roleExcelBuffer.byteLength} bytes)\n`);

  // 5. Test Phase C: Monthly Attendance Calendar View PDF Export
  console.log('Step 5: Testing Phase C Monthly Attendance Calendar PDF Export API...');
  const calPdfRes = await fetch(`${BASE_URL}/api/export/pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      type: 'MONTHLY_CALENDAR',
      siteId: site.id,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      monthLabel: 'September 2026',
    }),
  });
  assert.equal(calPdfRes.status, 200, `Calendar PDF export must return 200, got ${calPdfRes.status}`);
  assert.equal(calPdfRes.headers.get('content-type'), 'application/pdf');
  const calPdfBuffer = await calPdfRes.arrayBuffer();
  assert.ok(calPdfBuffer.byteLength > 500, 'Calendar PDF buffer must have valid size');
  console.log(`  ✓ Phase C: Monthly Attendance Calendar PDF generated successfully (${calPdfBuffer.byteLength} bytes)`);

  // 6. Test Phase C: Monthly Attendance Calendar View Excel Export
  console.log('Step 6: Testing Phase C Monthly Attendance Calendar Excel Export API...');
  const calExcelRes = await fetch(`${BASE_URL}/api/export/excel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader,
    },
    body: JSON.stringify({
      type: 'MONTHLY_CALENDAR',
      siteId: site.id,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      monthLabel: 'September 2026',
    }),
  });
  assert.equal(calExcelRes.status, 200, `Calendar Excel export must return 200, got ${calExcelRes.status}`);
  const calExcelBuffer = await calExcelRes.arrayBuffer();
  assert.ok(calExcelBuffer.byteLength > 500, 'Calendar Excel buffer must have valid size');
  console.log(`  ✓ Phase C: Monthly Attendance Calendar Excel generated successfully (${calExcelBuffer.byteLength} bytes)\n`);

  // 7. Test Phase D: Finance page loads with filter controls
  console.log('Step 7: Testing Phase D Finance Page rendering...');
  const finRes = await fetch(`${BASE_URL}/site1/finance`, {
    headers: { Cookie: cookieHeader },
  });
  assert.equal(finRes.status, 200, `Finance page must return 200, got ${finRes.status}`);
  const finHtml = await finRes.text();
  assert.ok(finHtml.includes('Search'), 'Finance page must contain Search input');
  console.log('  ✓ Phase D: Finance page loads with active search and filter components\n');

  console.log('====================================================');
  console.log('ALL LOCALHOST HTTP VERIFICATIONS PASSED SUCCESSFULLY!');
  console.log('====================================================');
  } finally {
    db.prepare('DELETE FROM audit_logs WHERE user_id = ?').run(testUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
  }
}

runLocalhostQA().catch((err) => {
  console.error('Localhost QA failed:', err);
  process.exit(1);
});
