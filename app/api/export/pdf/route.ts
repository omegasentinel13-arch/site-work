import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess, UnauthorizedError, ForbiddenError } from '@/lib/auth/permissions';
import { getSiteById, getAllSites } from '@/lib/db/repositories/site-repo';
import { getDailyAttendance, getAttendanceByDateRange } from '@/lib/db/repositories/attendance-repo';
import { 
  getFinancialTransactions, 
  getCumulativeBalanceBeforeDate, 
  mapDbRecordToItem 
} from '@/lib/db/repositories/finance-repo';
import { getAllCategories, getAllRoles } from '@/lib/db/repositories/role-repo';
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
  sanitizeReportFilename,
  buildContentDispositionHeader,
} from '@/lib/export/pdf';
import {
  resolveExportPeriod,
  getScopeHistoricalDateBounds,
  collectSiteExportData,
  collectSystemExportData,
  generateSiteCompletePDF,
  generateSystemCompletePDF,
} from '@/lib/export/complete';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    // Reject Viewer accounts immediately from export operations
    if (session.role === 'VIEWER') {
      return NextResponse.json({ error: 'Export is restricted to Administrators and Site Managers.' }, { status: 403 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const {
      siteId,
      scope,
      type,
      reportType,
      date,
      startDate,
      endDate,
      from,
      to,
      title,
      monthLabel,
      roleId,
      categoryId,
      transactionType,
      debitCategory,
    } = body;

    const rawType = (type || reportType || '') as string;
    if (!rawType || typeof rawType !== 'string' || !rawType.trim()) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }

    const sDate = startDate || from;
    const eDate = endDate || to;

    // Date format validations
    if (date && !DATE_REGEX.test(date)) {
      return NextResponse.json({ error: 'Invalid date format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (sDate && !DATE_REGEX.test(sDate)) {
      return NextResponse.json({ error: 'Invalid startDate format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (eDate && !DATE_REGEX.test(eDate)) {
      return NextResponse.json({ error: 'Invalid endDate format. Expected YYYY-MM-DD.' }, { status: 400 });
    }

    // Date range ordering validation
    if (sDate && eDate && sDate > eDate) {
      return NextResponse.json({ error: 'Start date cannot be after end date' }, { status: 400 });
    }

    let pdfBuffer: Buffer;
    let filename: string;

    const isAllSites =
      rawType === 'ALL_SITES_CONSOLIDATED' ||
      rawType === 'SYSTEM_COMPLETE' ||
      scope === 'ALL_SITES' ||
      siteId === 'ALL';

    if (isAllSites) {
      // Validate that this report type actually supports ALL_SITES
      if (rawType !== 'COMPLETE_REPORT' && rawType !== 'ALL_SITES_CONSOLIDATED' && rawType !== 'SYSTEM_COMPLETE') {
        return NextResponse.json({ error: 'This report type only supports a single site scope.' }, { status: 400 });
      }

      const isGlobalAdmin =
        session.role === 'ADMIN' ||
        session.authorityTier === 'KING_MAKER' ||
        session.authorityTier === 'SUPERIOR_PRIME';

      const allDbSites = getAllSites();
      const authorizedSites = isGlobalAdmin
        ? allDbSites
        : allDbSites.filter((s) => session.assignedSiteIds?.includes(s.id));

      if (authorizedSites.length === 0) {
        return NextResponse.json(
          { error: 'No authorized sites available for consolidated export.' },
          { status: 403 }
        );
      }

      const authorizedSiteIds = isGlobalAdmin ? undefined : authorizedSites.map((s) => s.id);
      const dateBounds = getScopeHistoricalDateBounds(authorizedSiteIds);
      const resolvedPeriod = sDate && eDate
        ? resolveExportPeriod('CUSTOM', sDate, eDate)
        : resolveExportPeriod('ALL_DATA', undefined, undefined, dateBounds);

      const systemData = collectSystemExportData(resolvedPeriod, authorizedSiteIds);
      pdfBuffer = generateSystemCompletePDF(systemData, session.username);
      const fileLabel = isGlobalAdmin ? 'Enterprise_System' : 'Consolidated_Sites';
      filename = sanitizeReportFilename(fileLabel, `complete_${resolvedPeriod.preset}`);
    } else {
      // Site-scoped report
      if (!siteId || typeof siteId !== 'string' || !siteId.trim() || siteId === 'ALL') {
        return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
      }

      // Validate site authorization for session (Site Manager must be assigned)
      validateSiteAccess(session, siteId.trim(), 'READ');

      const site = getSiteById(siteId.trim());
      if (!site) {
        return NextResponse.json({ error: 'Site not found' }, { status: 404 });
      }

      switch (rawType) {
        case 'COMPLETE_REPORT': {
          const dateBounds = getScopeHistoricalDateBounds(site.id);
          const resolvedPeriod = sDate && eDate
            ? resolveExportPeriod('CUSTOM', sDate, eDate)
            : resolveExportPeriod('ALL_DATA', undefined, undefined, dateBounds);

          const siteData = collectSiteExportData(site.id, resolvedPeriod);
          pdfBuffer = generateSiteCompletePDF(siteData, session.username);
          filename = sanitizeReportFilename(site.name, `complete_${resolvedPeriod.preset}`);
          break;
        }

        case 'DAILY_ATTENDANCE': {
          const targetDate = date || sDate || new Date().toISOString().split('T')[0];
          const records = getDailyAttendance(site.id, targetDate);
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

          pdfBuffer = generateDailyAttendancePDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: title || 'Daily Attendance Report',
              periodLabel: targetDate,
            },
            summary
          );
          filename = sanitizeReportFilename(site.name, `Attendance_${targetDate}`);
          break;
        }

        case 'WEEKLY_ATTENDANCE': {
          if (!sDate || !eDate) {
            return NextResponse.json({ error: 'startDate and endDate are required for weekly attendance' }, { status: 400 });
          }
          const records = getAttendanceByDateRange(site.id, sDate, eDate);
          pdfBuffer = generateWeeklyAttendancePDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: title || 'Weekly Attendance Matrix',
              periodLabel: `${sDate} to ${eDate}`,
            },
            { records, startDate: sDate, endDate: eDate }
          );
          filename = sanitizeReportFilename(site.name, `Weekly_Matrix_${sDate}_to_${eDate}`);
          break;
        }

        case 'MONTHLY_COMPREHENSIVE':
        case 'MONTHLY_ATTENDANCE': {
          if (!sDate || !eDate) {
            return NextResponse.json({ error: 'startDate and endDate are required for monthly attendance' }, { status: 400 });
          }
          const records = getAttendanceByDateRange(site.id, sDate, eDate);
          pdfBuffer = generateMonthlyAttendancePDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: title || 'Monthly Attendance Report',
              periodLabel: monthLabel || `${sDate} to ${eDate}`,
            },
            { records, monthLabel: monthLabel || `${sDate} to ${eDate}`, startDate: sDate, endDate: eDate }
          );
          filename = sanitizeReportFilename(site.name, `Monthly_Attendance_${(monthLabel || sDate).replace(/\s+/g, '_')}`);
          break;
        }

        case 'TRANSACTIONS':
        case 'FINANCE': {
          const sDateParsed = sDate || '2000-01-01';
          const eDateParsed = eDate || '2099-12-31';
          const openingBalancePaise = sDate ? getCumulativeBalanceBeforeDate(site.id, sDate) : 0;
          const txs = getFinancialTransactions(site.id, {
            startDate: sDateParsed,
            endDate: eDateParsed,
            type: transactionType,
            debitCategory,
          });
          const items = txs.map(mapDbRecordToItem);
          const summary = calculateFinancialSummary(items, openingBalancePaise);

          pdfBuffer = generateFinancialPDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: title || 'Financial Ledger Report',
              periodLabel: sDate && eDate ? `${sDate} to ${eDate}` : 'Complete History',
            },
            summary,
            txs.map((t) => ({
              date: t.date,
              type: t.type,
              debitCategory: t.debit_category,
              description: t.description,
              amountPaise: t.amount_paise,
            }))
          );
          filename = sanitizeReportFilename(site.name, `Finance_${sDate || 'all'}`);
          break;
        }

        case 'MASTER_LEDGER':
        case 'MONTHLY_FINANCE': {
          if (!sDate || !eDate) {
            return NextResponse.json({ error: 'startDate and endDate are required for monthly financial statement' }, { status: 400 });
          }
          const openingBalancePaise = getCumulativeBalanceBeforeDate(site.id, sDate);
          const txs = getFinancialTransactions(site.id, { startDate: sDate, endDate: eDate });
          const items = txs.map(mapDbRecordToItem);
          const summary = calculateFinancialSummary(items, openingBalancePaise);

          pdfBuffer = generateMonthlyFinancialPDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: title || 'Monthly Financial Statement',
              periodLabel: monthLabel || `${sDate} to ${eDate}`,
            },
            summary,
            txs.map((t) => ({
              date: t.date,
              type: t.type,
              debitCategory: t.debit_category,
              description: t.description,
              amountPaise: t.amount_paise,
            }))
          );
          filename = sanitizeReportFilename(site.name, `Monthly_Finance_${(monthLabel || sDate).replace(/\s+/g, '_')}`);
          break;
        }

        case 'LABOUR_WORKER':
        case 'ROLE_REPORT': {
          const isLabourWorker = rawType === 'LABOUR_WORKER';
          const effectiveRoleId = isLabourWorker ? 'ALL' : roleId;

          if (!effectiveRoleId) {
            return NextResponse.json({ error: 'roleId is required for role report' }, { status: 400 });
          }
          if (!sDate || !eDate) {
            return NextResponse.json({ error: 'startDate and endDate are required for role report' }, { status: 400 });
          }
          const isAll = effectiveRoleId === 'ALL';
          const records = isAll
            ? getAttendanceByDateRange(site.id, sDate, eDate)
            : getAttendanceByDateRange(site.id, sDate, eDate, undefined, effectiveRoleId);
          
          let roleName = isAll ? 'All Roles (All Workers)' : 'Role';
          let categoryName = isAll ? 'All Categories' : 'General';
          if (!isAll) {
            if (records.length > 0 && records[0].role_name) {
              roleName = records[0].role_name;
              categoryName = records[0].category_name || 'General';
            } else {
              const allRoles = getAllRoles(site.id);
              const matched = allRoles.find((r) => r.id === effectiveRoleId);
              if (matched) {
                roleName = matched.name;
                categoryName = matched.category_name || 'General';
              }
            }
          }

          pdfBuffer = generateRoleReportPDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: isAll ? (title || 'All Workforce Roles & Deployment') : (title || 'Role Breakdown Report'),
              periodLabel: monthLabel || `${sDate} to ${eDate}`,
              filtersSummary: isAll ? 'All Roles & Categories' : `Role: ${roleName}`,
            },
            { roleName, categoryName, records, isAllRoles: isAll }
          );
          filename = sanitizeReportFilename(site.name, `Role_${roleName.replace(/\s+/g, '_')}_${(monthLabel || sDate).replace(/\s+/g, '_')}`);
          break;
        }

        case 'CATEGORY_REPORT': {
          if (!sDate || !eDate) {
            return NextResponse.json({ error: 'startDate and endDate are required for category report' }, { status: 400 });
          }
          const isAllCategories = !categoryId || categoryId === 'ALL';
          const records = isAllCategories
            ? getAttendanceByDateRange(site.id, sDate, eDate)
            : getAttendanceByDateRange(site.id, sDate, eDate, categoryId);

          let categoryName = isAllCategories ? 'All Categories' : 'Category';
          if (!isAllCategories) {
            if (records.length > 0 && records[0].category_name) {
              categoryName = records[0].category_name;
            } else {
              const allCats = getAllCategories();
              const matched = allCats.find((c) => c.id === categoryId);
              if (matched) {
                categoryName = matched.name;
              }
            }
          }

          pdfBuffer = generateCategoryReportPDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: title || (isAllCategories ? 'All Categories Deployment' : 'Category Breakdown Report'),
              periodLabel: monthLabel || `${sDate} to ${eDate}`,
              filtersSummary: `Category: ${categoryName}`,
            },
            { categoryName, records }
          );
          filename = sanitizeReportFilename(site.name, `Category_${categoryName.replace(/\s+/g, '_')}_${(monthLabel || sDate).replace(/\s+/g, '_')}`);
          break;
        }

        case 'SITE_PERFORMANCE':
        case 'SITE_REPORT': {
          if (!sDate || !eDate) {
            return NextResponse.json({ error: 'startDate and endDate are required for site performance report' }, { status: 400 });
          }
          const attendanceRecords = getAttendanceByDateRange(site.id, sDate, eDate);
          const openingBalancePaise = getCumulativeBalanceBeforeDate(site.id, sDate);
          const txs = getFinancialTransactions(site.id, { startDate: sDate, endDate: eDate });
          const items = txs.map(mapDbRecordToItem);
          const financialSummary = calculateFinancialSummary(items, openingBalancePaise);

          pdfBuffer = generateSitePerformancePDF(
            {
              siteName: site.name,
              siteCode: site.code,
              reportTitle: title || 'Site Performance Report',
              periodLabel: monthLabel || `${sDate} to ${eDate}`,
            },
            {
              siteName: site.name,
              siteLocation: site.location,
              attendanceRecords,
              financialSummary,
            }
          );
          filename = sanitizeReportFilename(site.name, `Site_Performance_${(monthLabel || sDate).replace(/\s+/g, '_')}`);
          break;
        }

        default:
          return NextResponse.json({ error: `Unknown export type: ${rawType}` }, { status: 400 });
      }
    }

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildContentDispositionHeader(filename),
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      },
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : 'Error generating PDF report';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
