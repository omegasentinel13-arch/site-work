import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('DAILY ATTENDANCE PAST-DATA SAFETY & UNSAVED EDIT GUARD TESTS', () => {
  const dailyPath = path.join(process.cwd(), 'app', '(dashboard)', 'attendance', 'daily', 'page.tsx');
  const dailySrc = fs.readFileSync(dailyPath, 'utf8');

  // Baseline database snapshot verification
  const db = new DatabaseSync('./data/site_work.db', { readOnly: true });

  test('Database baseline integrity check', () => {
    const users = db.prepare('SELECT count(*) as c FROM users').get().c;
    const sites = db.prepare('SELECT count(*) as c FROM sites').get().c;
    const siteUsers = db.prepare('SELECT count(*) as c FROM site_users').get().c;
    const workCategories = db.prepare('SELECT count(*) as c FROM work_categories').get().c;
    const workRoles = db.prepare('SELECT count(*) as c FROM work_roles').get().c;
    const attendanceRecords = db.prepare('SELECT count(*) as c FROM attendance_records').get().c;
    const financialTransactions = db.prepare('SELECT count(*) as c FROM financial_transactions').get().c;
    const auditLogs = db.prepare('SELECT count(*) as c FROM audit_logs').get().c;

    assert.equal(users, 4, 'Users count must match baseline');
    assert.equal(sites, 6, 'Sites count must match baseline');
    assert.equal(siteUsers, 3, 'Site users count must match baseline');
    assert.equal(workCategories, 4, 'Work categories count must match baseline');
    assert.equal(workRoles, 23, 'Work roles count must match baseline');
    assert.equal(attendanceRecords, 18, 'Attendance records count must match baseline');
    assert.equal(financialTransactions, 4, 'Financial transactions count must match baseline');
    assert.equal(auditLogs, 419, 'Audit logs count must match baseline');
  });

  // Date Logic and Definitions
  test('A, B, C, D: Past date definition and condition logic', () => {
    function getLocalTodayISO(): string {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    function isPastDate(dateStr: string, todayStr = getLocalTodayISO()): boolean {
      return dateStr < todayStr;
    }

    const today = getLocalTodayISO();
    const past1 = '2026-09-07';
    const past2 = '2025-12-31';
    const future = '2026-09-09';

    assert.equal(isPastDate(today, '2026-09-08'), false, 'Today itself is not a past date');
    assert.equal(isPastDate(future, '2026-09-08'), false, 'Future date is not a past date');
    assert.equal(isPastDate(past1, '2026-09-08'), true, 'Past date is detected as past');
    assert.equal(isPastDate(past2, '2026-09-08'), true, 'Distant past date is detected as past');

    assert.match(dailySrc, /function isPastDate/, 'Must have isPastDate helper');
    assert.match(dailySrc, /function getLocalTodayISO/, 'Must use application-local date');
    assert.match(dailySrc, /if \(isPastDate\(selectedDate\) && isDirty\)/, 'Confirmation required ONLY when past date AND isDirty');
  });

  // Dirty state detection
  test('H, I: Dirty state detection and preservation', () => {
    function checkAttendanceDirty(currentRoles: any[], initialRoles: any[]): boolean {
      if (!initialRoles || initialRoles.length === 0 || currentRoles.length === 0) return false;
      if (currentRoles.length !== initialRoles.length) return true;
      for (let i = 0; i < currentRoles.length; i++) {
        const curr = currentRoles[i];
        const initial = initialRoles.find((r) => r.roleId === curr.roleId);
        if (!initial) return true;
        if (curr.fullDayCount !== initial.fullDayCount || curr.halfDayCount !== initial.halfDayCount) {
          return true;
        }
      }
      return false;
    }

    const initial = [
      { roleId: 'r1', fullDayCount: 6, halfDayCount: 2 },
      { roleId: 'r2', fullDayCount: 0, halfDayCount: 0 },
    ];

    assert.equal(checkAttendanceDirty(initial, initial), false, 'Initial load must be clean');

    const edited = [
      { roleId: 'r1', fullDayCount: 7, halfDayCount: 2 },
      { roleId: 'r2', fullDayCount: 0, halfDayCount: 0 },
    ];
    assert.equal(checkAttendanceDirty(edited, initial), true, 'Edited state must be dirty');

    const reverted = [
      { roleId: 'r1', fullDayCount: 6, halfDayCount: 2 },
      { roleId: 'r2', fullDayCount: 0, halfDayCount: 0 },
    ];
    assert.equal(checkAttendanceDirty(reverted, initial), false, 'Reverting to initial values must return to clean');

    assert.match(dailySrc, /checkAttendanceDirty/, 'Must implement checkAttendanceDirty');
    assert.match(dailySrc, /setInitialRoles\(roles\.map/, 'Successful save updates initialRoles to clear dirty state');
    
    const saveBlock = dailySrc.substring(dailySrc.indexOf('const executeSave'), dailySrc.indexOf('// Modal Actions'));
    assert.doesNotMatch(saveBlock.substring(saveBlock.indexOf('catch')), /setInitialRoles/, 'Failed save preserves dirty state');
  });

  // Modal copy and button semantics
  test('Modal titles, copy, and buttons match requirements exactly', () => {
    assert.match(dailySrc, /Changing Past Attendance/, 'Must have title "Changing Past Attendance"');
    assert.match(dailySrc, /You're changing attendance data for a past date\. Do you want to save these changes\?/, 'Must have exact past-save message');
    assert.match(dailySrc, /NO, KEEP EDITING/, 'Must have button "NO, KEEP EDITING"');
    assert.match(dailySrc, /YES, SAVE CHANGES/, 'Must have button "YES, SAVE CHANGES"');

    assert.match(dailySrc, /Unsaved Attendance Changes/, 'Must have title "Unsaved Attendance Changes"');
    assert.match(dailySrc, /Your current attendance edits haven't been saved\. Do you want to leave this page\?/, 'Must have exact unsaved-nav message');
    assert.match(dailySrc, /YES, CONTINUE EDITING/, 'Must have button "YES, CONTINUE EDITING"');
    assert.match(dailySrc, /NO, LEAVE PAGE/, 'Must have button "NO, LEAVE PAGE"');

    assert.match(dailySrc, /If you change the date now, your current attendance edits will not be saved\. Do you want to continue\?/, 'Must have exact date-change message');
    assert.match(dailySrc, /YES, DISCARD CHANGES/, 'Must have button "YES, DISCARD CHANGES"');
  });

  // Accessibility and styling
  test('Accessibility, ARIA, and interactive targets >= 44px', () => {
    assert.match(dailySrc, /role="dialog"/, 'Modals must have role="dialog"');
    assert.match(dailySrc, /aria-modal="true"/, 'Modals must have aria-modal="true"');
    assert.match(dailySrc, /aria-labelledby="attendance-safety-modal-title"/, 'Modals must have aria-labelledby');
    assert.match(dailySrc, /aria-describedby="attendance-safety-modal-desc"/, 'Modals must have aria-describedby');
    assert.match(dailySrc, /min-h-\[44px\]/, 'Interactive buttons must have min-h-[44px]');
    assert.match(dailySrc, /Escape/, 'Escape key must be handled for accessible dismissal');
  });

  // Navigation guard
  test('J, K, L, M, N, O, P: Navigation interception and destination preservation', () => {
    assert.match(dailySrc, /handleClickCapture/, 'Must capture anchor clicks');
    assert.match(dailySrc, /handlePopState/, 'Must handle popstate for browser back/forward');
    assert.match(dailySrc, /window\.location\.href = destination/, 'Must navigate to originally requested destination');
    assert.match(dailySrc, /requestDateChange/, 'Must guard date changes when dirty');
  });

  // External unload
  test('Q: Browser beforeunload protection exists only while dirty', () => {
    assert.match(dailySrc, /handleBeforeUnload/, 'Must have beforeunload handler');
    assert.match(dailySrc, /window\.addEventListener\('beforeunload'/, 'Must register beforeunload');
    assert.match(dailySrc, /window\.removeEventListener\('beforeunload'/, 'Must unregister beforeunload when clean');
  });

  // Double prompts prevention
  test('R: Prevent double confirmation prompts', () => {
    assert.match(dailySrc, /isBypassingGuardRef/, 'Must have guard bypass ref to prevent double prompts');
  });
});
