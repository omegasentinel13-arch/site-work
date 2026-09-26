import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { appendRecoveryJournal, readRecoveryJournal } from '../lib/backup/journal-sidecar';

describe('Task 2: Audit Continuity & Durable Recovery Journal Sidecar', () => {
  test('Appends and reads recovery journal sidecar events', () => {
    const testOpId = `op-audit-test-${Date.now()}`;

    appendRecoveryJournal({
      operationId: testOpId,
      eventType: 'RESTORE_INITIATED',
      timestamp: new Date().toISOString(),
      operator: {
        userId: 'test-admin',
        username: 'admin',
        role: 'ADMIN',
      },
      sourceBackup: {
        backupId: 'bak-test-1',
        scope: 'SYSTEM',
        sha256: 'abc123sha',
      },
    });

    appendRecoveryJournal({
      operationId: testOpId,
      eventType: 'RESTORE_SUCCESS',
      timestamp: new Date().toISOString(),
      operator: {
        userId: 'test-admin',
        username: 'admin',
        role: 'ADMIN',
      },
      durationMs: 42,
    });

    const entries = readRecoveryJournal();
    assert.ok(entries.length >= 2, 'Journal must contain at least 2 entries');

    const matching = entries.filter((e) => e.operationId === testOpId);
    assert.equal(matching.length, 2);
    assert.equal(matching[0].eventType, 'RESTORE_SUCCESS');
    assert.equal(matching[1].eventType, 'RESTORE_INITIATED');
    assert.equal(matching[0].durationMs, 42);
  });
});
