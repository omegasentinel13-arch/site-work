import crypto from 'crypto';

export interface CanonicalTransactionPayload {
  userId: string;
  siteId: string;
  date: string;
  amountPaise: number;
  type: 'CREDIT' | 'DEBIT';
  investorName?: string | null;
  investorId?: string | null;
  debitCategory?: string | null;
  workCategoryId?: string | null;
  workRoleId?: string | null;
  note?: string | null;
  attachmentHash?: string | null;
}

/**
 * Computes a deterministic SHA-256 canonical lock key incorporating
 * every meaningful business field to prevent duplicate submissions
 * without falsely colliding legitimate separate transactions.
 */
export function computeCanonicalSingleFlightKey(payload: CanonicalTransactionPayload): string {
  const investorIdentifier = (payload.investorName || payload.investorId || '').trim().toLowerCase();
  const debitCat = (payload.debitCategory || '').trim().toUpperCase();
  const workCat = (payload.workCategoryId || '').trim();
  const workRole = (payload.workRoleId || '').trim();
  const noteNormalized = (payload.note || '').trim().toLowerCase();
  const attachHash = (payload.attachmentHash || 'none').trim();

  const parts = [
    payload.userId,
    payload.siteId,
    payload.date,
    String(Math.floor(payload.amountPaise)),
    payload.type,
    investorIdentifier,
    debitCat,
    workCat,
    workRole,
    noteNormalized,
    attachHash,
  ];

  return crypto.createHash('sha256').update(parts.join('::')).digest('hex');
}

export class SingleFlightManager {
  private inFlight = new Map<string, number>();

  cleanExpired(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.inFlight.entries()) {
      if (now > expiresAt) {
        this.inFlight.delete(key);
      }
    }
  }

  /**
   * Attempts to acquire a single-flight lock.
   * Returns true if acquired successfully, false if an identical request is already active.
   */
  acquire(key: string, ttlMs = 2000): boolean {
    this.cleanExpired();
    if (this.inFlight.has(key)) {
      return false;
    }
    this.inFlight.set(key, Date.now() + ttlMs);
    return true;
  }

  release(key: string): void {
    this.inFlight.delete(key);
  }

  has(key: string): boolean {
    this.cleanExpired();
    return this.inFlight.has(key);
  }

  clear(): void {
    this.inFlight.clear();
  }
}

export const singleFlightManager = new SingleFlightManager();
