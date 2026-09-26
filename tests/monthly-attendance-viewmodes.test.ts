import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('MONTHLY ATTENDANCE VIEW MODES & CUSTOM SELECTOR TESTS', () => {
  const monthlyPath = path.join(process.cwd(), 'app', '(dashboard)', 'attendance', 'monthly', 'page.tsx');
  const monthlySrc = fs.readFileSync(monthlyPath, 'utf8');
  const db = new DatabaseSync('./data/site_work.db', { readOnly: true });

  test('DB Baseline Integrity Check (Zero Mutations)', () => {
    assert.equal(db.prepare('SELECT count(*) as c FROM users').get().c, 4);
    assert.equal(db.prepare('SELECT count(*) as c FROM sites').get().c, 6);
    assert.equal(db.prepare('SELECT count(*) as c FROM site_users').get().c, 3);
    assert.equal(db.prepare('SELECT count(*) as c FROM work_categories').get().c, 4);
    assert.equal(db.prepare('SELECT count(*) as c FROM work_roles').get().c, 23);
    assert.equal(db.prepare('SELECT count(*) as c FROM attendance_records').get().c, 18);
    assert.equal(db.prepare('SELECT count(*) as c FROM financial_transactions').get().c, 4);
    assert.equal(db.prepare('SELECT count(*) as c FROM audit_logs').get().c, 420);
  });

  test('Requirement A & C: View Mode Switcher and Default Table View', () => {
    assert.match(monthlySrc, /useState<'table' \| 'calendar'>\('table'\)/, 'Default viewMode must be table');
    assert.match(monthlySrc, /data-testid="view-mode-table"/, 'Must have table view button with data-testid');
    assert.match(monthlySrc, /data-testid="view-mode-calendar"/, 'Must have calendar view button with data-testid');
    assert.match(monthlySrc, /<LayoutGrid className=/, 'Table view button must have LayoutGrid icon');
    assert.match(monthlySrc, /<CalendarIcon className=/, 'Calendar view button must have CalendarIcon');
    assert.match(monthlySrc, /aria-pressed={viewMode === 'table'}/, 'Must have aria-pressed state on table button');
    assert.match(monthlySrc, /aria-pressed={viewMode === 'calendar'}/, 'Must have aria-pressed state on calendar button');
  });

  test('Requirement B: Table View Title Guard (Weekly Workforce Matrix is not shown)', () => {
    assert.doesNotMatch(monthlySrc, /Weekly Workforce Matrix/, 'Must NOT contain Weekly Workforce Matrix');
    assert.match(monthlySrc, /Monthly Workforce Matrix/, 'Must maintain Monthly Workforce Matrix');
    assert.match(monthlySrc, /Monthly Attendance Report/, 'Must maintain Monthly Attendance Report page title');
  });

  test('Requirement 1 & 2: Custom SITE WORK Month & Year Selector Experience', () => {
    assert.match(monthlySrc, /data-testid="month-selector-trigger"/, 'Must have custom month selector trigger');
    assert.match(monthlySrc, /data-testid="month-selector-popover"/, 'Must have custom month selector popover');
    assert.match(monthlySrc, /SUPPORTED_YEARS/, 'Must define supported years');
    assert.match(monthlySrc, /SHORT_MONTH_NAMES/, 'Must have month names grid');
    assert.match(monthlySrc, /handleClickOutside/, 'Must close popover on outside click');
    assert.match(monthlySrc, /handleKeyDown[\s\S]*Escape/, 'Must close popover on Escape key');
    assert.match(monthlySrc, /shiftMonth\(-1\)/, 'Must support previous month arrow navigation');
    assert.match(monthlySrc, /shiftMonth\(1\)/, 'Must support next month arrow navigation');
    assert.match(monthlySrc, /setThisMonth/, 'Must support Current Month quick button');
  });

  test('Requirement 3 & 6: Table View Category Hierarchy Visual Treatment', () => {
    assert.match(monthlySrc, /bg-slate-900 dark:bg-\[#18191C\] text-white border-y/, 'Category header row must use dark navy/slate-900 style');
    assert.match(monthlySrc, /bg-emerald-400 dark:bg-\[#1ED760\]/, 'Category header must have emerald dot indicator');
    assert.match(monthlySrc, /hover:bg-slate-50 dark:hover:bg-\[#202225\]/, 'Role rows must have subtle hover states');
    assert.match(monthlySrc, /bg-slate-800 dark:bg-\[#202225\] text-white font-bold/, 'Category subtotal row must use slate-800 styling');
    assert.match(monthlySrc, /Subtotal — {cat\.categoryName}/, 'Category subtotal row must display category name');
    assert.match(monthlySrc, /border-l border-black dark:border-\[#3A3D42\]/, 'Table columns must have thin black/dark column separators');
    assert.match(monthlySrc, /Grand Total/, 'Table must have Grand Total footer row');
  });

  test('Requirement 4, 5 & 7: Calendar View & Double-Click Drill-Down', () => {
    assert.match(monthlySrc, /WEEKDAY_NAMES = \['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'\]/, 'Calendar must have 7 weekday headers MON-SUN');
    assert.match(monthlySrc, /data-testid={`calendar-day-\${dateStr}`}/, 'Calendar day cells must have test IDs');
    assert.match(monthlySrc, /onDoubleClick={\(\) => handleDayDoubleClick\(dateStr\)}/, 'Day cell must have double-click handler');
    assert.match(monthlySrc, /router\.push\(`\/attendance\/daily\?date=\${dateStr}`\)/, 'Double click must navigate to /attendance/daily?date=');
    assert.doesNotMatch(monthlySrc, /onClick={\(\) => (?:router\.push|handleDayDoubleClick)/, 'Single click must NOT navigate');
    assert.match(monthlySrc, /No attendance/, 'Days with no attendance must display No attendance');
    assert.match(monthlySrc, /isToday/, 'Must highlight today with indicator');
  });

  test('Only Default Export in page.tsx (Next.js App Router constraint)', () => {
    const namedExports = monthlySrc.match(/export (?:const|let|var|function|class|type|interface) (?!default)/g);
    assert.equal(namedExports, null, 'No named exports allowed in page.tsx');
  });

  test('Calendar Month Grid Calculations (Monday-first alignment)', () => {
    function computeGrid(year: number, month: number) {
      const firstDay = new Date(year, month - 1, 1);
      const startingOffset = (firstDay.getDay() + 6) % 7;
      const totalDays = new Date(year, month, 0).getDate();
      const leadingBlanks = Array.from({ length: startingOffset }, (_, i) => i);
      const days = Array.from({ length: totalDays }, (_, i) => i + 1);
      const totalSlots = startingOffset + totalDays;
      const trailingBlanks = Array.from({ length: (7 - (totalSlots % 7)) % 7 }, (_, i) => i);
      return { startingOffset, totalDays, leadingBlanks, days, trailingBlanks };
    }

    // March 2026: March 1, 2026 is a Sunday. Sunday -> offset 6 (Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6)
    const mar2026 = computeGrid(2026, 3);
    assert.equal(mar2026.totalDays, 31);
    assert.equal(mar2026.startingOffset, 6);
    assert.equal((mar2026.startingOffset + mar2026.totalDays + mar2026.trailingBlanks.length) % 7, 0);

    // September 2026: September 1, 2026 is a Tuesday -> offset 1
    const sep2026 = computeGrid(2026, 9);
    assert.equal(sep2026.totalDays, 30);
    assert.equal(sep2026.startingOffset, 1);
    assert.equal((sep2026.startingOffset + sep2026.totalDays + sep2026.trailingBlanks.length) % 7, 0);

    // February 2024 (Leap year): Feb 1, 2024 is Thursday -> offset 3, days 29
    const feb2024 = computeGrid(2024, 2);
    assert.equal(feb2024.totalDays, 29);
    assert.equal(feb2024.startingOffset, 3);
  });

  test('Month Shifting & Year Boundary Wrapping', () => {
    function shiftMonth(year: number, month: number, delta: number) {
      let newMonth = month + delta;
      let newYear = year;
      if (newMonth > 12) {
        newMonth = 1;
        newYear += 1;
      } else if (newMonth < 1) {
        newMonth = 12;
        newYear -= 1;
      }
      return { year: newYear, month: newMonth };
    }

    assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
    assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
    assert.deepEqual(shiftMonth(2026, 6, 1), { year: 2026, month: 7 });
    assert.deepEqual(shiftMonth(2026, 6, -1), { year: 2026, month: 5 });
  });
});
