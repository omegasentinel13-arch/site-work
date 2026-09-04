import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Set up clean isolated test database
const TEST_DB_PATH = path.join(process.cwd(), 'data', 'test_site_work.db');
if (fs.existsSync(TEST_DB_PATH)) {
  fs.unlinkSync(TEST_DB_PATH);
}
process.env.DATABASE_PATH = TEST_DB_PATH;

import { getDb, closeDb } from '../lib/db/index';
import { runSeed } from '../lib/db/seed';
import { toPaise, toRupees, formatINR, calculateHalfDayRate } from '../lib/domain/money';
import { calculateRoleAttendance, calculateDailySummary } from '../lib/domain/attendance-engine';
import { calculateFinancialSummary } from '../lib/domain/finance-engine';
import { saveDailyAttendance, getDailyAttendance, getAttendanceByDateRange } from '../lib/db/repositories/attendance-repo';
import { createFinancialTransaction, getFinancialTransactions, getCumulativeBalanceBeforeDate } from '../lib/db/repositories/finance-repo';
import { getAllSites, createSite } from '../lib/db/repositories/site-repo';
import { getAllRoles, updateRole, setSiteRoleRate } from '../lib/db/repositories/role-repo';
import { validateSiteAccess, UnauthorizedError, ForbiddenError } from '../lib/auth/permissions';
import { generateDailyAttendancePDF, generateFinancialPDF } from '../lib/export/pdf-generator';
import { generateDailyAttendanceExcel, generateMonthlyComprehensiveExcel } from '../lib/export/excel-generator';

test('1. Database Initialization & Seed Verification', () => {
  const db = getDb();
  assert.ok(db, 'Database should be initialized');
  runSeed();

  // Create test users for test foreign key references
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, password_hash, full_name, role, is_active, created_at, updated_at)
    VALUES 
      ('usr-admin-1', 'admin_test', 'hash_admin', 'Head Administrator (Test)', 'ADMIN', 1, datetime('now'), datetime('now')),
      ('usr-eng-1', 'eng_test', 'hash_eng', 'Site Engineer (Test)', 'SITE_MANAGER', 1, datetime('now'), datetime('now')),
      ('usr-view-1', 'view_test', 'hash_view', 'Site Auditor (Test)', 'VIEWER', 1, datetime('now'), datetime('now'))
  `).run();

  const sites = getAllSites(false);
  assert.ok(sites.length >= 2, 'Should seed at least 2 sites');
  assert.equal(sites[0].id, 'site-1');

  const roles = getAllRoles('site-1', false);
  assert.ok(roles.length >= 19, 'Should seed 19 default roles across 4 categories');

  const mason = roles.find(r => r.name === 'Mason');
  assert.ok(mason, 'Mason role must exist');
  assert.equal(mason?.default_rate_paise, 140000, 'Mason default rate should be 140,000 paise (₹1,400)');
});

test('2. SECTION 57 MANDATORY ATTENDANCE TEST SCENARIO', () => {
  // Scenario: 01 September 2026, Site 1
  // Mason: 5 Full Day, 1 Half Day @ ₹1,400
  // Male Helper: 4 Full Day, 2 Half Day @ ₹900
  const date = '2026-09-01';
  const siteId = 'site-1';

  // 1. Check unit domain formulas
  const masonCalc = calculateRoleAttendance({
    roleId: 'role-mason',
    roleName: 'Mason',
    categoryId: 'cat-civil',
    categoryName: 'CIVIL WORKS',
    rateInPaise: 140000,
    fullDayCount: 5,
    halfDayCount: 1,
  });

  assert.equal(masonCalc.fullDayCostPaise, 700000, 'Mason 5 full @ 1400 = ₹7,000 (700,000 paise)');
  assert.equal(masonCalc.halfDayCostPaise, 70000, 'Mason 1 half @ 1400 * 0.5 = ₹700 (70,000 paise)');
  assert.equal(masonCalc.totalCostPaise, 770000, 'Mason total = ₹7,700 (770,000 paise)');
  assert.equal(masonCalc.totalWorkers, 6, 'Mason total workers = 6');
  assert.equal(masonCalc.workerDays, 5.5, 'Mason worker days = 5.5');

  const helperCalc = calculateRoleAttendance({
    roleId: 'role-male-helper',
    roleName: 'Male Helper',
    categoryId: 'cat-civil',
    categoryName: 'CIVIL WORKS',
    rateInPaise: 90000,
    fullDayCount: 4,
    halfDayCount: 2,
  });

  assert.equal(helperCalc.fullDayCostPaise, 360000, 'Male Helper 4 full @ 900 = ₹3,600 (360,000 paise)');
  assert.equal(helperCalc.halfDayCostPaise, 90000, 'Male Helper 2 half @ 900 * 0.5 = ₹900 (90,000 paise)');
  assert.equal(helperCalc.totalCostPaise, 450000, 'Male Helper total = ₹4,500 (450,000 paise)');
  assert.equal(helperCalc.totalWorkers, 6, 'Male Helper total workers = 6');
  assert.equal(helperCalc.workerDays, 5.0, 'Male Helper worker days = 5.0');

  // Daily Summary Aggregation Check
  const daily = calculateDailySummary(date, [
    {
      roleId: 'role-mason',
      roleName: 'Mason',
      categoryId: 'cat-civil',
      categoryName: 'CIVIL WORKS',
      rateInPaise: 140000,
      fullDayCount: 5,
      halfDayCount: 1,
    },
    {
      roleId: 'role-male-helper',
      roleName: 'Male Helper',
      categoryId: 'cat-civil',
      categoryName: 'CIVIL WORKS',
      rateInPaise: 90000,
      fullDayCount: 4,
      halfDayCount: 2,
    },
  ]);

  assert.equal(daily.totalWorkers, 12, 'Total workers must be 12 (6 + 6)');
  assert.equal(daily.workerDays, 10.5, 'Total worker-days must be 10.5 (5.5 + 5.0)');
  assert.equal(daily.totalLabourCostPaise, 1220000, 'Total daily cost must be ₹12,200 (1,220,000 paise)');
  assert.equal(formatINR(daily.totalLabourCostPaise), '₹12,200', 'Formatted total must be ₹12,200');

  // 2. Persist to Database and verify DB queries
  saveDailyAttendance(
    siteId,
    date,
    [
      { roleId: 'role-mason', fullDayCount: 5, halfDayCount: 1 },
      { roleId: 'role-male-helper', fullDayCount: 4, halfDayCount: 2 },
    ],
    'usr-eng-1'
  );

  const dbRecords = getDailyAttendance(siteId, date);
  assert.equal(dbRecords.length, 2, 'Should persist 2 attendance records');

  const dbMason = dbRecords.find(r => r.role_id === 'role-mason');
  assert.ok(dbMason);
  assert.equal(dbMason?.total_cost_paise, 770000);
  assert.equal(dbMason?.rate_snapshot_paise, 140000);
  assert.equal(dbMason?.worker_days, 5.5);

  const dbHelper = dbRecords.find(r => r.role_id === 'role-male-helper');
  assert.ok(dbHelper);
  assert.equal(dbHelper?.total_cost_paise, 450000);
  assert.equal(dbHelper?.rate_snapshot_paise, 90000);
  assert.equal(dbHelper?.worker_days, 5.0);

  const totalCost = dbRecords.reduce((sum, r) => sum + r.total_cost_paise, 0);
  assert.equal(totalCost, 1220000, 'DB recorded total daily cost must be 1,220,000 paise (₹12,200)');
});

test('3. SECTION 58 FINANCIAL TEST SCENARIO', () => {
  // Scenario:
  // Investor Credit: ₹5,00,000 (50,000,000 paise)
  // Supplies Debit: ₹1,00,000 (10,000,000 paise)
  // Special Worker/Task Debit: ₹25,000 (2,500,000 paise)
  // Expected: Total Debit = ₹1,25,000 | Balance = ₹3,75,000
  const siteId = 'site-1';
  const date = '2026-09-01';

  createFinancialTransaction({
    siteId,
    date,
    type: 'CREDIT',
    amountPaise: 50000000,
    description: 'Initial Investor Funding',
    userId: 'usr-admin-1',
  });

  createFinancialTransaction({
    siteId,
    date,
    type: 'DEBIT',
    debitCategory: 'SUPPLIES',
    amountPaise: 10000000,
    description: 'Cement & Steel Purchase',
    userId: 'usr-eng-1',
  });

  createFinancialTransaction({
    siteId,
    date,
    type: 'DEBIT',
    debitCategory: 'SPECIAL_WORKER_TASK',
    amountPaise: 2500000,
    description: 'Special Crane Operator Subcontract',
    userId: 'usr-eng-1',
  });

  const txs = getFinancialTransactions(siteId, { startDate: date, endDate: date });
  assert.equal(txs.length, 3, 'Should have 3 transactions');

  const finSummary = calculateFinancialSummary(
    txs.map(t => ({
      id: t.id,
      siteId: t.site_id,
      date: t.date,
      type: t.type,
      debitCategory: t.debit_category,
      amountPaise: t.amount_paise,
      description: t.description,
      createdAt: t.created_at,
    })),
    0
  );

  assert.equal(finSummary.totalCreditPaise, 50000000, 'Total Credit = ₹5,00,000 (50,000,000 paise)');
  assert.equal(finSummary.suppliesDebitPaise, 10000000, 'Supplies Debit = ₹1,00,000 (10,000,000 paise)');
  assert.equal(finSummary.specialWorkerTaskDebitPaise, 2500000, 'Special Task Debit = ₹25,000 (2,500,000 paise)');
  assert.equal(finSummary.totalDebitPaise, 12500000, 'Total Debit = ₹1,25,000 (12,500,000 paise)');
  assert.equal(finSummary.closingBalancePaise, 37500000, 'Closing Balance = ₹3,75,000 (37,500,000 paise)');
  assert.equal(formatINR(finSummary.closingBalancePaise), '₹3,75,000', 'Formatted balance must be ₹3,75,000');
});

test('4. SECTION 59 HISTORICAL RATE IMMUTABILITY TEST', () => {
  // 1. Verify September 1 attendance for Mason is currently @ ₹1,400 (7,700 total)
  const siteId = 'site-1';
  const sep1Records = getDailyAttendance(siteId, '2026-09-01');
  const masonBefore = sep1Records.find(r => r.role_id === 'role-mason');
  assert.equal(masonBefore?.rate_snapshot_paise, 140000);
  assert.equal(masonBefore?.total_cost_paise, 770000);

  // 2. Change current global Mason rate to ₹1,500 (150,000 paise)
  updateRole('role-mason', 'Mason', 150000);

  // 3. Verify that September 1 historical attendance remains strictly ₹1,400 & ₹7,700
  const sep1RecordsAfter = getDailyAttendance(siteId, '2026-09-01');
  const masonAfter = sep1RecordsAfter.find(r => r.role_id === 'role-mason');
  assert.equal(masonAfter?.rate_snapshot_paise, 140000, 'Historical rate snapshot must remain 140,000 paise');
  assert.equal(masonAfter?.total_cost_paise, 770000, 'Historical total cost must remain 770,000 paise (₹7,700)');

  // 4. Now enter new attendance on September 2 for Mason (2 Full Days)
  // It should pick up the new ₹1,500 rate
  saveDailyAttendance(siteId, '2026-09-02', [{ roleId: 'role-mason', fullDayCount: 2, halfDayCount: 0 }], 'usr-eng-1');

  const sep2Records = getDailyAttendance(siteId, '2026-09-02');
  const masonSep2 = sep2Records.find(r => r.role_id === 'role-mason');
  assert.equal(masonSep2?.rate_snapshot_paise, 150000, 'New entry should capture updated 150,000 paise rate');
  assert.equal(masonSep2?.total_cost_paise, 300000, '2 full @ 1500 = ₹3,000 (300,000 paise)');
});

test('5. SECTION 60 MULTI-SITE ISOLATION TEST', () => {
  // Site 1 has attendance and finance from previous tests.
  // Site 2 should be completely empty and isolated.
  const site2DailyAttendance = getDailyAttendance('site-2', '2026-09-01');
  assert.equal(site2DailyAttendance.length, 0, 'Site 2 must not see Site 1 attendance');

  const site2Transactions = getFinancialTransactions('site-2');
  assert.equal(site2Transactions.length, 0, 'Site 2 must not see Site 1 financial transactions');

  // Insert transaction on Site 2
  createFinancialTransaction({
    siteId: 'site-2',
    date: '2026-09-01',
    type: 'CREDIT',
    amountPaise: 20000000, // ₹2,00,000
    description: 'Site 2 Investor Seed',
    userId: 'usr-admin-1',
  });

  const site1Txs = getFinancialTransactions('site-1');
  const site2Txs = getFinancialTransactions('site-2');
  assert.equal(site1Txs.length, 3, 'Site 1 has exactly 3 transactions');
  assert.equal(site2Txs.length, 1, 'Site 2 has exactly 1 transaction');
  assert.equal(site2Txs[0].amount_paise, 20000000);
});

test('6. SECTION 61 MULTI-USER AUTHORIZATION & SITE ACL TEST', () => {
  const adminSession = {
    userId: 'usr-admin-1',
    username: 'admin',
    fullName: 'Head Administrator',
    role: 'ADMIN' as const,
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const engineerSession = {
    userId: 'usr-eng-1',
    username: 'engineer',
    fullName: 'Site Engineer (Demo)',
    role: 'SITE_MANAGER' as const,
    assignedSiteIds: ['site-1'], // Only Site 1 assigned
    tokenVersion: 1,
  };

  const viewerSession = {
    userId: 'usr-view-1',
    username: 'viewer',
    fullName: 'Site Auditor (Demo)',
    role: 'VIEWER' as const,
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 1,
  };

  // Admin has access to anything
  assert.doesNotThrow(() => validateSiteAccess(adminSession, 'site-1', 'ADMIN'));
  assert.doesNotThrow(() => validateSiteAccess(adminSession, 'site-2', 'ADMIN'));

  // Engineer can READ & WRITE on Site 1
  assert.doesNotThrow(() => validateSiteAccess(engineerSession, 'site-1', 'READ'));
  assert.doesNotThrow(() => validateSiteAccess(engineerSession, 'site-1', 'WRITE'));

  // Engineer CANNOT access Site 2 (Unauthorized Site)
  assert.throws(() => validateSiteAccess(engineerSession, 'site-2', 'READ'), ForbiddenError);
  assert.throws(() => validateSiteAccess(engineerSession, 'site-2', 'WRITE'), ForbiddenError);

  // Engineer CANNOT perform ADMIN actions
  assert.throws(() => validateSiteAccess(engineerSession, 'site-1', 'ADMIN'), ForbiddenError);

  // Viewer can READ Site 1 and Site 2
  assert.doesNotThrow(() => validateSiteAccess(viewerSession, 'site-1', 'READ'));
  assert.doesNotThrow(() => validateSiteAccess(viewerSession, 'site-2', 'READ'));

  // Viewer CANNOT WRITE to any site
  assert.throws(() => validateSiteAccess(viewerSession, 'site-1', 'WRITE'), ForbiddenError);
});

test('7. SECTION 62 REPORT & EXPORT CONSISTENCY TEST', async () => {
  // Test that Daily, Monthly range query, PDF generator, and Excel generator produce valid, consistent outputs
  const siteId = 'site-1';
  const records = getDailyAttendance(siteId, '2026-09-01');
  const summary = calculateDailySummary(
    '2026-09-01',
    records.map(r => ({
      roleId: r.role_id,
      roleName: r.role_name || '',
      categoryId: r.category_id || '',
      categoryName: r.category_name || '',
      rateInPaise: r.rate_snapshot_paise,
      fullDayCount: r.full_day_count,
      halfDayCount: r.half_day_count,
    }))
  );

  assert.equal(summary.totalLabourCostPaise, 1220000);
  assert.equal(summary.totalWorkers, 12);
  assert.equal(summary.workerDays, 10.5);

  // Generate Daily Attendance PDF
  const pdfBuffer = generateDailyAttendancePDF(
    { siteName: 'Site 1', siteCode: 'S-01', reportTitle: 'Daily Attendance', periodLabel: '01 Sep 2026' },
    summary
  );
  assert.ok(pdfBuffer.length > 500, 'PDF buffer should be generated');

  // Generate Daily Attendance Excel
  const excelBuffer = await generateDailyAttendanceExcel('Site 1', '2026-09-01', summary);
  assert.ok(excelBuffer.length > 500, 'Excel buffer should be generated');

  // Multi-sheet Monthly Excel
  const rangeRecords = getAttendanceByDateRange(siteId, '2026-09-01', '2026-09-30');
  const finTxs = getFinancialTransactions(siteId, { startDate: '2026-09-01', endDate: '2026-09-30' });
  const finSummary = calculateFinancialSummary(
    finTxs.map(t => ({
      id: t.id,
      siteId: t.site_id,
      date: t.date,
      type: t.type,
      debitCategory: t.debit_category,
      amountPaise: t.amount_paise,
      description: t.description,
      createdAt: t.created_at,
    })),
    0
  );

  const monthlyExcel = await generateMonthlyComprehensiveExcel({
    siteName: 'Site 1',
    monthLabel: 'September 2026',
    attendanceRecords: rangeRecords,
    financialTransactions: finTxs,
    financialSummary: finSummary,
    totalLabourCostPaise: rangeRecords.reduce((sum, r) => sum + r.total_cost_paise, 0),
    totalWorkers: rangeRecords.reduce((sum, r) => sum + r.total_workers, 0),
    totalWorkerDays: rangeRecords.reduce((sum, r) => sum + r.worker_days, 0),
  });

  assert.ok(monthlyExcel.length > 1000, 'Monthly Excel buffer should be generated');
});

test.after(() => {
  closeDb();
  if (fs.existsSync(TEST_DB_PATH)) {
    try {
      fs.unlinkSync(TEST_DB_PATH);
    } catch {}
  }
});
