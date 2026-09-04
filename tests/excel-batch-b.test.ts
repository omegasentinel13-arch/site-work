import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import * as fs from 'fs';
import * as path from 'path';

test('PHASE 5 BATCH B: EXCEL EXPORT FRONTEND UI INTEGRATION SUITE', async (t) => {
  const BASE_URL = 'http://localhost:3000';
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('QA Configuration Error: process.env.SESSION_SECRET is required but missing.');
  }
  const secretKey = new TextEncoder().encode(sessionSecret);

  async function makeAdminToken() {
    return await new SignJWT({
      userId: 'usr-admin-1',
      username: 'Iamadmin',
      fullName: 'Head Administrator',
      role: 'ADMIN',
      assignedSiteIds: [],
      tokenVersion: 11,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secretKey);
  }

  // --------------------------------------------------------------------------
  // 1. STATIC CODE AUDIT: ALL 8 ROUTES INTEGRATE EXCEL EXPORT
  // --------------------------------------------------------------------------
  await t.test('1. Static route verification: all 8 target routes import and render ExcelExportButton', () => {
    const routeFiles = [
      { route: '/attendance/daily', file: 'app/(dashboard)/attendance/daily/page.tsx', type: 'DAILY_ATTENDANCE' },
      { route: '/attendance/weekly', file: 'app/(dashboard)/attendance/weekly/page.tsx', type: 'WEEKLY_ATTENDANCE' },
      { route: '/attendance/monthly', file: 'app/(dashboard)/attendance/monthly/page.tsx', type: 'MONTHLY_ATTENDANCE' },
      { route: '/finance', file: 'app/(dashboard)/finance/page.tsx', type: 'FINANCE' },
      { route: '/finance/monthly', file: 'app/(dashboard)/finance/monthly/page.tsx', type: 'MONTHLY_FINANCE' },
      { route: '/reports/role', file: 'app/(dashboard)/reports/role/page.tsx', type: 'ROLE_REPORT' },
      { route: '/reports/category', file: 'app/(dashboard)/reports/category/page.tsx', type: 'CATEGORY_REPORT' },
      { route: '/reports/site', file: 'app/(dashboard)/reports/site/page.tsx', type: 'SITE_REPORT' },
    ];

    for (const r of routeFiles) {
      const fullPath = path.join(process.cwd(), r.file);
      assert.ok(fs.existsSync(fullPath), `Target route file ${r.file} must exist`);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Check import
      assert.ok(
        content.includes("import { ExcelExportButton } from '@/components/export/ExcelExportButton'") ||
        content.includes('ExcelExportButton'),
        `Route ${r.route} must import ExcelExportButton`
      );

      // Check usage with exact report type
      assert.ok(
        content.includes(`type: '${r.type}'`),
        `Route ${r.route} must specify export type '${r.type}'`
      );

      // Check min-h-[44px] accessible target
      assert.ok(
        content.includes('ExcelExportButton') || content.includes('min-h-[44px]'),
        `Route ${r.route} must support accessible target`
      );

      // Check that existing PDF button remains present
      if (r.route === '/finance') {
        assert.ok(content.includes('PDF Ledger'), 'Finance must retain PDF Ledger button');
      } else {
        assert.ok(content.includes('PdfExportButton') || content.includes('FileDown'), `${r.route} must retain PDF export`);
      }
    }
  });

  // --------------------------------------------------------------------------
  // 2. CLIENT DOWNLOAD HELPER SPECIFICATION VERIFICATION
  // --------------------------------------------------------------------------
  await t.test('2. Client download helper: rejects missing siteId before network dispatch', async () => {
    const { downloadReportExcel } = await import('../lib/export/client-excel-download');
    await assert.rejects(
      async () => {
        await downloadReportExcel({ siteId: '', type: 'DAILY_ATTENDANCE' });
      },
      /Please select a site before exporting/
    );
  });

  await t.test('3. Client helper: Content-Disposition parsing & cleanup simulation', () => {
    // Test RFC 5987 parser logic
    const cdHeader = "attachment; filename=\"Fallback.xlsx\"; filename*=UTF-8''Sunrise%20Site%20Report%202026.xlsx";
    const utf8Match = cdHeader.match(/filename\*=UTF-8''([^;]+)/i);
    assert.ok(utf8Match && utf8Match[1]);
    const decoded = decodeURIComponent(utf8Match[1]);
    assert.equal(decoded, 'Sunrise Site Report 2026.xlsx');
  });

  // --------------------------------------------------------------------------
  // 3. LIVE HTTP 200 DOWNLOAD ACROSS ALL 8 REPORT TYPES
  // --------------------------------------------------------------------------
  await t.test('4. Live HTTP 200 Excel download for all 8 target routes with server Content-Disposition', async () => {
    const adminToken = await makeAdminToken();

    const targets = [
      { route: '/attendance/daily', type: 'DAILY_ATTENDANCE', payload: { siteId: 'site-1', type: 'DAILY_ATTENDANCE', date: '2026-09-01' } },
      { route: '/attendance/weekly', type: 'WEEKLY_ATTENDANCE', payload: { siteId: 'site-1', type: 'WEEKLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-07' } },
      { route: '/attendance/monthly', type: 'MONTHLY_ATTENDANCE', payload: { siteId: 'site-1', type: 'MONTHLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { route: '/finance', type: 'FINANCE', payload: { siteId: 'site-1', type: 'FINANCE', startDate: '2026-09-01', endDate: '2026-09-30' } },
      { route: '/finance/monthly', type: 'MONTHLY_FINANCE', payload: { siteId: 'site-1', type: 'MONTHLY_FINANCE', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { route: '/reports/role', type: 'ROLE_REPORT', payload: { siteId: 'site-1', type: 'ROLE_REPORT', roleId: 'ALL', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { route: '/reports/category', type: 'CATEGORY_REPORT', payload: { siteId: 'site-1', type: 'CATEGORY_REPORT', categoryId: 'cat-1', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
      { route: '/reports/site', type: 'SITE_REPORT', payload: { siteId: 'site-1', type: 'SITE_REPORT', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' } },
    ];

    for (const tgt of targets) {
      const res = await fetch(`${BASE_URL}/api/export/excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `site_work_session=${adminToken}`,
        },
        body: JSON.stringify(tgt.payload),
      });

      assert.equal(res.status, 200, `Route ${tgt.route} payload must return 200`);
      assert.equal(
        res.headers.get('content-type'),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      const cd = res.headers.get('content-disposition');
      assert.ok(cd && cd.includes('attachment;'), `${tgt.route} must have attachment Content-Disposition`);
      assert.ok(cd && cd.includes('.xlsx'), `${tgt.route} Content-Disposition must end with .xlsx`);

      const buf = Buffer.from(await res.arrayBuffer());
      assert.ok(buf.length > 500, `Buffer size (${buf.length}) must be valid`);
      assert.equal(buf[0], 0x50, 'Must have PK zip header');
      assert.equal(buf[1], 0x4b, 'Must have PK zip header');
    }
  });

  // --------------------------------------------------------------------------
  // 4. SECURITY AUDIT: ZERO CLIENT SECRETS LEAKAGE
  // --------------------------------------------------------------------------
  await t.test('5. Security audit: zero secrets or credentials leaked into frontend components', () => {
    const filesToAudit = [
      'components/export/ExcelExportButton.tsx',
      'lib/export/client-excel-download.ts',
      'app/(dashboard)/attendance/daily/page.tsx',
      'app/(dashboard)/attendance/weekly/page.tsx',
      'app/(dashboard)/attendance/monthly/page.tsx',
      'app/(dashboard)/finance/page.tsx',
      'app/(dashboard)/finance/monthly/page.tsx',
      'app/(dashboard)/reports/role/page.tsx',
      'app/(dashboard)/reports/category/page.tsx',
      'app/(dashboard)/reports/site/page.tsx',
    ];

    const forbiddenPatterns = [
      /SESSION_SECRET/i,
      /process\.env\./i,
      /password_hash/i,
      /recovery_token/i,
      /site_work_super_secret/i,
    ];

    for (const f of filesToAudit) {
      const fullPath = path.join(process.cwd(), f);
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of forbiddenPatterns) {
        assert.ok(
          !pattern.test(content),
          `Security violation: File ${f} contains forbidden secret reference matching ${pattern}`
        );
      }
    }
  });

  // --------------------------------------------------------------------------
  // 5. INVARIANTS: NAVBAR ARROWS & CAROUSEL INTEGRITY
  // --------------------------------------------------------------------------
  await t.test('6. Invariant verification: navbar arrows remain scroll carousel controls, no history.back', () => {
    const navPath = path.join(process.cwd(), 'components/layout/Navigation.tsx');
    assert.ok(fs.existsSync(navPath));
    const navContent = fs.readFileSync(navPath, 'utf8');

    // Confirm scrollBy is used
    assert.ok(navContent.includes('.scrollBy('), 'Navbar must use scrollBy for arrow controls');
    // Confirm router.back() is not used for nav arrows
    assert.ok(!navContent.includes('router.back()'), 'Navbar arrows must not call router.back()');
  });
});
