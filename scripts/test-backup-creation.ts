import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SignJWT } from 'jose';

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

async function inspectBackupPackage(backupId: string, cookie: string, expectedType: string, expectedScope: string) {
  // Download backup package via API
  const res = await fetch(`${BASE_URL}/api/backup/${backupId}`, {
    headers: { 'Cookie': cookie },
  });

  if (!res.ok) {
    throw new Error(`Failed to download backup ${backupId}: ${res.status}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  const zip = await JSZip.loadAsync(buf);
  const fileNames = Object.keys(zip.files).sort();

  const hasManifest = fileNames.includes('manifest.json');
  if (!hasManifest) throw new Error('Missing manifest.json');

  const manifestStr = await zip.file('manifest.json')!.async('text');
  const manifest = JSON.parse(manifestStr);

  // Check lack of PDF / Excel in backup packages
  const hasPdfOrExcel = fileNames.some(f => f.endsWith('.pdf') || f.endsWith('.xlsx'));

  // Inspect all data/*.json files for credentials / recovery_tokens / password hashes
  const dataFiles = fileNames.filter(f => f.startsWith('data/') && f.endsWith('.json'));
  let foundSecrets = false;
  let foundTokens = false;
  const datasetsIncluded: Record<string, number> = {};

  for (const df of dataFiles) {
    const text = await zip.file(df)!.async('text');
    const records = JSON.parse(text);
    const tableName = df.replace('data/', '').replace('.json', '');
    datasetsIncluded[tableName] = Array.isArray(records) ? records.length : 0;

    if (text.includes('password_hash') || text.includes('$2a$') || text.includes('$2b$')) {
      foundSecrets = true;
    }
    if (tableName === 'recovery_tokens' || text.includes('recovery_token')) {
      foundTokens = true;
    }
  }

  return {
    backupId,
    httpStatus: res.status,
    bytes: buf.length,
    sha256,
    expectedType,
    manifestType: manifest.packageType || manifest.backupType,
    manifestScope: manifest.scope?.type || manifest.scope,
    fileCount: fileNames.length,
    fileNames,
    hasPdfOrExcel,
    foundSecrets,
    foundTokens,
    datasetsIncluded,
    manifestChecksum: manifest.packageChecksum || manifest.checksum,
  };
}

async function main() {
  const cookie = await getAdminCookie();
  const headers = {
    'Cookie': cookie,
    'Content-Type': 'application/json',
  };

  console.log('=== BACKUP CREATION SMOKE TESTS ===');

  // Test A: Master System Backup
  console.log('\n--- Test A: Master System Backup ---');
  const resA = await fetch(`${BASE_URL}/api/backup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      scope: 'SYSTEM',
      reason: 'CTO Forensic Verification - Master System Backup',
    }),
  });

  const dataA = await resA.json();
  console.log('Creation Response A:', dataA);

  const inspectionA = await inspectBackupPackage(dataA.backup.backupId, cookie, 'SYSTEM_BACKUP', 'SYSTEM');
  console.log('Inspection A:', JSON.stringify(inspectionA, null, 2));

  // Test B: Site Backup for site-1
  console.log('\n--- Test B: Site Backup (site-1) ---');
  const resB = await fetch(`${BASE_URL}/api/backup`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      scope: 'SITE',
      siteId: 'site-1',
      reason: 'CTO Forensic Verification - Site Backup',
    }),
  });

  const dataB = await resB.json();
  console.log('Creation Response B:', dataB);

  const inspectionB = await inspectBackupPackage(dataB.backup.backupId, cookie, 'SITE_BACKUP', 'SITE');
  console.log('Inspection B:', JSON.stringify(inspectionB, null, 2));

  // Check Audit Trail for Backup Events
  console.log('\n--- Checking Audit Trail for Backup Events ---');
  const auditRes = await fetch(`${BASE_URL}/api/audit?pageSize=10`, {
    headers: { 'Cookie': cookie },
  });
  const auditData = await auditRes.json();
  const backupAuditLogs = auditData.logs?.filter((l: any) => l.action?.includes('BACKUP') || l.entityType === 'BACKUP');
  console.log('Recent Backup Audit Logs:', backupAuditLogs?.slice(0, 4));
}

main().catch(console.error);
