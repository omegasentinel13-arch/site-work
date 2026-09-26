import { getDb } from '../lib/db';

const db = getDb();
const reqs = db.prepare('SELECT id, requester_full_name, requested_username, requested_email, status, created_at FROM access_requests ORDER BY created_at DESC').all();
console.log(JSON.stringify(reqs, null, 2));
