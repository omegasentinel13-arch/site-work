import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { POST as postPDF } from '../app/api/export/pdf/route';
import { POST as postExcel } from '../app/api/export/excel/route';
import { POST as postComplete } from '../app/api/export/complete/route';
import { UserSession } from '../lib/auth/session';

describe('TASK 4 — STEP 2: Forensic PDF / Excel Export Integration Matrix (A through AN)', () => {
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
    username: 'engineer2',
    fullName: 'Site Manager',
    role: 'SITE_MANAGER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-2'], // Assigned only to site-2, unauthorized for site-1
    tokenVersion: 1,
  };

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    fullName: 'Auditor Viewer',
    role: 'VIEWER',
    authorityTier: 'STANDARD',
    assignedSiteIds: ['site-1', 'site-2'],
    tokenVersion: 1,
  };

  const testSiteId = 'site-1';
  const assignedSiteId = 'site-2';
  const testRoleId = 'role-mason';
  const testCategoryId = 'cat-civil';
  const startDate = '2026-08-01';
  const endDate = '2026-08-31';

  after(() => {
    delete (globalThis as any).__TEST_SESSION__;
  });

  // =========================================================================
  // SECTION 1: PDF GENERATION TESTS (A through O)
  // =========================================================================

  test('Case A: PDF - COMPLETE_REPORT (SITE scope)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'COMPLETE_REPORT',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case B: PDF - COMPLETE_REPORT (ALL_SITES scope / siteId="ALL")', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'COMPLETE_REPORT',
        scope: 'ALL_SITES',
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case C: PDF - ALL_SITES_CONSOLIDATED', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ALL_SITES_CONSOLIDATED',
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case D: PDF - DAILY_ATTENDANCE', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'DAILY_ATTENDANCE',
        siteId: testSiteId,
        date: startDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case E: PDF - WEEKLY_ATTENDANCE', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'WEEKLY_ATTENDANCE',
        siteId: testSiteId,
        startDate: '2026-08-01',
        endDate: '2026-08-07',
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case F: PDF - MONTHLY_ATTENDANCE', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MONTHLY_ATTENDANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case G: PDF - TRANSACTIONS (Canonical)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'TRANSACTIONS',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case H: PDF - FINANCE (Legacy Alias)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'FINANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case I: PDF - MASTER_LEDGER (Canonical)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MASTER_LEDGER',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case J: PDF - MONTHLY_FINANCE (Legacy Alias)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MONTHLY_FINANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case K: PDF - LABOUR_WORKER (Canonical all-roles rollup)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'LABOUR_WORKER',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case L: PDF - ROLE_REPORT (Specific role)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ROLE_REPORT',
        siteId: testSiteId,
        roleId: testRoleId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case M: PDF - CATEGORY_REPORT (Specific category)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'CATEGORY_REPORT',
        siteId: testSiteId,
        categoryId: testCategoryId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case N: PDF - SITE_PERFORMANCE (Canonical)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'SITE_PERFORMANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  test('Case O: PDF - SITE_REPORT (Legacy Alias)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'SITE_REPORT',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 500);
    assert.strictEqual(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  // =========================================================================
  // SECTION 2: EXCEL GENERATION TESTS (P through AE)
  // =========================================================================

  test('Case P: Excel - COMPLETE_REPORT (SITE scope)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'COMPLETE_REPORT',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 5000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case Q: Excel - COMPLETE_REPORT (ALL_SITES scope)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'COMPLETE_REPORT',
        scope: 'ALL_SITES',
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('Content-Type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 5000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case R: Excel - ALL_SITES_CONSOLIDATED', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ALL_SITES_CONSOLIDATED',
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 5000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case S: Excel - DAILY_ATTENDANCE', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'DAILY_ATTENDANCE',
        siteId: testSiteId,
        date: startDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case T: Excel - WEEKLY_ATTENDANCE', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'WEEKLY_ATTENDANCE',
        siteId: testSiteId,
        startDate: '2026-08-01',
        endDate: '2026-08-07',
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case U: Excel - MONTHLY_ATTENDANCE', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MONTHLY_ATTENDANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case V: Excel - MONTHLY_COMPREHENSIVE (Legacy Excel Alias)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MONTHLY_COMPREHENSIVE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case W: Excel - TRANSACTIONS (Canonical)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'TRANSACTIONS',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case X: Excel - FINANCE (Legacy Alias)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'FINANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case Y: Excel - MASTER_LEDGER (Canonical)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MASTER_LEDGER',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case Z: Excel - MONTHLY_FINANCE (Legacy Alias)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'MONTHLY_FINANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case AA: Excel - LABOUR_WORKER (Canonical)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'LABOUR_WORKER',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case AB: Excel - ROLE_REPORT (Specific role)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ROLE_REPORT',
        siteId: testSiteId,
        roleId: testRoleId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case AC: Excel - CATEGORY_REPORT (Specific category)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'CATEGORY_REPORT',
        siteId: testSiteId,
        categoryId: testCategoryId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case AD: Excel - SITE_PERFORMANCE (Canonical)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'SITE_PERFORMANCE',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  test('Case AE: Excel - SITE_REPORT (Legacy Alias)', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'SITE_REPORT',
        siteId: testSiteId,
        startDate,
        endDate,
      }),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 1000);
    assert.strictEqual(buf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  });

  // =========================================================================
  // SECTION 3: SECURITY, RBAC & VALIDATION GUARDS (AF through AN)
  // =========================================================================

  test('Case AF: Unauthenticated request is rejected with 401 Unauthorized', async () => {
    delete (globalThis as any).__TEST_SESSION__;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'DAILY_ATTENDANCE', siteId: testSiteId }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 401);
  });

  test('Case AG: Viewer role is strictly rejected with 403 Forbidden', async () => {
    (globalThis as any).__TEST_SESSION__ = viewerSession;

    // PDF check
    const pdfReq = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'TRANSACTIONS', siteId: testSiteId }),
    });
    const pdfRes = await postPDF(pdfReq);
    assert.strictEqual(pdfRes.status, 403);

    // Excel check
    const excelReq = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'TRANSACTIONS', siteId: testSiteId }),
    });
    const excelRes = await postExcel(excelReq);
    assert.strictEqual(excelRes.status, 403);

    // Complete check
    const compReq = new Request('http://localhost:3000/api/export/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'SITE', siteId: testSiteId }),
    });
    const compRes = await postComplete(compReq);
    assert.strictEqual(compRes.status, 403);
  });

  test('Case AH: Site Manager is rejected with 403 when accessing unauthorized site', async () => {
    (globalThis as any).__TEST_SESSION__ = managerSession;
    // manager is assigned to site-2, attempting to export site-1
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'DAILY_ATTENDANCE', siteId: 'site-1' }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 403);
  });

  test('Case AI: Site Manager ALL_SITES semantics: authorized sites succeed (200), zero assigned sites rejected (403)', async () => {
    // 1. Site Manager with assigned sites (site-2) succeeds with 200 scoped to authorized sites
    (globalThis as any).__TEST_SESSION__ = managerSession;

    const pdfReq = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ALL_SITES_CONSOLIDATED',
        startDate,
        endDate,
      }),
    });
    const pdfRes = await postPDF(pdfReq);
    assert.strictEqual(pdfRes.status, 200);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    assert.ok(pdfBuf.length > 500);
    assert.strictEqual(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');

    // Excel route
    const excelReq = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ALL_SITES_CONSOLIDATED',
        startDate,
        endDate,
      }),
    });
    const excelRes = await postExcel(excelReq);
    assert.strictEqual(excelRes.status, 200);
    const excelBuf = Buffer.from(await excelRes.arrayBuffer());
    assert.ok(excelBuf.length > 1000);
    assert.strictEqual(excelBuf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');



    // 2. Site Manager with zero assigned sites is strictly rejected with 403
    const unassignedManagerSession: UserSession = {
      ...managerSession,
      assignedSiteIds: [],
    };
    (globalThis as any).__TEST_SESSION__ = unassignedManagerSession;

    const unassignedPdfReq = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ALL_SITES_CONSOLIDATED' }),
    });
    const unassignedPdfRes = await postPDF(unassignedPdfReq);
    assert.strictEqual(unassignedPdfRes.status, 403);
    const unassignedPdfBody = await unassignedPdfRes.json();
    assert.ok(unassignedPdfBody.error.includes('No authorized sites'));

    const unassignedCompReq = new Request('http://localhost:3000/api/export/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'SYSTEM' }),
    });
    const unassignedCompRes = await postComplete(unassignedCompReq);
    assert.strictEqual(unassignedCompRes.status, 403);
  });

  test('Case AJ: Site-only report called with scope="ALL_SITES" is rejected with 400', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'WEEKLY_ATTENDANCE',
        scope: 'ALL_SITES',
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('only supports a single site'));
  });

  test('Case AK: Date range validation rejects startDate > endDate with 400', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;

    // PDF route
    const pdfReq = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'WEEKLY_ATTENDANCE',
        siteId: testSiteId,
        startDate: '2026-12-31',
        endDate: '2026-01-01',
      }),
    });
    const pdfRes = await postPDF(pdfReq);
    assert.strictEqual(pdfRes.status, 400);
    const pdfBody = await pdfRes.json();
    assert.ok(pdfBody.error.includes('Start date cannot be after end date'));

    // Complete route
    const compReq = new Request('http://localhost:3000/api/export/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period: 'CUSTOM',
        from: '2026-12-31',
        to: '2026-01-01',
        siteId: testSiteId,
      }),
    });
    const compRes = await postComplete(compReq);
    assert.strictEqual(compRes.status, 400);
  });

  test('Case AL: Invalid date format is rejected with 400', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'DAILY_ATTENDANCE',
        siteId: testSiteId,
        date: '01-08-2026', // invalid format (expected YYYY-MM-DD)
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 400);
  });

  test('Case AM: Missing siteId on site-level export is rejected with 400', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'WEEKLY_ATTENDANCE',
        startDate,
        endDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('siteId is required'));
  });

  test('Case AN: Non-existent siteId is rejected with 404', async () => {
    (globalThis as any).__TEST_SESSION__ = adminSession;
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'DAILY_ATTENDANCE',
        siteId: 'non-existent-site-id-999',
        date: startDate,
      }),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 404);
  });
});
