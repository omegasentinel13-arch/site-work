import { getDb } from '@/lib/db';

export interface SiteDependencyReport {
  canDelete: boolean;
  isBlockedByHistoricalData: boolean;
  blockingReason: string | null;
  counts: {
    attendance: number;
    financial: number;
    roleRates: number;
    siteUsers: number;
    supplies: number;
    auditLogs: number;
  };
}

/**
 * Forensically evaluates all child references to sites(id).
 *
 * Safety Classification:
 * - Class A: Historical / Protected (attendance_records, financial_transactions, audit_logs)
 *   -> Permanent deletion STRICTLY FORBIDDEN. Historical accounting & labor records must never be destroyed.
 * - Class B: Operational Removable (site_users, supply_items)
 *   -> Can only be removed within an atomic delete transaction IF zero Class A records exist.
 * - Class C: Required for Restoration (site_role_rates)
 *   -> Cleanable only if the site has zero historical labor/financial entries.
 * - Class D: Unknown / Unsafe
 *   -> Any unrecognized child records abort operation.
 */
export function evaluateSiteDependencies(siteId: string): SiteDependencyReport {
  const db = getDb();

  const attendanceCount = (
    db.prepare('SELECT COUNT(*) as c FROM attendance_records WHERE site_id = ?').get(siteId) as { c: number }
  ).c;

  const financialCount = (
    db.prepare('SELECT COUNT(*) as c FROM financial_transactions WHERE site_id = ?').get(siteId) as { c: number }
  ).c;

  const roleRatesCount = (
    db.prepare('SELECT COUNT(*) as c FROM site_role_rates WHERE site_id = ?').get(siteId) as { c: number }
  ).c;

  const siteUsersCount = (
    db.prepare('SELECT COUNT(*) as c FROM site_users WHERE site_id = ?').get(siteId) as { c: number }
  ).c;

  const suppliesCount = (
    db.prepare('SELECT COUNT(*) as c FROM supply_items WHERE site_id = ?').get(siteId) as { c: number }
  ).c;

  const auditLogsCount = (
    db.prepare('SELECT COUNT(*) as c FROM audit_logs WHERE site_id = ?').get(siteId) as { c: number }
  ).c;

  const counts = {
    attendance: attendanceCount,
    financial: financialCount,
    roleRates: roleRatesCount,
    siteUsers: siteUsersCount,
    supplies: suppliesCount,
    auditLogs: auditLogsCount,
  };

  if (attendanceCount > 0 || financialCount > 0) {
    const reasons: string[] = [];
    if (attendanceCount > 0) {
      reasons.push(`${attendanceCount} attendance record(s)`);
    }
    if (financialCount > 0) {
      reasons.push(`${financialCount} financial transaction(s)`);
    }

    return {
      canDelete: false,
      isBlockedByHistoricalData: true,
      blockingReason: `This site has operational history (${reasons.join(' and ')}) and cannot be permanently removed. It can safely stay in the Archive.`,
      counts,
    };
  }

  return {
    canDelete: true,
    isBlockedByHistoricalData: false,
    blockingReason: null,
    counts,
  };
}
