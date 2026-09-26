import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteContext, Site, User } from '../context/site-context';
import DashboardPage from '../app/(dashboard)/page';
import fs from 'node:fs';
import path from 'node:path';
import { Navigation } from '../components/layout/Navigation';
import { Header } from '../components/layout/Header';
import { ThemeProvider } from '../context/theme-context';

describe('DASHBOARD UI REDESIGN VERIFICATION', () => {
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

  function renderDashboard(user: User) {
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
      React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(DashboardPage))
    );
  }

  test('1. Separate Add Credit and Add Debit buttons are REMOVED from Quick Actions', () => {
    const html = renderDashboard(mockAdmin);
    assert.doesNotMatch(html, />Add Credit</, 'Add Credit must not be rendered');
    assert.doesNotMatch(html, />Add Debit</, 'Add Debit must not be rendered');
  });

  test('2. Common Add button exists and links to existing /finance route', () => {
    const html = renderDashboard(mockAdmin);
    assert.match(html, /id="dashboard-common-add-btn"/, 'Common Add button must exist with id');
    assert.match(html, /href="\/finance"/, 'Common Add button must link to /finance');
    assert.match(html, />Add<\/span>/, 'Common Add button must display "Add" action text');
  });

  test('3. Common Add button provides semantic split Credit (green) and Debit (red) visual cues', () => {
    const html = renderDashboard(mockAdmin);
    assert.match(html, /bg-emerald-600/, 'Credit half must have green/emerald background');
    assert.match(html, />Credit<\/span>/, 'Credit label must be visible in split pill');
    assert.match(html, /bg-rose-600/, 'Debit half must have red/rose background');
    assert.match(html, />Debit<\/span>/, 'Debit label must be visible in split pill');
    assert.match(html, /aria-label="Add Transaction \(Credit or Debit\)"/, 'Must have accessible label');
    assert.match(html, /min-h-\[44px\]/, 'Must meet >=44px interactive target requirement');
  });

  test('4. Attendance Summaries: Worker Days is REMOVED from Today, This Week, and This Month', () => {
    const html = renderDashboard(mockAdmin);
    assert.doesNotMatch(html, /Worker-Days<\/span><span class="text-xs text-slate-500/, 'Week worker-days card removed');
    assert.doesNotMatch(html, /Monthly Worker-Days/, 'Month worker-days card removed');
  });

  test('5. Today / This Week / This Month display Total Workers, Equation, and Labour Cost', () => {
    const html = renderDashboard(mockAdmin);
    const totalWorkersMatches = html.match(/Total Workers/g);
    assert.ok(totalWorkersMatches && totalWorkersMatches.length >= 3, 'Total Workers must appear in all 3 periods');

    const labourCostMatches = html.match(/Labour Cost/g);
    assert.ok(labourCostMatches && labourCostMatches.length >= 3, 'Labour Cost must appear in all 3 periods');

    assert.match(html, /Full<\/span>/, 'Equation Full present label must exist');
    assert.match(html, /Half<\/span>/, 'Equation Half present label must exist');
    assert.match(html, /Day Count<\/span>/, 'Equation Day Count label must exist');
    assert.doesNotMatch(html, /\d+\s*Workers<\/span>/, 'Equation Workers total label must be removed');
  });

  test('6. RBAC: Site Manager and Viewer render dashboard with correct scope', () => {
    const htmlMgr = renderDashboard(mockSiteManager);
    assert.match(htmlMgr, /Riverside Commercial Center/, 'Site Manager sees assigned site');
    assert.match(htmlMgr, /id="dashboard-common-add-btn"/, 'Site Manager has Add button');

    const htmlViewer = renderDashboard(mockViewer);
    assert.match(htmlViewer, /Riverside Commercial Center/, 'Viewer sees assigned site');
  });

  test('7. Dashboard Attendance Cards and Site Overview are white/light with dark navy Labour Cost', () => {
    const html = renderDashboard(mockAdmin);
    assert.match(html, /Site Overview/, 'Site Overview banner must exist');
    assert.match(html, /bg-white dark:bg-\[#18191C\][\s\S]*?Site Overview/, 'Site Overview must feature white/light container');
    assert.match(html, /bg-slate-900 dark:bg-\[#202225\][\s\S]*?Labour Cost/, 'Labour Cost must feature dark navy box');
    assert.match(html, /bg-white dark:bg-\[#18191C\] rounded-xl border border-slate-900 dark:border-\[#3A3D42\] p-4 sm:p-5 shadow-sm space-y-4/, 'Attendance cards must be white/light');
  });

  test('8. Weekly Attendance label is present on Dashboard, Weekly Matrix is absent', () => {
    const html = renderDashboard(mockAdmin);
    assert.match(html, /Weekly Attendance →/, 'Dashboard must link to Weekly Attendance');
    assert.doesNotMatch(html, /Weekly Matrix/, 'Dashboard must NOT contain Weekly Matrix');
  });

  test('9. Role Breakdown navigation item is restored under Attendance', () => {
    for (const user of [mockAdmin, mockSiteManager, mockViewer]) {
      const contextValue = {
        user,
        sites: [mockSite],
        selectedSite: mockSite,
        selectedSiteId: 'site-1',
        setSelectedSiteId: () => {},
        selectSite: () => {},
        refreshSites: async () => {},
        loading: false,
      };
      const navHtml = renderToString(
        React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(Navigation))
      );
      assert.match(navHtml, /Role Breakdown/, `Role Breakdown must be visible in Navigation for ${user.role}`);
      assert.match(navHtml, /href="\/reports\/role"/, `Role Breakdown must link to /reports/role for ${user.role}`);
    }

    const headerSource = fs.readFileSync(path.join(process.cwd(), 'components/layout/Header.tsx'), 'utf8');
    assert.ok(headerSource.includes("'Role Breakdown'"), 'Header.tsx must contain Role Breakdown');
    assert.ok(headerSource.includes("href: '/reports/role'"), 'Header.tsx must link to /reports/role');
  });
});
