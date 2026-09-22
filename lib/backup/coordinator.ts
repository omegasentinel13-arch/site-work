import fs from 'node:fs';
import path from 'node:path';

export type CoordinatorState = 'IDLE' | 'BACKUP_ACTIVE' | 'RESTORE_LOCKED' | 'RECOVERY_MODE';

export class DatabaseLockedError extends Error {
  constructor(message = 'Database is currently locked for maintenance/restoration. Please retry shortly.') {
    super(message);
    this.name = 'DatabaseLockedError';
  }
}

class RestoreCoordinatorImpl {
  private state: CoordinatorState = 'IDLE';
  private activeBackupCount = 0;
  private currentOperationId: string | null = null;
  private lockAcquiredAt: number | null = null;
  private markerFilePath: string;
  private activeBackupFlights = new Set<string>();

  public acquireBackupFlightLock(key: string): boolean {
    if (this.activeBackupFlights.has(key)) {
      return false;
    }
    this.activeBackupFlights.add(key);
    return true;
  }

  public releaseBackupFlightLock(key: string): void {
    this.activeBackupFlights.delete(key);
  }

  public isBackupFlightActive(key: string): boolean {
    return this.activeBackupFlights.has(key);
  }

  constructor() {
    const backupDir = path.join(process.cwd(), 'data', 'backups');
    this.markerFilePath = path.join(backupDir, '.restore_active_marker');
    this.detectStartupState();
  }

  private detectStartupState(): void {
    try {
      if (fs.existsSync(this.markerFilePath)) {
        console.warn('WARNING: Interrupted restore detected on startup! Entering RECOVERY_MODE.');
        this.state = 'RECOVERY_MODE';
      }
    } catch {
      // ignore
    }
  }

  public getState(): CoordinatorState {
    return this.state;
  }

  public getLockState(): CoordinatorState {
    return this.state;
  }

  public isRecoveryMode(): boolean {
    return this.state === 'RECOVERY_MODE';
  }

  public getActiveOperationId(): string | null {
    return this.currentOperationId;
  }

  public isLocked(): boolean {
    return this.state === 'RESTORE_LOCKED' || this.state === 'RECOVERY_MODE';
  }

  public assertNotLocked(): void {
    if (this.isLocked()) {
      throw new DatabaseLockedError();
    }
  }

  public async acquireSharedReadLock(timeoutMs = 5000): Promise<() => void> {
    const start = Date.now();
    while (this.state === 'RESTORE_LOCKED' || this.state === 'RECOVERY_MODE') {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timeout waiting for database restore to complete.');
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    this.activeBackupCount++;
    this.state = 'BACKUP_ACTIVE';

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeBackupCount = Math.max(0, this.activeBackupCount - 1);
      if (this.activeBackupCount === 0 && this.state === 'BACKUP_ACTIVE') {
        this.state = 'IDLE';
      }
    };
  }

  public async acquireExclusiveRestoreLock(operationId: string, timeoutMs = 8000): Promise<() => void> {
    if (this.state === 'RESTORE_LOCKED') {
      throw new Error('A database restore operation is already in progress.');
    }
    if (this.state === 'RECOVERY_MODE') {
      throw new Error('System is in RECOVERY_MODE due to a previous interrupted restore. Please run emergency recovery.');
    }

    const start = Date.now();
    // Drain active backups
    while (this.activeBackupCount > 0) {
      if (Date.now() - start > timeoutMs) {
        throw new Error('Timeout waiting for active backup operations to complete.');
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    this.state = 'RESTORE_LOCKED';
    this.currentOperationId = operationId;
    this.lockAcquiredAt = Date.now();

    // Write on-disk marker to detect server crash mid-restore
    try {
      const dir = path.dirname(this.markerFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.markerFilePath,
        JSON.stringify({ operationId, timestamp: new Date().toISOString() }),
        'utf-8'
      );
    } catch (err) {
      console.error('Failed to write restore active marker:', err);
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.state = 'IDLE';
      this.currentOperationId = null;
      this.lockAcquiredAt = null;

      try {
        if (fs.existsSync(this.markerFilePath)) {
          fs.unlinkSync(this.markerFilePath);
        }
      } catch (err) {
        console.error('Failed to remove restore active marker:', err);
      }
    };
  }

  public setRecoveryMode(enable: boolean): void {
    if (enable) {
      this.state = 'RECOVERY_MODE';
    } else {
      this.state = 'IDLE';
      try {
        if (fs.existsSync(this.markerFilePath)) {
          fs.unlinkSync(this.markerFilePath);
        }
      } catch {}
    }
  }
}

export const RestoreCoordinator = new RestoreCoordinatorImpl();
