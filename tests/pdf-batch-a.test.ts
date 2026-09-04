import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import {
  generateDailyAttendancePDF,
  generateWeeklyAttendancePDF,
  generateMonthlyAttendancePDF,
  generateFinancialPDF,
  generateMonthlyFinancialPDF,
  generateRoleReportPDF,
  generateCategoryReportPDF,
  generateSitePerformancePDF,
  sanitizeReportFilename,
  buildContentDispositionHeader,
} from '../lib/export/pdf';
import { DailySummary } from '../lib/domain/attendance-engine';
import { FinancialSummary } from '../lib/domain/finance-engine';

// Helper to extract text from pure ASCII / WinAnsi jsPDF binary buffer
function extractPdfText(buf: Buffer): string {
  return buf.toString('latin1');
}

test('PHASE 4 BATCH A: ENTERPRISE PDF ENGINE & EXPORT API SUITE', async (t) => {
  const sampleMeta = {
    siteName: 'Sunrise Complex',
    siteCode: 'SC-01',
    reportTitle: 'Test Report',
    periodLabel: '01 Sep 2026 to 07 Sep 2026',
    generatedAt: '01/09/2026, 10:00:00 am',
  };

  // --------------------------------------------------------------------------
  // 1. FILENAME SANITIZER & CONTENT-DISPOSITION SECURITY
  // --------------------------------------------------------------------------
  await t.test('1. Filename Sanitizer defenses against attacks & edge cases', () => {
    // Path traversal
    assert.equal(
      sanitizeReportFilename('../../evil/path', 'daily'),
      'evil_path_daily.pdf'
    );
    assert.equal(
      sanitizeReportFilename('..\\..\\windows\\traversal', 'test'),
      'windows_traversal_test.pdf'
    );

    // CRLF injection
    assert.equal(
      sanitizeReportFilename('Site\r\nX-Injected: yes', 'report'),
      'SiteX-Injected_yes_report.pdf'
    );
    assert.equal(
      sanitizeReportFilename('Site\nInjected', 'report'),
      'SiteInjected_report.pdf'
    );

    // Quotes and semicolons
    assert.equal(
      sanitizeReportFilename('Site"Name;Injected', 'report'),
      'Site_Name_Injected_report.pdf'
    );

    // Reserved Windows device names
    assert.equal(sanitizeReportFilename('CON', ''), 'site_work_report.pdf');
    assert.equal(sanitizeReportFilename('PRN', ''), 'site_work_report.pdf');
    assert.equal(sanitizeReportFilename('AUX', ''), 'site_work_report.pdf');
    assert.equal(sanitizeReportFilename('NUL', ''), 'site_work_report.pdf');
    assert.equal(sanitizeReportFilename('COM1', ''), 'site_work_report.pdf');
    assert.equal(sanitizeReportFilename('LPT9', ''), 'site_work_report.pdf');

    // Empty string fallback
    assert.equal(sanitizeReportFilename('', ''), 'site_work_report.pdf');
    assert.equal(sanitizeReportFilename('   ', '   '), 'site_work_report.pdf');

    // Unicode normalization (NFKC) & special characters
    const unicodeName = sanitizeReportFilename('Sîte Wõrk 🏗️', '2026');
    assert.ok(!unicodeName.includes('\r'));
    assert.ok(!unicodeName.includes('\n'));
    assert.ok(unicodeName.endsWith('.pdf'));

    // Excessive length truncation (80 chars base max)
    const longName = 'A'.repeat(120);
    const sanitizedLong = sanitizeReportFilename(longName, 'suffix');
    assert.ok(sanitizedLong.length <= 85); // 80 chars + .pdf
  });

  await t.test('2. Content-Disposition RFC 5987 / RFC 6266 Header Security', () => {
    const cd = buildContentDispositionHeader('Sunrise_Site_Report_2026.pdf');
    assert.ok(cd.startsWith('attachment; filename="Sunrise_Site_Report_2026.pdf"'));
    assert.ok(cd.includes("filename*=UTF-8''Sunrise_Site_Report_2026.pdf"));

    // Verify CRLF is completely stripped
    const malicious = 'evil\r\nInjected: true.pdf';
    const cdMalicious = buildContentDispositionHeader(malicious);
    assert.ok(!cdMalicious.includes('\r'));
    assert.ok(!cdMalicious.includes('\n'));
  });

  // --------------------------------------------------------------------------
  // 2. STRUCTURAL VALIDATION OF ALL 8 PDF REPORT GENERATORS
  // --------------------------------------------------------------------------
  await t.test('3. Daily Attendance PDF Generator (Portrait)', () => {
    const summary: DailySummary = {
      date: '2026-09-01',
      totalWorkers: 5,
      fullDayCount: 4,
      halfDayCount: 1,
      workerDays: 4.5,
      totalLabourCostPaise: 450000,
      categories: [
        {
          categoryId: 'cat-masonry',
          categoryName: 'Masonry Work',
          totalWorkers: 5,
          workerDays: 4.5,
          totalCostPaise: 450000,
          roles: [
            {
              roleId: 'role-mason',
              roleName: 'Mason (Head)',
              categoryId: 'cat-masonry',
              categoryName: 'Masonry Work',
              rateInPaise: 100000,
              fullDayCount: 4,
              halfDayCount: 1,
              totalWorkers: 5,
              workerDays: 4.5,
              fullDayCostPaise: 400000,
              halfDayCostPaise: 50000,
              totalCostPaise: 450000,
            },
          ],
        },
      ],
    };

    const buf = generateDailyAttendancePDF(
      { ...sampleMeta, reportTitle: 'Daily Attendance Report' },
      summary
    );

    assert.ok(Buffer.isBuffer(buf), 'Must return Buffer');
    assert.ok(buf.length > 1000, 'Must be valid PDF size');
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-', 'Must have valid %PDF- header');

    const str = extractPdfText(buf);
    assert.ok(str.includes('Page 1 of 1'), 'Must include two-pass page numbering');
    assert.ok(str.includes('Sunrise Complex'), 'Must include site name');
  });

  await t.test('4. Weekly Attendance Matrix PDF Generator (Landscape)', () => {
    const buf = generateWeeklyAttendancePDF(
      { ...sampleMeta, reportTitle: 'Weekly Attendance Matrix' },
      {
        records: [
          {
            id: 'att-1',
            site_id: 'site-1',
            date: '2026-09-01',
            role_id: 'role-mason',
            role_name: 'Mason',
            category_id: 'cat-1',
            category_name: 'Civil',
            rate_snapshot_paise: 120000,
            full_day_count: 5,
            half_day_count: 0,
            total_workers: 5,
            worker_days: 5.0,
            total_cost_paise: 600000,
            created_by: null,
            updated_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
        startDate: '2026-09-01',
        endDate: '2026-09-07',
      }
    );

    assert.ok(buf.length > 1000);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    const str = extractPdfText(buf);
    assert.ok(str.includes('WEEKLY ATTENDANCE MATRIX'));
    assert.ok(str.includes('Page 1 of 1'));
  });

  await t.test('5. Monthly Attendance Comprehensive PDF Generator (Landscape)', () => {
    const buf = generateMonthlyAttendancePDF(
      { ...sampleMeta, reportTitle: 'Monthly Attendance Report', periodLabel: 'September 2026' },
      {
        records: [
          {
            id: 'att-1',
            site_id: 'site-1',
            date: '2026-09-01',
            role_id: 'role-mason',
            role_name: 'Mason',
            category_id: 'cat-1',
            category_name: 'Civil',
            rate_snapshot_paise: 120000,
            full_day_count: 5,
            half_day_count: 0,
            total_workers: 5,
            worker_days: 5.0,
            total_cost_paise: 600000,
            created_by: null,
            updated_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
        monthLabel: 'September 2026',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }
    );

    assert.ok(buf.length > 1000);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    const str = extractPdfText(buf);
    assert.ok(str.includes('September 2026'));
  });

  await t.test('6. Financial Transactions Ledger PDF Generator (Portrait)', () => {
    const summary: FinancialSummary = {
      openingBalancePaise: 10000000,
      totalCreditPaise: 50000000,
      suppliesDebitPaise: 15000000,
      specialWorkerTaskDebitPaise: 5000000,
      totalDebitPaise: 20000000,
      netCashFlowPaise: 30000000,
      closingBalancePaise: 40000000,
      transactionCount: 2,
    };

    const buf = generateFinancialPDF(
      { ...sampleMeta, reportTitle: 'Financial Transactions Ledger' },
      summary,
      [
        {
          date: '2026-09-01',
          type: 'CREDIT',
          description: 'Client Project Advance',
          amountPaise: 50000000,
        },
        {
          date: '2026-09-02',
          type: 'DEBIT',
          debitCategory: 'SUPPLIES',
          description: 'Ready Mix Concrete 50 bags',
          amountPaise: 15000000,
        },
      ]
    );

    assert.ok(buf.length > 1000);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    const str = extractPdfText(buf);
    assert.ok(str.includes('Ready Mix Concrete'));
    assert.ok(str.includes('Page 1 of 1'));
  });

  await t.test('7. Monthly Financial Statement PDF Generator (Landscape)', () => {
    const summary: FinancialSummary = {
      openingBalancePaise: 10000000,
      totalCreditPaise: 20000000,
      suppliesDebitPaise: 5000000,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: 5000000,
      netCashFlowPaise: 15000000,
      closingBalancePaise: 25000000,
      transactionCount: 2,
    };

    const buf = generateMonthlyFinancialPDF(
      { ...sampleMeta, reportTitle: 'Monthly Financial Statement' },
      summary,
      [
        {
          date: '2026-09-01',
          type: 'CREDIT',
          description: 'Investor Tranche 1',
          amountPaise: 20000000,
        },
      ]
    );

    assert.ok(buf.length > 1000);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
  });

  await t.test('8. Role Breakdown Report PDF Generator (Portrait)', () => {
    const buf = generateRoleReportPDF(
      { ...sampleMeta, reportTitle: 'Role Breakdown Report' },
      {
        roleName: 'Lead Carpenter',
        categoryName: 'Woodwork',
        records: [
          {
            id: 'att-1',
            site_id: 'site-1',
            date: '2026-09-01',
            role_id: 'role-carp',
            role_name: 'Lead Carpenter',
            category_id: 'cat-wood',
            category_name: 'Woodwork',
            rate_snapshot_paise: 140000,
            full_day_count: 2,
            half_day_count: 1,
            total_workers: 3,
            worker_days: 2.5,
            total_cost_paise: 350000,
            created_by: null,
            updated_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
      }
    );

    assert.ok(buf.length > 1000);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    const str = extractPdfText(buf);
    assert.ok(str.includes('Lead Carpenter'));
  });

  await t.test('9. Category Breakdown Report PDF Generator (Portrait)', () => {
    const buf = generateCategoryReportPDF(
      { ...sampleMeta, reportTitle: 'Category Breakdown Report' },
      {
        categoryName: 'Electrical Installation',
        records: [
          {
            id: 'att-1',
            site_id: 'site-1',
            date: '2026-09-01',
            role_id: 'role-elec',
            role_name: 'Licensed Electrician',
            category_id: 'cat-elec',
            category_name: 'Electrical Installation',
            rate_snapshot_paise: 150000,
            full_day_count: 3,
            half_day_count: 0,
            total_workers: 3,
            worker_days: 3.0,
            total_cost_paise: 450000,
            created_by: null,
            updated_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
      }
    );

    assert.ok(buf.length > 1000);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    const str = extractPdfText(buf);
    assert.ok(str.includes('Electrical Installation'));
  });

  await t.test('10. Site Performance Report PDF Generator (Portrait)', () => {
    const finSummary: FinancialSummary = {
      openingBalancePaise: 5000000,
      totalCreditPaise: 100000000,
      suppliesDebitPaise: 40000000,
      specialWorkerTaskDebitPaise: 10000000,
      totalDebitPaise: 50000000,
      netCashFlowPaise: 50000000,
      closingBalancePaise: 55000000,
      transactionCount: 5,
    };

    const buf = generateSitePerformancePDF(
      { ...sampleMeta, reportTitle: 'Site Performance Report' },
      {
        siteName: 'Sunrise Complex',
        siteLocation: 'North Sector',
        attendanceRecords: [
          {
            id: 'att-1',
            site_id: 'site-1',
            date: '2026-09-01',
            role_id: 'role-1',
            rate_snapshot_paise: 100000,
            full_day_count: 10,
            half_day_count: 2,
            total_workers: 12,
            worker_days: 11.0,
            total_cost_paise: 1100000,
            created_by: null,
            updated_by: null,
            created_at: '',
            updated_at: '',
          },
        ],
        financialSummary: finSummary,
      }
    );

    assert.ok(buf.length > 1000);
    assert.equal(buf.subarray(0, 5).toString('ascii'), '%PDF-');
    const str = extractPdfText(buf);
    assert.ok(str.includes('SITE PERFORMANCE REPORT'));
  });

  // --------------------------------------------------------------------------
  // 3. EMPTY STATE VERIFICATION FOR ALL 8 REPORTS
  // --------------------------------------------------------------------------
  await t.test('11. Empty Dataset Behavior Across All 8 Reports', () => {
    // 1. Daily Attendance Empty
    const b1 = generateDailyAttendancePDF(sampleMeta, {
      date: '2026-09-01',
      totalWorkers: 0,
      fullDayCount: 0,
      halfDayCount: 0,
      workerDays: 0,
      totalLabourCostPaise: 0,
      categories: [],
    });
    assert.ok(b1.length > 500);
    assert.ok(extractPdfText(b1).includes('No attendance records recorded for this date.'));

    // 2. Weekly Attendance Empty
    const b2 = generateWeeklyAttendancePDF(sampleMeta, {
      records: [],
      startDate: '2026-09-01',
      endDate: '2026-09-07',
    });
    assert.ok(b2.length > 500);
    assert.ok(extractPdfText(b2).includes('No attendance records recorded for this week.'));

    // 3. Monthly Attendance Empty
    const b3 = generateMonthlyAttendancePDF(sampleMeta, {
      records: [],
      monthLabel: 'September 2026',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    assert.ok(b3.length > 500);
    assert.ok(extractPdfText(b3).includes('No workforce attendance recorded for this month.'));

    // 4. Finance Ledger Empty
    const emptyFinSummary: FinancialSummary = {
      openingBalancePaise: 0,
      totalCreditPaise: 0,
      suppliesDebitPaise: 0,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: 0,
      netCashFlowPaise: 0,
      closingBalancePaise: 0,
      transactionCount: 0,
    };
    const b4 = generateFinancialPDF(sampleMeta, emptyFinSummary, []);
    assert.ok(b4.length > 500);
    assert.ok(extractPdfText(b4).includes('No financial transactions recorded for this period.'));

    // 5. Monthly Finance Empty
    const b5 = generateMonthlyFinancialPDF(sampleMeta, emptyFinSummary, []);
    assert.ok(b5.length > 500);
    assert.ok(extractPdfText(b5).includes('No cash movements recorded for this month.'));

    // 6. Role Report Empty
    const b6 = generateRoleReportPDF(sampleMeta, {
      roleName: 'Plumber',
      categoryName: 'Sanitary',
      records: [],
    });
    assert.ok(b6.length > 500);
    assert.ok(extractPdfText(b6).includes('Selected role had zero deployment days in this period.'));

    // 7. Category Report Empty
    const b7 = generateCategoryReportPDF(sampleMeta, {
      categoryName: 'Sanitary',
      records: [],
    });
    assert.ok(b7.length > 500);
    assert.ok(extractPdfText(b7).includes('Selected category had zero deployment in this period.'));

    // 8. Site Performance Empty
    const b8 = generateSitePerformancePDF(sampleMeta, {
      siteName: 'Sunrise Complex',
      attendanceRecords: [],
      financialSummary: emptyFinSummary,
    });
    assert.ok(b8.length > 500);
    assert.ok(extractPdfText(b8).includes('No operational or financial data recorded for this period.'));
  });

  // --------------------------------------------------------------------------
  // 4. MULTI-PAGE PAGINATION & REPEATED HEADERS
  // --------------------------------------------------------------------------
  await t.test('12. Multi-Page Pagination with Repeated Headers (Large Dataset)', () => {
    // Generate 60 transactions that naturally span multiple A4 portrait pages
    const manyTxs = Array.from({ length: 60 }, (_, i) => ({
      date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
      type: i % 2 === 0 ? 'CREDIT' : 'DEBIT',
      debitCategory: i % 2 === 0 ? null : 'SUPPLIES',
      description: `Purchase of Construction Materials Batch #${i + 1} with high grade quality specifications`,
      amountPaise: (i + 1) * 50000,
    }));

    const summary: FinancialSummary = {
      openingBalancePaise: 1000000,
      totalCreditPaise: 30000000,
      suppliesDebitPaise: 30000000,
      specialWorkerTaskDebitPaise: 0,
      totalDebitPaise: 30000000,
      netCashFlowPaise: 0,
      closingBalancePaise: 1000000,
      transactionCount: 60,
    };

    const buf = generateFinancialPDF(
      { ...sampleMeta, reportTitle: 'Large Financial Ledger' },
      summary,
      manyTxs
    );

    assert.ok(buf.length > 5000, 'Multi-page PDF must have substantial size');
    const str = extractPdfText(buf);

    // Assert that two-pass page numbering recorded multiple pages (e.g. "Page 1 of 2" or "Page 2 of 2")
    assert.ok(str.includes('Page 2 of ') || str.includes('Page 3 of '), 'Must span at least 2 pages');
    assert.ok(
      str.includes('Sunrise Complex') && str.includes('Large Financial Ledger'),
      'Continuation page must have running header'
    );
  });

  // --------------------------------------------------------------------------
  // 5. LIVE HTTP API ORCHESTRATION & CROSS-SITE SECURITY
  // --------------------------------------------------------------------------
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

  // Use matching live DB users and token versions
  const adminToken = await makeToken('usr-admin-1', 'Iamadmin', 'ADMIN', [], 11);
  const engineerToken = await makeToken('usr-eng-1', 'engineer2', 'SITE_MANAGER', ['site-2'], 4);

  await t.test('13. HTTP 401 Unauthorized for Unauthenticated Export Request', async () => {
    const res = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: 'site-1', type: 'DAILY_ATTENDANCE', date: '2026-09-01' }),
    });
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'Please log in to continue.');
  });

  await t.test('14. HTTP 400 Bad Request for Missing siteId', async () => {
    const res = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `site_work_session=${adminToken}` },
      body: JSON.stringify({ type: 'DAILY_ATTENDANCE', date: '2026-09-01' }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('15. HTTP 404 Not Found for Nonexistent siteId', async () => {
    const res = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `site_work_session=${adminToken}` },
      body: JSON.stringify({ siteId: 'non-existent-site-id-999', type: 'DAILY_ATTENDANCE' }),
    });
    assert.equal(res.status, 404);
  });

  await t.test('16. HTTP 400 Bad Request for Unknown Report Type', async () => {
    const res = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `site_work_session=${adminToken}` },
      body: JSON.stringify({ siteId: 'site-1', type: 'COMPLETELY_UNKNOWN_TYPE' }),
    });
    assert.equal(res.status, 400);
  });

  await t.test('17. HTTP 400 Bad Request for Malformed Date', async () => {
    const res = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `site_work_session=${adminToken}` },
      body: JSON.stringify({ siteId: 'site-1', type: 'DAILY_ATTENDANCE', date: '2026/09/01' }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error.includes('Invalid date format'));
  });

  await t.test('18. HTTP 403 Forbidden: Cross-Site Isolation Across ALL 8 Report Types', async () => {
    // Engineer has access to Site 2 only, attempting to access Site 1
    const allReportPayloads = [
      { type: 'DAILY_ATTENDANCE', date: '2026-09-01' },
      { type: 'WEEKLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-07' },
      { type: 'MONTHLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-30' },
      { type: 'FINANCE', startDate: '2026-09-01', endDate: '2026-09-30' },
      { type: 'MONTHLY_FINANCE', startDate: '2026-09-01', endDate: '2026-09-30' },
      { type: 'ROLE_REPORT', startDate: '2026-09-01', endDate: '2026-09-30', roleId: 'role-mason' },
      { type: 'CATEGORY_REPORT', startDate: '2026-09-01', endDate: '2026-09-30', categoryId: 'cat-civil' },
      { type: 'SITE_REPORT', startDate: '2026-09-01', endDate: '2026-09-30' },
    ];

    for (const payload of allReportPayloads) {
      const res = await fetch(`${BASE_URL}/api/export/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `site_work_session=${engineerToken}` },
        body: JSON.stringify({ siteId: 'site-1', ...payload }), // Site 1 is unauthorized for engineer!
      });
      assert.equal(
        res.status,
        403,
        `Report ${payload.type} must reject cross-site tampering with HTTP 403`
      );
    }
  });

  await t.test('19. HTTP 200 OK: Authorized Admin Generation Across ALL 8 Report Types', async () => {
    const allReportPayloads = [
      { type: 'DAILY_ATTENDANCE', date: '2026-09-01' },
      { type: 'WEEKLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-07' },
      { type: 'MONTHLY_ATTENDANCE', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
      { type: 'FINANCE', startDate: '2026-09-01', endDate: '2026-09-30' },
      { type: 'MONTHLY_FINANCE', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
      { type: 'ROLE_REPORT', startDate: '2026-09-01', endDate: '2026-09-30', roleId: 'role-mason' },
      { type: 'CATEGORY_REPORT', startDate: '2026-09-01', endDate: '2026-09-30', categoryId: 'cat-civil' },
      { type: 'SITE_REPORT', startDate: '2026-09-01', endDate: '2026-09-30', monthLabel: 'September 2026' },
    ];

    for (const payload of allReportPayloads) {
      const res = await fetch(`${BASE_URL}/api/export/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: `site_work_session=${adminToken}` },
        body: JSON.stringify({ siteId: 'site-1', ...payload }),
      });
      assert.equal(
        res.status,
        200,
        `Admin request for ${payload.type} must return HTTP 200`
      );
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      const cd = res.headers.get('content-disposition') || '';
      assert.ok(cd.includes('attachment; filename='), 'Must include Content-Disposition header');
      const buf = await res.arrayBuffer();
      assert.ok(buf.byteLength > 1000, 'Must return non-empty PDF binary');
      const sig = new TextDecoder().decode(new Uint8Array(buf.slice(0, 5)));
      assert.equal(sig, '%PDF-', 'Must begin with valid %PDF- signature');
    }
  });
});
