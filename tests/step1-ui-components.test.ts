import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteContext, Site, User } from '../context/site-context';
import { ThemeProvider } from '../context/theme-context';
import { ReportCenterSection } from '../components/reports/ReportCenterSection';
import DataProtectionCenterPage from '../app/(dashboard)/admin/data-protection/page';
import { REPORT_LIST } from '../lib/reports/registry';

describe('TASK 4 — STEP 1: UI Components & Dual-Domain Command Center Tests', () => {
  const mockSites: Site[] = [
    { id: 'site-1', name: 'Riverside Commercial Center', code: 'RCC', location: 'Riverside', is_archived: 0 },
    { id: 'site-2', name: 'Metro Station Extension', code: 'MSE', location: 'Metro', is_archived: 0 },
  ];

  const mockAdmin: User = {
    id: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Chief Administrator',
    role: 'ADMIN',
    assignedSiteIds: [],
  };

  const mockSiteManager: User = {
    id: 'usr-eng-1',
    username: 'site_engineer',
    fullName: 'Site Engineer 1',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
  };

  const mockViewer: User = {
    id: 'usr-view-1',
    username: 'auditor_viewer',
    fullName: 'External Auditor',
    role: 'VIEWER',
    assignedSiteIds: ['site-1'],
  };

  function renderWithContext(component: React.ReactElement, user: User) {
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

    return renderToString(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(SiteContext.Provider, { value: contextValue }, component)
      )
    );
  }

  test('1. ReportCenterSection renders all 11 user-facing reports in selection', () => {
    const html = renderWithContext(React.createElement(ReportCenterSection), mockAdmin);

    // 1-Click Hero Card
    assert.ok(html.includes('Generate Complete Project Report'));

    // Check that all 11 reports appear in the options
    for (const report of REPORT_LIST) {
      const escaped = report.label.replace(/&/g, '&amp;');
      assert.ok(
        html.includes(report.label) || html.includes(escaped),
        `Report option "${report.label}" must be rendered in ReportCenterSection`
      );
    }

    // Assert Quick Presets
    assert.ok(html.includes('This Month'));
    assert.ok(html.includes('This Year'));
    assert.ok(html.includes('All Recorded Dates'));

    // Assert Export actions
    assert.ok(html.includes('Export PDF'));
    assert.ok(html.includes('Export Excel'));
  });

  test('2. DataProtectionCenterPage renders Dual-Domain tabs', () => {
    const html = renderWithContext(React.createElement(DataProtectionCenterPage), mockAdmin);

    assert.ok(html.includes('REPORTS &amp; BACKUP COMMAND CENTER') || html.includes('REPORTS & BACKUP COMMAND CENTER'));
    assert.ok(html.includes('Report Center'));
    assert.ok(html.includes('11 Reports'));
    assert.ok(html.includes('Backup &amp; Recovery Center') || html.includes('Backup & Recovery Center'));
  });

  test('3. Viewer role on DataProtectionCenterPage is blocked with Access Denied', () => {
    const html = renderWithContext(React.createElement(DataProtectionCenterPage), mockViewer);

    assert.ok(html.includes('Access Denied'));
    assert.ok(!html.includes('1-CLICK COMPLETE PROJECT REPORT'));
  });

  test('4. Site Manager has single site scope and authorized sites only', () => {
    const html = renderWithContext(React.createElement(ReportCenterSection), mockSiteManager);

    // Site Manager must see assigned site-1
    assert.ok(html.includes('Riverside Commercial Center'));
    // Site Manager should NOT see site-2 in their authorized dropdown
    assert.ok(!html.includes('Metro Station Extension'));
  });
});
