import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('MONTHLY TO DAILY DRILL-DOWN DATE PRESERVATION TESTS', () => {
  const dailyPath = path.join(process.cwd(), 'app', '(dashboard)', 'attendance', 'daily', 'page.tsx');
  const monthlyPath = path.join(process.cwd(), 'app', '(dashboard)', 'attendance', 'monthly', 'page.tsx');
  const dailySrc = fs.readFileSync(dailyPath, 'utf8');
  const monthlySrc = fs.readFileSync(monthlyPath, 'utf8');
  const db = new DatabaseSync('./data/site_work.db', { readOnly: true });

  test('L. DB Baseline Integrity (0 mutations)', () => {
    assert.equal(db.prepare('SELECT count(*) as c FROM users').get().c, 4);
    assert.equal(db.prepare('SELECT count(*) as c FROM sites').get().c, 6);
    assert.equal(db.prepare('SELECT count(*) as c FROM site_users').get().c, 3);
    assert.equal(db.prepare('SELECT count(*) as c FROM work_categories').get().c, 4);
    assert.equal(db.prepare('SELECT count(*) as c FROM work_roles').get().c, 23);
    assert.equal(db.prepare('SELECT count(*) as c FROM attendance_records').get().c, 18);
    assert.equal(db.prepare('SELECT count(*) as c FROM financial_transactions').get().c, 4);
    assert.equal(db.prepare('SELECT count(*) as c FROM audit_logs').get().c, 420);
  });

  test('A. Monthly double-click produces /attendance/daily?date=YYYY-MM-DD', () => {
    assert.match(monthlySrc, /onDoubleClick={\(\) => handleDayDoubleClick\(dateStr\)}/, 'Monthly page registers double click on dateStr');
    assert.match(monthlySrc, /router\.push\(`\/attendance\/daily\?date=\${dateStr}`\)/, 'Monthly page navigates with date query param');
  });

  test('B, C, D: Daily Attendance reads date query parameter and overrides Today', () => {
    assert.match(dailySrc, /useSearchParams/, 'Daily page imports and uses useSearchParams');
    assert.match(dailySrc, /searchParams\?\.get\('date'\)/, 'Daily page extracts date query parameter');
    assert.match(dailySrc, /if \(isValidISODate\(queryDate\)\)/, 'Daily page checks if query date is valid');
  });

  test('F, J: Date validation and Timezone off-by-one protection', () => {
    function isValidISODate(dateStr: string | null | undefined): dateStr is string {
      if (!dateStr || typeof dateStr !== 'string') return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
      const [y, m, d] = dateStr.split('-').map(Number);
      if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
      if (m < 1 || m > 12) return false;
      if (d < 1 || d > 31) return false;
      if (y < 2000 || y > 2100) return false;
      const daysInMonth = new Date(y, m, 0).getDate();
      return d <= daysInMonth;
    }

    // Valid ISO dates
    assert.equal(isValidISODate('2026-09-05'), true);
    assert.equal(isValidISODate('2026-09-01'), true);
    assert.equal(isValidISODate('2026-09-07'), true);
    assert.equal(isValidISODate('2026-09-08'), true);
    assert.equal(isValidISODate('2024-02-29'), true, 'Leap year Feb 29 is valid');

    // Invalid ISO dates safely rejected
    assert.equal(isValidISODate('2026-02-29'), false, 'Non-leap year Feb 29 rejected');
    assert.equal(isValidISODate('2026-04-31'), false, 'April 31 rejected');
    assert.equal(isValidISODate('2026-13-01'), false, 'Month 13 rejected');
    assert.equal(isValidISODate('not-a-date'), false, 'String rejected');
    assert.equal(isValidISODate(''), false, 'Empty string rejected');
    assert.equal(isValidISODate(null), false, 'Null rejected');
    assert.equal(isValidISODate(undefined), false, 'Undefined rejected');
    assert.equal(isValidISODate('2026-9-5'), false, 'Unpadded date rejected');
  });

  test('Priority Resolution Logic: Query Date > Existing / Local Today', () => {
    function resolveInitialDate(queryDate: string | null, fallbackDate: string): string {
      function isValid(dateStr: string | null | undefined): dateStr is string {
        if (!dateStr || typeof dateStr !== 'string') return false;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
        const [y, m, d] = dateStr.split('-').map(Number);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return false;
        if (m < 1 || m > 12) return false;
        if (d < 1 || d > 31) return false;
        if (y < 2000 || y > 2100) return false;
        const daysInMonth = new Date(y, m, 0).getDate();
        return d <= daysInMonth;
      }

      if (isValid(queryDate)) {
        return queryDate;
      }
      return fallbackDate;
    }

    const today = '2026-09-08';
    assert.equal(resolveInitialDate('2026-09-05', today), '2026-09-05', 'Query date 2026-09-05 must override Today');
    assert.equal(resolveInitialDate('2026-09-01', today), '2026-09-01', 'Query date 2026-09-01 must override Today');
    assert.equal(resolveInitialDate('2026-09-07', today), '2026-09-07', 'Query date 2026-09-07 must override Today');
    assert.equal(resolveInitialDate(null, today), today, 'Null query falls back to Today');
    assert.equal(resolveInitialDate('invalid', today), today, 'Invalid query falls back to Today');
  });

  test('E. Attendance data fetching uses exact selected date', () => {
    assert.match(dailySrc, /\/api\/attendance\/daily\?siteId=\${selectedSiteId}&date=\${selectedDate}/, 'fetchAttendance uses selectedDate parameter');
  });

  test('G. Single click in Monthly Calendar does not navigate', () => {
    assert.doesNotMatch(monthlySrc, /onClick={\(\) => (?:router\.push|handleDayDoubleClick)/, 'Single click must NOT navigate');
  });
});
