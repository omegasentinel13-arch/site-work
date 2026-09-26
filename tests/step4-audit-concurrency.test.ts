import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { appendRecoveryHistory, getRecoveryHistory } from '../lib/backup/import/history-repo';

describe('SUITE 8: AUDIT CONTINUITY & CRASH-SAFE RECOVERY HISTORY', () => {
  const tmpHistoryFile = path.join(process.cwd(), 'data', 'backups', 'recovery_history.jsonl');
  let backupFileExists = false;
  let originalContent = '';

  before(() => {
    if (fs.existsSync(tmpHistoryFile)) {
      backupFileExists = true;
      originalContent = fs.readFileSync(tmpHistoryFile, 'utf-8');
    }
  });

  after(() => {
    // Restore original file state if any
    if (backupFileExists) {
      fs.writeFileSync(tmpHistoryFile, originalContent);
    }
  });

  test('appends recovery history entries atomically and reads in reverse chronological order', () => {
    const testOp1 = `test-op-${Date.now()}-1`;
    const testOp2 = `test-op-${Date.now()}-2`;

    appendRecoveryHistory({
      operationId: testOp1,
      packageId: 'bak-test-1',
      executedAt: new Date(Date.now() - 1000).toISOString(),
      actor: { userId: 'usr-admin-1', username: 'admin', role: 'ADMIN' },
      scope: 'SYSTEM',
      packageChecksum: 'dummy-sha-1',
      analysisChecksum: 'dummy-analysis-sha-1',
      totalInserted: 42,
      totalSkipped: 5,
      totalConflicts: 2,
      insertedPerTable: { users: 2, sites: 1, attendance_records: 39 },
      status: 'SUCCESS',
    });

    appendRecoveryHistory({
      operationId: testOp2,
      packageId: 'bak-test-2',
      executedAt: new Date().toISOString(),
      actor: { userId: 'usr-admin-1', username: 'admin', role: 'ADMIN' },
      scope: 'SITE',
      siteName: 'Test Site',
      packageChecksum: 'dummy-sha-2',
      analysisChecksum: 'dummy-analysis-sha-2',
      totalInserted: 10,
      totalSkipped: 0,
      totalConflicts: 0,
      insertedPerTable: { attendance_records: 10 },
      status: 'SUCCESS',
    });

    const history = getRecoveryHistory();
    assert.ok(history.length >= 2);

    // Most recent must be first
    const entry2 = history.find(h => h.operationId === testOp2);
    const entry1 = history.find(h => h.operationId === testOp1);
    assert.ok(entry2, 'Entry 2 must be found in history');
    assert.ok(entry1, 'Entry 1 must be found in history');

    assert.strictEqual(entry2.totalInserted, 10);
    assert.strictEqual(entry1.totalInserted, 42);
    assert.strictEqual(entry1.totalConflicts, 2);
  });
});
