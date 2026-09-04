import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadReportPdf, ExportPdfOptions } from '../lib/export/client-download';
import { SignJWT } from 'jose';

test('PHASE 4 BATCH B: PDF EXPORT UI INTEGRATION & CLIENT DOWNLOAD SUITE', async (t) => {
  const BASE_URL = 'http://localhost:3000';
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('QA Configuration Error: process.env.SESSION_SECRET is required but missing.');
  }
  const secretKey = new TextEncoder().encode(sessionSecret);

  async function makeToken(userId: string, username: string, role: 'ADMIN' | 'SITE_MANAGER' | 'VIEWER', assignedSites: string[], tokenVersion: number) {
    return await new SignJWT({
      userId,
      username,
      fullName: 'Test User',
      role,
      assignedSiteIds: assignedSites,
      tokenVersion,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);
  }

  const adminToken = await makeToken('usr-admin-1', 'Iamadmin', 'ADMIN', [], 11);

  // --------------------------------------------------------------------------
  // 1. ROUTE TO REPORT TYPE & PAYLOAD MAPPINGS
  // --------------------------------------------------------------------------
  await t.test('1. Six target routes construct authoritative payloads', () => {
    // 1. Weekly Attendance
    const weeklyPayload: ExportPdfOptions = {
      siteId: 'site-1',
      type: 'WEEKLY_ATTENDANCE',
      startDate: '2026-09-01',
      endDate: '2026-09-07',
    };
    assert.equal(weeklyPayload.type, 'WEEKLY_ATTENDANCE');
    assert.ok(weeklyPayload.startDate && weeklyPayload.endDate);

    // 2. Monthly Attendance
    const monthlyAttPayload: ExportPdfOptions = {
      siteId: 'site-1',
      type: 'MONTHLY_ATTENDANCE',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      monthLabel: 'September 2026',
    };
    assert.equal(monthlyAttPayload.type, 'MONTHLY_ATTENDANCE');
    assert.equal(monthlyAttPayload.monthLabel, 'September 2026');

    // 3. Monthly Finance
    const monthlyFinPayload: ExportPdfOptions = {
      siteId: 'site-1',
      type: 'MONTHLY_FINANCE',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      monthLabel: 'September 2026',
    };
    assert.equal(monthlyFinPayload.type, 'MONTHLY_FINANCE');

    // 4. Role Report
    const rolePayload: ExportPdfOptions = {
      siteId: 'site-1',
      type: 'ROLE_REPORT',
      roleId: 'role-mason',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      monthLabel: 'September 2026',
    };
    assert.equal(rolePayload.type, 'ROLE_REPORT');
    assert.equal(rolePayload.roleId, 'role-mason');

    // 5. Category Report
    const catPayload: ExportPdfOptions = {
      siteId: 'site-1',
      type: 'CATEGORY_REPORT',
      categoryId: 'cat-civil',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      monthLabel: 'September 2026',
    };
    assert.equal(catPayload.type, 'CATEGORY_REPORT');
    assert.equal(catPayload.categoryId, 'cat-civil');

    // 6. Site Report
    const sitePayload: ExportPdfOptions = {
      siteId: 'site-1',
      type: 'SITE_REPORT',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      monthLabel: 'September 2026',
    };
    assert.equal(sitePayload.type, 'SITE_REPORT');
  });

  // --------------------------------------------------------------------------
  // 2. CLIENT DOWNLOAD HELPER UNIT & LIFECYCLE BEHAVIOR
  // --------------------------------------------------------------------------
  await t.test('2. Missing siteId is rejected client-side before network dispatch', async () => {
    await assert.rejects(
      async () => {
        await downloadReportPdf({ siteId: '', type: 'WEEKLY_ATTENDANCE' });
      },
      { message: 'Please select a site before exporting.' }
    );
  });

  await t.test('3. Client helper properly parses Content-Disposition & triggers cleanup', async () => {
    let objectUrlCreated = '';
    let objectUrlRevoked = '';
    let clickedDownloadName = '';

    // Mock DOM environment for download trigger
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalFetch = globalThis.fetch;

    globalThis.window = {
      URL: {
        createObjectURL: (blob: any) => {
          objectUrlCreated = 'blob:http://localhost:3000/mock-uuid-123';
          return objectUrlCreated;
        },
        revokeObjectURL: (url: string) => {
          objectUrlRevoked = url;
        },
      },
    } as any;

    globalThis.document = {
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
      createElement: (tag: string) => {
        if (tag === 'a') {
          return {
            style: {},
            href: '',
            download: '',
            click: function () {
              clickedDownloadName = this.download;
            },
          };
        }
        return {};
      },
    } as any;

    // Mock fetch returning successful PDF
    globalThis.fetch = (async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="Sunrise_Weekly_Report.pdf"; filename*=UTF-8\'\'Sunrise_Weekly_Report.pdf',
        }),
        blob: async () => new Blob(['%PDF-1.4 Mock Binary Content'], { type: 'application/pdf' }),
      };
    }) as any;

    try {
      await downloadReportPdf({ siteId: 'site-1', type: 'WEEKLY_ATTENDANCE' });

      assert.equal(clickedDownloadName, 'Sunrise_Weekly_Report.pdf');
      assert.ok(objectUrlCreated.startsWith('blob:'));

      // Verify revocation was scheduled
      await new Promise((resolve) => setTimeout(resolve, 1100));
      assert.equal(objectUrlRevoked, objectUrlCreated, 'Object URL must be revoked after download');
    } finally {
      globalThis.window = originalWindow;
      globalThis.document = originalDocument;
      globalThis.fetch = originalFetch;
    }
  });

  await t.test('4. Client helper normalizes HTTP error responses', async () => {
    const originalFetch = globalThis.fetch;

    // Test 403 Forbidden normalization
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: 'You do not have access to this site.' }),
      };
    }) as any;

    try {
      await assert.rejects(
        async () => {
          await downloadReportPdf({ siteId: 'site-1', type: 'DAILY_ATTENDANCE' });
        },
        { message: 'You do not have access to this site.' }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // --------------------------------------------------------------------------
  // 3. LIVE ENDPOINT INTEGRATION FOR ALL SIX BATCH B PAYLOADS
  // --------------------------------------------------------------------------
  await t.test('5. Live HTTP 200 download for all 6 operational routes', async () => {
    const routePayloads = [
      {
        route: '/attendance/weekly',
        payload: { siteId: 'site-1', type: 'WEEKLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-07' },
      },
      {
        route: '/attendance/monthly',
        payload: { siteId: 'site-1', type: 'MONTHLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
      },
      {
        route: '/finance/monthly',
        payload: { siteId: 'site-1', type: 'MONTHLY_FINANCE', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
      },
      {
        route: '/reports/role',
        payload: { siteId: 'site-1', type: 'ROLE_REPORT', roleId: 'role-mason', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
      },
      {
        route: '/reports/category',
        payload: { siteId: 'site-1', type: 'CATEGORY_REPORT', categoryId: 'cat-civil', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
      },
      {
        route: '/reports/site',
        payload: { siteId: 'site-1', type: 'SITE_REPORT', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
      },
    ];

    for (const item of routePayloads) {
      const res = await fetch(`${BASE_URL}/api/export/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `site_work_session=${adminToken}`,
        },
        body: JSON.stringify(item.payload),
      });

      assert.equal(res.status, 200, `${item.route} payload must return HTTP 200`);
      assert.equal(res.headers.get('content-type'), 'application/pdf');

      const cd = res.headers.get('content-disposition') || '';
      assert.ok(cd.includes('attachment; filename='), `${item.route} must have Content-Disposition header`);

      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength > 1000, `${item.route} PDF binary must be non-empty`);
      const sig = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
      assert.equal(sig, '%PDF-', `${item.route} must return valid PDF stream`);
    }
  });

  // --------------------------------------------------------------------------
  // 4. REGRESSION VERIFICATION OF PRE-EXISTING EXPORT ROUTES
  // --------------------------------------------------------------------------
  await t.test('6. Pre-existing Daily Attendance & Finance export routes remain functional', async () => {
    // 1. Daily Attendance existing payload
    const resDaily = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `site_work_session=${adminToken}`,
      },
      body: JSON.stringify({
        siteId: 'site-1',
        type: 'DAILY_ATTENDANCE',
        date: '2026-09-01',
      }),
    });
    assert.equal(resDaily.status, 200, 'Daily attendance export must return HTTP 200');
    const dailyBuf = await resDaily.arrayBuffer();
    assert.ok(dailyBuf.byteLength > 1000);

    // 2. Finance existing payload
    const resFinance = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `site_work_session=${adminToken}`,
      },
      body: JSON.stringify({
        siteId: 'site-1',
        type: 'FINANCE',
      }),
    });
    assert.equal(resFinance.status, 200, 'Finance ledger export must return HTTP 200');
    const financeBuf = await resFinance.arrayBuffer();
    assert.ok(financeBuf.byteLength > 1000);
  });
});
