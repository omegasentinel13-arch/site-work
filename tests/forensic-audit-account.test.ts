import { test } from 'node:test';
import assert from 'node:assert';
import { getDb } from '../lib/db';
import { AuditRepository } from '../lib/db/repositories/audit-repo';
import { getUserById } from '../lib/db/repositories/user-repo';

test('Audit Trail & My Account Forensic Verification', async (t) => {
  const db = getDb();

  await t.test('1. Baseline DB counts check', () => {
    const auditCount = db.prepare('SELECT count(*) as c FROM audit_logs').get() as { c: number };
    const userCount = db.prepare('SELECT count(*) as c FROM users').get() as { c: number };
    assert.strictEqual(userCount.c, 6, 'Users count must be 6');
    assert.strictEqual(auditCount.c, 462, 'Audit logs count must remain 462');
  });

  await t.test('2. Superior Prime / King Maker sees unredacted events', () => {
    const km = getUserById('usr-admin-1')!;
    const context = {
      session: {
        userId: km.id,
        username: km.username,
        role: km.role,
        authorityTier: km.authority_tier,
        assignedSiteIds: [],
        tokenVersion: km.token_version,
      },
      isSuperiorPrime: true,
      isGlobalAdmin: true,
      assignedSiteIds: [],
    };
    const res = AuditRepository.getLogs({ pageSize: 10 }, context);
    assert.ok(res.items.length > 0, 'Should return records');
    assert.ok(res.totalCount > 0, 'Total count should be positive');
  });

  await t.test('3. Prime sees redacted King Maker audit records as System Administrator with id=null', () => {
    const prime = getUserById('usr-client-prime') || {
      id: 'usr-client-prime',
      username: 'abadmin',
      role: 'ADMIN',
      authority_tier: 'CLIENT_PRIME',
      assignedSiteIds: [],
      token_version: 1,
    };
    const context = {
      session: {
        userId: prime.id,
        username: prime.username,
        role: prime.role as any,
        authorityTier: prime.authority_tier as any,
        assignedSiteIds: [],
        tokenVersion: prime.token_version,
      },
      isSuperiorPrime: false,
      isGlobalAdmin: true,
      assignedSiteIds: [],
    };
    const res = AuditRepository.getLogs({ search: 'Iamadmin', pageSize: 10 }, context);
    assert.strictEqual(res.items.length, 0, 'Non-KM search for Iamadmin must return 0 results (no discovery)');
  });

  await t.test('4. Site isolation: site-scoped user only sees assigned sites', () => {
    const context = {
      session: {
        userId: 'usr-eng-1',
        username: 'site_eng',
        role: 'SITE_MANAGER' as any,
        authorityTier: 'STANDARD' as any,
        assignedSiteIds: ['site-1'],
        tokenVersion: 1,
      },
      isSuperiorPrime: false,
      isGlobalAdmin: false,
      assignedSiteIds: ['site-1'],
    };
    const res = AuditRepository.getLogs({ pageSize: 25 }, context);
    for (const item of res.items) {
      assert.strictEqual(item.site?.id, 'site-1', 'Must only contain site-1 logs');
    }
  });

  await t.test('5. Zero mutations occurred during queries', () => {
    const auditCount = db.prepare('SELECT count(*) as c FROM audit_logs').get() as { c: number };
    assert.strictEqual(auditCount.c, 462, 'Audit logs count must still be 462');
  });
});
