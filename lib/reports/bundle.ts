/**
 * SITE WORK — Canonical Multi-Report Bundle Generator
 * Connects the Report Registry capabilities to canonical PDF and Excel generators,
 * producing human-readable report items for individual export or Full Report ZIP packaging.
 */

import { REPORT_DEFINITIONS, ReportType, ReportScope } from './registry';
import { getSiteById, getAllSites } from '@/lib/db/repositories/site-repo';
import { getDailyAttendance, getAttendanceByDateRange } from '@/lib/db/repositories/attendance-repo';
import { getFinancialTransactions, getCumulativeBalanceBeforeDate, mapDbRecordToItem } from '@/lib/db/repositories/finance-repo';
import { getAllCategories, getAllRoles, getRoleById, getCategoryById } from '@/lib/db/repositories/role-repo';
import { calculateDailySummary } from '@/lib/domain/attendance-engine';
import { calculateFinancialSummary } from '@/lib/domain/finance-engine';
import {
  generateDailyAttendancePDF,
  generateWeeklyAttendancePDF,
  generateMonthlyAttendancePDF,
  generateFinancialPDF,
  generateMonthlyFinancialPDF,
  generateRoleReportPDF,
  generateCategoryReportPDF,
  generateSitePerformancePDF,
} from '@/lib/export/pdf';
import {
  generateDailyAttendanceExcel,
  generateWeeklyAttendanceExcel,
  generateMonthlyAttendanceExcel,
  generateFinancialExcel,
  generateMonthlyFinancialExcel,
  generateRoleReportExcel,
  generateCategoryReportExcel,
  generateSiteReportExcel,
} from '@/lib/export/excel';
import {
  resolveExportPeriod,
  getScopeHistoricalDateBounds,
  collectSiteExportData,
  collectSystemExportData,
  generateSiteCompletePDF,
  generateSystemCompletePDF,
  generateCompleteSiteExcel,
  generateCompleteSystemExcel,
  PeriodPreset,
} from '@/lib/export/complete';
import { ReportItemEntry } from '@/lib/export/complete/zip-packager';
import { UserSession } from '@/lib/auth/session';

export interface GenerateReportBundleOptions {
  scope: ReportScope;
  siteId?: string;
  startDate?: string;
  endDate?: string;
  periodPreset?: PeriodPreset;
  reportTypes: ReportType[];
  includePdf?: boolean;
  includeExcel?: boolean;
  session: UserSession;
}

export interface GeneratedReportBundleResult {
  scope: ReportScope;
  siteId?: string;
  siteName?: string;
  siteCode?: string;
  period: {
    preset: string;
    startDate?: string;
    endDate?: string;
    label: string;
  };
  reports: ReportItemEntry[];
}

export async function generateReportBundle(
  options: GenerateReportBundleOptions
): Promise<GeneratedReportBundleResult> {
  const {
    scope,
    siteId,
    startDate,
    endDate,
    periodPreset = 'ALL_DATA',
    reportTypes,
    includePdf = true,
    includeExcel = true,
    session,
  } = options;

  // 1. Enforce scope applicability using the canonical registry
  const applicableTypes = reportTypes.filter((t) => {
    const def = REPORT_DEFINITIONS[t];
    return def && def.supportedScopes.includes(scope);
  });

  if (applicableTypes.length === 0) {
    throw new Error(`No reports in selection are applicable for scope: ${scope}`);
  }

  // 2. Resolve Site or System Context
  let siteName: string | undefined;
  let siteCode: string | undefined;
  let authorizedSiteIds: string[] | undefined;

  const isGlobalAdmin =
    session.role === 'ADMIN' ||
    (session as any).authorityTier === 'KING_MAKER' ||
    (session as any).authorityTier === 'SUPERIOR_PRIME';

  if (scope === 'SITE') {
    if (!siteId || siteId === 'ALL') {
      throw new Error('siteId is required for SITE-scoped report generation');
    }
    const site = getSiteById(siteId);
    if (!site) {
      throw new Error(`Site not found: ${siteId}`);
    }
    siteName = site.name;
    siteCode = site.code || undefined;
  } else {
    // ALL_SITES
    const allSites = getAllSites();
    const authorizedSites = isGlobalAdmin
      ? allSites
      : allSites.filter((s) => session.assignedSiteIds?.includes(s.id));

    if (authorizedSites.length === 0) {
      throw new Error('No authorized sites found for this user in ALL_SITES scope');
    }
    authorizedSiteIds = isGlobalAdmin ? undefined : authorizedSites.map((s) => s.id);
  }

  // 3. Resolve Period with true historical boundaries
  const dateBounds = getScopeHistoricalDateBounds(scope === 'SITE' ? siteId : authorizedSiteIds);
  const resolvedPeriod = resolveExportPeriod(
    startDate && endDate ? 'CUSTOM' : periodPreset,
    startDate,
    endDate,
    dateBounds
  );

  const meta = {
    siteName: siteName || 'All Sites Consolidated',
    siteCode: siteCode || undefined,
    reportTitle: '',
    periodLabel: resolvedPeriod.label,
    generatedBy: session.username,
    generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
  };

  const results: ReportItemEntry[] = [];

  // Pre-collect complete export data if complete or multi-sheet reports are requested
  let siteExportDataCache: any = null;
  let systemExportDataCache: any = null;

  const getSiteData = () => {
    if (!siteExportDataCache && siteId) {
      siteExportDataCache = collectSiteExportData(siteId, resolvedPeriod);
    }
    return siteExportDataCache;
  };

  const getSystemData = () => {
    if (!systemExportDataCache) {
      systemExportDataCache = collectSystemExportData(resolvedPeriod, authorizedSiteIds);
    }
    return systemExportDataCache;
  };

  const sD = resolvedPeriod.startDate || dateBounds.earliestDate || '2026-01-01';
  const eD = resolvedPeriod.endDate || dateBounds.latestDate || new Date().toISOString().split('T')[0];

  // 4. Generate each applicable report
  for (const reportType of applicableTypes) {
    const def = REPORT_DEFINITIONS[reportType];
    let pdfBuf: Buffer | undefined;
    let excelBuf: Buffer | undefined;
    const title = `${def.label.replace(/\s+/g, '_')}_${(siteName || 'All_Sites').replace(/\s+/g, '_')}_${resolvedPeriod.preset}`;

    switch (reportType) {
      case 'COMPLETE_REPORT': {
        if (scope === 'SITE') {
          const sData = getSiteData();
          if (includePdf) pdfBuf = generateSiteCompletePDF(sData, session.username);
          if (includeExcel) excelBuf = await generateCompleteSiteExcel(sData, { ...meta, reportTitle: def.label });
        } else {
          const sysData = getSystemData();
          if (includePdf) pdfBuf = generateSystemCompletePDF(sysData, session.username);
          if (includeExcel) excelBuf = await generateCompleteSystemExcel(sysData, { ...meta, reportTitle: def.label });
        }
        break;
      }

      case 'ALL_SITES_CONSOLIDATED': {
        if (scope === 'ALL_SITES') {
          const sysData = getSystemData();
          if (includePdf) pdfBuf = generateSystemCompletePDF(sysData, session.username);
          if (includeExcel) excelBuf = await generateCompleteSystemExcel(sysData, { ...meta, reportTitle: def.label });
        }
        break;
      }

      case 'DAILY_ATTENDANCE': {
        if (scope === 'SITE' && siteId) {
          const targetDate = resolvedPeriod.startDate || new Date().toISOString().split('T')[0];
          const records = getDailyAttendance(siteId, targetDate);
          const summary = calculateDailySummary(
            targetDate,
            records.map((r) => ({
              roleId: r.role_id,
              roleName: r.role_name || '',
              categoryId: r.category_id || '',
              categoryName: r.category_name || '',
              rateInPaise: r.rate_snapshot_paise,
              fullDayCount: r.full_day_count,
              halfDayCount: r.half_day_count,
            }))
          );
          const reportMeta = { ...meta, reportTitle: def.label, periodLabel: targetDate };
          if (includePdf) pdfBuf = generateDailyAttendancePDF(reportMeta, summary);
          if (includeExcel) excelBuf = await generateDailyAttendanceExcel(reportMeta, summary);
        }
        break;
      }

      case 'WEEKLY_ATTENDANCE': {
        if (scope === 'SITE' && siteId) {
          const records = getAttendanceByDateRange(siteId, sD, eD);
          const reportMeta = { ...meta, reportTitle: def.label, periodLabel: `${sD} to ${eD}` };
          if (includePdf) pdfBuf = generateWeeklyAttendancePDF(reportMeta, { records, startDate: sD, endDate: eD });
          if (includeExcel) excelBuf = await generateWeeklyAttendanceExcel(reportMeta, { records, startDate: sD, endDate: eD });
        }
        break;
      }

      case 'MONTHLY_ATTENDANCE': {
        if (scope === 'SITE' && siteId) {
          const records = getAttendanceByDateRange(siteId, sD, eD);
          const reportMeta = { ...meta, reportTitle: def.label, periodLabel: `${sD} to ${eD}` };
          if (includePdf) pdfBuf = generateMonthlyAttendancePDF(reportMeta, { records, monthLabel: `${sD} to ${eD}`, startDate: sD, endDate: eD });
          if (includeExcel) excelBuf = await generateMonthlyAttendanceExcel(reportMeta, { records, monthLabel: `${sD} to ${eD}`, startDate: sD, endDate: eD });
        }
        break;
      }

      case 'TRANSACTIONS': {
        const targetSiteId = scope === 'SITE' ? siteId : undefined;
        const rawItems = getFinancialTransactions(targetSiteId || '', {
          startDate: sD,
          endDate: eD,
        });
        const items = rawItems.map(mapDbRecordToItem);
        const openingBalance = targetSiteId && sD ? getCumulativeBalanceBeforeDate(targetSiteId, sD) : 0;
        const summary = calculateFinancialSummary(items, openingBalance);
        const reportMeta = { ...meta, reportTitle: def.label, periodLabel: `${sD} to ${eD}` };
        if (includePdf) {
          pdfBuf = generateFinancialPDF(
            reportMeta,
            summary,
            rawItems.map((t) => ({
              date: t.date,
              type: t.type,
              debitCategory: t.debit_category,
              description: t.description,
              amountPaise: t.amount_paise,
            }))
          );
        }
        if (includeExcel) {
          excelBuf = await generateFinancialExcel(reportMeta, {
            summary,
            transactions: rawItems.map((t) => ({
              date: t.date,
              type: t.type,
              debitCategory: t.debit_category,
              description: t.description,
              amountPaise: t.amount_paise,
            })),
          });
        }
        break;
      }

      case 'MASTER_LEDGER': {
        const targetSiteId = scope === 'SITE' ? siteId : undefined;
        const rawItems = getFinancialTransactions(targetSiteId || '', {
          startDate: sD,
          endDate: eD,
        });
        const items = rawItems.map(mapDbRecordToItem);
        const openingBalance = targetSiteId && sD ? getCumulativeBalanceBeforeDate(targetSiteId, sD) : 0;
        const summary = calculateFinancialSummary(items, openingBalance);
        const reportMeta = { ...meta, reportTitle: def.label, periodLabel: `${sD} to ${eD}` };
        if (includePdf) {
          pdfBuf = generateMonthlyFinancialPDF(
            reportMeta,
            summary,
            rawItems.map((t) => ({
              date: t.date,
              type: t.type,
              debitCategory: t.debit_category,
              description: t.description,
              amountPaise: t.amount_paise,
            }))
          );
        }
        if (includeExcel) {
          excelBuf = await generateMonthlyFinancialExcel(reportMeta, {
            summary,
            transactions: rawItems.map((t) => ({
              date: t.date,
              type: t.type,
              debitCategory: t.debit_category,
              description: t.description,
              amountPaise: t.amount_paise,
            })),
          });
        }
        break;
      }

      case 'LABOUR_WORKER':
      case 'ROLE_REPORT': {
        if (scope === 'SITE' && siteId) {
          const records = getAttendanceByDateRange(siteId, sD, eD);
          const reportMeta = { ...meta, reportTitle: def.label, periodLabel: `${sD} to ${eD}` };
          if (includePdf) {
            pdfBuf = generateRoleReportPDF(reportMeta, {
              roleName: 'All Roles',
              categoryName: 'Workforce Rollup',
              records,
              isAllRoles: true,
            });
          }
          if (includeExcel) {
            excelBuf = await generateRoleReportExcel(reportMeta, {
              roleName: 'All Roles',
              categoryName: 'Workforce Rollup',
              records,
              isAllRoles: true,
            });
          }
        }
        break;
      }

      case 'CATEGORY_REPORT': {
        if (scope === 'SITE' && siteId) {
          const records = getAttendanceByDateRange(siteId, sD, eD);
          const reportMeta = { ...meta, reportTitle: def.label, periodLabel: `${sD} to ${eD}` };
          if (includePdf) {
            pdfBuf = generateCategoryReportPDF(reportMeta, {
              categoryName: 'All Categories',
              records,
            });
          }
          if (includeExcel) {
            excelBuf = await generateCategoryReportExcel(reportMeta, {
              categoryName: 'All Categories',
              records,
            });
          }
        }
        break;
      }

      case 'SITE_PERFORMANCE': {
        if (scope === 'SITE' && siteId) {
          const sData = getSiteData();
          const reportMeta = { ...meta, reportTitle: def.label };
          if (includePdf) pdfBuf = generateSitePerformancePDF(reportMeta, sData);
          if (includeExcel) excelBuf = await generateSiteReportExcel(reportMeta, sData);
        } else {
          const sysData = getSystemData();
          const reportMeta = { ...meta, reportTitle: def.label };
          if (includePdf) pdfBuf = generateSystemCompletePDF(sysData, session.username);
          if (includeExcel) excelBuf = await generateCompleteSystemExcel(sysData, reportMeta);
        }
        break;
      }
    }

    if (pdfBuf || excelBuf) {
      results.push({
        reportType,
        title,
        pdfBuffer: pdfBuf,
        excelBuffer: excelBuf,
      });
    }
  }

  return {
    scope,
    siteId,
    siteName,
    siteCode,
    period: {
      preset: resolvedPeriod.preset,
      startDate: resolvedPeriod.startDate,
      endDate: resolvedPeriod.endDate,
      label: resolvedPeriod.label,
    },
    reports: results,
  };
}
