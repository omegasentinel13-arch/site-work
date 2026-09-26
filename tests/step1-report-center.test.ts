import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { REPORT_DEFINITIONS, REPORT_LIST, ReportType } from '../lib/reports/registry';
import { Navigation } from '../components/layout/Navigation';
import { Header } from '../components/layout/Header';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteContext, Site, User } from '../context/site-context';
import { ThemeProvider } from '../context/theme-context';

describe('TASK 4 — STEP 1: Report Center & Registry Verification', () => {
  const mockSites: Site[] = [
    { id: 'site-1', name: 'Riverside Commercial Center', code: 'RCC', location: 'Riverside', is_archived: 0 },
    { id: 'site-2', name: 'Metro Station Extension', code: 'MSE', location: 'Metro', is_archived: 0 },
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

  test('1. REPORT COUNT: Exactly 11 user-facing reports in registry', () => {
    assert.strictEqual(REPORT_LIST.length, 11, 'Registry must expose exactly 11 user-facing report types');
    
    // Assert SYSTEM_COMPLETE and AUDIT_LOG_REPORT are NOT in the user-facing report list
    const hasSystemComplete = REPORT_LIST.some((r) => (r.id as string) === 'SYSTEM_COMPLETE');
    assert.strictEqual(hasSystemComplete, false, 'SYSTEM_COMPLETE must NOT be exposed as a separate report');

    const hasAuditLogReport = REPORT_LIST.some((r) => (r.id as string) === 'AUDIT_LOG_REPORT');
    assert.strictEqual(hasAuditLogReport, false, 'AUDIT_LOG_REPORT must NOT be in the user-facing report list');

    // Verify all 11 expected approved IDs are present
    const expectedIds: ReportType[] = [
      'COMPLETE_REPORT',
      'DAILY_ATTENDANCE',
      'WEEKLY_ATTENDANCE',
      'MONTHLY_ATTENDANCE',
      'TRANSACTIONS',
      'MASTER_LEDGER',
      'LABOUR_WORKER',
      'ROLE_REPORT',
      'CATEGORY_REPORT',
      'SITE_PERFORMANCE',
      'ALL_SITES_CONSOLIDATED',
    ];

    for (const id of expectedIds) {
      assert.ok(REPORT_DEFINITIONS[id], `Report definition for ${id} must exist`);
    }
  });

  test('2. REPORT CAPABILITIES: Capabilities properly configured for each report', () => {
    // COMPLETE_REPORT supports both SITE and ALL_SITES scopes
    const completeReport = REPORT_DEFINITIONS['COMPLETE_REPORT'];
    assert.ok(completeReport.supportedScopes.includes('SITE'));
    assert.ok(completeReport.supportedScopes.includes('ALL_SITES'));
    assert.strictEqual(completeReport.hasPdf, true);
    assert.strictEqual(completeReport.hasExcel, true);

    // DAILY_ATTENDANCE supports both SITE and ALL_SITES scopes
    const dailyAtt = REPORT_DEFINITIONS['DAILY_ATTENDANCE'];
    assert.ok(dailyAtt.supportedScopes.includes('SITE'));
    assert.strictEqual(dailyAtt.hasPdf, true);
    assert.strictEqual(dailyAtt.hasExcel, true);

    // WEEKLY_ATTENDANCE only supports SITE scope
    const weeklyAtt = REPORT_DEFINITIONS['WEEKLY_ATTENDANCE'];
    assert.deepStrictEqual(weeklyAtt.supportedScopes, ['SITE']);

    // ALL_SITES_CONSOLIDATED supports ALL_SITES scope
    const allSitesReport = REPORT_DEFINITIONS['ALL_SITES_CONSOLIDATED'];
    assert.deepStrictEqual(allSitesReport.supportedScopes, ['ALL_SITES']);
    assert.strictEqual(allSitesReport.hasPdf, true);
    assert.strictEqual(allSitesReport.hasExcel, true);
  });

  test('3. NAVIGATION HIERARCHY: Reports & Backup placed strictly between Audit Trail and My Account', () => {
    function renderNav(user: User) {
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

      const navHtml = renderToString(
        React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(Navigation))
      );

      return { navHtml };
    }

    const { navHtml } = renderNav(mockAdmin);

    // Check desktop Navigation order: Audit Trail -> Reports & Backup -> My Account
    const auditIndex = navHtml.indexOf('Audit Trail');
    const reportsIndex = navHtml.indexOf('Reports &amp; Backup');
    const accountIndex = navHtml.indexOf('My Account');

    assert.ok(auditIndex !== -1, 'Audit Trail must be present in desktop nav');
    assert.ok(reportsIndex !== -1, 'Reports & Backup must be present in desktop nav');
    assert.ok(accountIndex !== -1, 'My Account must be present in desktop nav');

    assert.ok(
      auditIndex < reportsIndex,
      `Audit Trail (pos ${auditIndex}) must precede Reports & Backup (pos ${reportsIndex})`
    );
    assert.ok(
      reportsIndex < accountIndex,
      `Reports & Backup (pos ${reportsIndex}) must precede My Account (pos ${accountIndex})`
    );

    // Check Header.tsx source code for identical Setup & Admin order
    const headerSource = fs.readFileSync(path.join(process.cwd(), 'components/layout/Header.tsx'), 'utf8');
    const hAuditIdx = headerSource.indexOf("label: 'Audit Trail'");
    const hReportsIdx = headerSource.indexOf("label: 'Reports & Backup'");
    const hAccountIdx = headerSource.indexOf("label: 'My Account'");

    assert.ok(hAuditIdx !== -1, 'Audit Trail must be present in Header.tsx');
    assert.ok(hReportsIdx !== -1, 'Reports & Backup must be present in Header.tsx');
    assert.ok(hAccountIdx !== -1, 'My Account must be present in Header.tsx');

    assert.ok(
      hAuditIdx < hReportsIdx,
      `Header.tsx: Audit Trail (pos ${hAuditIdx}) must precede Reports & Backup (pos ${hReportsIdx})`
    );
    assert.ok(
      hReportsIdx < hAccountIdx,
      `Header.tsx: Reports & Backup (pos ${hReportsIdx}) must precede My Account (pos ${hAccountIdx})`
    );
  });

  test('4. CANONICAL ROUTE ALIAS: /setup/reports-backup physically exists and re-exports', () => {
    const aliasPath = path.join(process.cwd(), 'app', '(dashboard)', 'setup', 'reports-backup', 'page.tsx');
    assert.ok(fs.existsSync(aliasPath), 'Route app/(dashboard)/setup/reports-backup/page.tsx must exist');

    const content = fs.readFileSync(aliasPath, 'utf8');
    assert.ok(content.includes("import DataProtectionCenterPage from '../../admin/data-protection/page'"));
    assert.ok(content.includes('export default DataProtectionCenterPage'));
  });

  test('5. PRODUCTION DATABASE SAFETY: Baseline counts remain identical and untouched', () => {
    const db = new DatabaseSync('data/site_work.db', { readOnly: true });

    const expectedCounts = {
      users: 6,
      sites: 6,
      site_users: 8,
      work_categories: 4,
      work_roles: 23,
      site_role_rates: 1,
      attendance_records: 18,
      financial_transactions: 4,
      investors: 1,
      supply_items: 0,
      system_lifecycle_records: 0,
      permission_definitions: 45,
      role_permissions: 0,
      user_permission_overrides: 0,
      audit_logs: 462,
      recovery_tokens: 12,
    };

    for (const [table, count] of Object.entries(expectedCounts)) {
      const row = db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      assert.strictEqual(
        row.count,
        count,
        `Table ${table} count must remain exactly ${count}, got ${row.count}`
      );
    }

    const integrity = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
    assert.strictEqual(integrity, 'ok');

    const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
    assert.strictEqual(foreignKeys.length, 0);

    db.close();
  });
});
