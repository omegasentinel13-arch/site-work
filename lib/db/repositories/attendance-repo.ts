import { getDb, runTransaction } from '../index';
import crypto from 'crypto';
import { calculateRoleAttendance } from '../../domain/attendance-engine';

export interface AttendanceDbRecord {
  id: string;
  site_id: string;
  date: string;
  role_id: string;
  role_name?: string;
  category_id?: string;
  category_name?: string;
  rate_snapshot_paise: number;
  full_day_count: number;
  half_day_count: number;
  total_workers: number;
  worker_days: number;
  total_cost_paise: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaveAttendanceItemInput {
  roleId: string;
  fullDayCount: number;
  halfDayCount: number;
  rateInPaise?: number;
}

export function saveDailyAttendance(
  siteId: string,
  date: string,
  items: SaveAttendanceItemInput[],
  userId: string | null
): void {
  const db = getDb();

  const selectExisting = db.prepare(`
    SELECT * FROM attendance_records WHERE site_id = ? AND date = ? AND role_id = ?
  `);

  const selectEffectiveRate = db.prepare(`
    SELECT COALESCE(srr.rate_paise, r.default_rate_paise) as rate_paise
    FROM work_roles r
    LEFT JOIN site_role_rates srr ON (srr.role_id = r.id AND srr.site_id = ?)
    WHERE r.id = ?
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO attendance_records (
      id, site_id, date, role_id, rate_snapshot_paise,
      full_day_count, half_day_count, total_workers, worker_days, total_cost_paise,
      created_by, updated_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(site_id, date, role_id) DO UPDATE SET
      full_day_count = excluded.full_day_count,
      half_day_count = excluded.half_day_count,
      total_workers = excluded.total_workers,
      worker_days = excluded.worker_days,
      total_cost_paise = excluded.total_cost_paise,
      updated_by = excluded.updated_by,
      updated_at = datetime('now')
  `);

  const deleteStmt = db.prepare(`
    DELETE FROM attendance_records WHERE site_id = ? AND date = ? AND role_id = ?
  `);

  runTransaction(db, () => {
    for (const item of items) {
      const full = Math.max(0, Math.floor(item.fullDayCount || 0));
      const half = Math.max(0, Math.floor(item.halfDayCount || 0));

      const existing = selectExisting.get(siteId, date, item.roleId) as AttendanceDbRecord | undefined;

      if (full === 0 && half === 0) {
        if (existing) {
          deleteStmt.run(siteId, date, item.roleId);
        }
        continue;
      }

      let ratePaise: number;
      if (existing && existing.rate_snapshot_paise) {
        ratePaise = existing.rate_snapshot_paise;
      } else if (item.rateInPaise !== undefined && item.rateInPaise > 0) {
        ratePaise = item.rateInPaise;
      } else {
        const rateRow = selectEffectiveRate.get(siteId, item.roleId) as { rate_paise: number } | undefined;
        ratePaise = rateRow ? rateRow.rate_paise : 0;
      }

      const calc = calculateRoleAttendance({
        roleId: item.roleId,
        roleName: '',
        categoryId: '',
        categoryName: '',
        rateInPaise: ratePaise,
        fullDayCount: full,
        halfDayCount: half,
      });

      const id = existing ? existing.id : `att-${crypto.randomUUID()}`;
      upsertStmt.run(
        id,
        siteId,
        date,
        item.roleId,
        ratePaise,
        full,
        half,
        calc.totalWorkers,
        calc.workerDays,
        calc.totalCostPaise,
        existing ? existing.created_by : userId,
        userId
      );
    }
  });
}

export function getDailyAttendance(siteId: string, date: string): AttendanceDbRecord[] {
  const db = getDb();
  const query = `
    SELECT 
      a.id,
      a.site_id,
      a.date,
      a.role_id,
      r.name as role_name,
      c.id as category_id,
      c.name as category_name,
      a.rate_snapshot_paise,
      a.full_day_count,
      a.half_day_count,
      a.total_workers,
      a.worker_days,
      a.total_cost_paise,
      a.created_by,
      a.updated_by,
      a.created_at,
      a.updated_at
    FROM attendance_records a
    JOIN work_roles r ON a.role_id = r.id
    JOIN work_categories c ON r.category_id = c.id
    WHERE a.site_id = ? AND a.date = ?
    ORDER BY c.sort_order ASC, r.sort_order ASC, r.name ASC
  `;

  return db.prepare(query).all(siteId, date) as AttendanceDbRecord[];
}

export function getAttendanceByDateRange(
  siteId: string,
  startDate: string,
  endDate: string,
  categoryId?: string,
  roleId?: string
): AttendanceDbRecord[] {
  const db = getDb();
  let query = `
    SELECT 
      a.id,
      a.site_id,
      a.date,
      a.role_id,
      r.name as role_name,
      c.id as category_id,
      c.name as category_name,
      a.rate_snapshot_paise,
      a.full_day_count,
      a.half_day_count,
      a.total_workers,
      a.worker_days,
      a.total_cost_paise,
      a.created_by,
      a.updated_by,
      a.created_at,
      a.updated_at
    FROM attendance_records a
    JOIN work_roles r ON a.role_id = r.id
    JOIN work_categories c ON r.category_id = c.id
    WHERE a.site_id = ? AND a.date >= ? AND a.date <= ?
  `;
  const params: unknown[] = [siteId, startDate, endDate];

  if (categoryId) {
    query += ` AND c.id = ?`;
    params.push(categoryId);
  }
  if (roleId) {
    query += ` AND r.id = ?`;
    params.push(roleId);
  }

  query += ` ORDER BY a.date ASC, c.sort_order ASC, r.sort_order ASC, r.name ASC`;

  return db.prepare(query).all(...params) as AttendanceDbRecord[];
}
