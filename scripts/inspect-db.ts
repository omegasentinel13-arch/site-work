import { getDb } from '../lib/db';

const db = getDb();
console.log('=== USERS ===');
const users = db.prepare('SELECT id, username, full_name, role, authority_tier, is_active, recovery_email FROM users').all();
console.log(JSON.stringify(users, null, 2));

console.log('=== PERMISSION DEFINITIONS FOR ACCESS REVIEW ===');
const defs = db.prepare("SELECT * FROM permission_definitions WHERE action_id = 'ACCESS_REQUEST_REVIEW' OR id LIKE '%access%'").all();
console.log(JSON.stringify(defs, null, 2));

console.log('=== USER PERMISSION OVERRIDES ===');
const overrides = db.prepare('SELECT * FROM user_permission_overrides').all();
console.log(JSON.stringify(overrides, null, 2));

console.log('=== ROLE PERMISSIONS ===');
const rolePerms = db.prepare("SELECT rp.*, pd.action_id, pd.display_name FROM role_permissions rp JOIN permission_definitions pd ON pd.id = rp.permission_id WHERE pd.action_id = 'ACCESS_REQUEST_REVIEW' OR pd.id LIKE '%access%'").all();
console.log(JSON.stringify(rolePerms, null, 2));

console.log('=== RECENT NOTIFICATIONS ===');
const notifs = db.prepare('SELECT * FROM access_request_notifications ORDER BY created_at DESC LIMIT 10').all();
console.log(JSON.stringify(notifs, null, 2));
