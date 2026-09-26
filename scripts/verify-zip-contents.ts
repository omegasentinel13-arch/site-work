import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';
import { REPORT_DEFINITIONS, REPORT_LIST } from '../lib/reports/registry';

const BASE_URL = 'http://localhost:3000';

async function getAdminCookie(): Promise<string> {
  const envContent = fs.existsSync(path.join(process.cwd(), '.env.local'))
    ? fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
    : '';
  let secret = process.env.SESSION_SECRET || 'site_work_dev_secret_session_key_minimum_32_characters_2026';
  for (const line of envContent.split('\n')) {
    if (line.startsWith('SESSION_SECRET=')) {
      secret = line.replace('SESSION_SECRET=', '').trim();
    }
  }

  const db = new DatabaseSync(path.join(process.cwd(), 'data', 'site_work.db'), { readOnly: true } as any);
  const adminUser = db.prepare('SELECT id, username, full_name, role, authority_tier, token_version FROM users WHERE id = ?').get('usr-admin-1') as any;
  db.close();

  const secretKey = new TextEncoder().encode(secret);
  const token = await new SignJWT({
    userId: adminUser.id,
    username: adminUser.username,
    fullName: adminUser.full_name,
    role: adminUser.role,
    authorityTier: adminUser.authority_tier || 'KING_MAKER',
    assignedSiteIds: [],
    tokenVersion: adminUser.token_version,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secretKey);

  return `site_work_session=${token}`;
}

async function analyzeZip(name: string, zipBuffer: Buffer) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const fileNames = Object.keys(zip.files).sort();

  const pdfFiles = fileNames.filter(f => f.endsWith('.pdf'));
  const excelFiles = fileNames.filter(f => f.endsWith('.xlsx'));
  const hasReadme = fileNames.includes('README.txt');
  const hasManifest = fileNames.includes('manifest.json');
  const hasDb = fileNames.some(f => f.endsWith('.db') || f.endsWith('.sqlite'));
  const hasData = fileNames.some(f => f.startsWith('data/'));
  
  // Inspect manifest
  let manifest: any = null;
  if (hasManifest) {
    const text = await zip.file('manifest.json')!.async('text');
    manifest = JSON.parse(text);
  }

  return {
    name,
    totalFiles: fileNames.length,
    fileNames,
    pdfCount: pdfFiles.length,
    excelCount: excelFiles.length,
    hasReadme,
    hasManifest,
    zeroDb: !hasDb,
    zeroDataDumps: !hasData,
    manifest,
  };
}

async function main() {
  const cookie = await getAdminCookie();
  const headers = {
    'Cookie': cookie,
    'Content-Type': 'application/json',
  };

  console.log('=== FORENSIC REPORT ZIP INSPECTION ===');

  // Case 1: SITE Selected Reports
  console.log('\n--- 1. SITE Selected Reports (5 reports) ---');
  const res1 = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      scope: 'SITE',
      siteId: 'site-1',
      period: 'ALL_DATA',
      format: 'FULL_REPORT_ZIP',
      reportTypes: ['COMPLETE_REPORT', 'DAILY_ATTENDANCE', 'TRANSACTIONS', 'MASTER_LEDGER', 'SITE_PERFORMANCE'],
    }),
  });
  const buf1 = Buffer.from(await res1.arrayBuffer());
  const report1 = await analyzeZip('SITE Selected Reports', buf1);
  console.log(JSON.stringify(report1, null, 2));

  // Case 2: ALL_SITES Selected Reports
  console.log('\n--- 2. ALL_SITES Selected Reports (4 reports) ---');
  const res2 = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      scope: 'SYSTEM',
      period: 'ALL_DATA',
      format: 'FULL_REPORT_ZIP',
      reportTypes: ['COMPLETE_REPORT', 'ALL_SITES_CONSOLIDATED', 'TRANSACTIONS', 'MASTER_LEDGER'],
    }),
  });
  const buf2 = Buffer.from(await res2.arrayBuffer());
  const report2 = await analyzeZip('ALL_SITES Selected Reports', buf2);
  console.log(JSON.stringify(report2, null, 2));

  // Case 3: SELECT ALL SITE
  console.log('\n--- 3. SELECT ALL SITE ---');
  const allSiteReportTypes = Object.entries(REPORT_DEFINITIONS)
    .filter(([_, def]) => def.supportedScopes.includes('SITE'))
    .map(([id]) => id);
  console.log('Applicable SITE report types:', allSiteReportTypes);
  const res3 = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      scope: 'SITE',
      siteId: 'site-1',
      period: 'ALL_DATA',
      format: 'FULL_REPORT_ZIP',
      reportTypes: allSiteReportTypes,
    }),
  });
  const buf3 = Buffer.from(await res3.arrayBuffer());
  const report3 = await analyzeZip('SELECT ALL SITE', buf3);
  console.log(JSON.stringify(report3, null, 2));

  // Case 4: SELECT ALL ALL_SITES
  console.log('\n--- 4. SELECT ALL ALL_SITES ---');
  const allSystemReportTypes = Object.entries(REPORT_DEFINITIONS)
    .filter(([_, def]) => def.supportedScopes.includes('ALL_SITES'))
    .map(([id]) => id);
  console.log('Applicable ALL_SITES report types:', allSystemReportTypes);
  const res4 = await fetch(`${BASE_URL}/api/export/complete`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      scope: 'SYSTEM',
      period: 'ALL_DATA',
      format: 'FULL_REPORT_ZIP',
      reportTypes: allSystemReportTypes,
    }),
  });
  const buf4 = Buffer.from(await res4.arrayBuffer());
  const report4 = await analyzeZip('SELECT ALL ALL_SITES', buf4);
  console.log(JSON.stringify(report4, null, 2));
}

main().catch(console.error);
