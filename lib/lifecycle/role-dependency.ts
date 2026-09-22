import { getDb } from '@/lib/db';

export interface RoleDependencyReport {
  canDelete: boolean;
  isBlockedByHistory: boolean;
  blockingReason: string | null;
  counts: {
    attendance: number;
    financial: number;
    siteOverrides: number;
  };
}

/**
 * Forensically evaluates all child references to work_roles(id).
 *
 * Safety Classification:
 * - Historical / Protected (attendance_records, financial_transactions):
 *   -> Permanent deletion STRICTLY FORBIDDEN. Historical wage and labour records must never be destroyed.
 * - Operational Removable (site_role_rates):
 *   -> Overrides must be removed before permanent deletion can occur.
 */
export function evaluateRoleDependencies(roleId: string): RoleDependencyReport {
  const db = getDb();

  const attendance = (
    db.prepare('SELECT COUNT(*) as c FROM attendance_records WHERE role_id = ?').get(roleId) as { c: number }
  ).c;

  const financial = (
    db.prepare('SELECT COUNT(*) as c FROM financial_transactions WHERE work_role_id = ?').get(roleId) as { c: number }
  ).c;

  const siteOverrides = (
    db.prepare('SELECT COUNT(*) as c FROM site_role_rates WHERE role_id = ?').get(roleId) as { c: number }
  ).c;

  const counts = { attendance, financial, siteOverrides };

  if (attendance > 0 || financial > 0) {
    const reasons: string[] = [];
    if (attendance > 0) reasons.push(`${attendance} attendance record(s)`);
    if (financial > 0) reasons.push(`${financial} financial transaction(s)`);

    return {
      canDelete: false,
      isBlockedByHistory: true,
      blockingReason: `This role has operational history (${reasons.join(' and ')}) and cannot be permanently removed. You can deactivate or archive it instead.`,
      counts,
    };
  }

  if (siteOverrides > 0) {
    return {
      canDelete: false,
      isBlockedByHistory: false,
      blockingReason: `This role has ${siteOverrides} active site rate override(s). Remove the site override(s) before permanently deleting the role.`,
      counts,
    };
  }

  return {
    canDelete: true,
    isBlockedByHistory: false,
    blockingReason: null,
    counts,
  };
}
