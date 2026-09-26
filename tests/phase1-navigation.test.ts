import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteContext, Site, User } from '../context/site-context';
import { ThemeProvider } from '../context/theme-context';
import { Navigation } from '../components/layout/Navigation';
import { Header } from '../components/layout/Header';
import fs from 'node:fs';
import path from 'node:path';

describe('SITE WORK — PHASE 1: Navigation & Label Standardization Verification', () => {
  const mockSites: Site[] = [
    { id: 'site-1', name: 'Riverside Commercial Center', code: 'RCC', location: 'Riverside', is_archived: 0 },
  ];

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

  function renderLayout(user: User) {
    const contextValue = {
      user,
      sites: mockSites,
      selectedSite: mockSites[0],
      selectedSiteId: mockSites[0].id,
      setSelectedSiteId: () => {},
      isLoading: false,
      refreshSites: async () => {},
      refreshUser: async () => {},
      logout: async () => {},
    };

    const nav = renderToString(
      React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(Navigation))
    );
    const header = renderToString(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(Header))
      )
    );

    return { nav, header };
  }

  const containsText = (html: string, text: string) => {
    const encoded = text.replace(/&/g, '&amp;');
    return html.includes(text) || html.includes(encoded);
  };

  test('A. Navigation Labels — Weekly Attendance is visible, Weekly Matrix is absent', () => {
    for (const user of [mockAdmin, mockSiteManager, mockViewer]) {
      const { nav } = renderLayout(user);
      assert.ok(containsText(nav, 'Weekly Attendance'), `Weekly Attendance must be in desktop nav for ${user.role}`);
      assert.ok(!containsText(nav, 'Weekly Matrix'), `Weekly Matrix must NOT be in desktop nav for ${user.role}`);
    }

    // Verify Header.tsx source code contains Weekly Attendance and NOT Weekly Matrix
    const headerSource = fs.readFileSync(path.join(process.cwd(), 'components/layout/Header.tsx'), 'utf8');
    assert.ok(headerSource.includes("'Weekly Attendance'"), 'Header.tsx must contain Weekly Attendance');
    assert.ok(!headerSource.includes("'Weekly Matrix'"), 'Header.tsx must NOT contain Weekly Matrix');
  });

  test('B. Attendance Standard Labels', () => {
    for (const user of [mockAdmin, mockSiteManager, mockViewer]) {
      const { nav } = renderLayout(user);
      assert.ok(containsText(nav, 'Daily Attendance'), 'Daily Attendance must be present');
      assert.ok(containsText(nav, 'Weekly Attendance'), 'Weekly Attendance must be present');
      assert.ok(containsText(nav, 'Monthly Attendance'), 'Monthly Attendance must be present');
      assert.ok(!containsText(nav, 'Daily Entry'), 'Daily Entry must NOT be present');
      assert.ok(!containsText(nav, 'Monthly Report'), 'Monthly Report must NOT be present');
    }
  });

  test('C. Money Standard Labels', () => {
    for (const user of [mockAdmin, mockSiteManager, mockViewer]) {
      const { nav } = renderLayout(user);
      assert.ok(containsText(nav, 'Transactions'), 'Transactions must be present');
      assert.ok(containsText(nav, 'Monthly Statement'), 'Monthly Statement must be present');
      assert.ok(!containsText(nav, 'Monthly Ledger'), 'Monthly Ledger must NOT be present');
    }
  });

  test('D. Governance & RBAC — Admin sees Reports & Backup and setup links', () => {
    const { nav } = renderLayout(mockAdmin);
    assert.ok(containsText(nav, 'Reports & Backup'), 'Admin must see Reports & Backup in desktop nav');
    assert.ok(nav.includes('/admin/data-protection'), 'Admin must link to /admin/data-protection');
    assert.ok(containsText(nav, 'Project Sites'), 'Admin must see Project Sites');
    assert.ok(containsText(nav, 'Roles & Rates'), 'Admin must see Roles & Rates');
    assert.ok(containsText(nav, 'Users & Access'), 'Admin must see Users & Access');
    assert.ok(containsText(nav, 'Audit Trail'), 'Admin must see Audit Trail');
    assert.ok(containsText(nav, 'My Account'), 'Admin must see My Account');

    const headerSource = fs.readFileSync(path.join(process.cwd(), 'components/layout/Header.tsx'), 'utf8');
    assert.ok(headerSource.includes("'Reports & Backup'"), 'Header.tsx must contain Reports & Backup');
  });

  test('E. Governance & RBAC — Site Manager sees Reports & Backup and My Account', () => {
    const { nav } = renderLayout(mockSiteManager);
    assert.ok(containsText(nav, 'Reports & Backup'), 'Site Manager must see Reports & Backup');
    assert.ok(nav.includes('/admin/data-protection'), 'Site Manager links to /admin/data-protection');
    assert.ok(containsText(nav, 'My Account'), 'Site Manager sees My Account');
    // Site Manager must NOT see admin-only items
    assert.ok(!containsText(nav, 'Project Sites'), 'Site Manager must NOT see Project Sites');
    assert.ok(!containsText(nav, 'Roles & Rates'), 'Site Manager must NOT see Roles & Rates');
    assert.ok(!containsText(nav, 'Users & Access'), 'Site Manager must NOT see Users & Access');
    assert.ok(!containsText(nav, 'Audit Trail'), 'Site Manager must NOT see Audit Trail');
  });

  test('F. Governance & RBAC — Viewer strictly blocked from Reports & Backup', () => {
    const { nav } = renderLayout(mockViewer);
    assert.ok(!containsText(nav, 'Reports & Backup'), 'Viewer must NOT see Reports & Backup in desktop nav');
    assert.ok(!nav.includes('/admin/data-protection'), 'Viewer must NOT have /admin/data-protection link');
    assert.ok(!containsText(nav, 'Data & Protection'), 'Viewer must NOT see Data & Protection');
    assert.ok(!containsText(nav, 'Backup & Recovery'), 'Viewer must NOT see Backup & Recovery');
    assert.ok(!containsText(nav, 'Complete Export'), 'Viewer must NOT see Complete Export');
    assert.ok(containsText(nav, 'My Account'), 'Viewer has My Account');
  });

  test('G. Removed primary navigation items are absent for all roles', () => {
    for (const user of [mockAdmin, mockSiteManager, mockViewer]) {
      const { nav } = renderLayout(user);
      assert.ok(!containsText(nav, 'Complete Export'), `Complete Export must NOT be in desktop nav for ${user.role}`);
      assert.ok(!containsText(nav, 'Backup & Recovery'), `Backup & Recovery must NOT be in desktop nav for ${user.role}`);
      assert.ok(!containsText(nav, 'Site Backup'), `Site Backup must NOT be in desktop nav for ${user.role}`);
      assert.ok(!containsText(nav, 'Category Summary'), `Category Summary must NOT be in desktop nav for ${user.role}`);
      assert.ok(!containsText(nav, 'Site Overview'), `Site Overview must NOT be in desktop nav for ${user.role}`);
    }

    const headerSource = fs.readFileSync(path.join(process.cwd(), 'components/layout/Header.tsx'), 'utf8');
    assert.ok(!headerSource.includes("'Complete Export'"), 'Header.tsx must NOT contain Complete Export');
    assert.ok(!headerSource.includes("'Backup & Recovery'"), 'Header.tsx must NOT contain Backup & Recovery');
    assert.ok(!headerSource.includes("'Category Summary'"), 'Header.tsx must NOT contain Category Summary');
    assert.ok(!headerSource.includes("'Site Overview'"), 'Header.tsx must NOT contain Site Overview');
  });

  test('H. Physical preservation of all 8 required routes', () => {
    const requiredRoutes = [
      'app/(dashboard)/attendance/weekly/page.tsx',
      'app/(dashboard)/attendance/monthly/page.tsx',
      'app/(dashboard)/reports/complete-export/page.tsx',
      'app/(dashboard)/admin/backup/page.tsx',
      'app/(dashboard)/reports/role/page.tsx',
      'app/(dashboard)/reports/category/page.tsx',
      'app/(dashboard)/reports/site/page.tsx',
      'app/(dashboard)/admin/data-protection/page.tsx',
    ];

    for (const route of requiredRoutes) {
      const fullPath = path.join(process.cwd(), ...route.split('/'));
      assert.ok(fs.existsSync(fullPath), `Route file ${route} must exist`);
    }
  });
});
