import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createFullReportZip } from '../lib/export/complete/zip-packager';
import { REPORT_DEFINITIONS, REPORT_LIST } from '../lib/reports/registry';

describe('SUITE 1: COMPLETE REPORT ZIP PACKAGING & SCOPE SELECTOR', () => {
  test('generates clean report package containing only PDFs, Excels, README, and manifest', async () => {
    const dummyPdf = Buffer.from('%PDF-1.4 dummy pdf content');
    const dummyExcel = Buffer.from('PK\x03\x04 dummy excel content');

    const zipBuffer = await createFullReportZip({
      baseName: 'Site_Downtown_Tower',
      scope: 'SITE',
      siteName: 'Downtown Tower',
      siteCode: 'DT01',
      period: { preset: 'ALL_DATA', label: 'All Recorded Data' },
      generatedBy: { id: 'usr-admin-1', username: 'admin', role: 'ADMIN' },
      reports: [
        {
          type: 'COMPLETE_REPORT',
          title: 'Complete_Project_Report',
          pdfBuffer: dummyPdf,
          excelBuffer: dummyExcel,
        },
        {
          type: 'DAILY_ATTENDANCE',
          title: 'Daily_Attendance_Roster',
          pdfBuffer: dummyPdf,
        },
      ],
    });

    const zip = await JSZip.loadAsync(zipBuffer);
    const files = Object.keys(zip.files);

    // Assert mandatory control files
    assert.ok(files.includes('README.txt'), 'Must contain README.txt');
    assert.ok(files.includes('manifest.json'), 'Must contain manifest.json');

    // Assert report files present in reports/ folder
    assert.ok(files.includes('reports/Complete_Project_Report.pdf'));
    assert.ok(files.includes('reports/Complete_Project_Report.xlsx'));
    assert.ok(files.includes('reports/Daily_Attendance_Roster.pdf'));

    // STRICT NEGATIVE ASSERTIONS: Zero database files, zero raw data JSON dumps
    const hasDbFile = files.some(f => f.endsWith('.db') || f.endsWith('.sqlite'));
    assert.strictEqual(hasDbFile, false, 'NEGATIVE ASSERTION FAILED: ZIP must contain zero .db files');

    const hasDataFolder = files.some(f => f.startsWith('data/'));
    assert.strictEqual(hasDataFolder, false, 'NEGATIVE ASSERTION FAILED: ZIP must contain zero data/ raw JSON dumps');

    // Check manifest structure and cryptographic verification
    const manifestStr = await zip.file('manifest.json')!.async('text');
    const manifest = JSON.parse(manifestStr);
    assert.strictEqual(manifest.packageType, 'REPORT_PACKAGE');
    assert.strictEqual(manifest.files.length, 4, '3 report files + README.txt');
    assert.ok(manifest.packageChecksum, 'Must have packageChecksum');
  });

  test('enforces scope applicability for report types (SITE vs ALL_SITES)', () => {
    const siteReports = REPORT_LIST.filter(r => r.supportedScopes.includes('SITE'));
    const allSitesReports = REPORT_LIST.filter(r => r.supportedScopes.includes('ALL_SITES'));

    // SITE scope has exactly 10 applicable reports (all except ALL_SITES_CONSOLIDATED)
    assert.strictEqual(siteReports.length, 10, 'SITE scope must have exactly 10 applicable reports');
    assert.strictEqual(siteReports.some(r => r.id === 'ALL_SITES_CONSOLIDATED'), false);

    // ALL_SITES scope has exactly 8 applicable reports per canonical registry
    assert.strictEqual(allSitesReports.length, 8, 'ALL_SITES scope must have exactly 8 applicable reports');
    const expectedAllSites = ['COMPLETE_REPORT', 'ALL_SITES_CONSOLIDATED', 'TRANSACTIONS', 'MASTER_LEDGER', 'DAILY_ATTENDANCE', 'LABOUR_WORKER', 'ROLE_REPORT', 'CATEGORY_REPORT'];
    for (const expected of expectedAllSites) {
      assert.ok(allSitesReports.some(r => r.id === expected), `Expected ${expected} to support ALL_SITES`);
    }

    // Site-only reports in canonical registry
    assert.strictEqual(REPORT_DEFINITIONS.WEEKLY_ATTENDANCE.supportedScopes.includes('ALL_SITES'), false);
    assert.strictEqual(REPORT_DEFINITIONS.MONTHLY_ATTENDANCE.supportedScopes.includes('ALL_SITES'), false);
    assert.strictEqual(REPORT_DEFINITIONS.SITE_PERFORMANCE.supportedScopes.includes('ALL_SITES'), false);
  });
});
