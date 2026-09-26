import { getDb } from '../lib/db';

const db = getDb();
console.log('=== ALL ACCESS REQUESTS ===');
const reqs = db.prepare("SELECT id, requester_full_name, requested_username, requested_email, status, created_at FROM access_requests WHERE id NOT LIKE 'AR-TEST%' ORDER BY created_at DESC LIMIT 3").all();
console.log(JSON.stringify(reqs, null, 2));

console.log('=== NOTIFICATIONS FOR TOP 3 NON-TEST REQUESTS ===');
const reqIds = reqs.map((r: any) => r.id);
if (reqIds.length > 0) {
  const placeholders = reqIds.map(() => '?').join(',');
  const notifs = db.prepare(`SELECT * FROM access_request_notifications WHERE access_request_id IN (${placeholders}) ORDER BY created_at DESC`).all(...reqIds);
  console.log(JSON.stringify(notifs, null, 2));
}
