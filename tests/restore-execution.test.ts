import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { executeControlledRestore } from '../lib/restore/restore-executor';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';
import { UserSession } from '../lib/auth/session';
import { closeDb } from '../lib/db';

describe('Task 2: Controlled Restore Execution & Rollback Engine', () => {
  const adminSession: UserSession = {
    userId: 'usr-admin-1',
    username: 'Iamadmin',
    role: 'ADMIN',
    assignedSiteIds: [],
    requiresPasswordReset: false,
  };

  const originalDbPath = process.env.DATABASE_PATH;
  const testDir = path.join(process.cwd(), 'data', 'backups', 'test_scratch_restore');
  const testDbPath = path.join(testDir, 'site_work.db');

  before(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  after(() => {
    closeDb();
    process.env.DATABASE_PATH = originalDbPath;
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {}
  });

  test('REJECT: Missing or invalid confirmation phrase throws error', async () => {
    const backup = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    await assert.rejects(
      async () => {
        await executeControlledRestore(backup.zipBuffer, 'CONFIRM', adminSession);
      },
      {
        message: /Invalid confirmation: You must enter "RESTORE CONFIRM"/,
      }
    );
  });

  test('REJECT: Non-admin cannot initiate database restoration', async () => {
    const backup = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    const engineerSession: UserSession = {
      userId: 'usr-a8c8c116-936c-4c0a-ad26-f23c4922adf0',
      username: 'engineer1',
      role: 'SITE_MANAGER',
      assignedSiteIds: ['site-1'],
      requiresPasswordReset: false,
    };

    await assert.rejects(
      async () => {
        await executeControlledRestore(backup.zipBuffer, 'RESTORE CONFIRM', engineerSession);
      },
      {
        message: /Unauthorized: Only Administrators can initiate database restoration/,
      }
    );
  });

  test('Isolated Restore Execution: Creates pre-restore safety snapshot and verifies counts', async () => {
    // Generate valid backup from active database
    const backup = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA', includePdf: false, includeExcel: false },
      adminSession
    );

    // Switch to isolated test database path
    closeDb();
    const activeDbBuffer = fs.readFileSync(process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db'));
    fs.writeFileSync(testDbPath, activeDbBuffer);
    process.env.DATABASE_PATH = testDbPath;

    const result = await executeControlledRestore(
      backup.zipBuffer,
      'RESTORE CONFIRM',
      adminSession
    );

    assert.equal(result.success, true);
    assert.ok(result.operationId);
    assert.ok(result.preRestoreBackupPath);
    assert.ok(fs.existsSync(result.preRestoreBackupPath), 'Pre-restore safety backup must exist on disk');
    assert.ok(result.recordCounts.users > 0);
    assert.ok(result.recordCounts.sites > 0);

    // Clean up test pre-restore backup
    try {
      if (fs.existsSync(result.preRestoreBackupPath)) {
        fs.unlinkSync(result.preRestoreBackupPath);
      }
    } catch {}

    // Restore original path
    closeDb();
    process.env.DATABASE_PATH = originalDbPath;
  });
});
