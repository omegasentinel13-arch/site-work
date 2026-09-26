import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { POST } from '../app/api/reports/preview/route';
import { UserSession } from '../lib/auth/session';

describe('TASK 4 — STEP 1: Server-Side Preview API Tests', () => {
  const adminSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    fullName: 'Admin User',
    role: 'ADMIN',
    authorityTier: 'SUPERIOR_PRIME',
    assignedSiteIds: [],
    tokenVersion: 1,
  };

  const managerSession: UserSession = {
    userId: 'usr-eng-1',
    username: 'engineer1',
    fullName: 'Site Manager',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Auditor Viewer',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1'],
    tokenVersion: 1,
  };

  after(() => {
    delete (globalThis as any).__TEST_SESSION__;
  });

  test('1. Unauthenticated request is rejected with 401', async () => {
    delete (globalThis as any).__TEST_SESSION__;

    const req = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType: 'COMPLETE_REPORT',
        scope: 'ALL_SITES',
      }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 401);
    const body = await res.json();
    assert.strictEqual(body.error, 'Authentication required');
  });

  test('2. Viewer role is strictly rejected with 403 Forbidden', async () => {
    (globalThis as any).__TEST_SESSION__ = viewerSession;

    const req = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType: 'COMPLETE_REPORT',
        scope: 'ALL_SITES',
      }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes('Viewer accounts are not permitted'));
  });

  test('3. Invalid JSON or missing fields are rejected with 400', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;

    // Missing reportType
    const req1 = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'ALL_SITES' }),
    });
    const res1 = await POST(req1);
    assert.strictEqual(res1.status, 400);

    // Missing siteId when scope is SITE
    const req2 = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportType: 'COMPLETE_REPORT', scope: 'SITE' }),
    });
    const res2 = await POST(req2);
    assert.strictEqual(res2.status, 400);
    const body2 = await res2.json();
    assert.ok(body2.error.includes('siteId is required'));
  });

  test('4. Date validation rejects from > to with 400', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;

    const req = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType: 'COMPLETE_REPORT',
        scope: 'ALL_SITES',
        from: '2026-12-31',
        to: '2026-01-01',
      }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('Start date cannot be after end date'));
  });

  test('5. Admin requesting ALL_SITES receives consolidated summary across all sites', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;

    const req = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType: 'COMPLETE_REPORT',
        scope: 'ALL_SITES',
        from: '2020-01-01',
        to: '2030-12-31',
      }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.reportType, 'COMPLETE_REPORT');
    assert.strictEqual(body.scope, 'ALL_SITES');
    assert.ok(body.siteCount >= 1, 'Admin must see authorized sites');
    assert.strictEqual(typeof body.totalWorkerDays, 'number');
    assert.strictEqual(typeof body.totalLabourCostPaise, 'number');
    assert.strictEqual(typeof body.transactionCount, 'number');
    assert.strictEqual(typeof body.totalCreditsPaise, 'number');
    assert.strictEqual(typeof body.totalDebitsPaise, 'number');
    assert.strictEqual(typeof body.netCashFlowPaise, 'number');

    // Assert that raw heavy data rows are NOT streamed in preview
    assert.strictEqual(body.attendanceRecords, undefined, 'Preview must NOT return heavy attendance rows');
    assert.strictEqual(body.transactions, undefined, 'Preview must NOT return heavy transaction rows');
  });

  test('6. Site Manager requesting ALL_SITES only aggregates assigned sites', async () => {
    (globalThis as any).__TEST_SESSION__ = managerSession;

    const req = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType: 'COMPLETE_REPORT',
        scope: 'ALL_SITES',
        from: '2020-01-01',
        to: '2030-12-31',
      }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(body.scope, 'ALL_SITES');
    assert.strictEqual(body.siteCount, 1, 'Site Manager with 1 assigned site must only aggregate 1 site');
  });

  test('7. Site Manager requesting unassigned site (site-2) is rejected with 403', async () => {
    (globalThis as any).__TEST_SESSION__ = managerSession;

    const req = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportType: 'COMPLETE_REPORT',
        scope: 'SITE',
        siteId: 'site-2', // site-2 exists in DB but is not in managerSession.assignedSiteIds
        from: '2020-01-01',
        to: '2030-12-31',
      }),
    });

    const res = await POST(req);
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.ok(body.error.includes('Forbidden') || body.error.includes('assigned'));
  });
});
