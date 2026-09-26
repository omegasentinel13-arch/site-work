import { SignJWT } from 'jose';
import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

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

async function runSmokeTests() {
  console.log('============================================================');
  console.log('POST-DEPLOYMENT READ-ONLY SMOKE TEST SUITE');
  console.log('============================================================');

  const cookie = await getAdminCookie();
  const headers = {
    'Cookie': cookie,
    'Content-Type': 'application/json',
  };

  const results: Record<string, { status: number | string; ok: boolean; details?: string }> = {};

  // 1. Route Smoke Tests
  const routesToTest = [
    { name: '1. Login Page', url: `${BASE_URL}/login`, method: 'GET', noAuth: true },
    { name: '2. Dashboard', url: `${BASE_URL}/`, method: 'GET' },
    { name: '3. Attendance Daily', url: `${BASE_URL}/attendance/daily`, method: 'GET' },
    { name: '4. Attendance Weekly', url: `${BASE_URL}/attendance/weekly`, method: 'GET' },
    { name: '5. Attendance Monthly', url: `${BASE_URL}/attendance/monthly`, method: 'GET' },
    { name: '6. Finance / Transactions', url: `${BASE_URL}/finance`, method: 'GET' },
    { name: '7. Master Ledger', url: `${BASE_URL}/finance/monthly`, method: 'GET' },
    { name: '8. Sites Setup', url: `${BASE_URL}/setup/sites`, method: 'GET' },
    { name: '9. Roles Setup', url: `${BASE_URL}/setup/roles`, method: 'GET' },
    { name: '10. Users & Access Setup', url: `${BASE_URL}/setup/users`, method: 'GET' },
    { name: '11. Audit Trail Setup', url: `${BASE_URL}/setup/audit`, method: 'GET' },
    { name: '12. My Account', url: `${BASE_URL}/setup/account`, method: 'GET' },
    { name: '13. Reports & Backup Root', url: `${BASE_URL}/admin/data-protection`, method: 'GET' },
    { name: '14. Report Center Tab', url: `${BASE_URL}/admin/data-protection?tab=reports`, method: 'GET' },
    { name: '15. Backup & Recovery Tab', url: `${BASE_URL}/admin/data-protection?tab=backup`, method: 'GET' },
    { name: '16. Recovery History Tab', url: `${BASE_URL}/admin/data-protection?tab=history`, method: 'GET' },
    { name: '17. Stored Backups API', url: `${BASE_URL}/api/backup`, method: 'GET' },
    { name: '18. Recovery History API', url: `${BASE_URL}/api/backup/import/history`, method: 'GET' },
    { name: '19. Audit API', url: `${BASE_URL}/api/audit`, method: 'GET' },
  ];

  for (const r of routesToTest) {
    try {
      const res = await fetch(r.url, {
        method: r.method,
        headers: r.noAuth ? undefined : headers,
      });
      results[r.name] = {
        status: res.status,
        ok: res.status >= 200 && res.status < 400,
      };
    } catch (err: any) {
      results[r.name] = {
        status: 'NETWORK_ERROR',
        ok: false,
        details: err.message,
      };
    }
  }

  // 2. Report Preview Smoke Test
  try {
    const previewRes = await fetch(`${BASE_URL}/api/reports/preview`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'SITE',
        siteId: 'site-1',
        reportType: 'COMPLETE_REPORT',
      }),
    });
    const previewData = await previewRes.json();
    results['20. Report Preview API'] = {
      status: previewRes.status,
      ok: previewRes.ok && previewData.siteCount === 1,
      details: `siteCount: ${previewData.siteCount}, attendance: ${previewData.attendanceRecordsCount}, transactions: ${previewData.transactionCount}`,
    };
  } catch (err: any) {
    results['20. Report Preview API'] = { status: 'ERR', ok: false, details: err.message };
  }

  // 3. Report PDF Smoke Test
  try {
    const pdfRes = await fetch(`${BASE_URL}/api/export/pdf`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        siteId: 'site-1',
        type: 'DAILY_ATTENDANCE',
      }),
    });
    const pdfBuf = await pdfRes.arrayBuffer();
    const isPdfValid = Buffer.from(pdfBuf).subarray(0, 4).toString() === '%PDF';
    results['21. PDF Export API'] = {
      status: pdfRes.status,
      ok: pdfRes.ok && isPdfValid,
      details: `Bytes: ${pdfBuf.byteLength}, Magic: %PDF`,
    };
  } catch (err: any) {
    results['21. PDF Export API'] = { status: 'ERR', ok: false, details: err.message };
  }

  // 4. Report Excel Smoke Test
  try {
    const xlsxRes = await fetch(`${BASE_URL}/api/export/excel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        siteId: 'site-1',
        type: 'FINANCE',
      }),
    });
    const xlsxBuf = await xlsxRes.arrayBuffer();
    const isZipHeader = Buffer.from(xlsxBuf).subarray(0, 2).toString() === 'PK';
    results['22. Excel Export API'] = {
      status: xlsxRes.status,
      ok: xlsxRes.ok && isZipHeader,
      details: `Bytes: ${xlsxBuf.byteLength}, Magic: PK (ZIP/XLSX)`,
    };
  } catch (err: any) {
    results['22. Excel Export API'] = { status: 'ERR', ok: false, details: err.message };
  }

  // 5. Full Report ZIP Smoke Test (SITE scope - 10 reports)
  try {
    const zipRes = await fetch(`${BASE_URL}/api/export/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'SITE',
        siteId: 'site-1',
        period: 'ALL_DATA',
        format: 'FULL_REPORT_ZIP',
        reportTypes: [
          'COMPLETE_REPORT',
          'DAILY_ATTENDANCE',
          'TRANSACTIONS',
          'MASTER_LEDGER',
          'SITE_PERFORMANCE',
        ],
      }),
    });

    const zipArrayBuf = await zipRes.arrayBuffer();
    const zipBuf = Buffer.from(zipArrayBuf);
    const zip = await JSZip.loadAsync(zipBuf);
    const files = Object.keys(zip.files);

    const hasReadme = files.includes('README.txt');
    const hasManifest = files.includes('manifest.json');
    const hasReports = files.some(f => f.startsWith('reports/'));
    const hasDb = files.some(f => f.endsWith('.db') || f.endsWith('.sqlite'));
    const hasData = files.some(f => f.startsWith('data/'));

    results['23. Full Report ZIP (SITE)'] = {
      status: zipRes.status,
      ok: zipRes.ok && hasReadme && hasManifest && hasReports && !hasDb && !hasData,
      details: `Files: ${files.length}, Zero DB: ${!hasDb}, Zero Data Dumps: ${!hasData}`,
    };
  } catch (err: any) {
    results['23. Full Report ZIP (SITE)'] = { status: 'ERR', ok: false, details: err.message };
  }

  // 6. Full Report ZIP Smoke Test (ALL_SITES scope - 8 reports)
  try {
    const zipAllRes = await fetch(`${BASE_URL}/api/export/complete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        scope: 'SYSTEM',
        period: 'ALL_DATA',
        format: 'FULL_REPORT_ZIP',
        reportTypes: [
          'COMPLETE_REPORT',
          'ALL_SITES_CONSOLIDATED',
          'TRANSACTIONS',
          'MASTER_LEDGER',
        ],
      }),
    });

    const zipAllArrayBuf = await zipAllRes.arrayBuffer();
    const zipAllBuf = Buffer.from(zipAllArrayBuf);
    const zipAll = await JSZip.loadAsync(zipAllBuf);
    const filesAll = Object.keys(zipAll.files);

    const hasReadmeAll = filesAll.includes('README.txt');
    const hasManifestAll = filesAll.includes('manifest.json');
    const hasReportsAll = filesAll.some(f => f.startsWith('reports/'));
    const hasDbAll = filesAll.some(f => f.endsWith('.db') || f.endsWith('.sqlite'));
    const hasDataAll = filesAll.some(f => f.startsWith('data/'));

    results['24. Full Report ZIP (ALL_SITES)'] = {
      status: zipAllRes.status,
      ok: zipAllRes.ok && hasReadmeAll && hasManifestAll && hasReportsAll && !hasDbAll && !hasDataAll,
      details: `Files: ${filesAll.length}, Zero DB: ${!hasDbAll}, Zero Data Dumps: ${!hasDataAll}`,
    };
  } catch (err: any) {
    results['24. Full Report ZIP (ALL_SITES)'] = { status: 'ERR', ok: false, details: err.message };
  }

  console.log(JSON.stringify(results, null, 2));

  const allPassed = Object.values(results).every(r => r.ok);
  console.log('============================================================');
  console.log('SMOKE TEST VERDICT:', allPassed ? 'ALL TESTS PASSED' : 'FAILURES DETECTED');
  console.log('============================================================');
}

runSmokeTests().catch(err => {
  console.error('Fatal smoke test runner error:', err);
  process.exit(1);
});
