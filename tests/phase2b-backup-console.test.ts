import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { deepValidateBackupArchive } from '../lib/restore/deep-validator';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { listStoredBackups } from '../lib/backup/storage-registry';
import { RestoreCoordinator } from '../lib/backup/coordinator';
import { UserSession } from '../lib/auth/session';
import { calculateBufferSha256 } from '../lib/backup/checksum-service';
import { PACKAGE_SECURITY_LIMITS } from '../lib/packages/types';

describe('Phase 2B: Backup & Disaster Recovery Operational Console', () => {
  const adminSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    role: 'ADMIN',
    assignedSiteIds: [],
    requiresPasswordReset: false,
  };

  const siteManagerSession: UserSession = {
    userId: 'usr-sm-1',
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

  describe('RBAC Authorization Boundaries', () => {
    test('VIEWER role is blocked from creating backups', async () => {
      await assert.rejects(
        async () => {
          await createEnterpriseBackup(
            { scope: 'SYSTEM', period: 'ALL_DATA' },
            viewerSession
          );
        },
        { message: /Access denied: Viewers cannot generate backup archives/ }
      );
    });

    test('SITE_MANAGER role is blocked from creating SYSTEM-wide backups', async () => {
      await assert.rejects(
        async () => {
          await createEnterpriseBackup(
            { scope: 'SYSTEM', period: 'ALL_DATA' },
            siteManagerSession
          );
        },
        { message: /Access denied: System-wide backup requires Administrator privileges/ }
      );
    });

    test('SITE_MANAGER role is blocked from creating backups for unassigned sites', async () => {
      await assert.rejects(
        async () => {
          await createEnterpriseBackup(
            { scope: 'SITE', siteId: 'site-999-unassigned', period: 'ALL_DATA' },
            siteManagerSession
          );
        },
        { message: /Access denied: You are not authorized to access site site-999-unassigned/ }
      );
    });

    test('Storage listStoredBackups enforces Site Manager isolation and Viewer denial', async () => {
      const viewerBackups = await listStoredBackups(viewerSession);
      assert.deepEqual(viewerBackups, [], 'Viewer must see 0 backups');

      const smBackups = await listStoredBackups(siteManagerSession);
      for (const b of smBackups) {
        assert.notEqual(b.manifest.scope, 'SYSTEM', 'Site Manager must never see SYSTEM backups');
        if (b.manifest.siteId) {
          assert.ok(
            siteManagerSession.assignedSiteIds.includes(b.manifest.siteId),
            'Backup siteId must be in assignedSiteIds'
          );
        }
      }
    });
  });

  describe('Deep Validation & Security Boundaries', () => {
    test('Rejects corrupted ZIP archives with CORRUPT_ZIP_ARCHIVE', async () => {
      const corruptBuffer = Buffer.from('NOT_A_VALID_ZIP_HEADER_DATA');
      const result = await deepValidateBackupArchive(corruptBuffer);
      assert.equal(result.isValid, false);
      assert.equal(result.hasBlockingIssues, true);
      assert.ok(result.conflicts.some((c) => c.code === 'CORRUPT_ZIP_ARCHIVE'));
    });

    test('Rejects archives with path traversal attacks', async () => {
      const zip = new JSZip();
      zip.file('../malicious.txt', 'evil payload');
      zip.file('manifest.json', JSON.stringify({ files: [] }));
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await deepValidateBackupArchive(zipBuffer);
      assert.equal(result.isValid, false);
      assert.ok(result.conflicts.some((c) => c.code === 'SECURITY_VIOLATION_PATH_TRAVERSAL'));
    });

    test('Rejects archives with missing manifest.json', async () => {
      const zip = new JSZip();
      zip.file('data/test.txt', 'hello');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await deepValidateBackupArchive(zipBuffer);
      assert.equal(result.isValid, false);
      assert.ok(result.conflicts.some((c) => c.code === 'MISSING_MANIFEST'));
    });

    test('Rejects archives with malformed manifest.json', async () => {
      const zip = new JSZip();
      zip.file('manifest.json', '{ bad json');
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await deepValidateBackupArchive(zipBuffer);
      assert.equal(result.isValid, false);
      assert.ok(result.conflicts.some((c) => c.code === 'MALFORMED_MANIFEST'));
    });

    test('Rejects archives with checksum mismatches', async () => {
      const zip = new JSZip();
      const content = Buffer.from('actual content');
      zip.file('data/file.txt', content);
      zip.file(
        'manifest.json',
        JSON.stringify({
          scope: 'SYSTEM',
          periodPreset: 'ALL_DATA',
          isUnbounded: true,
          restorableAsDatabase: true,
          files: [
            {
              path: 'data/file.txt',
              format: 'TXT',
              sizeBytes: content.length,
              sha256: '0000000000000000000000000000000000000000000000000000000000000000',
            },
          ],
        })
      );
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await deepValidateBackupArchive(zipBuffer);
      assert.equal(result.isValid, false);
      assert.ok(result.conflicts.some((c) => c.code === 'CHECKSUM_MISMATCH'));
    });

    test('Rejects site-scoped packages from database restoration', async () => {
      const zip = new JSZip();
      const content = Buffer.from('dummy');
      const sha = calculateBufferSha256(content);
      zip.file('data/site.json', content);
      zip.file(
        'manifest.json',
        JSON.stringify({
          scope: 'SITE',
          siteId: 'site-1',
          periodPreset: 'ALL_DATA',
          isUnbounded: true,
          restorableAsDatabase: false,
          files: [{ path: 'data/site.json', format: 'JSON', sizeBytes: content.length, sha256: sha }],
        })
      );
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await deepValidateBackupArchive(zipBuffer);
      assert.equal(result.isValid, false);
      assert.ok(result.conflicts.some((c) => c.code === 'SITE_SCOPE_RESTORE_BLOCKED'));
      assert.ok(result.conflicts.some((c) => c.code === 'NON_RESTORABLE_FLAG'));
    });

    test('Rejects date-filtered packages from database restoration', async () => {
      const zip = new JSZip();
      const content = Buffer.from('dummy');
      const sha = calculateBufferSha256(content);
      zip.file('data/scoped.json', content);
      zip.file(
        'manifest.json',
        JSON.stringify({
          scope: 'SYSTEM',
          periodPreset: 'THIS_MONTH',
          isUnbounded: false,
          restorableAsDatabase: false,
          files: [{ path: 'data/scoped.json', format: 'JSON', sizeBytes: content.length, sha256: sha }],
        })
      );
      const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

      const result = await deepValidateBackupArchive(zipBuffer);
      assert.equal(result.isValid, false);
      assert.ok(result.conflicts.some((c) => c.code === 'DATE_SCOPED_RESTORE_BLOCKED'));
    });
  });

  describe('Concurrency & RestoreCoordinator Lifecycle', () => {
    test('Coordinator starts unlocked', () => {
      assert.equal(RestoreCoordinator.isLocked(), false);
      assert.equal(RestoreCoordinator.getActiveOperationId(), null);
    });

    test('Acquires and releases shared read locks cleanly', async () => {
      const release1 = await RestoreCoordinator.acquireSharedReadLock();
      const release2 = await RestoreCoordinator.acquireSharedReadLock();

      assert.equal(RestoreCoordinator.getState(), 'BACKUP_ACTIVE');
      assert.equal(RestoreCoordinator.isLocked(), false);

      release1();
      release2();
      assert.equal(RestoreCoordinator.getState(), 'IDLE');
    });

    test('Exclusive write lock prevents concurrent write lock', async () => {
      const releaseExclusive = await RestoreCoordinator.acquireExclusiveRestoreLock('test-operation');
      assert.equal(RestoreCoordinator.isLocked(), true);
      assert.equal(RestoreCoordinator.getActiveOperationId(), 'test-operation');

      await assert.rejects(
        async () => {
          await RestoreCoordinator.acquireExclusiveRestoreLock('second-op');
        },
        { message: /A database restore operation is already in progress/ }
      );

      releaseExclusive();
      assert.equal(RestoreCoordinator.isLocked(), false);
    });
  });
});
