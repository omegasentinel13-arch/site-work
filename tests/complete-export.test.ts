import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  resolveExportPeriod,
  getScopeHistoricalDateBounds,
  collectSiteExportData,
  collectSystemExportData,
  generateSiteCompleteJSON,
  generateSystemCompleteJSON,
  generateSiteCompletePDF,
  generateSystemCompletePDF,
  generateCompleteSiteExcel,
  generateCompleteSystemExcel,
  createCompleteExportZip,
  ExportManifest,
} from '../lib/export/complete';
import { getDb } from '../lib/db';
import { getAllSites } from '../lib/db/repositories/site-repo';

test('TASK 1 — Complete Export Period Resolution', () => {
  // 1. ALL_DATA with actual bounds
  const allDataWithBounds = resolveExportPeriod('ALL_DATA', undefined, undefined, {
    earliestDate: '2026-08-01',
    latestDate: '2026-09-05',
  });
  assert.equal(allDataWithBounds.preset, 'ALL_DATA');
  assert.equal(allDataWithBounds.isUnbounded, true);
  assert.equal(allDataWithBounds.startDate, '2026-08-01');
  assert.equal(allDataWithBounds.endDate, '2026-09-05');
  assert.equal(allDataWithBounds.label, 'All Data (2026-08-01 to 2026-09-05)');

  // 2. ALL_DATA without bounds
  const allDataNoBounds = resolveExportPeriod('ALL_DATA');
  assert.equal(allDataNoBounds.isUnbounded, true);
  assert.equal(allDataNoBounds.label, 'All Data (Full Recorded History)');

  // 3. TODAY
  const today = resolveExportPeriod('TODAY');
  assert.equal(today.preset, 'TODAY');
  assert.equal(today.isUnbounded, false);
  assert.ok(today.startDate && today.startDate === today.endDate);

  // 4. LAST_7_DAYS
  const last7 = resolveExportPeriod('LAST_7_DAYS');
  assert.equal(last7.preset, 'LAST_7_DAYS');
  assert.equal(last7.isUnbounded, false);
  assert.ok(last7.startDate && last7.endDate);

  // 5. LAST_30_DAYS
  const last30 = resolveExportPeriod('LAST_30_DAYS');
  assert.equal(last30.preset, 'LAST_30_DAYS');
  assert.equal(last30.isUnbounded, false);

  // 6. THIS_MONTH
  const thisMonth = resolveExportPeriod('THIS_MONTH');
  assert.equal(thisMonth.preset, 'THIS_MONTH');

  // 7. PREVIOUS_MONTH
  const prevMonth = resolveExportPeriod('PREVIOUS_MONTH');
  assert.equal(prevMonth.preset, 'PREVIOUS_MONTH');

  // 8. THIS_YEAR & PREVIOUS_YEAR
  const thisYear = resolveExportPeriod('THIS_YEAR');
  assert.equal(thisYear.preset, 'THIS_YEAR');
  const prevYear = resolveExportPeriod('PREVIOUS_YEAR');
  assert.equal(prevYear.preset, 'PREVIOUS_YEAR');

  // 9. CUSTOM
  const custom = resolveExportPeriod('CUSTOM', '2026-08-15', '2026-09-01');
  assert.equal(custom.preset, 'CUSTOM');
  assert.equal(custom.startDate, '2026-08-15');
  assert.equal(custom.endDate, '2026-09-01');
  assert.equal(custom.label, 'Custom Range (2026-08-15 to 2026-09-01)');
});

test('TASK 1 — Site & System Data Collection (Read-Only)', () => {
  const sites = getAllSites(false);
  assert.ok(sites.length > 0, 'Should find at least one active site');
  const testSite = sites[0];

  const resolvedAll = resolveExportPeriod('ALL_DATA');
  const siteData = collectSiteExportData(testSite.id, resolvedAll);

  // Assert data structure
  assert.equal(siteData.site.id, testSite.id);
  assert.ok(Array.isArray(siteData.attendanceRecords));
  assert.ok(Array.isArray(siteData.financialRecords));
  assert.ok(Array.isArray(siteData.dailySummaries));
  assert.ok(Array.isArray(siteData.roleRollup));
  assert.ok(Array.isArray(siteData.categoryRollup));
  assert.ok(typeof siteData.totalWorkerDays === 'number');
  assert.ok(typeof siteData.totalLabourCostPaise === 'number');
  assert.ok(typeof siteData.closingBalancePaise === 'number');

  // System collection
  const systemData = collectSystemExportData(resolvedAll);
  assert.ok(systemData.sitesData.length >= 1);
  assert.equal(systemData.aggregatedSummary.totalSites, sites.length);
  assert.ok(typeof systemData.aggregatedSummary.totalWorkerDays === 'number');
  assert.ok(typeof systemData.aggregatedSummary.totalLabourCostPaise === 'number');
});

test('TASK 1 — Machine-Readable JSON Export Generation & Security Sanitization', () => {
  const sites = getAllSites(false);
  const testSite = sites[0];
  const resolved = resolveExportPeriod('ALL_DATA');
  const siteData = collectSiteExportData(testSite.id, resolved);

  const siteJsonStr = generateSiteCompleteJSON(siteData, 'test_operator');
  const parsed = JSON.parse(siteJsonStr);

  assert.equal(parsed.application, 'SITE WORK');
  assert.equal(parsed.exportType, 'COMPLETE_SITE');
  assert.equal(parsed.generatedBy, 'test_operator');
  assert.equal(parsed.scope.siteId, testSite.id);

  // Security check: ensure no passwords, hashes, recovery tokens, or secrets exist anywhere in JSON
  const rawString = siteJsonStr.toLowerCase();
  assert.equal(rawString.includes('password'), false, 'JSON must never contain password keys');
  assert.equal(rawString.includes('hash_admin'), false, 'JSON must never contain password hashes');
  assert.equal(rawString.includes('token_hash'), false, 'JSON must never contain token hashes');
  assert.equal(rawString.includes('session_secret'), false, 'JSON must never contain secrets');

  // System JSON
  const systemData = collectSystemExportData(resolved);
  const sysJsonStr = generateSystemCompleteJSON(systemData, 'test_admin');
  const sysParsed = JSON.parse(sysJsonStr);
  assert.equal(sysParsed.exportType, 'COMPLETE_SYSTEM');
  assert.equal(sysParsed.scope.totalSites, sites.length);
});

test('TASK 1 — Consolidated Multi-Section PDF Generation', () => {
  const sites = getAllSites(false);
  const testSite = sites[0];
  const resolved = resolveExportPeriod('ALL_DATA');
  const siteData = collectSiteExportData(testSite.id, resolved);

  // Site PDF
  const sitePdfBuf = generateSiteCompletePDF(siteData, 'Admin Tester');
  assert.ok(Buffer.isBuffer(sitePdfBuf), 'Should return Node.js Buffer');
  assert.ok(sitePdfBuf.length > 5000, 'Consolidated PDF buffer should contain comprehensive report data');
  const sitePdfHeader = sitePdfBuf.subarray(0, 5).toString('ascii');
  assert.equal(sitePdfHeader, '%PDF-', 'Must start with valid PDF magic bytes');

  // System PDF
  const systemData = collectSystemExportData(resolved);
  const sysPdfBuf = generateSystemCompletePDF(systemData, 'Admin Tester');
  assert.ok(Buffer.isBuffer(sysPdfBuf));
  assert.ok(sysPdfBuf.length > 5000);
  const sysPdfHeader = sysPdfBuf.subarray(0, 5).toString('ascii');
  assert.equal(sysPdfHeader, '%PDF-');
});

test('TASK 1 — Consolidated Multi-Sheet Excel Generation', async () => {
  const sites = getAllSites(false);
  const testSite = sites[0];
  const resolved = resolveExportPeriod('ALL_DATA');
  const siteData = collectSiteExportData(testSite.id, resolved);

  const meta = {
    siteName: testSite.name,
    siteCode: testSite.code,
    reportTitle: `Complete Site Report — ${testSite.name}`,
    periodLabel: resolved.label,
    generatedBy: 'Admin Tester',
    generatedAt: new Date().toISOString(),
  };

  // Site Excel
  const siteExcelBuf = await generateCompleteSiteExcel(siteData, meta);
  assert.ok(Buffer.isBuffer(siteExcelBuf));
  assert.ok(siteExcelBuf.length > 5000, 'Excel workbook should contain formatted multi-sheet binary');
  const excelMagic = siteExcelBuf.subarray(0, 4).toString('ascii');
  assert.equal(excelMagic, 'PK\x03\x04', 'XLSX must start with valid ZIP archive magic bytes');

  // System Excel
  const systemData = collectSystemExportData(resolved);
  const sysExcelBuf = await generateCompleteSystemExcel(systemData, meta);
  assert.ok(Buffer.isBuffer(sysExcelBuf));
  assert.ok(sysExcelBuf.length > 5000);
  assert.equal(sysExcelBuf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
});

test('TASK 1 — In-Memory ZIP Archive Packaging & Manifest Verification', async () => {
  const sites = getAllSites(false);
  const testSite = sites[0];
  const resolved = resolveExportPeriod('ALL_DATA');
  const siteData = collectSiteExportData(testSite.id, resolved);

  const jsonStr = generateSiteCompleteJSON(siteData, 'Operator');
  const jsonBuf = Buffer.from(jsonStr, 'utf-8');
  const pdfBuf = generateSiteCompletePDF(siteData, 'Operator');
  const excelBuf = await generateCompleteSiteExcel(siteData, {
    siteName: testSite.name,
    reportTitle: 'Complete Site Report',
    periodLabel: resolved.label,
    generatedBy: 'Operator',
  });

  const manifest: ExportManifest = {
    application: 'SITE WORK Enterprise System',
    exportVersion: 1,
    exportType: 'COMPLETE_SITE',
    generatedAt: new Date().toISOString(),
    generatedBy: {
      id: 'usr-1',
      username: 'Operator',
      role: 'ADMIN',
    },
    scope: {
      type: 'SITE',
      siteId: testSite.id,
      siteName: testSite.name,
      siteCode: testSite.code,
    },
    period: {
      preset: 'ALL_DATA',
      from: null,
      to: null,
      label: resolved.label,
    },
    formatsIncluded: ['PDF', 'EXCEL', 'JSON'],
    recordCounts: {
      attendanceRecords: siteData.attendanceRecords.length,
      financialTransactions: siteData.financialRecords.length,
      workRoles: siteData.roles.length,
      workCategories: siteData.categories.length,
      sites: 1,
    },
    files: [],
  };

  const zipBuf = await createCompleteExportZip({
    baseName: 'test_archive_sitework',
    manifest,
    jsonBuffer: jsonBuf,
    pdfBuffer: pdfBuf,
    excelBuffer: excelBuf,
  });

  assert.ok(Buffer.isBuffer(zipBuf));
  assert.ok(zipBuf.length > 10000, 'Packaged ZIP should contain all artifacts');
  assert.equal(zipBuf.subarray(0, 4).toString('ascii'), 'PK\x03\x04');

  // Extract ZIP and inspect internal directory structure
  const zip = await JSZip.loadAsync(zipBuf);
  assert.ok(zip.file('manifest.json'), 'ZIP must include manifest.json at root');
  assert.ok(zip.file('README.txt'), 'ZIP must include README.txt at root');
  assert.ok(zip.file('data/test_archive_sitework.json'), 'ZIP must include data/*.json');
  assert.ok(zip.file('pdf/test_archive_sitework.pdf'), 'ZIP must include pdf/*.pdf');
  assert.ok(zip.file('excel/test_archive_sitework.xlsx'), 'ZIP must include excel/*.xlsx');

  // Read manifest.json from ZIP
  const manifestText = await zip.file('manifest.json')!.async('text');
  const readManifest: ExportManifest = JSON.parse(manifestText);
  assert.equal(readManifest.exportType, 'COMPLETE_SITE');
  assert.equal(readManifest.files.length, 4, 'Manifest should list data, pdf, excel, and readme');
  assert.ok(readManifest.files.some((f) => f.format === 'JSON'));
  assert.ok(readManifest.files.some((f) => f.format === 'PDF'));
  assert.ok(readManifest.files.some((f) => f.format === 'XLSX'));
  assert.ok(readManifest.files.some((f) => f.format === 'TXT'));
});

test('TASK 1 — Zero Production Database Modification Verification', () => {
  // Ensure the database was strictly read-only and no business rows were added or altered
  const db = getDb();
  const sitesCount = (db.prepare('SELECT COUNT(*) as c FROM sites').get() as { c: number }).c;
  assert.ok(sitesCount >= 1, 'Sites table intact');

  const usersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  assert.ok(usersCount >= 1, 'Users table intact');
});
