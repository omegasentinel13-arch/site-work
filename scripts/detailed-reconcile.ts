import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const liveDbPath = path.resolve('data/site_work.db');
const liveDb = new DatabaseSync(liveDbPath, { readOnly: true } as any);

console.log('=== ALL 29 ATTENDANCE RECORDS ===');
const attRows = liveDb.prepare(`
  SELECT ar.id, ar.site_id, s.name as site_name, ar.date, ar.role_id, wr.name as role_name,
         ar.rate_snapshot_paise, ar.full_day_count, ar.half_day_count, ar.total_workers, ar.worker_days, ar.total_cost_paise,
         ar.created_by, u.username as creator_username, ar.created_at, ar.updated_at
  FROM attendance_records ar
  LEFT JOIN sites s ON ar.site_id = s.id
  LEFT JOIN work_roles wr ON ar.role_id = wr.id
  LEFT JOIN users u ON ar.created_by = u.id
  ORDER BY ar.created_at ASC, ar.id ASC
`).all();

attRows.forEach((r: any, idx: number) => {
  console.log(`[#${idx + 1}] ID: ${r.id} | Date: ${r.date} | Site: ${r.site_name} (${r.site_id}) | Role: ${r.role_name} (${r.role_id}) | Workers: ${r.total_workers} (${r.full_day_count}F + ${r.half_day_count}H) | Cost: ${r.total_cost_paise} | Creator: ${r.creator_username || 'NULL'} (${r.created_by || 'NULL'}) | CreatedAt: ${r.created_at} | UpdatedAt: ${r.updated_at}`);
});

console.log('\n=== AUDIT LOGS FROM 494 TO 507 ===');
// Total audit logs = 507. Fetch all ordered by created_at ASC, id ASC
const allAudits = liveDb.prepare(`
  SELECT a.id, a.action, a.entity_type, a.entity_id, a.site_id, s.name as site_name,
         a.user_id, u.username as actor_username, a.created_at, a.after_state
  FROM audit_logs a
  LEFT JOIN sites s ON a.site_id = s.id
  LEFT JOIN users u ON a.user_id = u.id
  ORDER BY a.created_at ASC, a.id ASC
`).all();

console.log(`Total audits found: ${allAudits.length}`);
// Print items from index 494 to 507 (1-indexed 495 to 507, which is 13 records)
const deltaAudits = allAudits.slice(494);
console.log(`Delta audits count: ${deltaAudits.length}`);
deltaAudits.forEach((a: any, idx: number) => {
  console.log(`[#${495 + idx}] ID: ${a.id} | Action: ${a.action} | EntityType: ${a.entity_type} | EntityID: ${a.entity_id} | Actor: ${a.actor_username || 'SYSTEM'} (${a.user_id}) | Site: ${a.site_name || 'N/A'} (${a.site_id}) | Timestamp: ${a.created_at} | AfterState: ${a.after_state}`);
});

liveDb.close();
