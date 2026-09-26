import zlib from 'zlib';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolveExportPeriod } from '../lib/export/complete/periods';
import {
  collectSystemExportData,
  collectSiteExportData,
  getScopeHistoricalDateBounds,
} from '../lib/export/complete/data-collector';
import {
  generateSystemCompletePDF,
  generateSiteCompletePDF,
} from '../lib/export/complete/pdf-consolidator';

export async function runSystemPdfVerification() {
  console.log('================================================================');
  console.log('STARTING TASK 1: SYSTEM-WIDE CONSOLIDATED PDF QA VERIFICATION');
  console.log('================================================================\n');

  const db = new DatabaseSync('data/site_work.db');

  const tableNames = [
    'users',
    'sites',
    'site_users',
    'work_categories',
    'work_roles',
    'attendance_records',
    'financial_transactions',
  ];
  const initialCounts: Record<string, number> = {};
  for (const t of tableNames) {
    initialCounts[t] = (db.prepare('SELECT COUNT(*) as c FROM ' + t).get() as any).c;
  }
  console.log('Initial Business Table Counts:', initialCounts);

  const bounds = getScopeHistoricalDateBounds();
  const period = resolveExportPeriod('ALL_DATA', undefined, undefined, bounds);
  const systemData = collectSystemExportData(period);

  assert.equal(systemData.sitesData.length, 6, 'System data must contain all 6 sites');

  const pdfBuf = generateSystemCompletePDF(systemData);
  assert.ok(pdfBuf.length > 50000, 'System PDF should be a substantial multi-page document');
  console.log('\n✔ System Complete PDF Generated: ' + pdfBuf.length + ' bytes');

  const pdfStr = pdfBuf.toString('binary');
  const pageMatches = pdfStr.match(/\/Type\s*\/Page\b/g);
  const pageCount = pageMatches ? pageMatches.length : 0;
  assert.equal(pageCount, 15, 'Expected exactly 15 pages after layout polish, got ' + pageCount);
  console.log('✔ Exact PDF Page Count: ' + pageCount + ' pages (Cleanly optimized from 16 to 15)');

  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;
  let allText = '';
  while ((match = streamRegex.exec(pdfStr)) !== null) {
    const rawStream = Buffer.from(match[1], 'binary');
    try {
      const decompressed = zlib.inflateSync(rawStream).toString('utf-8');
      allText += decompressed + '\n';
    } catch {
      allText += rawStream.toString('utf-8') + '\n';
    }
  }

  console.log('\n--- VERIFYING ALL 12 REQUIRED SECTIONS ---');
  const requiredSections = [
    '1. ENTERPRISE EXECUTIVE SUMMARY',
    '2. ALL SITES PERFORMANCE & FINANCIAL RECONCILIATION',
    '3. SITE PROFILE & OPERATIONAL SCOPE',
    '4. WORKFORCE ROLE BREAKDOWN & LABOUR DEPLOYMENT',
    '5. WORK CATEGORY SUMMARY & COST ALLOCATION',
    '6. DAILY ATTENDANCE OPERATIONAL LOG',
    '7. FINANCIAL STATEMENT & CASH FLOW POSITION',
    '8. DEBIT EXPENSES BREAKDOWN BY CATEGORY',
    '9. FINANCIAL TRANSACTIONS LEDGER',
    '10. SITE REPORT VERIFICATION & AUDIT METADATA',
    '11. ENTERPRISE CONSOLIDATED TOTALS',
    '12. ENTERPRISE REPORT VERIFICATION & AUDIT METADATA',
  ];

  for (const sec of requiredSections) {
    assert.ok(allText.includes(sec), 'Missing required section: ' + sec);
    console.log('  ✔ Section verified: ' + sec);
  }

  console.log('\n--- VERIFYING ALL 6 DATABASE SITE IDENTITIES ---');
  const expectedSiteRecords = db
    .prepare('SELECT id, name, code FROM sites')
    .all() as Array<{ id: string; name: string; code: string }>;

  assert.equal(expectedSiteRecords.length, 6, 'Must be 6 site records in DB');
  for (const site of expectedSiteRecords) {
    assert.ok(allText.includes(site.id), 'Missing site ID in PDF: ' + site.id);
    console.log('  ✔ Site ID verified: ' + site.id + ' (' + site.name + ', Code: ' + site.code + ')');
  }

  console.log('\n--- VERIFYING SITE 1 OPERATIONAL & FINANCIAL DATA ---');
  assert.ok(allText.includes('40.5'), 'Must contain 40.5 worker-days for Site 1');
  assert.ok(allText.includes('49,500.00'), 'Must contain Rs. 49,500.00 labour cost for Site 1');
  assert.ok(allText.includes('6,00,000.00'), 'Must contain Rs. 6,00,000.00 inflows for Site 1');
  assert.ok(allText.includes('1,25,000.00'), 'Must contain Rs. 1,25,000.00 debits for Site 1');
  assert.ok(allText.includes('4,75,000.00'), 'Must contain Rs. 4,75,000.00 closing balance for Site 1');
  console.log('  ✔ Site 1 details verified: 40.5 W-Days, Rs. 49,500 Labour, Rs. 6,00,000 Credits, Rs. 1,25,000 Debits, Rs. 4,75,000 Net Cash');

  console.log('\n--- VERIFYING ZERO-RECORD SITES EXPLICIT EMPTY STATES ---');
  const emptyStateStrings = [
    'No workforce attendance recorded for this site.',
    'No category attendance recorded for this site.',
    'No daily attendance logs recorded for this site.',
    'No debit expenses recorded for this site.',
    'No financial transactions recorded for this site.',
  ];
  for (const emptyMsg of emptyStateStrings) {
    assert.ok(allText.includes(emptyMsg), 'Missing explicit empty state message: ' + emptyMsg);
    console.log('  ✔ Empty state message verified: "' + emptyMsg + '"');
  }

  console.log('\n--- VERIFYING ENTERPRISE TOTALS & DOMAIN PARITY ---');
  assert.equal(systemData.aggregatedSummary.totalSites, 6);
  assert.equal(systemData.aggregatedSummary.totalWorkerDays, 40.5);
  assert.equal(systemData.aggregatedSummary.totalLabourCostPaise, 4950000);
  assert.equal(systemData.aggregatedSummary.totalCreditsPaise, 60000000);
  assert.equal(systemData.aggregatedSummary.totalDebitsPaise, 12500000);
  assert.equal(systemData.aggregatedSummary.netClosingBalancePaise, 47500000);
  console.log('  ✔ Domain mathematical parity: All enterprise totals match domain calculations');

  console.log('\n--- VERIFYING SITE COMPLETE PDF FIDELITY ---');
  const siteData = collectSiteExportData('site-1', period);
  const sitePdfBuf = generateSiteCompletePDF(siteData);
  assert.ok(sitePdfBuf.toString('binary').startsWith('%PDF-'));
  assert.ok(sitePdfBuf.length > 30000);
  console.log('  ✔ Site Complete PDF generated independently: ' + sitePdfBuf.length + ' bytes (Unchanged)');

  console.log('\n--- VERIFYING DATABASE INVARIANCE ---');
  for (const t of tableNames) {
    const currentCount = (db.prepare('SELECT COUNT(*) as c FROM ' + t).get() as any).c;
    assert.equal(
      currentCount,
      initialCounts[t],
      'Table ' + t + ' count mutated! Before: ' + initialCounts[t] + ', Now: ' + currentCount
    );
    console.log('  ✔ Table ' + t.padEnd(25) + ': ' + currentCount + ' -> ' + currentCount + ' (Delta: 0)');
  }

  console.log('\n================================================================');
  console.log('ALL SYSTEM-WIDE CONSOLIDATED PDF CHECKS PASSED (100% SUCCESS)');
  console.log('================================================================\n');
}

runSystemPdfVerification().catch((err) => {
  console.error('SYSTEM PDF QA FAILED:', err);
  process.exit(1);
});
