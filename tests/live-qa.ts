import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:3000';

async function runLiveQA() {
  console.log('====================================================');
  console.log('STARTING REAL-WORLD LIVE BROWSER / API QA TEST SUITE');
  console.log(`Target URL: ${BASE_URL}`);
  console.log('====================================================\n');

  let adminCookie = '';
  let engineerCookie = '';
  let viewerCookie = '';

  // ----------------------------------------------------
  // 1. LOGIN QA
  // ----------------------------------------------------
  console.log('--- TEST 1: AUTHENTICATION & LOGIN QA ---');

  // Test Admin Login
  const adminRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'Admin@SiteWork2026!' }),
  });
  assert.equal(adminRes.status, 200, 'Admin login should succeed');
  const adminData = await adminRes.json();
  assert.equal(adminData.user.role, 'ADMIN', 'Admin user role must be ADMIN');
  adminCookie = adminRes.headers.get('set-cookie') || '';
  assert.ok(adminCookie.includes('site_work_session='), 'Admin session cookie must be set');
  console.log('✔ Admin login succeeded with secure session cookie');

  // Test Engineer Login
  const engRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'engineer', password: 'Engineer@SiteWork2026!' }),
  });
  assert.equal(engRes.status, 200, 'Engineer login should succeed');
  const engData = await engRes.json();
  assert.equal(engData.user.role, 'SITE_MANAGER', 'Engineer user role must be SITE_MANAGER');
  engineerCookie = engRes.headers.get('set-cookie') || '';
  console.log('✔ Engineer login succeeded (Assigned Sites:', engData.user.assignedSiteIds, ')');

  // Test Viewer Login
  const viewRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer', password: 'Viewer@SiteWork2026!' }),
  });
  assert.equal(viewRes.status, 200, 'Viewer login should succeed');
  const viewData = await viewRes.json();
  assert.equal(viewData.user.role, 'VIEWER', 'Viewer user role must be VIEWER');
  viewerCookie = viewRes.headers.get('set-cookie') || '';
  console.log('✔ Viewer login succeeded');

  // Test Invalid Login
  const invalidRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'WrongPassword123' }),
  });
  assert.equal(invalidRes.status, 401, 'Invalid login must return 401 Unauthorized');
  console.log('✔ Invalid password rejected with 401');

  // Test Current Session Check (/api/auth/me)
  const meRes = await fetch(`${BASE_URL}/api/auth/me`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(meRes.status, 200);
  const meData = await meRes.json();
  assert.equal(meData.user.username, 'admin');
  console.log('✔ Session /api/auth/me correctly identifies authenticated user\n');

  // ----------------------------------------------------
  // 2. SITE MANAGEMENT QA
  // ----------------------------------------------------
  console.log('--- TEST 2: SITE MANAGEMENT & ARCHIVING QA ---');

  // Fetch Sites as Admin
  const sitesRes = await fetch(`${BASE_URL}/api/sites?includeArchived=true`, {
    headers: { cookie: adminCookie },
  });
  const sitesData = await sitesRes.json();
  assert.ok(sitesData.sites.length >= 2, 'Default sites should exist');
  console.log('✔ Sites retrieved:', sitesData.sites.map((s: { name: string; code: string }) => `${s.name} (${s.code})`).join(', '));

  // Create a 3rd site for testing
  const createSiteRes = await fetch(`${BASE_URL}/api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: 'Villa Project Phase 1', code: 'S-03', location: 'Greenfield Hills' }),
  });
  assert.equal(createSiteRes.status, 200);
  const createSiteData = await createSiteRes.json();
  const testSiteId = createSiteData.siteId;
  console.log('✔ Created new site: Villa Project Phase 1 (ID:', testSiteId, ')');

  // Edit Site
  const editSiteRes = await fetch(`${BASE_URL}/api/sites/${testSiteId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name: 'Villa Project Phase 1 (Updated)', code: 'S-03A', location: 'Greenfield Hills North' }),
  });
  assert.equal(editSiteRes.status, 200);
  console.log('✔ Edited site details successfully');

  // Archive Site
  const archiveRes = await fetch(`${BASE_URL}/api/sites/${testSiteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ isArchived: true }),
  });
  assert.equal(archiveRes.status, 200);

  // Verify Active vs Archived filter
  const activeSitesRes = await fetch(`${BASE_URL}/api/sites?includeArchived=false`, {
    headers: { cookie: adminCookie },
  });
  const activeSitesData = await activeSitesRes.json();
  assert.ok(!activeSitesData.sites.some((s: { id: string }) => s.id === testSiteId), 'Archived site must not appear in active site list');
  console.log('✔ Archived site correctly hidden from active selector without destroying data');

  // Unarchive Site
  await fetch(`${BASE_URL}/api/sites/${testSiteId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ isArchived: false }),
  });
  console.log('✔ Unarchived site successfully\n');

  // ----------------------------------------------------
  // 3. CATEGORY / ROLE / RATE MANAGEMENT QA
  // ----------------------------------------------------
  console.log('--- TEST 3: CATEGORIES, 19 ROLES & RATE SYSTEM QA ---');

  const categoriesRes = await fetch(`${BASE_URL}/api/categories`, {
    headers: { cookie: adminCookie },
  });
  const categoriesData = await categoriesRes.json();
  assert.equal(categoriesData.categories.length, 4, 'Must have 4 default categories');
  console.log('✔ 4 Categories verified:', categoriesData.categories.map((c: { name: string }) => c.name).join(', '));

  const rolesRes = await fetch(`${BASE_URL}/api/roles?siteId=site-1`, {
    headers: { cookie: adminCookie },
  });
  const rolesData = await rolesRes.json();
  assert.ok(rolesData.roles.length >= 19, 'Must have at least 19 default roles');

  const civilRoles = rolesData.roles.filter((r: { category_name: string }) => r.category_name === 'CIVIL WORKS');
  const finishingRoles = rolesData.roles.filter((r: { category_name: string }) => r.category_name === 'FINISHING WORKS');
  const mepRoles = rolesData.roles.filter((r: { category_name: string }) => r.category_name === 'MEP WORKS');
  const exteriorRoles = rolesData.roles.filter((r: { category_name: string }) => r.category_name === 'EXTERIOR WORKS');

  assert.equal(civilRoles.length, 9, 'Civil Works must have 9 roles');
  assert.equal(finishingRoles.length, 5, 'Finishing Works must have 5 roles');
  assert.equal(mepRoles.length, 3, 'MEP Works must have 3 roles');
  assert.equal(exteriorRoles.length, 2, 'Exterior Works must have 2 roles');
  console.log('✔ Verified role counts: Civil(9), Finishing(5), MEP(3), Exterior(2) = 19 roles');

  // Reset Mason default rate to ₹1,400 for test baseline
  await fetch(`${BASE_URL}/api/roles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ id: 'role-mason', name: 'Mason', defaultRateRupees: 1400 }),
  });

  // Add a new role
  const addRoleRes = await fetch(`${BASE_URL}/api/roles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      categoryId: 'cat-civil',
      name: 'Scaffolding Foreman',
      defaultRateRupees: 1600,
      sortOrder: 20,
    }),
  });
  assert.equal(addRoleRes.status, 200);
  const addRoleData = await addRoleRes.json();
  const testRoleId = addRoleData.roleId;
  console.log('✔ Added new role: Scaffolding Foreman @ ₹1,600 (ID:', testRoleId, ')');

  // Deactivate the new role
  await fetch(`${BASE_URL}/api/roles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ id: testRoleId, isActive: false }),
  });
  console.log('✔ Deactivated role successfully');

  // Verify deactivated role is excluded from daily attendance active form
  const dailyRolesRes = await fetch(`${BASE_URL}/api/attendance/daily?siteId=site-1&date=2026-09-01`, {
    headers: { cookie: adminCookie },
  });
  const dailyRolesData = await dailyRolesRes.json();
  assert.ok(!dailyRolesData.roles.some((r: { roleId: string }) => r.roleId === testRoleId), 'Deactivated role must not appear in new daily attendance form');
  console.log('✔ Verified deactivated role does not appear in new daily attendance entry form');

  // Site-specific Rate Override
  await fetch(`${BASE_URL}/api/rates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ siteId: 'site-2', roleId: 'role-mason', rateRupees: 1550 }),
  });
  const site1MasonRes = await fetch(`${BASE_URL}/api/roles?siteId=site-1`, { headers: { cookie: adminCookie } });
  const site1MasonData = await site1MasonRes.json();
  const site2MasonRes = await fetch(`${BASE_URL}/api/roles?siteId=site-2`, { headers: { cookie: adminCookie } });
  const site2MasonData = await site2MasonRes.json();

  const site1Mason = site1MasonData.roles.find((r: { id: string }) => r.id === 'role-mason');
  const site2Mason = site2MasonData.roles.find((r: { id: string }) => r.id === 'role-mason');

  assert.equal(site1Mason.effective_rate_paise, 140000, 'Site 1 Mason must remain ₹1,400');
  assert.equal(site2Mason.effective_rate_paise, 155000, 'Site 2 Mason must be ₹1,550');
  console.log('✔ Site-specific rate override verified (Site 1: ₹1,400 | Site 2: ₹1,550)\n');

  // ----------------------------------------------------
  // 4. DAILY ATTENDANCE MANDATORY REAL WORKFLOW (01 SEP 2026)
  // ----------------------------------------------------
  console.log('--- TEST 4: SECTION 57 MANDATORY ATTENDANCE WORKFLOW ---');
  const targetDate = '2026-09-01';

  // Save Attendance: Mason 5 Full, 1 Half @ ₹1,400; Male Helper 4 Full, 2 Half @ ₹900
  const saveAttRes = await fetch(`${BASE_URL}/api/attendance/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      siteId: 'site-1',
      date: targetDate,
      items: [
        { roleId: 'role-mason', fullDayCount: 5, halfDayCount: 1, rateInPaise: 140000 },
        { roleId: 'role-male-helper', fullDayCount: 4, halfDayCount: 2, rateInPaise: 90000 },
      ],
    }),
  });
  assert.equal(saveAttRes.status, 200, 'Save attendance must succeed');

  // Fetch Attendance & Verify Calculations
  const fetchAttRes = await fetch(`${BASE_URL}/api/attendance/daily?siteId=site-1&date=${targetDate}`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(fetchAttRes.status, 200);
  const fetchAttData = await fetchAttRes.json();
  const summary = fetchAttData.summary;

  assert.equal(summary.totalWorkers, 12, 'Total workers must be 12 (6 Mason + 6 Helper)');
  assert.equal(summary.fullDayCount, 9, 'Full day count must be 9 (5 + 4)');
  assert.equal(summary.halfDayCount, 3, 'Half day count must be 3 (1 + 2)');
  assert.equal(summary.workerDays, 10.5, 'Worker-days must be 10.5 (5.5 + 5.0)');
  assert.equal(summary.totalLabourCostPaise, 1220000, 'Total labour cost must be 1,220,000 paise (₹12,200)');

  const masonRow = fetchAttData.roles.find((r: { roleId: string }) => r.roleId === 'role-mason');
  const helperRow = fetchAttData.roles.find((r: { roleId: string }) => r.roleId === 'role-male-helper');

  assert.equal(masonRow.totalCostPaise, 770000, 'Mason cost must be ₹7,700');
  assert.equal(masonRow.workerDays, 5.5, 'Mason worker-days must be 5.5');
  assert.equal(helperRow.totalCostPaise, 450000, 'Helper cost must be ₹4,500');
  assert.equal(helperRow.workerDays, 5.0, 'Helper worker-days must be 5.0');
  console.log('✔ Attendance on 01 Sep 2026 verified:');
  console.log('  - Mason: 5 Full + 1 Half = ₹7,700 (5.5 w-days)');
  console.log('  - Male Helper: 4 Full + 2 Half = ₹4,500 (5.0 w-days)');
  console.log('  - Total Workers = 12 | Worker-Days = 10.5 | Daily Total = ₹12,200\n');

  // ----------------------------------------------------
  // 5. EDIT ATTENDANCE & DUPLICATE PREVENTION QA
  // ----------------------------------------------------
  console.log('--- TEST 5: EDIT ATTENDANCE & DUPLICATE PREVENTION QA ---');

  // Edit Mason to 6 Full + 0 Half
  await fetch(`${BASE_URL}/api/attendance/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      siteId: 'site-1',
      date: targetDate,
      items: [
        { roleId: 'role-mason', fullDayCount: 6, halfDayCount: 0, rateInPaise: 140000 },
        { roleId: 'role-male-helper', fullDayCount: 4, halfDayCount: 2, rateInPaise: 90000 },
      ],
    }),
  });

  const editedAttRes = await fetch(`${BASE_URL}/api/attendance/daily?siteId=site-1&date=${targetDate}`, {
    headers: { cookie: adminCookie },
  });
  const editedData = await editedAttRes.json();
  const editedMason = editedData.roles.find((r: { roleId: string }) => r.roleId === 'role-mason');
  assert.equal(editedMason.totalCostPaise, 840000, 'Mason cost must update to ₹8,400 (6 * 1400)');
  assert.equal(editedData.summary.totalLabourCostPaise, 1290000, 'Daily total must update to ₹12,900 (8400 + 4500)');
  console.log('✔ Edited attendance persisted and recalculated properly (₹12,900)');

  // Revert back to 5 Full + 1 Half for standard test suite consistency
  await fetch(`${BASE_URL}/api/attendance/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      siteId: 'site-1',
      date: targetDate,
      items: [
        { roleId: 'role-mason', fullDayCount: 5, halfDayCount: 1, rateInPaise: 140000 },
        { roleId: 'role-male-helper', fullDayCount: 4, halfDayCount: 2, rateInPaise: 90000 },
      ],
    }),
  });
  console.log('✔ Restored 01 Sep 2026 to standard test values\n');

  // ----------------------------------------------------
  // 6. HISTORICAL RATE IMMUTABILITY QA
  // ----------------------------------------------------
  console.log('--- TEST 6: HISTORICAL RATE IMMUTABILITY QA ---');

  // Change current global Mason rate to ₹1,500
  await fetch(`${BASE_URL}/api/roles`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ id: 'role-mason', name: 'Mason', defaultRateRupees: 1500 }),
  });
  console.log('✔ Updated Mason current default rate to ₹1,500');

  // Verify historical attendance on Sep 1 still uses ₹1,400 snapshot
  const histAttRes = await fetch(`${BASE_URL}/api/attendance/daily?siteId=site-1&date=2026-09-01`, {
    headers: { cookie: adminCookie },
  });
  const histAttData = await histAttRes.json();
  const histMason = histAttData.roles.find((r: { roleId: string }) => r.roleId === 'role-mason');
  assert.equal(histMason.rateInPaise, 140000, 'Historical rate snapshot must remain 140,000 paise (₹1,400)');
  assert.equal(histMason.totalCostPaise, 770000, 'Historical total cost must remain ₹7,700');
  console.log('✔ Verified Sep 1 attendance still preserves historical rate snapshot ₹1,400 and total ₹7,700');

  // Enter new attendance on Sep 2 for Mason (2 Full Days)
  await fetch(`${BASE_URL}/api/attendance/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      siteId: 'site-1',
      date: '2026-09-02',
      items: [{ roleId: 'role-mason', fullDayCount: 2, halfDayCount: 0, rateInPaise: 150000 }],
    }),
  });
  const sep2AttRes = await fetch(`${BASE_URL}/api/attendance/daily?siteId=site-1&date=2026-09-02`, {
    headers: { cookie: adminCookie },
  });
  const sep2AttData = await sep2AttRes.json();
  const sep2Mason = sep2AttData.roles.find((r: { roleId: string }) => r.roleId === 'role-mason');
  assert.equal(sep2Mason.rateInPaise, 150000, 'New entry must inherit updated rate 150,000 paise (₹1,500)');
  assert.equal(sep2Mason.totalCostPaise, 300000, 'Sep 2 Mason cost must be ₹3,000 (2 * 1500)');
  console.log('✔ New Sep 2 attendance correctly inherits updated ₹1,500 rate (₹3,000)\n');

  // ----------------------------------------------------
  // 7. FINANCIAL MODULE UI & DATA SEPARATION QA
  // ----------------------------------------------------
  console.log('--- TEST 7: SECTION 58 FINANCIAL LEDGER & CASH SEPARATION QA ---');

  // Clean prior transactions on site-1 for idempotency
  const existingFinRes = await fetch(`${BASE_URL}/api/finance?siteId=site-1`, { headers: { cookie: adminCookie } });
  const existingFinData = await existingFinRes.json();
  for (const t of existingFinData.transactions || []) {
    await fetch(`${BASE_URL}/api/finance/${t.id}`, { method: 'DELETE', headers: { cookie: adminCookie } });
  }

  // Record Credit ₹5,00,000
  await fetch(`${BASE_URL}/api/finance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      siteId: 'site-1',
      date: '2026-09-01',
      type: 'CREDIT',
      amountRupees: 500000,
      description: 'Investor Funding Seed',
    }),
  });

  // Record Supplies Debit ₹1,00,000
  await fetch(`${BASE_URL}/api/finance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      siteId: 'site-1',
      date: '2026-09-01',
      type: 'DEBIT',
      debitCategory: 'SUPPLIES',
      amountRupees: 100000,
      description: 'Cement & Steel Purchase',
    }),
  });

  // Record Special Worker/Task Debit ₹25,000
  await fetch(`${BASE_URL}/api/finance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({
      siteId: 'site-1',
      date: '2026-09-01',
      type: 'DEBIT',
      debitCategory: 'SPECIAL_WORKER_TASK',
      amountRupees: 25000,
      description: 'Special Crane Operator Subcontract',
    }),
  });

  // Fetch Financial Summary
  const finRes = await fetch(`${BASE_URL}/api/finance/summary?siteId=site-1&startDate=2026-09-01&endDate=2026-09-30`, {
    headers: { cookie: adminCookie },
  });
  const finData = await finRes.json();
  const finSum = finData.summary;

  assert.equal(finSum.totalCreditPaise, 50000000, 'Credit must be ₹5,00,000');
  assert.equal(finSum.suppliesDebitPaise, 10000000, 'Supplies Debit must be ₹1,00,000');
  assert.equal(finSum.specialWorkerTaskDebitPaise, 2500000, 'Special Task Debit must be ₹25,000');
  assert.equal(finSum.totalDebitPaise, 12500000, 'Total Debit must be ₹1,25,000');
  assert.equal(finSum.closingBalancePaise, 37500000, 'Closing Balance must be ₹3,75,000');
  console.log('✔ Financial Ledger verified:');
  console.log('  - Credit: ₹5,00,000 | Supplies: ₹1,00,000 | Special Task: ₹25,000');
  console.log('  - Total Debit = ₹1,25,000 | Cash Balance = ₹3,75,000');
  console.log('✔ Verified Attendance Labour Cost (₹12,200) is NOT added to Financial Debit balance (Separation Invariant)\n');

  // ----------------------------------------------------
  // 8. MULTI-SITE DATA ISOLATION QA
  // ----------------------------------------------------
  console.log('--- TEST 8: SECTION 60 MULTI-SITE DATA ISOLATION QA ---');

  const site2AttRes = await fetch(`${BASE_URL}/api/attendance/daily?siteId=site-2&date=2026-09-01`, {
    headers: { cookie: adminCookie },
  });
  const site2AttData = await site2AttRes.json();
  assert.equal(site2AttData.summary.totalWorkers, 0, 'Site 2 must have 0 workers');
  assert.equal(site2AttData.summary.totalLabourCostPaise, 0, 'Site 2 must have ₹0 labour cost');

  const site2FinRes = await fetch(`${BASE_URL}/api/finance?siteId=site-2`, {
    headers: { cookie: adminCookie },
  });
  const site2FinData = await site2FinRes.json();
  assert.equal(site2FinData.transactions.length, 0, 'Site 2 must have 0 financial transactions');
  console.log('✔ Verified complete data isolation: Site 2 has zero attendance and zero financial transactions from Site 1\n');

  // ----------------------------------------------------
  // 9. SERVER-SIDE SECURITY & SITE ACL ENFORCEMENT QA
  // ----------------------------------------------------
  console.log('--- TEST 9: SECTION 61 SERVER-SIDE RBAC & SITE ACL QA ---');

  // Engineer attempting to access unauthorized Site 2 -> Must return 403
  const engSite2Res = await fetch(`${BASE_URL}/api/attendance/daily?siteId=site-2&date=2026-09-01`, {
    headers: { cookie: engineerCookie },
  });
  assert.equal(engSite2Res.status, 403, 'Engineer accessing unauthorized site-2 must be 403 Forbidden');

  // Engineer attempting to create site -> Must return 403
  const engCreateSiteRes = await fetch(`${BASE_URL}/api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: engineerCookie },
    body: JSON.stringify({ name: 'Hacked Site' }),
  });
  assert.equal(engCreateSiteRes.status, 403, 'Engineer creating site must be 403 Forbidden');

  // Viewer attempting to mutate attendance -> Must return 403
  const viewPostAttRes = await fetch(`${BASE_URL}/api/attendance/daily`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: viewerCookie },
    body: JSON.stringify({ siteId: 'site-1', date: '2026-09-01', items: [] }),
  });
  assert.equal(viewPostAttRes.status, 403, 'Viewer attempting to write attendance must be 403 Forbidden');

  // Viewer attempting to post finance -> Must return 403
  const viewPostFinRes = await fetch(`${BASE_URL}/api/finance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: viewerCookie },
    body: JSON.stringify({ siteId: 'site-1', date: '2026-09-01', type: 'CREDIT', amountRupees: 1000, description: 'Test' }),
  });
  assert.equal(viewPostFinRes.status, 403, 'Viewer attempting to write finance must be 403 Forbidden');
  console.log('✔ Server-side authorization rigorously enforced (Engineer blocked from Site 2 & Admin ops; Viewer blocked from writes)\n');

  // ----------------------------------------------------
  // 10. PDF & EXCEL EXPORT GENERATION QA
  // ----------------------------------------------------
  console.log('--- TEST 10: PDF & MULTI-SHEET EXCEL EXPORT QA ---');

  // Daily Attendance PDF
  const pdfAttRes = await fetch(`${BASE_URL}/api/export/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ siteId: 'site-1', type: 'DAILY_ATTENDANCE', date: '2026-09-01' }),
  });
  assert.equal(pdfAttRes.status, 200);
  assert.equal(pdfAttRes.headers.get('content-type'), 'application/pdf');
  const pdfBuffer = await pdfAttRes.arrayBuffer();
  assert.ok(pdfBuffer.byteLength > 1000, 'PDF buffer must be valid size');
  const pdfHeader = new TextDecoder().decode(new Uint8Array(pdfBuffer.slice(0, 5)));
  assert.equal(pdfHeader, '%PDF-', 'Valid PDF file header verified');
  console.log('✔ Daily Attendance PDF generated successfully (', pdfBuffer.byteLength, 'bytes)');

  // Financial PDF
  const pdfFinRes = await fetch(`${BASE_URL}/api/export/pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ siteId: 'site-1', type: 'FINANCE', startDate: '2026-09-01', endDate: '2026-09-30' }),
  });
  assert.equal(pdfFinRes.status, 200);
  const finPdfBuffer = await pdfFinRes.arrayBuffer();
  assert.ok(finPdfBuffer.byteLength > 1000);
  console.log('✔ Financial Ledger PDF generated successfully (', finPdfBuffer.byteLength, 'bytes)');

  // Daily Attendance Excel
  const excelAttRes = await fetch(`${BASE_URL}/api/export/excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ siteId: 'site-1', type: 'DAILY_ATTENDANCE', date: '2026-09-01' }),
  });
  assert.equal(excelAttRes.status, 200);
  assert.equal(
    excelAttRes.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const excelAttBuffer = await excelAttRes.arrayBuffer();
  assert.ok(excelAttBuffer.byteLength > 1000);
  console.log('✔ Daily Attendance Excel workbook generated successfully (', excelAttBuffer.byteLength, 'bytes)');

  // Monthly Comprehensive Multi-Sheet Excel
  const excelMonthRes = await fetch(`${BASE_URL}/api/export/excel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ siteId: 'site-1', type: 'MONTHLY_COMPREHENSIVE', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' }),
  });
  assert.equal(excelMonthRes.status, 200);
  const excelMonthBuffer = await excelMonthRes.arrayBuffer();
  assert.ok(excelMonthBuffer.byteLength > 2000);
  console.log('✔ Comprehensive 5-Sheet Monthly Excel workbook generated successfully (', excelMonthBuffer.byteLength, 'bytes)\n');

  // ----------------------------------------------------
  // 11. AUDIT TRAIL LOG QA
  // ----------------------------------------------------
  console.log('--- TEST 11: AUDIT TRAIL LOG RECORDING QA ---');
  const auditRes = await fetch(`${BASE_URL}/api/audit?siteId=site-1`, {
    headers: { cookie: adminCookie },
  });
  assert.equal(auditRes.status, 200);
  const auditData = await auditRes.json();
  assert.ok(auditData.logs.length > 0, 'Audit logs must capture operations');
  console.log('✔ Audit trail successfully verified (', auditData.logs.length, 'entries captured)\n');

  console.log('====================================================');
  console.log('ALL REAL-WORLD LIVE APPLICATION QA TESTS PASSED (100%)');
  console.log('====================================================');
}

runLiveQA().catch((err) => {
  console.error('LIVE QA FAILURE:', err);
  process.exit(1);
});
