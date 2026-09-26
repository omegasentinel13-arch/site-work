import fs from 'fs';
import path from 'path';

// Parse .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

import { getDb } from '../lib/db';

async function main() {
  const testId = Date.now().toString().slice(-4);
  const body = {
    fullName: `Forensic Trace ${testId}`,
    username: `trace_${testId}`,
    email: `trace_${testId}@sitework.local`,
    password: `Password123!${testId}`,
    confirmPassword: `Password123!${testId}`,
    roleId: 'SITE_MANAGER',
  };

  console.log('1. Submitting Access Request to http://localhost:3000/api/access-requests...');
  const res = await fetch('http://localhost:3000/api/access-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const json = await res.json();
  console.log('2. Response:', res.status, json);

  if (!json.requestId) {
    console.error('Submission failed!');
    return;
  }

  const requestId = json.requestId;
  const db = getDb();

  console.log('\n3. Immediate DB inspection for request:', requestId);
  const immediateNotifs = db.prepare('SELECT * FROM access_request_notifications WHERE access_request_id = ?').all(requestId);
  console.log('Immediate notifications:', JSON.stringify(immediateNotifs, null, 2));

  console.log('\n4. Waiting 6 seconds for async SMTP dispatch to settle...');
  await new Promise((resolve) => setTimeout(resolve, 6000));

  console.log('\n5. Settled DB inspection for request:', requestId);
  const settledNotifs = db.prepare('SELECT * FROM access_request_notifications WHERE access_request_id = ?').all(requestId);
  console.log('Settled notifications:', JSON.stringify(settledNotifs, null, 2));

  const audits = db.prepare('SELECT * FROM audit_logs WHERE entity_id = ?').all(requestId);
  console.log('Audit logs:', JSON.stringify(audits, null, 2));
}

main().catch(console.error);
