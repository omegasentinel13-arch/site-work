import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { getDb } from '../lib/db/index';

test('WORKFORCE ANALYTICS COMPREHENSIVE SUITE', async (t) => {
  const db = getDb();

  // Baseline DB Counts
  const baseline = {
    users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c,
    sites: (db.prepare('SELECT COUNT(*) as c FROM sites').get() as any).c,
    categories: (db.prepare('SELECT COUNT(*) as c FROM work_categories').get() as any).c,
    roles: (db.prepare('SELECT COUNT(*) as c FROM work_roles').get() as any).c,
    attendance: (db.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as any).c,
    transactions: (db.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c,
    audit: (db.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as any).c,
  };

  await t.test('1. DB Baseline & Read-Only Safety', () => {
    assert.ok(baseline.attendance > 0, 'Must have attendance records');
    assert.ok(baseline.categories > 0, 'Must have categories');
    assert.ok(baseline.roles > 0, 'Must have roles');
  });

  await t.test('2. Page title & Route verification', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    assert.ok(fs.existsSync(rolePagePath), 'Primary route file app/(dashboard)/reports/role/page.tsx must exist');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes('WORKFORCE ANALYTICS'), 'Page must contain WORKFORCE ANALYTICS title');
    assert.ok(!content.includes('MASTER BREAKDOWN'), 'Old MASTER BREAKDOWN name must not be used');
  });

  await t.test('3. Dynamic Category & Role loading (No hardcoded categories)', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes("fetch('/api/categories')"), 'Must dynamically fetch categories');
    assert.ok(content.includes('/api/roles?siteId='), 'Must dynamically fetch roles for site');
    assert.ok(!content.includes("'CIVIL WORKS' && 'MEP WORKS'"), 'Must not hardcode 4 categories');
  });

  await t.test('4. Hierarchical Multi-Select Selector logic', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes('handleToggleAll'), 'Must support ALL toggle');
    assert.ok(content.includes('handleToggleCategory'), 'Must support category toggle');
    assert.ok(content.includes('handleToggleRole'), 'Must support individual role toggle');
    assert.ok(content.includes('toggleCategoryExpand'), 'Must support category expand/collapse');
    assert.ok(content.includes('ALL (COMPLETE WORKFORCE)'), 'Must include ALL option');
  });

  await t.test('5. Date Range Draft / Apply Model & Validation', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes('draftFromDate'), 'Must maintain draftFromDate state');
    assert.ok(content.includes('draftToDate'), 'Must maintain draftToDate state');
    assert.ok(content.includes('appliedFromDate'), 'Must maintain appliedFromDate state');
    assert.ok(content.includes('appliedToDate'), 'Must maintain appliedToDate state');
    assert.ok(content.includes('handleApplyDateRange'), 'Must have handleApplyDateRange function');
    assert.ok(content.includes('To Date must be on or after From Date.'), 'Must show invalid range validation');
    assert.ok(content.includes('workforce-analytics-apply-btn'), 'Must have APPLY button');
  });

  await t.test('6. Three View Modes (Overall Breakdown, Year Calendar, Drilldown Explorer)', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes("'overall' | 'year' | 'drilldown'"), 'Must define 3 view modes');
    assert.ok(content.includes('Overall Breakdown'), 'Must display Overall Breakdown mode');
    assert.ok(content.includes('Year Calendar'), 'Must display Year Calendar mode');
    assert.ok(content.includes('Drilldown Explorer'), 'Must display Drilldown Explorer mode');
  });

  await t.test('7. View 1 Visual Hierarchy & Column Separators', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes('bg-slate-900 dark:bg-[#111214] text-white'), 'Category header must be dark navy');
    assert.ok(content.includes('Subtotal —'), 'Must have Category Subtotal');
    assert.ok(content.includes('GRAND TOTAL'), 'Must have Grand Total');
    assert.ok(content.includes('border-r border-slate-300 dark:border-[#2B2D31]'), 'Must have visible column separators');
  });

  await t.test('8. View 2 Year Calendar & Month Double-Click Drilldown', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes('yearlyMonthSummaries'), 'Must aggregate 12 months');
    assert.ok(content.includes('/attendance/monthly?month='), 'Double click must navigate to /attendance/monthly?month=YYYY-MM');
    assert.ok(content.includes('onDoubleClick={() => handleMonthDoubleClick'), 'Must use double click for navigation');
  });

  await t.test('9. View 3 Drilldown Explorer & Day Double-Click Drilldown', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes('drilldownAvailableDays'), 'Must list available active days');
    assert.ok(content.includes('/attendance/daily?date='), 'Double click must navigate to /attendance/daily?date=YYYY-MM-DD');
    assert.ok(content.includes('onDoubleClick={() => handleDayDoubleClick'), 'Must use double click for day navigation');
  });

  await t.test('10. Monthly Attendance Month Handoff Contract', () => {
    const monthlyPagePath = path.join(process.cwd(), 'app/(dashboard)/attendance/monthly/page.tsx');
    const content = fs.readFileSync(monthlyPagePath, 'utf8');

    assert.ok(content.includes('parseQueryMonth'), 'Monthly Attendance must parse queryMonth');
    assert.ok(content.includes("searchParams?.get('month')"), 'Must read month search parameter');
    assert.ok(content.includes('Suspense'), 'Monthly Attendance must be wrapped in Suspense');
  });

  await t.test('11. Secondary Tabs: Attendance vs Transactions', () => {
    const rolePagePath = path.join(process.cwd(), 'app/(dashboard)/reports/role/page.tsx');
    const content = fs.readFileSync(rolePagePath, 'utf8');

    assert.ok(content.includes("'attendance' | 'transactions'"), 'Must support attendance and transactions tabs');
    assert.ok(content.includes('/api/finance?siteId='), 'Must fetch finance data for applied range');
    assert.ok(content.includes('Total Inflow (Credits)'), 'Must display Inflow metric');
    assert.ok(content.includes('Total Outflow (Debits)'), 'Must display Outflow metric');
    assert.ok(content.includes('Net Balance'), 'Must display Net Balance metric');
  });

  await t.test('12. Legacy Category Breakdown backward compatibility', () => {
    const catPagePath = path.join(process.cwd(), 'app/(dashboard)/reports/category/page.tsx');
    assert.ok(fs.existsSync(catPagePath), 'Legacy route /reports/category must exist');
    const content = fs.readFileSync(catPagePath, 'utf8');

    assert.ok(content.includes('Category Breakdown Merged'), 'Must show merged banner');
    assert.ok(content.includes('/reports/role?categoryId='), 'Must link to /reports/role');
    assert.ok(content.includes("type: 'CATEGORY_REPORT'"), 'Must preserve CATEGORY_REPORT export type for tests');
  });

  await t.test('13. Navigation label updated to Workforce Analytics', () => {
    const navPath = path.join(process.cwd(), 'components/layout/Navigation.tsx');
    const headerPath = path.join(process.cwd(), 'components/layout/Header.tsx');
    const navContent = fs.readFileSync(navPath, 'utf8');
    const headerContent = fs.readFileSync(headerPath, 'utf8');

    assert.ok(navContent.includes('Workforce Analytics'), 'Navigation.tsx must have Workforce Analytics');
    assert.ok(headerContent.includes('Workforce Analytics'), 'Header.tsx must have Workforce Analytics');
    assert.ok(navContent.includes("href: '/reports/role'"), 'Navigation must preserve href: /reports/role');
  });

  await t.test('14. Database Delta Zero Check', () => {
    const after = {
      users: (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c,
      sites: (db.prepare('SELECT COUNT(*) as c FROM sites').get() as any).c,
      categories: (db.prepare('SELECT COUNT(*) as c FROM work_categories').get() as any).c,
      roles: (db.prepare('SELECT COUNT(*) as c FROM work_roles').get() as any).c,
      attendance: (db.prepare('SELECT COUNT(*) as c FROM attendance_records').get() as any).c,
      transactions: (db.prepare('SELECT COUNT(*) as c FROM financial_transactions').get() as any).c,
      audit: (db.prepare('SELECT COUNT(*) as c FROM audit_logs').get() as any).c,
    };

    assert.deepEqual(after, baseline, 'Database counts must remain exactly unchanged');
  });
});
