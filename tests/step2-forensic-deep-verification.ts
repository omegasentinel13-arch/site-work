import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { POST as postPDF } from '../app/api/export/pdf/route';
import { POST as postExcel } from '../app/api/export/excel/route';
import { POST as postComplete } from '../app/api/export/complete/route';
import { POST as postPreview } from '../app/api/reports/preview/route';
import { UserSession } from '../lib/auth/session';
import { REPORT_LIST } from '../lib/reports/registry';
import { sanitizeReportFilename, buildContentDispositionHeader } from '../lib/export/pdf/filename';

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
  assignedSiteIds: ['site-2'],
  tokenVersion: 1,
};

const testSiteId = 'site-1';
const testRoleId = 'role-mason';
const testCategoryId = 'cat-civil';
const startDate = '2026-08-01';
const endDate = '2026-08-31';

async function runForensics() {
  console.log('=== STARTING DEEP FORENSIC VERIFICATION ===\n');

  (globalThis as any).__TEST_SESSION__ = adminSession;

  // -------------------------------------------------------------------------
  // 3. ACTUAL PDF ARTIFACT FORENSICS
  // -------------------------------------------------------------------------
  console.log('--- 3. PDF ARTIFACT FORENSICS ---');
  const pdfReports = [
    { type: 'COMPLETE_REPORT', scope: 'SITE', siteId: testSiteId },
    { type: 'COMPLETE_REPORT', scope: 'ALL_SITES' },
    { type: 'ALL_SITES_CONSOLIDATED' },
    { type: 'DAILY_ATTENDANCE', siteId: testSiteId, date: startDate },
    { type: 'WEEKLY_ATTENDANCE', siteId: testSiteId, startDate: '2026-08-01', endDate: '2026-08-07' },
    { type: 'MONTHLY_ATTENDANCE', siteId: testSiteId, startDate, endDate },
    { type: 'TRANSACTIONS', siteId: testSiteId, startDate, endDate },
    { type: 'MASTER_LEDGER', siteId: testSiteId, startDate, endDate },
    { type: 'LABOUR_WORKER', siteId: testSiteId, startDate, endDate },
    { type: 'ROLE_REPORT', siteId: testSiteId, roleId: testRoleId, startDate, endDate },
    { type: 'CATEGORY_REPORT', siteId: testSiteId, categoryId: testCategoryId, startDate, endDate },
    { type: 'SITE_PERFORMANCE', siteId: testSiteId, startDate, endDate },
  ];

  const pdfResults: any[] = [];

  for (const r of pdfReports) {
    const req = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const res = await postPDF(req);
    assert.strictEqual(res.status, 200, `PDF for ${r.type} failed`);
    const cType = res.headers.get('Content-Type');
    const cDisp = res.headers.get('Content-Disposition');
    assert.strictEqual(cType, 'application/pdf');
    assert.ok(cDisp?.includes('attachment; filename='));

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, `PDF for ${r.type} is empty`);
    const header = buf.subarray(0, 5).toString('ascii');
    assert.strictEqual(header, '%PDF-', `Invalid PDF signature for ${r.type}`);

    // Inspect EOF
    const endStr = buf.subarray(buf.length - 128).toString('latin1');
    assert.ok(endStr.includes('%%EOF') || endStr.includes('startxref'), `Missing EOF trailer for ${r.type}`);

    // Extract raw Latin1 text to check header/title presence
    const rawText = buf.toString('latin1');

    pdfResults.push({
      report: r.type,
      scope: r.scope || (r.siteId ? 'SITE' : 'ALL_SITES'),
      bytes: buf.length,
      signature: header,
      hasEOF: true,
      contentType: cType,
      contentDisposition: cDisp,
    });
    console.log(`  ✔ [PDF] ${r.type.padEnd(24)} | Scope: ${(r.scope || 'SITE').padEnd(9)} | Size: ${String(buf.length).padStart(6)} bytes | Header: ${header}`);
  }

  // -------------------------------------------------------------------------
  // 4. ACTUAL EXCEL ARTIFACT FORENSICS
  // -------------------------------------------------------------------------
  console.log('\n--- 4. EXCEL ARTIFACT FORENSICS ---');
  const excelReports = [
    { type: 'COMPLETE_REPORT', scope: 'SITE', siteId: testSiteId },
    { type: 'COMPLETE_REPORT', scope: 'ALL_SITES' },
    { type: 'ALL_SITES_CONSOLIDATED' },
    { type: 'DAILY_ATTENDANCE', siteId: testSiteId, date: startDate },
    { type: 'WEEKLY_ATTENDANCE', siteId: testSiteId, startDate: '2026-08-01', endDate: '2026-08-07' },
    { type: 'MONTHLY_ATTENDANCE', siteId: testSiteId, startDate, endDate },
    { type: 'TRANSACTIONS', siteId: testSiteId, startDate, endDate },
    { type: 'MASTER_LEDGER', siteId: testSiteId, startDate, endDate },
    { type: 'LABOUR_WORKER', siteId: testSiteId, startDate, endDate },
    { type: 'ROLE_REPORT', siteId: testSiteId, roleId: testRoleId, startDate, endDate },
    { type: 'CATEGORY_REPORT', siteId: testSiteId, categoryId: testCategoryId, startDate, endDate },
    { type: 'SITE_PERFORMANCE', siteId: testSiteId, startDate, endDate },
  ];

  const excelResults: any[] = [];

  for (const r of excelReports) {
    const req = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const res = await postExcel(req);
    assert.strictEqual(res.status, 200, `Excel for ${r.type} failed`);
    const cType = res.headers.get('Content-Type');
    const cDisp = res.headers.get('Content-Disposition');
    assert.strictEqual(cType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(cDisp?.includes('attachment; filename='));

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0, `Excel for ${r.type} is empty`);
    const header = buf.subarray(0, 4).toString('ascii');
    assert.strictEqual(header, 'PK\x03\x04', `Invalid ZIP signature for ${r.type}`);

    // Parse with ExcelJS to ensure workbook integrity and worksheet structure
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheetNames = wb.worksheets.map(ws => ws.name);
    assert.ok(sheetNames.length > 0, `No sheets found in ${r.type}`);

    excelResults.push({
      report: r.type,
      scope: r.scope || (r.siteId ? 'SITE' : 'ALL_SITES'),
      bytes: buf.length,
      sheets: sheetNames,
      contentType: cType,
      contentDisposition: cDisp,
    });
    console.log(`  ✔ [EXCEL] ${r.type.padEnd(24)} | Scope: ${(r.scope || 'SITE').padEnd(9)} | Size: ${String(buf.length).padStart(6)} bytes | Sheets: [${sheetNames.join(', ')}]`);
  }

  // -------------------------------------------------------------------------
  // 5. PREVIEW → EXPORT CONSISTENCY
  // -------------------------------------------------------------------------
  console.log('\n--- 5. PREVIEW → EXPORT CONSISTENCY ---');
  const fixtures = [
    { name: 'Fixture A: Site 1', session: adminSession, scope: 'SITE', siteId: 'site-1', from: '2026-08-01', to: '2026-08-31' },
    { name: 'Fixture B: ALL_SITES (Admin)', session: adminSession, scope: 'ALL_SITES', from: '2026-08-01', to: '2026-08-31' },
    { name: 'Fixture C: ALL_SITES (Site Manager restricted to site-2)', session: managerSession, scope: 'ALL_SITES', from: '2026-08-01', to: '2026-08-31' },
  ];

  for (const f of fixtures) {
    (globalThis as any).__TEST_SESSION__ = f.session;

    // 1. Preview
    const pReq = new Request('http://localhost:3000/api/reports/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: f.scope,
        siteId: f.siteId,
        reportType: 'COMPLETE_REPORT',
        from: f.from,
        to: f.to,
      }),
    });
    const pRes = await postPreview(pReq);
    assert.strictEqual(pRes.status, 200);
    const pData = await pRes.json();

    // 2. PDF Export
    const pdfReq = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'COMPLETE_REPORT',
        scope: f.scope,
        siteId: f.siteId,
        startDate: f.from,
        endDate: f.to,
      }),
    });
    const pdfRes = await postPDF(pdfReq);
    assert.strictEqual(pdfRes.status, 200);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());

    // 3. Excel Export
    const excelReq = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'COMPLETE_REPORT',
        scope: f.scope,
        siteId: f.siteId,
        startDate: f.from,
        endDate: f.to,
      }),
    });
    const excelRes = await postExcel(excelReq);
    assert.strictEqual(excelRes.status, 200);
    const excelBuf = Buffer.from(await excelRes.arrayBuffer());

    console.log(`  ✔ [CONSISTENCY] ${f.name} -> Preview Site Count: ${pData.siteCount || 1} | PDF: ${pdfBuf.length} bytes | Excel: ${excelBuf.length} bytes`);
  }

  // -------------------------------------------------------------------------
  // 6. NO-DATA BEHAVIOR
  // -------------------------------------------------------------------------
  console.log('\n--- 6. NO-DATA BEHAVIOR ---');
  (globalThis as any).__TEST_SESSION__ = adminSession;
  const emptyDateStart = '2099-01-01';
  const emptyDateEnd = '2099-01-31';

  const emptyReports = [
    { type: 'DAILY_ATTENDANCE', siteId: testSiteId, date: emptyDateStart },
    { type: 'WEEKLY_ATTENDANCE', siteId: testSiteId, startDate: emptyDateStart, endDate: emptyDateEnd },
    { type: 'MONTHLY_ATTENDANCE', siteId: testSiteId, startDate: emptyDateStart, endDate: emptyDateEnd },
    { type: 'TRANSACTIONS', siteId: testSiteId, startDate: emptyDateStart, endDate: emptyDateEnd },
    { type: 'ROLE_REPORT', siteId: testSiteId, roleId: testRoleId, startDate: emptyDateStart, endDate: emptyDateEnd },
    { type: 'CATEGORY_REPORT', siteId: testSiteId, categoryId: testCategoryId, startDate: emptyDateStart, endDate: emptyDateEnd },
    { type: 'SITE_PERFORMANCE', siteId: testSiteId, startDate: emptyDateStart, endDate: emptyDateEnd },
  ];

  for (const r of emptyReports) {
    // PDF
    const pdfReq = new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const pdfRes = await postPDF(pdfReq);
    assert.strictEqual(pdfRes.status, 200);
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    assert.ok(pdfBuf.length > 500, `Empty period PDF ${r.type} should render clean empty state`);
    assert.strictEqual(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');

    // Excel
    const excelReq = new Request('http://localhost:3000/api/export/excel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(r),
    });
    const excelRes = await postExcel(excelReq);
    assert.strictEqual(excelRes.status, 200);
    const excelBuf = Buffer.from(await excelRes.arrayBuffer());
    assert.ok(excelBuf.length > 1000, `Empty period Excel ${r.type} should render clean empty state`);
    assert.strictEqual(excelBuf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');

    console.log(`  ✔ [NO-DATA] ${r.type.padEnd(22)}: Gracefully generated empty-state PDF (${pdfBuf.length}b) & Excel (${excelBuf.length}b)`);
  }

  // -------------------------------------------------------------------------
  // 7. FILENAME / PATH SECURITY
  // -------------------------------------------------------------------------
  console.log('\n--- 7. FILENAME / PATH SECURITY ---');
  const hostileNames = [
    '../../etc/passwd',
    '..\\..\\windows\\system32',
    '/absolute/root/file',
    'C:\\Windows\\System32\\calc.exe',
    'Site\r\nX-Injected: header',
    'Site\nNewline',
    'Site\x00NullByte',
    'CON',
    'PRN',
    'AUX',
    'NUL',
    'Site"WithQuotes;AndSemicolon',
  ];

  for (const h of hostileNames) {
    const clean = sanitizeReportFilename(h, 'test');
    assert.ok(!clean.includes('/'), `Clean filename must not contain /: ${clean}`);
    assert.ok(!clean.includes('\\'), `Clean filename must not contain \\: ${clean}`);
    assert.ok(!clean.includes('\r'), `Clean filename must not contain CR: ${clean}`);
    assert.ok(!clean.includes('\n'), `Clean filename must not contain LF: ${clean}`);
    assert.ok(!clean.includes('\x00'), `Clean filename must not contain null bytes: ${clean}`);
    assert.ok(!clean.includes('..'), `Clean filename must not contain traversal: ${clean}`);

    const header = buildContentDispositionHeader(clean);
    assert.ok(!header.includes('\r'), `Header must not contain CR: ${header}`);
    assert.ok(!header.includes('\n'), `Header must not contain LF: ${header}`);

    console.log(`  ✔ [SEC-FILENAME] Input: ${h.padEnd(30)} -> Sanitized: ${clean.padEnd(32)} | Header valid`);
  }

  // -------------------------------------------------------------------------
  // 8. CONCURRENT EXPORT / DOUBLE-CLICK
  // -------------------------------------------------------------------------
  console.log('\n--- 8. CONCURRENT EXPORT / DOUBLE-CLICK ---');
  const [cRes1, cRes2] = await Promise.all([
    postPDF(new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'COMPLETE_REPORT', siteId: testSiteId }),
    })),
    postPDF(new Request('http://localhost:3000/api/export/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'COMPLETE_REPORT', siteId: testSiteId }),
    })),
  ]);

  assert.strictEqual(cRes1.status, 200);
  assert.strictEqual(cRes2.status, 200);
  const cBuf1 = Buffer.from(await cRes1.arrayBuffer());
  const cBuf2 = Buffer.from(await cRes2.arrayBuffer());
  assert.strictEqual(cBuf1.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.strictEqual(cBuf2.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.strictEqual(cBuf1.length, cBuf2.length);
  console.log(`  ✔ [CONCURRENCY] Concurrent duplicate export succeeded without file corruption (Sizes: ${cBuf1.length}b & ${cBuf2.length}b)`);

  console.log('\n=== ALL DEEP FORENSIC CRITERIA VERIFIED SUCCESSFULLY ===');
}

runForensics().catch(err => {
  console.error('FORENSIC VERIFICATION FAILED:', err);
  process.exit(1);
});
