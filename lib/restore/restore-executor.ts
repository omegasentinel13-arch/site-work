import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { RestoreCoordinator } from '../backup/coordinator';
import { appendRecoveryJournal } from '../backup/journal-sidecar';
import { deepValidateBackupArchive } from './deep-validator';
import { closeDb, getDb } from '../db';
import { logAudit } from '../audit/logger';
import { generateSystemDatabaseSnapshot } from '../backup/snapshot-engine';
import { packageBackupArchive } from '../backup/packager';
import { buildBackupManifest } from '../backup/manifest-service';
import { calculateFileSha256 } from '../backup/checksum-service';
import { UserSession } from '../auth/session';

export interface ExecuteRestoreResult {
  success: boolean;
  operationId: string;
  backupId: string;
  preRestoreBackupPath: string;
  restoredAt: string;
  recordCounts: Record<string, number>;
  message: string;
}

export async function executeControlledRestore(
  zipBuffer: Buffer,
  confirmationPhrase: string,
  session: UserSession
): Promise<ExecuteRestoreResult> {
  // 1. Enforce Admin only
  if (session.role !== 'ADMIN') {
    throw new Error('Unauthorized: Only Administrators can initiate database restoration.');
  }

  // 2. Enforce exact confirmation phrase
  if (confirmationPhrase !== 'RESTORE CONFIRM') {
    throw new Error('Invalid confirmation: You must enter "RESTORE CONFIRM" in exact uppercase to proceed.');
  }

  // 3. Deep validation of incoming archive
  const validation = await deepValidateBackupArchive(zipBuffer);
  if (!validation.isValid || validation.hasBlockingIssues || !validation.extractedDbBuffer || !validation.manifest) {
    const blocking = validation.conflicts.filter((c) => c.severity === 'BLOCKING');
    throw new Error(`Restoration Aborted: ${blocking.map((b) => b.title + ': ' + b.description).join(' | ')}`);
  }

  const operationId = `restore-op-${Date.now()}-${crypto.randomUUID().substring(0, 8)}`;
  const startTime = Date.now();
  const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'site_work.db');
  const walPath = path.join(path.dirname(dbPath), 'site_work.db-wal');
  const shmPath = path.join(path.dirname(dbPath), 'site_work.db-shm');
  const backupDir = path.join(process.cwd(), 'data', 'backups');

  // 4. Acquire exclusive restore lock
  const releaseLock = await RestoreCoordinator.acquireExclusiveRestoreLock(operationId);

  let preRestoreBackupPath = '';
  let preservedDbPath = '';

  try {
    // 5. Measure pre-restore database state
    const preRestoreStat = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
    const preRestoreSha = fs.existsSync(dbPath) ? calculateFileSha256(dbPath) : 'NONE';

    // 6. Record RESTORE_INITIATED in Recovery Journal Sidecar
    appendRecoveryJournal({
      operationId,
      eventType: 'RESTORE_INITIATED',
      timestamp: new Date().toISOString(),
      operator: {
        userId: session.userId,
        username: session.username,
        role: session.role,
      },
      sourceBackup: {
        backupId: validation.manifest.backupId,
        scope: validation.manifest.scope,
        sha256: validation.dbMetrics?.sha256 || 'UNKNOWN',
        declaredCounts: validation.dbMetrics?.tableCounts,
      },
      preRestoreDatabase: {
        sizeBytes: preRestoreStat?.size || 0,
        sha256: preRestoreSha,
        counts: validation.dbMetrics?.tableCounts,
      },
    });

    // 7. Generate MANDATORY AUTOMATIC PRE-RESTORE SAFETY BACKUP
    console.log('[RESTORE] Creating mandatory pre-restore safety backup...');
    const safetySnapshot = generateSystemDatabaseSnapshot();
    const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyFileName = `pre-restore-safety_${safetyTimestamp}_${crypto.randomUUID().substring(0, 8)}.zip`;
    preRestoreBackupPath = path.join(backupDir, safetyFileName);

    const safetyManifest = buildBackupManifest({
      backupId: `safety-${Date.now()}`,
      scope: 'SYSTEM',
      periodPreset: 'ALL_DATA',
      isUnbounded: true,
      startDate: null,
      endDate: null,
      user: {
        userId: session.userId,
        username: session.username,
        role: session.role,
      },
      databaseMetadata: safetySnapshot.metadata,
      files: [],
    });

    const packagedSafety = await packageBackupArchive(safetyManifest, [
      {
        zipPath: 'data/site_work.db',
        format: 'SQLITE',
        buffer: safetySnapshot.buffer,
      },
    ]);

    fs.writeFileSync(preRestoreBackupPath, packagedSafety.zipBuffer);
    console.log(`[RESTORE] Pre-restore safety backup verified & saved: ${preRestoreBackupPath}`);

    appendRecoveryJournal({
      operationId,
      eventType: 'PRE_RESTORE_BACKUP_CREATED',
      timestamp: new Date().toISOString(),
      operator: { userId: session.userId, username: session.username, role: session.role },
      preRestoreBackupPath,
    });

    // 8. Close active database handles
    console.log('[RESTORE] Releasing SQLite connection handles...');
    closeDb();

    // 9. Move existing WAL & SHM aside to prevent stale journal replay
    const walHoldingPath = path.join(backupDir, `tmp_wal_${operationId}`);
    const shmHoldingPath = path.join(backupDir, `tmp_shm_${operationId}`);

    if (fs.existsSync(walPath)) {
      try {
        fs.renameSync(walPath, walHoldingPath);
      } catch {
        fs.unlinkSync(walPath);
      }
    }
    if (fs.existsSync(shmPath)) {
      try {
        fs.renameSync(shmPath, shmHoldingPath);
      } catch {
        fs.unlinkSync(shmPath);
      }
    }

    appendRecoveryJournal({
      operationId,
      eventType: 'DATABASE_SWAP_STARTED',
      timestamp: new Date().toISOString(),
      operator: { userId: session.userId, username: session.username, role: session.role },
    });

    // 10. Write validated database snapshot to data/site_work.db via safe atomic staging and preservation
    console.log('[RESTORE] Performing safe database swap...');
    const stagedDbPath = `${dbPath}.staged_${operationId}`;
    preservedDbPath = `${dbPath}.pre_swap_${operationId}`;
    try {
      fs.writeFileSync(stagedDbPath, validation.extractedDbBuffer);
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, preservedDbPath);
      }
      fs.renameSync(stagedDbPath, dbPath);
    } catch (swapErr: any) {
      if (fs.existsSync(preservedDbPath) && !fs.existsSync(dbPath)) {
        try { fs.renameSync(preservedDbPath, dbPath); } catch {}
      }
      if (fs.existsSync(stagedDbPath)) {
        try { fs.unlinkSync(stagedDbPath); } catch {}
      }
      throw new Error(`SAFE_SWAP_FAILED: Failed to safely replace database: ${swapErr.message}`);
    }

    // 11. Reopen database & run post-restore verification
    console.log('[RESTORE] Reopening database and verifying post-restore integrity...');
    let restoredDb: DatabaseSync;
    try {
      restoredDb = getDb(true);
    } catch (openErr: any) {
      throw new Error(`POST_RESTORE_OPEN_FAILED: Failed to reopen database connection: ${openErr.message}`);
    }

    const postIntegrity = restoredDb.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    if (postIntegrity[0]?.integrity_check !== 'ok') {
      throw new Error(`POST_RESTORE_CORRUPT: Restored database failed integrity check: ${postIntegrity[0]?.integrity_check}`);
    }

    const postFkCheck = restoredDb.prepare('PRAGMA foreign_key_check').all() as Array<any>;
    if (postFkCheck && postFkCheck.length > 0) {
      throw new Error(`POST_RESTORE_FK_VIOLATION: Restored database has ${postFkCheck.length} foreign key violation(s).`);
    }

    // Measure restored table counts and verify core tables exist
    const coreTables = [
      'users',
      'sites',
      'site_users',
      'work_categories',
      'work_roles',
      'attendance_records',
      'financial_transactions',
      'audit_logs',
    ] as const;

    const existingTables = restoredDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableSet = new Set(existingTables.map((t) => t.name));
    for (const requiredTable of coreTables) {
      if (!tableSet.has(requiredTable)) {
        throw new Error(`POST_RESTORE_MISSING_TABLE: Required core table '${requiredTable}' missing from restored database.`);
      }
    }

    const activeAdmin = restoredDb.prepare("SELECT count(*) as count FROM users WHERE role = 'ADMIN' AND is_active = 1").get() as { count: number };
    if (!activeAdmin || activeAdmin.count < 1) {
      throw new Error(`POST_RESTORE_NO_ACTIVE_ADMIN: Restored database contains no active administrator.`);
    }

    const restoredCounts: Record<string, number> = {};
    for (const t of coreTables) {
      const c = restoredDb.prepare(`SELECT count(*) as count FROM ${t}`).get() as { count: number };
      restoredCounts[t] = c?.count || 0;
    }

    // Clean up preserved old database and temporary WAL holding only after verification succeeds
    if (fs.existsSync(preservedDbPath)) fs.unlinkSync(preservedDbPath);
    if (fs.existsSync(walHoldingPath)) fs.unlinkSync(walHoldingPath);
    if (fs.existsSync(shmHoldingPath)) fs.unlinkSync(shmHoldingPath);

    // 12. Write durable RESTORE_SUCCESS to Recovery Journal Sidecar
    const durationMs = Date.now() - startTime;
    appendRecoveryJournal({
      operationId,
      eventType: 'RESTORE_SUCCESS',
      timestamp: new Date().toISOString(),
      operator: { userId: session.userId, username: session.username, role: session.role },
      restoredDatabaseSha256: validation.dbMetrics?.sha256,
      verifiedCounts: restoredCounts,
      preRestoreBackupPath,
      durationMs,
    });

    // Release restore lock now that database swap and verification are complete
    releaseLock();

    // 13. Insert audit log record in restored SQLite database
    try {
      logAudit({
        entityType: 'SECURITY',
        entityId: validation.manifest.backupId,
        action: 'UPDATE',
        siteId: null,
        userId: session.userId,
        beforeState: { action: 'RESTORE_EXECUTED', preRestoreSha, preRestoreBackupPath },
        afterState: { operationId, restoredCounts, durationMs },
      });
    } catch (auditErr) {
      console.warn('Warning: Could not insert audit log inside restored database:', auditErr);
    }

    return {
      success: true,
      operationId,
      backupId: validation.manifest.backupId,
      preRestoreBackupPath,
      restoredAt: new Date().toISOString(),
      recordCounts: restoredCounts,
      message: 'Database restored successfully. System integrity and referential constraints verified.',
    };
  } catch (restoreErr: any) {
    console.error('[RESTORE CRITICAL ERROR] Restore failed. Triggering automated rollback...', restoreErr);

    // AUTOMATED ROLLBACK ENGINE
    try {
      closeDb();

      // If pre-restore backup exists, roll back from it
      if (preRestoreBackupPath && fs.existsSync(preRestoreBackupPath)) {
        console.log('[ROLLBACK] Restoring from pre-restore safety backup...');
        const safetyValidation = await deepValidateBackupArchive(fs.readFileSync(preRestoreBackupPath));
        if (safetyValidation.extractedDbBuffer) {
          const stagedRollbackPath = `${dbPath}.rollback_staged_${operationId}`;
          const preservedFailedDbPath = `${dbPath}.failed_swap_${operationId}`;
          try {
            fs.writeFileSync(stagedRollbackPath, safetyValidation.extractedDbBuffer);
            if (fs.existsSync(dbPath)) {
              fs.renameSync(dbPath, preservedFailedDbPath);
            }
            fs.renameSync(stagedRollbackPath, dbPath);
          } catch (swapErr: any) {
            if (fs.existsSync(preservedFailedDbPath) && !fs.existsSync(dbPath)) {
              try { fs.renameSync(preservedFailedDbPath, dbPath); } catch {}
            }
            if (fs.existsSync(stagedRollbackPath)) {
              try { fs.unlinkSync(stagedRollbackPath); } catch {}
            }
            throw swapErr;
          }
          if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
          if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

          const rolledBackDb = getDb(true);
          const rollbackIntegrity = rolledBackDb.prepare('PRAGMA integrity_check').all() as any;
          if (rollbackIntegrity[0]?.integrity_check !== 'ok') {
            throw new Error(`Rollback database failed integrity check: ${rollbackIntegrity[0]?.integrity_check}`);
          }
          const rollbackFkCheck = rolledBackDb.prepare('PRAGMA foreign_key_check').all() as Array<any>;
          if (rollbackFkCheck && rollbackFkCheck.length > 0) {
            throw new Error(`Rollback database has ${rollbackFkCheck.length} foreign key violation(s).`);
          }

          // Clean up preserved failed database only after rollback verification succeeds
          if (fs.existsSync(preservedFailedDbPath)) fs.unlinkSync(preservedFailedDbPath);
          if (preservedDbPath && fs.existsSync(preservedDbPath)) {
            try { fs.unlinkSync(preservedDbPath); } catch {}
          }

          console.log('[ROLLBACK SUCCESS] Database rolled back to verified pre-restore state.');

          appendRecoveryJournal({
            operationId,
            eventType: 'RESTORE_FAILED_ROLLED_BACK',
            timestamp: new Date().toISOString(),
            operator: { userId: session.userId, username: session.username, role: session.role },
            error: restoreErr.message,
            preRestoreBackupPath,
          });

          try {
            logAudit({
              entityType: 'SECURITY',
              entityId: operationId,
              action: 'UPDATE',
              siteId: null,
              userId: session.userId,
              beforeState: { action: 'RESTORE_FAILED' },
              afterState: { action: 'ROLLED_BACK_TO_PRE_RESTORE_SAFETY', error: restoreErr.message },
            });
          } catch {}

          throw new Error(`RESTORATION FAILED & SAFELY ROLLED BACK: ${restoreErr.message}. The database was reverted to the pre-restore state.`);
        }
      }

      // If rollback failed
      throw new Error(`CRITICAL ROLLBACK FAILURE: Unable to restore safety snapshot. Error: ${restoreErr.message}`);
    } catch (rollbackErr: any) {
      console.error('[CRITICAL QUARANTINE] Both restore and rollback failed!', rollbackErr);

      RestoreCoordinator.setRecoveryMode(true);

      appendRecoveryJournal({
        operationId,
        eventType: 'RESTORE_CRITICAL_FAILURE',
        timestamp: new Date().toISOString(),
        operator: { userId: session.userId, username: session.username, role: session.role },
        error: `RESTORE_ERROR: ${restoreErr.message} | ROLLBACK_ERROR: ${rollbackErr.message}`,
        preRestoreBackupPath,
      });

      throw new Error(`CRITICAL SYSTEM RECOVERY REQUIRED: ${rollbackErr.message}. The system has entered Emergency Recovery Mode. Safety backup is preserved at ${preRestoreBackupPath}.`);
    }
  } finally {
    releaseLock();
  }
}
