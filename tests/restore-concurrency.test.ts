import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RestoreCoordinator, DatabaseLockedError } from '../lib/backup/coordinator';

describe('Task 2: Global Restore Concurrency & Lock Coordination', () => {
  test('Initial state is IDLE and not locked', () => {
    assert.equal(RestoreCoordinator.isLocked(), false);
    assert.equal(RestoreCoordinator.getLockState(), 'IDLE');
    assert.doesNotThrow(() => RestoreCoordinator.assertNotLocked());
  });

  test('Shared read lock allows concurrent backup operations', async () => {
    const release1 = await RestoreCoordinator.acquireSharedReadLock();
    assert.equal(RestoreCoordinator.getLockState(), 'BACKUP_ACTIVE');
    assert.equal(RestoreCoordinator.isLocked(), false); // read lock is not locked for queries

    const release2 = await RestoreCoordinator.acquireSharedReadLock();
    assert.equal(RestoreCoordinator.getLockState(), 'BACKUP_ACTIVE');

    release1();
    assert.equal(RestoreCoordinator.getLockState(), 'BACKUP_ACTIVE');

    release2();
    assert.equal(RestoreCoordinator.getLockState(), 'IDLE');
  });

  test('Exclusive restore lock transitions state to RESTORE_LOCKED', async () => {
    const releaseRestore = await RestoreCoordinator.acquireExclusiveRestoreLock('op-test-123');

    assert.equal(RestoreCoordinator.isLocked(), true);
    assert.equal(RestoreCoordinator.getLockState(), 'RESTORE_LOCKED');
    assert.equal(RestoreCoordinator.getActiveOperationId(), 'op-test-123');

    // assertNotLocked must throw DatabaseLockedError
    assert.throws(
      () => RestoreCoordinator.assertNotLocked(),
      DatabaseLockedError
    );

    // Attempting another exclusive lock while locked must throw
    await assert.rejects(
      async () => {
        await RestoreCoordinator.acquireExclusiveRestoreLock('op-test-456', 100);
      },
      { message: /A database restore operation is already in progress/ }
    );

    releaseRestore();

    assert.equal(RestoreCoordinator.isLocked(), false);
    assert.equal(RestoreCoordinator.getLockState(), 'IDLE');
    assert.equal(RestoreCoordinator.getActiveOperationId(), null);
    assert.doesNotThrow(() => RestoreCoordinator.assertNotLocked());
  });

  test('Emergency Recovery Mode activates and blocks operations until cleared', () => {
    RestoreCoordinator.setRecoveryMode(true);
    assert.equal(RestoreCoordinator.isLocked(), true);
    assert.equal(RestoreCoordinator.isRecoveryMode(), true);
    assert.equal(RestoreCoordinator.getLockState(), 'RECOVERY_MODE');

    assert.throws(
      () => RestoreCoordinator.assertNotLocked(),
      DatabaseLockedError
    );

    // Clear recovery mode
    RestoreCoordinator.setRecoveryMode(false);
    assert.equal(RestoreCoordinator.isLocked(), false);
    assert.equal(RestoreCoordinator.isRecoveryMode(), false);
    assert.equal(RestoreCoordinator.getLockState(), 'IDLE');
  });
});
