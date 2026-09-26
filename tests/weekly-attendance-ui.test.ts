import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteContext, Site, User } from '../context/site-context';
import WeeklyAttendanceReportPage from '../app/(dashboard)/attendance/weekly/page';
import fs from 'node:fs';
import path from 'node:path';

describe('WEEKLY ATTENDANCE UI & DATE RANGE VERIFICATION', () => {
  const mockSite: Site = {
    id: 'site-1',
    name: 'Riverside Commercial Center',
    code: 'RCC',
    location: 'Riverside East',
    is_archived: 0,
  };

  const mockAdmin: User = {
    id: 'usr-admin-1',
    username: 'admin',
    fullName: 'Admin User',
    role: 'ADMIN',
    assignedSiteIds: [],
  };

  const mockSiteManager: User = {
    id: 'usr-mgr-1',
    username: 'manager',
    fullName: 'Manager User',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
  };

  const mockViewer: User = {
    id: 'usr-view-1',
    username: 'viewer',
    fullName: 'Viewer User',
    role: 'VIEWER',
    assignedSiteIds: ['site-1'],
  };

  function renderWeekly(user: User) {
    const contextValue = {
      user,
      sites: [mockSite],
      selectedSite: mockSite,
      selectedSiteId: mockSite.id,
      setSelectedSiteId: () => {},
      isLoading: false,
      refreshSites: async () => {},
      refreshUser: async () => {},
      logout: async () => {},
    };

    return renderToString(
      React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(WeeklyAttendanceReportPage))
    );
  }

  test('1. Page Title is Weekly Attendance and Weekly Workforce Matrix is absent', () => {
    const html = renderWeekly(mockAdmin);
    assert.match(html, />Weekly Attendance<\/h1>/, 'Must feature Weekly Attendance heading');
    assert.doesNotMatch(html, /Weekly Workforce Matrix/, 'Must NOT contain Weekly Workforce Matrix');
  });

  test('2. From Date and To Date controls exist and use custom DatePicker', () => {
    const html = renderWeekly(mockAdmin);
    assert.match(html, /id="weekly-from-date-trigger"/, 'From Date trigger must exist');
    assert.match(html, /id="weekly-to-date-trigger"/, 'To Date trigger must exist');
    assert.match(html, /aria-label="From Date"/, 'From Date accessible label must exist');
    assert.match(html, /aria-label="To Date"/, 'To Date accessible label must exist');
    assert.doesNotMatch(html, /<input[^>]+type="date"/, 'Browser-native date input must not exist');
  });

  test('3. Default range covers current week (7 Days, Max 7)', () => {
    const html = renderWeekly(mockAdmin);
    assert.match(html, /7.*Days.*\(Max 7\)/, 'Must display 7 Days (Max 7) range badge');
    assert.match(html, /Selected Range:/, 'Selected Range text must be present');
  });

  test('4. Category Banner Rows use dark blue/navy + white typography', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/attendance/weekly/page.tsx'), 'utf8');
    assert.match(source, /bg-slate-900 dark:bg-\[#18191C\] text-white/, 'Category Banner row must use dark blue/navy + white typography');
    assert.match(source, /cat\.categoryName/, 'Category name must be displayed');
  });

  test('5. Subtotal Rows use inverted dark blue/navy + white typography', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/attendance/weekly/page.tsx'), 'utf8');
    assert.match(source, /bg-slate-800 dark:bg-\[#202225\] text-white font-bold/, 'Subtotal must use inverted dark blue + white');
    assert.match(source, /Subtotal/, 'Subtotal label must exist');
  });

  test('6. Grand Total Row uses inverted dark blue/navy + white typography', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/attendance/weekly/page.tsx'), 'utf8');
    assert.match(source, /Grand Daily Total/, 'Grand Daily Total must exist');
    assert.match(source, /bg-slate-900 dark:bg-\[#18191C\] text-white font-black/, 'Grand Total must use inverted dark blue/navy + white');
  });

  test('7. Thin black vertical separators between day columns are present', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/attendance/weekly/page.tsx'), 'utf8');
    assert.match(source, /border-l border-black dark:border-\[#3A3D42\]/, 'Day columns must have thin black vertical separators');
    assert.doesNotMatch(source, /border-l-4 border-black/, 'Separators must not be thick/heavy');
  });

  test('8. DatePicker minDate and maxDate enforce strict 7-day limit', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'app/(dashboard)/attendance/weekly/page.tsx'), 'utf8');
    assert.match(source, /minDate=\{startDateStr\}/, 'To Date minDate must be From Date');
    assert.match(source, /maxDate=\{maxToDateStr\}/, 'To Date maxDate must be maxToDateStr');
    assert.match(source, /addDays\(parseDateISO\(startDateStr\), 6\)/, 'maxToDateStr must be startDateStr + 6 days');
  });

  test('9. RBAC: Site Manager and Viewer render Weekly Attendance with assigned scope', () => {
    const htmlMgr = renderWeekly(mockSiteManager);
    assert.match(htmlMgr, /Weekly Attendance/, 'Site Manager sees Weekly Attendance');
    assert.match(htmlMgr, /Riverside Commercial Center/, 'Site Manager sees assigned site');

    const htmlViewer = renderWeekly(mockViewer);
    assert.match(htmlViewer, /Weekly Attendance/, 'Viewer sees Weekly Attendance');
    assert.match(htmlViewer, /Riverside Commercial Center/, 'Viewer sees assigned site');
  });
});