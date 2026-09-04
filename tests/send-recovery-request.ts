import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const BASE_URL = 'http://localhost:3000';

async function main() {
  console.log('Sending recovery request for username: Iamadmin...');
  
  const res = await fetch(`${BASE_URL}/api/auth/recovery/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Iamadmin' }),
  });

  const data = await res.json();
  console.log('HTTP Status:', res.status);
  console.log('API Response success:', Boolean(data.success));

  // Inspect the audit log in SQLite to confirm delivery status safely
  const dbPath = path.join(process.cwd(), 'data', 'site_work.db');
  const db = new DatabaseSync(dbPath);

  const latestAudit = db.prepare(`
    SELECT action, after_state, created_at 
    FROM audit_logs 
    WHERE action = 'RECOVERY_REQUEST' 
    ORDER BY created_at DESC 
    LIMIT 1
  `).get() as { action: string; after_state: string; created_at: string } | undefined;

  let deliveryStatus = 'UNKNOWN';
  if (latestAudit && latestAudit.after_state) {
    try {
      const parsed = JSON.parse(latestAudit.after_state);
      deliveryStatus = parsed.deliveryStatus || 'UNKNOWN';
    } catch {}
  }

  console.log('SMTP Dispatch Status:', deliveryStatus);

  // Check database integrity
  const usersCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const sitesCount = (db.prepare('SELECT COUNT(*) as c FROM sites').get() as { c: number }).c;
  const siteUsersCount = (db.prepare('SELECT COUNT(*) as c FROM site_users').get() as { c: number }).c;

  console.log('Database users:', usersCount);
  console.log('Database sites:', sitesCount);
  console.log('Database site_users:', siteUsersCount);

  db.close();
}

main().catch(err => {
  console.error('Execution error:', err.message);
});
