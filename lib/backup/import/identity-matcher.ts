/**
 * Task 4 — Step 4: Canonical Identity Matcher
 * Maps business entities to canonical natural identities and detects field variations.
 */

import { FieldDiff } from './types';

export function normalizeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim().toLowerCase();
}

export function getNaturalKey(table: string, record: Record<string, unknown>): string {
  switch (table) {
    case 'users':
      return normalizeString(record.username);

    case 'sites':
      return normalizeString(record.code);

    case 'site_users':
      return `${record.site_id}::${record.user_id}`;

    case 'work_categories':
      return normalizeString(record.name);

    case 'work_roles':
      return `${record.category_id}::${normalizeString(record.name)}`;

    case 'site_role_rates':
      return `${record.site_id}::${record.role_id}`;

    case 'permission_definitions':
      return `${normalizeString(record.page_id)}::${normalizeString(record.action_id)}`;

    case 'role_permissions':
      return `${record.role}::${record.permission_id}::${record.scope_type || ''}::${record.site_id || ''}`;

    case 'user_permission_overrides':
      return `${record.user_id}::${record.permission_id}::${record.site_id || ''}`;

    case 'attendance_records':
      // Natural key is (site_id, date, role_id)
      return `${record.site_id}::${record.date}::${record.role_id}`;

    case 'financial_transactions':
      // Natural composite: site_id, date, amount_paise, type, description
      return `${record.site_id}::${record.date}::${record.amount_paise}::${record.type}::${normalizeString(record.description)}`;

    case 'investors':
      return normalizeString(record.name);

    case 'supply_items':
      return `${record.site_id}::${normalizeString(record.normalized_name || record.name)}`;

    case 'system_lifecycle_records':
      return `${record.entity_type}::${record.entity_id}`;

    case 'audit_logs':
      return `${record.created_at}::${record.user_id}::${record.action}::${record.entity_type || ''}::${record.entity_id || ''}`;

    default:
      return String(record.id || JSON.stringify(record));
  }
}

/**
 * Fields to exclude from conflict comparisons (metadata, timestamps, auto-ids)
 */
const IGNORED_COMPARISON_FIELDS = new Set([
  'id',
  'created_at',
  'updated_at',
  'created_by',
  'updated_by',
  'password_hash',
  'recovery_email',
  'recovery_token',
]);

/**
 * Compares non-id, non-timestamp fields between existing and incoming records.
 * Returns array of FieldDiff. If empty, the records are MATCHED_EXACT.
 */
export function compareRecords(
  table: string,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const checkedKeys = new Set<string>();

  // Check all keys from incoming record
  for (const key of Object.keys(incoming)) {
    if (IGNORED_COMPARISON_FIELDS.has(key)) continue;
    checkedKeys.add(key);

    const incVal = incoming[key];
    const exVal = existing[key];

    // Normalize comparison for null/undefined/numbers/strings
    if (!areValuesEqual(incVal, exVal)) {
      diffs.push({
        field: key,
        existingValue: exVal,
        incomingValue: incVal,
      });
    }
  }

  return diffs;
}

function areValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  
  // Number comparison (including string numbers)
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b;
  }
  if (typeof a === 'number' || typeof b === 'number') {
    const numA = Number(a);
    const numB = Number(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA === numB;
  }

  // Boolean comparison (0/1 in SQLite vs boolean)
  if ((typeof a === 'boolean' || typeof a === 'number') && (typeof b === 'boolean' || typeof b === 'number')) {
    return Boolean(a) === Boolean(b);
  }

  // String comparison
  return String(a ?? '').trim() === String(b ?? '').trim();
}
