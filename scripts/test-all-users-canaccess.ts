import { getDb } from '../lib/db';
import { canAccess } from '../lib/permissions/evaluator';

const db = getDb();
const users = db.prepare('SELECT * FROM users WHERE is_active = 1').all() as any[];

console.log('=== CAN_ACCESS EVALUATION FOR ALL ACTIVE USERS ===');
for (const u of users) {
  const decision = canAccess({
    session: {
      userId: u.id,
      role: u.role,
      authorityTier: u.authority_tier,
      isActive: Boolean(u.is_active),
    },
    page: 'PAGE_ACCESS_REQUESTS',
    action: 'ACCESS_REQUEST_REVIEW',
  });

  console.log(`User: ${u.username.padEnd(15)} (${u.id}) Tier: ${u.authority_tier.padEnd(16)} Email: ${u.recovery_email || 'NULL'} -> Allowed: ${decision.allowed} (${decision.ruleSource})`);
}
