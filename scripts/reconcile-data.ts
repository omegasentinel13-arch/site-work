import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const liveDbPath = path.resolve('data/site_work.db');
const snapshotPath = path.resolve('data/backups/railway_deployment_transfer_snapshot_2026-09-22T15-33-42-478Z.db');

const liveDb = new DatabaseSync(liveDbPath, { readOnly: true } as any);
const snapDb = new DatabaseSync(snapshotPath, { readOnly: true } as any);

console.log('=== 1. ATTENDANCE RECORDS FORENSICS ===');
const liveAtt = liveDb.prepare(`
  SELECT ar.id, ar.site_id, s.name as site_name, ar.date, ar.role_id, wr.name as role_name,
         ar.full_day_count, ar.half_day_count, ar.total_workers, ar.worker_days, ar.total_cost_paise,
         ar.created_by, u.username as creator_username, ar.created_at, ar.updated_at
  FROM attendance_records ar
  LEFT JOIN sites s ON ar.site_id = s.id
  LEFT JOIN work_roles wr ON ar.role_id = wr.id
  LEFT JOIN users u ON ar.created_by = u.id
  ORDER BY ar.created_at ASC, ar.id ASC
`).all();
console.log('Live DB Attendance Count:', liveAtt.length);
console.log(JSON.stringify(liveAtt, null, 2));

console.log('=== 2. AUDIT LOGS FORENSICS ===');
const liveAudits = liveDb.prepare(`
  SELECT a.id, a.action, a.entity_type, a.entity_id, a.site_id, s.name as site_name,
         a.user_id, u.username as actor_username, a.created_at, a.before_state, a.after_state
  FROM audit_logs a
  LEFT JOIN sites s ON a.site_id = s.id
  LEFT JOIN users u ON a.user_id = u.id
  ORDER BY a.created_at DESC, a.id DESC
  LIMIT 25
`).all();
console.log('Last 25 Audit Logs:');
console.log(JSON.stringify(liveAudits, null, 2));

console.log('=== 3. TABLE COUNTS COMPARISON ===');
const tables = [
  'users',
  'sites',
  'site_users',
  'work_categories',
  'work_roles',
  'site_role_rates',
  'attendance_records',
  'financial_transactions',
  'investors',
  'supply_items',
  'system_lifecycle_records',
  'permission_definitions',
  'role_permissions',
  'user_permission_overrides',
  'audit_logs',
  'recovery_tokens'
];

const comparison: Record<string, { live: number; snapshot: number; match: boolean }> = {};
for (const t of tables) {
  let liveC = -1;
  let snapC = -1;
  try {
    liveC = (liveDb.prepare(`SELECT count(*) as c FROM ${t}`).get() as any).c;
  } catch {}
  try {
    snapC = (snapDb.prepare(`SELECT count(*) as c FROM ${t}`).get() as any).c;
  } catch {}
  comparison[t] = { live: liveC, snapshot: snapC, match: liveC === snapC };
}
console.log('Comparison Table:');
console.table(comparison);

console.log('=== 4. KING MAKER & AUTH PRESERVATION ===');
const liveKm = liveDb.prepare("SELECT id, username, authority_tier, is_active, password_hash, recovery_email FROM users WHERE authority_tier = 'KING_MAKER'").all() as any[];
const snapKm = snapDb.prepare("SELECT id, username, authority_tier, is_active, password_hash, recovery_email FROM users WHERE authority_tier = 'KING_MAKER'").all() as any[];

console.log('Live KM count:', liveKm.length);
console.log('Snap KM count:', snapKm.length);
if (liveKm[0] && snapKm[0]) {
  console.log('KM ID match:', liveKm[0].id === snapKm[0].id, liveKm[0].id);
  console.log('KM username match:', liveKm[0].username === snapKm[0].username, liveKm[0].username);
  console.log('KM authority match:', liveKm[0].authority_tier === snapKm[0].authority_tier, liveKm[0].authority_tier);
  console.log('KM active match:', liveKm[0].is_active === snapKm[0].is_active, liveKm[0].is_active);
  console.log('KM hash match:', liveKm[0].password_hash === snapKm[0].password_hash);
  console.log('KM email match:', liveKm[0].recovery_email === snapKm[0].recovery_email, liveKm[0].recovery_email);
}

// Compare all users' hashes
const liveUsers = liveDb.prepare("SELECT id, username, password_hash, recovery_email FROM users ORDER BY id").all() as any[];
const snapUsers = snapDb.prepare("SELECT id, username, password_hash, recovery_email FROM users ORDER BY id").all() as any[];
let allHashesMatch = true;
for (let i = 0; i < liveUsers.length; i++) {
  const lu = liveUsers[i];
  const su = snapUsers[i];
  if (!su || lu.id !== su.id || lu.password_hash !== su.password_hash) {
    allHashesMatch = false;
    console.log('User hash mismatch for:', lu?.id, lu?.username);
  }
}
console.log('All Users password_hash match:', allHashesMatch);

console.log('=== 5. INTEGRITY CHECKS ===');
console.log('Snap integrity:', snapDb.prepare('PRAGMA integrity_check').all());
console.log('Snap FK:', snapDb.prepare('PRAGMA foreign_key_check').all().length);

liveDb.close();
snapDb.close();
