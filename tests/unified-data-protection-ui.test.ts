import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteContext, Site, User } from '../context/site-context';
import { ThemeProvider } from '../context/theme-context';
import DataProtectionCenterPage from '../app/(dashboard)/admin/data-protection/page';
import { Navigation } from '../components/layout/Navigation';
import { Header } from '../components/layout/Header';

describe('TASK 3 — STEP 2D — STAGE 3: Unified Data & Protection Center UI Tests', () => {
  const mockSites: Site[] = [
    { id: 'site-1', name: 'Riverside Commercial Center', code: 'RCC', location: 'Riverside', is_archived: 0 },
    { id: 'site-2', name: 'Metro Station Extension', code: 'MSE', location: 'Metro', is_archived: 0 },
  ];

  const mockAdminUser: User = {
    id: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Chief Administrator',
    role: 'ADMIN',
    assignedSiteIds: [],
  };

  const mockSiteManagerUser: User = {
    id: 'usr-eng-1',
    username: 'site_engineer',
    fullName: 'Site Engineer 1',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
  };

  const mockViewerUser: User = {
    id: 'usr-view-1',
    username: 'auditor_viewer',
    fullName: 'External Auditor',
    role: 'VIEWER',
    assignedSiteIds: ['site-1'],
  };

  function renderPageWithUser(user: User | null) {
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
        SiteContext.Provider,
        { value: contextValue },
        React.createElement(DataProtectionCenterPage)
      )
    );
  }

  function renderNavWithUser(user: User | null) {
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

    return {
      nav: renderToString(
        React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(Navigation))
      ),
      header: renderToString(
        React.createElement(
          ThemeProvider,
          null,
          React.createElement(SiteContext.Provider, { value: contextValue }, React.createElement(Header))
        )
      ),
    };
  }

  // 1. /admin/data-protection route exists
  test('1. /admin/data-protection route file physically exists', () => {
    const routePath = path.join(process.cwd(), 'app', '(dashboard)', 'admin', 'data-protection', 'page.tsx');
    assert.ok(fs.existsSync(routePath), 'page.tsx must exist in app/(dashboard)/admin/data-protection');
  });

  // 2. Page title renders
  test('2. Main page title DATA & PROTECTION CENTER renders', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('DATA &amp; PROTECTION CENTER') || html.includes('DATA & PROTECTION CENTER'));
    assert.ok(html.includes('Unified reporting, backup, recovery and package inspection'));
  });

  // 3. Section 1 renders
  test('3. Section 1 renders Complete Report & Export', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(
      html.includes('1. Complete Report &amp; Export') ||
      html.includes('1. Complete Report & Export') ||
      html.includes('1. Reports &amp; Complete Export') ||
      html.includes('1. Reports & Complete Export')
    );
  });

  // 4. Section 2 renders
  test('4. Section 2 renders Backup & Recovery', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('2. Backup &amp; Recovery') || html.includes('2. Backup & Recovery'));
  });

  // 5. Section 3 renders
  test('5. Section 3 renders Import & Load Package', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('3. Import &amp; Load Package') || html.includes('3. Import & Load Package'));
  });

  // 6. CompleteExportSection is reused
  test('6. CompleteExportSection is properly reused and rendered in Section 1', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('Export Scope &amp; Target Selection') || html.includes('Export Scope & Target Selection'));
    assert.ok(html.includes('Reporting Period Window'));
    assert.ok(html.includes('ZIP Archive Formats Included'));
  });

  // 7. PackageInspectorCard is reused
  test('7. PackageInspectorCard is properly reused and rendered in Section 3', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('Inspection &amp; Safe Preview Only') || html.includes('Inspection & Safe Preview Only'));
    assert.ok(html.includes('Drag &amp; drop package ZIP archive here') || html.includes('Drag & drop package ZIP archive here'));
  });

  // 8. Backup components are reused
  test('8. Existing Backup components are reused (BackupCreateCard, HistoryTable, etc.)', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('Create Enterprise Backup Archive'));
    assert.ok(
      html.includes('Backup Archives &amp; Disaster Recovery History') ||
      html.includes('Backup Archives & Disaster Recovery History')
    );
  });

  // 9. No duplicate export engine
  test('9. No duplicate export engine code exists in page.tsx', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app', '(dashboard)', 'admin', 'data-protection', 'page.tsx'),
      'utf8'
    );
    assert.ok(!source.includes('generateSiteCompleteJSON'));
    assert.ok(!source.includes('createCompleteExportZip'));
    assert.ok(!source.includes('excel-consolidator'));
  });

  // 10. No duplicate backup engine
  test('10. No duplicate backup engine code exists in page.tsx', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app', '(dashboard)', 'admin', 'data-protection', 'page.tsx'),
      'utf8'
    );
    assert.ok(!source.includes('createDatabaseSnapshot'));
    assert.ok(!source.includes('snapshot-engine'));
    assert.ok(!source.includes('checksum-service'));
  });

  // 11. No duplicate restore engine
  test('11. No duplicate restore engine code exists in page.tsx', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'app', '(dashboard)', 'admin', 'data-protection', 'page.tsx'),
      'utf8'
    );
    assert.ok(!source.includes('restore-executor'));
    assert.ok(!source.includes('restore-planner'));
    assert.ok(!source.includes('deep-validator'));
  });

  // 12. No import/reconcile button exists
  test('12. Invariant: Zero buttons named Import, Apply, Merge, or Reconcile exist', () => {
    const html = renderPageWithUser(mockAdminUser);
    const forbidden = ['Import', 'Apply', 'Merge', 'Restore Now', 'Overwrite Database', 'Reconcile Now'];
    for (const name of forbidden) {
      assert.ok(!html.includes(`>${name}<`), `Forbidden action button found: ${name}`);
    }
  });

  // 13. System recovery inspector does not expose executable restore
  test('13. Package Inspector Section 3 never renders an executable restore trigger', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(!html.includes('Execute Restore'));
    assert.ok(!html.includes('Restore Database'));
  });

  // 14. ADMIN visibility
  test('14. ADMIN user sees full administrative controls including upload zone', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('Verify &amp; Restore External Archive') || html.includes('Verify & Restore External Archive'));
    assert.ok(html.includes('Entire System'));
  });

  // 15. SITE_MANAGER visibility restrictions
  test('15. SITE_MANAGER user has scoped view and cannot see external upload zone', () => {
    const html = renderPageWithUser(mockSiteManagerUser);
    // External backup upload zone is admin only
    assert.ok(!html.includes('Verify &amp; Restore External Archive'));
    assert.ok(!html.includes('Verify & Restore External Archive'));
  });

  // 16. VIEWER access restriction
  test('16. VIEWER role is strictly blocked with Access Denied screen', () => {
    const html = renderPageWithUser(mockViewerUser);
    assert.ok(html.includes('Access Denied'));
    assert.ok(!html.includes('1. Reports &amp; Complete Export'));
    assert.ok(!html.includes('2. Backup &amp; Recovery'));
    assert.ok(!html.includes('3. Import &amp; Load Package'));
  });

  // 17. Existing /reports/complete-export remains functional
  test('17. Existing /reports/complete-export page exists and functions', () => {
    const pagePath = path.join(process.cwd(), 'app', '(dashboard)', 'reports', 'complete-export', 'page.tsx');
    assert.ok(fs.existsSync(pagePath));
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('CompleteExportSection'));
  });

  // 18. Existing /admin/backup remains functional
  test('18. Existing /admin/backup page exists and retains full functionality', () => {
    const pagePath = path.join(process.cwd(), 'app', '(dashboard)', 'admin', 'backup', 'page.tsx');
    assert.ok(fs.existsSync(pagePath));
    const content = fs.readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('BackupCreateCard'));
    assert.ok(content.includes('RestoreModal'));
  });

  // 19. Light theme compatibility
  test('19. Light theme classes are comprehensively applied', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('bg-white'));
    assert.ok(html.includes('border-slate-200') || html.includes('border-slate-300'));
    assert.ok(html.includes('text-slate-900'));
  });

  // 20. Dark theme compatibility
  test('20. Dark theme classes (dark:...) are present across all sections', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('dark:bg-[#18191C]'));
    assert.ok(html.includes('dark:border-[#2B2D31]') || html.includes('dark:border-[#3A3D42]'));
    assert.ok(html.includes('dark:text-[#F2F3F5]'));
  });

  // 21. 44px interaction targets
  test('21. Interactive buttons maintain minimum 44px touch targets', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('min-h-[44px]'));
  });

  // 22. Mobile-safe stacking
  test('22. Responsive layout classes support vertical stacking on mobile viewports', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('flex flex-col sm:flex-row') || html.includes('flex-col sm:flex-row'));
    assert.ok(html.includes('grid grid-cols-1') || html.includes('grid-cols-1'));
  });

  // 23. No horizontal overflow layout
  test('23. Uses max-w-7xl and padding to prevent horizontal page overflow', () => {
    const html = renderPageWithUser(mockAdminUser);
    assert.ok(html.includes('max-w-7xl'));
  });

  // 24. Navigation destination exists
  test('24. Navigation and Header expose /admin/data-protection for ADMIN and SITE_MANAGER', () => {
    const adminNav = renderNavWithUser(mockAdminUser);
    assert.ok(adminNav.nav.includes('/admin/data-protection'));

    const managerNav = renderNavWithUser(mockSiteManagerUser);
    assert.ok(managerNav.nav.includes('/admin/data-protection'));

    const viewerNav = renderNavWithUser(mockViewerUser);
    assert.ok(!viewerNav.nav.includes('/admin/data-protection'));

    // Also verify Header.tsx source code defines the destination
    const headerSource = fs.readFileSync(path.join(process.cwd(), 'components', 'layout', 'Header.tsx'), 'utf8');
    assert.ok(headerSource.includes('/admin/data-protection'));
  });

  // 25. Legacy routes removed from primary nav but physical routes exist
  test('25. Legacy destinations /reports/complete-export and /admin/backup removed from primary navigation but routes exist', () => {
    const adminNav = renderNavWithUser(mockAdminUser);
    // Removed from primary navigation
    assert.ok(!adminNav.nav.includes('/reports/complete-export'));
    assert.ok(!adminNav.nav.includes('/admin/backup'));

    // Physical route files preserved
    const exportPagePath = path.join(process.cwd(), 'app', '(dashboard)', 'reports', 'complete-export', 'page.tsx');
    const backupPagePath = path.join(process.cwd(), 'app', '(dashboard)', 'admin', 'backup', 'page.tsx');
    assert.ok(fs.existsSync(exportPagePath), 'complete-export route file must exist');
    assert.ok(fs.existsSync(backupPagePath), 'backup route file must exist');
  });
});
