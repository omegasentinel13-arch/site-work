import { getDb } from '@/lib/db';
import { getSiteById, getAllSites, SiteRecord } from '@/lib/db/repositories/site-repo';
import { AttendanceDbRecord } from '@/lib/db/repositories/attendance-repo';
import { 
  getFinancialTransactions, 
  getCumulativeBalanceBeforeDate, 
  mapDbRecordToItem,
  FinancialDbRecord 
} from '@/lib/db/repositories/finance-repo';
import { getAllCategories, getAllRoles, CategoryRecord, RoleRecord } from '@/lib/db/repositories/role-repo';
import { calculateDailySummary, DailySummary } from '@/lib/domain/attendance-engine';
import { calculateFinancialSummary, FinancialSummary } from '@/lib/domain/finance-engine';
import { 
  ResolvedPeriod, 
  SiteExportData, 
  SystemExportData,
  RoleRollupItem,
  CategoryRollupItem
} from './types';

/**
 * Queries actual persisted date boundaries across attendance and finance.
 * Zero artificial dates.
 */
export function getScopeHistoricalDateBounds(siteId?: string | string[]): { earliestDate: string | null; latestDate: string | null } {
  const db = getDb();
  let query: string;
  let params: unknown[] = [];

  if (Array.isArray(siteId)) {
    if (siteId.length === 0) {
      return { earliestDate: null, latestDate: null };
    }
    const placeholders = siteId.map(() => '?').join(',');
    query = `
      SELECT MIN(d) as earliest, MAX(d) as latest FROM (
        SELECT date as d FROM attendance_records WHERE site_id IN (${placeholders})
        UNION ALL
        SELECT date as d FROM financial_transactions WHERE site_id IN (${placeholders})
      )
    `;
    params = [...siteId, ...siteId];
  } else if (siteId) {
    query = `
      SELECT MIN(d) as earliest, MAX(d) as latest FROM (
        SELECT date as d FROM attendance_records WHERE site_id = ?
        UNION ALL
        SELECT date as d FROM financial_transactions WHERE site_id = ?
      )
    `;
    params = [siteId, siteId];
  } else {
    query = `
      SELECT MIN(d) as earliest, MAX(d) as latest FROM (
        SELECT date as d FROM attendance_records
        UNION ALL
        SELECT date as d FROM financial_transactions
      )
    `;
  }

  const row = db.prepare(query).get(...params) as { earliest: string | null; latest: string | null } | undefined;
  return {
    earliestDate: row?.earliest || null,
    latestDate: row?.latest || null,
  };
}

/**
 * Gathers complete report and domain calculation data for a single site.
 */
export function collectSiteExportData(siteId: string, period: ResolvedPeriod): SiteExportData {
  const db = getDb();
  const site = getSiteById(siteId);
  if (!site) {
    throw new Error(`Site not found: ${siteId}`);
  }

  // 1. Attendance Records (Unbounded or bounded)
  let attendanceRecords: AttendanceDbRecord[];
  if (period.isUnbounded) {
    attendanceRecords = db.prepare(`
      SELECT 
        ar.*,
        r.name as role_name,
        c.name as category_name,
        c.id as category_id
      FROM attendance_records ar
      LEFT JOIN work_roles r ON ar.role_id = r.id
      LEFT JOIN work_categories c ON r.category_id = c.id
      WHERE ar.site_id = ?
      ORDER BY ar.date ASC, c.sort_order ASC, r.sort_order ASC
    `).all(siteId) as AttendanceDbRecord[];
  } else {
    attendanceRecords = db.prepare(`
      SELECT 
        ar.*,
        r.name as role_name,
        c.name as category_name,
        c.id as category_id
      FROM attendance_records ar
      LEFT JOIN work_roles r ON ar.role_id = r.id
      LEFT JOIN work_categories c ON r.category_id = c.id
      WHERE ar.site_id = ? AND ar.date >= ? AND ar.date <= ?
      ORDER BY ar.date ASC, c.sort_order ASC, r.sort_order ASC
    `).all(siteId, period.startDate, period.endDate) as AttendanceDbRecord[];
  }

  // 2. Financial Records & Balances
  let financialRecords: FinancialDbRecord[];
  let openingBalancePaise = 0;

  if (period.isUnbounded || !period.startDate) {
    financialRecords = getFinancialTransactions(siteId);
    openingBalancePaise = 0;
  } else {
    financialRecords = getFinancialTransactions(siteId, {
      startDate: period.startDate,
      endDate: period.endDate,
    });
    openingBalancePaise = getCumulativeBalanceBeforeDate(siteId, period.startDate);
  }

  // Domain Calculations
  const domainTxItems = financialRecords.map(mapDbRecordToItem);
  const financialSummary: FinancialSummary = calculateFinancialSummary(domainTxItems, openingBalancePaise);
  const closingBalancePaise = financialSummary.closingBalancePaise;

  // 3. Categories & Roles
  const categories: CategoryRecord[] = getAllCategories();
  const roles: RoleRecord[] = getAllRoles();

  // 4. Daily Attendance Summaries
  const distinctDates = Array.from(new Set(attendanceRecords.map((r) => r.date))).sort();
  const dailySummaries: DailySummary[] = distinctDates.map((date) => {
    const dayRecords = attendanceRecords.filter((r) => r.date === date);
    return calculateDailySummary(
      date,
      dayRecords.map((r) => ({
        roleId: r.role_id,
        roleName: r.role_name || 'Worker',
        categoryId: r.category_id || 'unassigned',
        categoryName: r.category_name || 'Unassigned',
        rateInPaise: r.rate_snapshot_paise,
        fullDayCount: r.full_day_count,
        halfDayCount: r.half_day_count,
      }))
    );
  });

  // 5. Aggregate Role & Category Rollups
  const totalWorkerDays = attendanceRecords.reduce((sum, r) => sum + r.worker_days, 0);
  const totalLabourCostPaise = attendanceRecords.reduce((sum, r) => sum + r.total_cost_paise, 0);

  const roleRollupMap = new Map<string, RoleRollupItem>();
  for (const r of attendanceRecords) {
    const existing = roleRollupMap.get(r.role_id) || {
      roleId: r.role_id,
      roleName: r.role_name || 'Worker',
      categoryId: r.category_id || 'unassigned',
      categoryName: r.category_name || 'Unassigned',
      workerDays: 0,
      fullDays: 0,
      halfDays: 0,
      totalCostPaise: 0,
      ratePaise: r.rate_snapshot_paise,
    };
    existing.workerDays += r.worker_days;
    existing.fullDays += r.full_day_count;
    existing.halfDays += r.half_day_count;
    existing.totalCostPaise += r.total_cost_paise;
    roleRollupMap.set(r.role_id, existing);
  }
  const roleRollup = Array.from(roleRollupMap.values()).sort((a, b) => 
    a.categoryName.localeCompare(b.categoryName) || a.roleName.localeCompare(b.roleName)
  );

  const categoryRollupMap = new Map<string, CategoryRollupItem>();
  for (const item of roleRollup) {
    const existing = categoryRollupMap.get(item.categoryId) || {
      categoryId: item.categoryId,
      categoryName: item.categoryName,
      workerDays: 0,
      fullDays: 0,
      halfDays: 0,
      totalCostPaise: 0,
    };
    existing.workerDays += item.workerDays;
    existing.fullDays += item.fullDays;
    existing.halfDays += item.halfDays;
    existing.totalCostPaise += item.totalCostPaise;
    categoryRollupMap.set(item.categoryId, existing);
  }
  const categoryRollup = Array.from(categoryRollupMap.values()).sort((a, b) => 
    a.categoryName.localeCompare(b.categoryName)
  );

  return {
    site,
    period,
    attendanceRecords,
    financialRecords,
    categories,
    roles,
    dailySummaries,
    financialSummary,
    openingBalancePaise,
    closingBalancePaise,
    totalWorkerDays,
    totalLabourCostPaise,
    roleRollup,
    categoryRollup,
  };
}

/**
 * Gathers consolidated export data across all active and recorded sites.
 */
export function collectSystemExportData(period: ResolvedPeriod, siteIds?: string[]): SystemExportData {
  const allDbSites = getAllSites();
  const allSites = siteIds ? allDbSites.filter((s) => siteIds.includes(s.id)) : allDbSites;
  const sitesData: SiteExportData[] = [];

  let totalWorkers = 0;
  let totalWorkerDays = 0;
  let totalLabourCostPaise = 0;
  let totalCreditsPaise = 0;
  let totalDebitsPaise = 0;
  let netClosingBalancePaise = 0;

  for (const site of allSites) {
    const data = collectSiteExportData(site.id, period);
    sitesData.push(data);

    const siteWorkers = data.attendanceRecords.reduce((sum, r) => sum + r.total_workers, 0);
    totalWorkers += siteWorkers;
    totalWorkerDays += data.totalWorkerDays;
    totalLabourCostPaise += data.totalLabourCostPaise;
    totalCreditsPaise += data.financialSummary.totalCreditPaise;
    totalDebitsPaise += data.financialSummary.totalDebitPaise;
    netClosingBalancePaise += data.closingBalancePaise;
  }

  return {
    period,
    sitesData,
    aggregatedSummary: {
      totalSites: allSites.length,
      totalWorkers,
      totalWorkerDays,
      totalLabourCostPaise,
      totalCreditsPaise,
      totalDebitsPaise,
      netClosingBalancePaise,
    },
  };
}
