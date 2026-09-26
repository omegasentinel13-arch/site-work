import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { listStoredBackups } from '../lib/backup/storage-registry';
import { UserSession } from '../lib/auth/session';

describe('Task 2: Enterprise Backup RBAC Enforcement', () => {
  const adminSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    role: 'ADMIN',
    assignedSiteIds: [],
    requiresPasswordReset: false,
  };

  const siteManagerSession: UserSession = {
    userId: 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0',
    username: 'engineer1',
    role: 'SITE_MANAGER',
    assignedSiteIds: ['site-1'],
    requiresPasswordReset: false,
  };

  const viewerSession: UserSession = {
    userId: 'usr-view-1',
    username: 'viewer1',
    role: 'VIEWER',
    assignedSiteIds: ['site-1'],
    requiresPasswordReset: false,
  };

  test('ADMIN can generate SYSTEM + ALL_DATA backup with restorable SQLite snapshot', async () => {
    const result = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    assert.ok(result.backupId);
    assert.equal(result.manifest.scope, 'SYSTEM');
    assert.equal(result.manifest.restorableAsDatabase, true);
    assert.ok(result.manifest.database?.included);
    assert.ok(result.zipBuffer.length > 0);
  });

  test('SITE_MANAGER is strictly forbidden from creating SYSTEM-wide backup', async () => {
    await assert.rejects(
      async () => {
        await createEnterpriseBackup(
          { scope: 'SYSTEM', period: 'ALL_DATA' },
          siteManagerSession
        );
      },
      {
        message: /Access denied: System-wide backup requires Administrator privileges/,
      }
    );
  });

  test('SITE_MANAGER can generate SITE backup for assigned site (site-1)', async () => {
    const result = await createEnterpriseBackup(
      { scope: 'SITE', siteId: 'site-1', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      siteManagerSession
    );

    assert.ok(result.backupId);
    assert.equal(result.manifest.scope, 'SITE');
    assert.equal(result.manifest.siteId, 'site-1');
    assert.equal(result.manifest.restorableAsDatabase, false);
    assert.equal(result.manifest.database, undefined);
  });

  test('SITE_MANAGER is strictly forbidden from accessing unassigned site (site-2)', async () => {
    await assert.rejects(
      async () => {
        await createEnterpriseBackup(
          { scope: 'SITE', siteId: 'site-2', period: 'ALL_DATA' },
          siteManagerSession
        );
      },
      {
        message: /Access denied: You are not authorized to access site site-2/,
      }
    );
  });

  test('VIEWER is completely forbidden from generating any backup archive', async () => {
    await assert.rejects(
      async () => {
        await createEnterpriseBackup(
          { scope: 'SITE', siteId: 'site-1', period: 'ALL_DATA' },
          viewerSession
        );
      },
      {
        message: /Access denied: Viewers cannot generate backup archives/,
      }
    );
  });

  test('Storage Registry ACL: SITE_MANAGER cannot see SYSTEM backups or unassigned sites', async () => {
    const backups = await listStoredBackups(siteManagerSession);
    for (const b of backups) {
      assert.notEqual(b.manifest.scope, 'SYSTEM', 'SITE_MANAGER must never see SYSTEM backups');
      if (b.manifest.siteId) {
        assert.ok(
          siteManagerSession.assignedSiteIds.includes(b.manifest.siteId),
          `SITE_MANAGER cannot view backup for unassigned site ${b.manifest.siteId}`
        );
      }
    }
  });

  test('Storage Registry ACL: VIEWER receives empty list (zero visibility)', async () => {
    const backups = await listStoredBackups(viewerSession);
    assert.equal(backups.length, 0, 'VIEWER must see zero backups');
  });
});
