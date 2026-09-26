import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createEnterpriseBackup } from '../lib/backup/orchestrator';

describe('SUITE 3: SECURITY PACKAGE SCAN (CREDENTIAL & SECRET STRIPPING)', () => {
  const tmpDbPath = path.join(os.tmpdir(), `qa_sec_scan_${Date.now()}_${Math.random().toString(36).substring(7)}.db`);
  const originalEnvDb = process.env.DATABASE_PATH;

  before(() => {
    // Copy prod DB to disposable QA DB
    const prodDbPath = path.join(process.cwd(), 'data', 'site_work.db');
    fs.copyFileSync(prodDbPath, tmpDbPath);
    process.env.DATABASE_PATH = tmpDbPath;
  });

  after(() => {
    process.env.DATABASE_PATH = originalEnvDb;
    try {
      if (fs.existsSync(tmpDbPath)) fs.unlinkSync(tmpDbPath);
    } catch {}
  });

  test('validates zero password hashes, zero recovery tokens, zero env files in generated backup archive', async () => {
    const adminSession = {
      userId: 'usr-admin-1',
      username: 'admin',
      role: 'ADMIN' as const,
      assignedSiteIds: [],
      requiresPasswordReset: false,
    };

    const backupResult = await createEnterpriseBackup(
      { scope: 'SYSTEM', period: 'ALL_DATA' },
      adminSession
    );

    const zip = await JSZip.loadAsync(backupResult.zipBuffer);
    const files = Object.keys(zip.files);

    // 1. Assert zero .env or secrets files
    for (const file of files) {
      assert.strictEqual(file.includes('.env'), false, `Forbidden env file found: ${file}`);
      assert.strictEqual(file.includes('session'), false, `Forbidden session file found: ${file}`);
      assert.strictEqual(file.includes('node_modules'), false, `Forbidden node_modules found: ${file}`);
    }

    // 2. Scan users.json for leaked credentials
    const usersFile = zip.file('data/users.json');
    assert.ok(usersFile, 'data/users.json must be present');
    const usersStr = await usersFile.async('text');
    const users = JSON.parse(usersStr);

    assert.ok(users.length > 0);
    for (const u of users) {
      assert.strictEqual(u.password_hash, undefined, `Security failure: password_hash leaked for user ${u.username}`);
      assert.strictEqual(u.recovery_email, undefined, `Security failure: recovery_email leaked for user ${u.username}`);
      assert.strictEqual(u.recovery_token, undefined, `Security failure: recovery_token leaked for user ${u.username}`);
      assert.strictEqual(u.recovery_tokens, undefined, `Security failure: recovery_tokens leaked for user ${u.username}`);
    }

    // 3. If standalone SQLite db is in zip, verify recovery_tokens table is purged
    const dbFile = zip.file('data/site_work.db');
    if (dbFile) {
      const dbBuf = await dbFile.async('nodebuffer');
      const testDbTmp = path.join(os.tmpdir(), `test_db_extracted_${Date.now()}.db`);
      try {
        fs.writeFileSync(testDbTmp, dbBuf);
        const extractedDb = new DatabaseSync(testDbTmp, { readOnly: true } as any);
        const tokenCount = (extractedDb.prepare('SELECT COUNT(*) as c FROM recovery_tokens').get() as any).c;
        assert.strictEqual(tokenCount, 0, 'Security failure: recovery_tokens table was not purged in SQLite snapshot');
        extractedDb.close();
      } finally {
        if (fs.existsSync(testDbTmp)) fs.unlinkSync(testDbTmp);
      }
    }
  });
});
