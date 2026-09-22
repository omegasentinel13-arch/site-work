import { getDb } from '@/lib/db';

export interface CategoryDependencyReport {
  canDelete: boolean;
  isBlockedByHistory: boolean;
  blockingReason: string | null;
  counts: {
    roles: number;
    financial: number;
  };
}

/**
 * Forensically evaluates all child references to work_categories(id).
 *
 * Safety Classification:
 * - Child Roles in ANY lifecycle state (ACTIVE, INACTIVE, ARCHIVED, RECYCLE_BIN):
 *   -> Permanent deletion or recycling STRICTLY FORBIDDEN.
 *   -> Orphaning child roles violates referential integrity and makes future restoration impossible.
 * - Historical / Protected (financial_transactions):
 *   -> Permanent deletion STRICTLY FORBIDDEN if financial accounting records reference this category.
 */
export function evaluateCategoryDependencies(categoryId: string): CategoryDependencyReport {
  const db = getDb();

  const roles = (
    db.prepare('SELECT COUNT(*) as c FROM work_roles WHERE category_id = ?').get(categoryId) as { c: number }
  ).c;

  const financial = (
    db.prepare('SELECT COUNT(*) as c FROM financial_transactions WHERE work_category_id = ?').get(categoryId) as { c: number }
  ).c;

  const counts = { roles, financial };

  if (roles > 0) {
    return {
      canDelete: false,
      isBlockedByHistory: true,
      blockingReason: 'Deletion blocked: this category still has dependent roles. Remove or reassign all dependent roles before moving the category to the Recycle Bin.',
      counts,
    };
  }

  if (financial > 0) {
    return {
      canDelete: false,
      isBlockedByHistory: true,
      blockingReason: `Cannot delete this category because ${financial} financial transaction(s) reference it.`,
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
