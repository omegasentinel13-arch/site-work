import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteContext, Site, User } from '../context/site-context';
import DataProtectionCenterPage from '../app/(dashboard)/admin/data-protection/page';
import { CompleteExportSection } from '../components/export/CompleteExportSection';
import { CompleteReportViewer } from '../components/export/CompleteReportViewer';
import { GET as getCompleteReport } from '../app/api/reports/complete/route';
import { getDb } from '../lib/db';
import { SignJWT } from 'jose';
import { collectSiteExportData, collectSystemExportData } from '../lib/export/complete/data-collector';

describe('SITE WORK — PHASE 2A: COMPLETE REPORT ON-SCREEN VIEW TESTS', () => {
  const db = getDb();

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

  async function createAuthRequest(url: string, user: { id: string; username: string; role: string; assignedSiteIds: string[] } | null): Promise<Request> {
    const headers: Record<string, string> = {};
    if (user) {
      const dbUser = db.prepare('SELECT token_version, full_name FROM users WHERE id = ?').get(user.id) as { token_version: number; full_name: string } | undefined;
      const tokenVersion = dbUser?.token_version ?? 1;
      const secret = process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026';
      const secretKey = new TextEncoder().encode(secret);

      const token = await new SignJWT({
        userId: user.id,
        role: user.role,
        username: user.username,
        fullName: dbUser?.full_name || 'Test User',
        assignedSiteIds: user.assignedSiteIds,
        tokenVersion,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('24h')
        .sign(secretKey);

      headers['Cookie'] = `site_work_session=${token}`;
    }
    return new Request(url, { headers });
  }

  function renderWithUser(component: React.ReactElement, user: User | null) {
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
        component
      )
    );
  }

  test('1. API Route /api/reports/complete file exists', () => {
    const routePath = path.join(process.cwd(), 'app', 'api', 'reports', 'complete', 'route.ts');
    assert.ok(fs.existsSync(routePath), 'route.ts must exist in app/api/reports/complete');
  });

  test('2. CompleteReportViewer component file exists', () => {
    const compPath = path.join(process.cwd(), 'components', 'export', 'CompleteReportViewer.tsx');
    assert.ok(fs.existsSync(compPath), 'CompleteReportViewer.tsx must exist in components/export');
  });

  test('3. API GET returns 200 and system export data for ADMIN with scope=SYSTEM', async () => {
    const adminUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'ADMIN'").get() as any;
    assert.ok(adminUser, 'Admin user must exist in DB');

    const req = await createAuthRequest('http://localhost:3000/api/reports/complete?scope=SYSTEM&period=ALL_DATA', {
      id: adminUser.id,
      username: adminUser.username,
      role: 'ADMIN',
      assignedSiteIds: [],
    });

    const res = await getCompleteReport(req);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.scope, 'SYSTEM');
    assert.ok(body.data.aggregatedSummary);
    assert.ok(Array.isArray(body.data.sitesData));

    const directData = await collectSystemExportData(body.period);
    assert.equal(body.data.sitesData.length, directData.sitesData.length);
    assert.equal(body.data.aggregatedSummary.totalWorkerDays, directData.aggregatedSummary.totalWorkerDays);
    assert.equal(body.data.aggregatedSummary.totalLabourCostPaise, directData.aggregatedSummary.totalLabourCostPaise);
  });

  test('4. API GET returns 200 and site export data for ADMIN with scope=SITE', async () => {
    const adminUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'ADMIN'").get() as any;
    const site = db.prepare('SELECT id, name FROM sites LIMIT 1').get() as any;
    assert.ok(site, 'Site must exist');

    const req = await createAuthRequest(`http://localhost:3000/api/reports/complete?scope=SITE&siteId=${site.id}&period=ALL_DATA`, {
      id: adminUser.id,
      username: adminUser.username,
      role: 'ADMIN',
      assignedSiteIds: [],
    });

    const res = await getCompleteReport(req);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.scope, 'SITE');
    assert.equal(body.data.site.id, site.id);
    assert.ok(body.data.financialSummary);
    assert.ok(Array.isArray(body.data.roleRollup));

    const directData = await collectSiteExportData(site.id, body.period);
    assert.equal(body.data.totalWorkerDays, directData.totalWorkerDays);
    assert.equal(body.data.financialSummary.netCashFlowPaise, directData.financialSummary.netCashFlowPaise);
  });

  test('5. RBAC: SITE_MANAGER can access assigned site data', async () => {
    const engUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'SITE_MANAGER'").get() as any;
    const assignedSite = db.prepare('SELECT site_id FROM site_users WHERE user_id = ?').get(engUser.id) as any;
    assert.ok(assignedSite, 'Site manager must have an assigned site');

    const req = await createAuthRequest(`http://localhost:3000/api/reports/complete?scope=SITE&siteId=${assignedSite.site_id}&period=ALL_DATA`, {
      id: engUser.id,
      username: engUser.username,
      role: 'SITE_MANAGER',
      assignedSiteIds: [assignedSite.site_id],
    });

    const res = await getCompleteReport(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.site.id, assignedSite.site_id);
  });

  test('6. RBAC: SITE_MANAGER is blocked with 403 when requesting scope=SYSTEM', async () => {
    const engUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'SITE_MANAGER'").get() as any;

    const req = await createAuthRequest('http://localhost:3000/api/reports/complete?scope=SYSTEM&period=ALL_DATA', {
      id: engUser.id,
      username: engUser.username,
      role: 'SITE_MANAGER',
      assignedSiteIds: ['some-site'],
    });

    const res = await getCompleteReport(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes('Administrator privileges') || body.error.includes('assigned sites'));
  });

  test('7. RBAC: SITE_MANAGER is blocked with 403 when requesting unassigned site', async () => {
    const engUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'SITE_MANAGER'").get() as any;
    const unassignedSite = db.prepare(`
      SELECT id FROM sites WHERE id NOT IN (SELECT site_id FROM site_users WHERE user_id = ?) LIMIT 1
    `).get(engUser.id) as any;

    if (unassignedSite) {
      const req = await createAuthRequest(`http://localhost:3000/api/reports/complete?scope=SITE&siteId=${unassignedSite.id}&period=ALL_DATA`, {
        id: engUser.id,
        username: engUser.username,
        role: 'SITE_MANAGER',
        assignedSiteIds: ['other-site'],
      });

      const res = await getCompleteReport(req);
      assert.equal(res.status, 403);
    }
  });

  test('8. RBAC: VIEWER role is blocked with 403 Forbidden', async () => {
    const viewerUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'VIEWER'").get() as any;
    assert.ok(viewerUser, 'Viewer user must exist in DB');

    const req = await createAuthRequest('http://localhost:3000/api/reports/complete?scope=SYSTEM&period=ALL_DATA', {
      id: viewerUser.id,
      username: viewerUser.username,
      role: 'VIEWER',
      assignedSiteIds: [],
    });

    const res = await getCompleteReport(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.ok(
      body.error.includes('restricted to Administrators and Engineers') ||
      body.error.includes('Viewer accounts are not permitted')
    );
  });

  test('9. Unauthenticated request is rejected with 401 Unauthorized', async () => {
    const req = await createAuthRequest('http://localhost:3000/api/reports/complete?scope=SYSTEM&period=ALL_DATA', null);
    const res = await getCompleteReport(req);
    assert.equal(res.status, 401);
  });

  test('10. Invariant: Zero audit logs are created when fetching on-screen Complete Reports', async () => {
    const countBefore = (db.prepare('SELECT count(*) as c FROM audit_logs').get() as any).c;

    const adminUser = db.prepare("SELECT id, username, role FROM users WHERE role = 'ADMIN'").get() as any;
    const req = await createAuthRequest('http://localhost:3000/api/reports/complete?scope=SYSTEM&period=ALL_DATA', {
      id: adminUser.id,
      username: adminUser.username,
      role: 'ADMIN',
      assignedSiteIds: [],
    });

    const res = await getCompleteReport(req);
    assert.equal(res.status, 200);

    const countAfter = (db.prepare('SELECT count(*) as c FROM audit_logs').get() as any).c;
    assert.equal(countAfter, countBefore, 'Audit logs count MUST remain unchanged after on-screen report viewing');
  });

  test('11. CompleteExportSection renders controls AND CompleteReportViewer', () => {
    const html = renderWithUser(React.createElement(CompleteExportSection), mockAdminUser);

    assert.ok(html.includes('Export Scope &amp; Target Selection') || html.includes('Export Scope & Target Selection'));
    assert.ok(html.includes('Reporting Period Window'));
    assert.ok(html.includes('ZIP Archive Formats Included'));

    assert.ok(html.includes('Download Complete Archive (ZIP)'));
    assert.ok(html.includes('Consolidated PDF'));
    assert.ok(html.includes('Multi-Sheet Excel'));
    assert.ok(html.includes('Structured JSON'));

    assert.ok(html.includes('Complete Business Report (On-Screen View)'));
  });

  test('12. CompleteReportViewer renders loading state skeleton by default', () => {
    const html = renderWithUser(
      React.createElement(CompleteReportViewer, {
        scope: 'SYSTEM',
        period: 'ALL_DATA',
      }),
      mockAdminUser
    );

    assert.ok(
      html.includes('Generating On-Screen Complete Report...') ||
      html.includes('animate-spin')
    );
  });

  test('13. /admin/data-protection Section 1 title is updated to Complete Report & Export', () => {
    const html = renderWithUser(React.createElement(DataProtectionCenterPage), mockAdminUser);
    assert.ok(
      html.includes('1. Complete Report &amp; Export') ||
      html.includes('1. Complete Report & Export')
    );
  });

  test('14. CompleteExportSection has minimum 44px touch targets on interactive controls', () => {
    const html = renderWithUser(React.createElement(CompleteExportSection), mockAdminUser);
    assert.ok(html.includes('min-h-[44px]') || html.includes('min-h-[48px]'));
  });

  test('15. Legacy /reports/complete-export page renders CompleteExportSection with viewer', () => {
    const completeExportPagePath = path.join(process.cwd(), 'app', '(dashboard)', 'reports', 'complete-export', 'page.tsx');
    assert.ok(fs.existsSync(completeExportPagePath), 'Legacy page must exist');
    const content = fs.readFileSync(completeExportPagePath, 'utf8');
    assert.ok(content.includes('CompleteExportSection'), 'Legacy page must import and render CompleteExportSection');
  });
});
