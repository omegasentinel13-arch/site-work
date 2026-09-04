import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess, UnauthorizedError, ForbiddenError } from '@/lib/auth/permissions';
import { getSiteById } from '@/lib/db/repositories/site-repo';
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

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const {
      siteId,
      type,
      date,
      startDate,
      endDate,
      title,
      monthLabel,
      roleId,
      categoryId,
      transactionType,
      debitCategory,
    } = body;

    // 1. Validate siteId presence & type
    if (!siteId || typeof siteId !== 'string' || !siteId.trim()) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    // 2. Validate user site authorization (Throws UnauthorizedError or ForbiddenError)
    validateSiteAccess(session, siteId, 'READ');

    // 3. Validate site existence
    const site = getSiteById(siteId);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // 4. Validate date formats when provided
    if (date && !DATE_REGEX.test(date)) {
      return NextResponse.json({ error: 'Invalid date format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (startDate && !DATE_REGEX.test(startDate)) {
      return NextResponse.json({ error: 'Invalid startDate format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (endDate && !DATE_REGEX.test(endDate)) {
      return NextResponse.json({ error: 'Invalid endDate format. Expected YYYY-MM-DD.' }, { status: 400 });
    }

    let pdfBuffer: Buffer;
    let filename: string;

    switch (type) {
      case 'DAILY_ATTENDANCE': {
        const targetDate = date || new Date().toISOString().split('T')[0];
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
        if (!startDate || !endDate) {
          return NextResponse.json({ error: 'startDate and endDate are required for weekly attendance' }, { status: 400 });
        }
        const records = getAttendanceByDateRange(siteId, startDate, endDate);
        pdfBuffer = generateWeeklyAttendancePDF(
          {
            siteName: site.name,
            siteCode: site.code,
            reportTitle: title || 'Weekly Attendance Matrix',
            periodLabel: `${startDate} to ${endDate}`,
          },
          { records, startDate, endDate }
        );
        filename = sanitizeReportFilename(site.name, `Weekly_Matrix_${startDate}_to_${endDate}`);
        break;
      }

      case 'MONTHLY_ATTENDANCE': {
        if (!startDate || !endDate) {
          return NextResponse.json({ error: 'startDate and endDate are required for monthly attendance' }, { status: 400 });
        }
        const records = getAttendanceByDateRange(siteId, startDate, endDate);
        pdfBuffer = generateMonthlyAttendancePDF(
          {
            siteName: site.name,
            siteCode: site.code,
            reportTitle: title || 'Monthly Attendance Report',
            periodLabel: monthLabel || `${startDate} to ${endDate}`,
          },
          { records, monthLabel: monthLabel || `${startDate} to ${endDate}`, startDate, endDate }
        );
        filename = sanitizeReportFilename(site.name, `Monthly_Attendance_${(monthLabel || startDate).replace(/\s+/g, '_')}`);
        break;
      }

      case 'FINANCE': {
        const sDate = startDate || '2000-01-01';
        const eDate = endDate || '2099-12-31';
        const openingBalancePaise = startDate ? getCumulativeBalanceBeforeDate(siteId, startDate) : 0;
        const txs = getFinancialTransactions(siteId, {
          startDate: sDate,
          endDate: eDate,
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
            periodLabel: startDate && endDate ? `${startDate} to ${endDate}` : 'Complete History',
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
        filename = sanitizeReportFilename(site.name, `Finance_${startDate || 'all'}`);
        break;
      }

      case 'MONTHLY_FINANCE': {
        if (!startDate || !endDate) {
          return NextResponse.json({ error: 'startDate and endDate are required for monthly financial statement' }, { status: 400 });
        }
        const openingBalancePaise = getCumulativeBalanceBeforeDate(siteId, startDate);
        const txs = getFinancialTransactions(siteId, { startDate, endDate });
        const items = txs.map(mapDbRecordToItem);
        const summary = calculateFinancialSummary(items, openingBalancePaise);

        pdfBuffer = generateMonthlyFinancialPDF(
          {
            siteName: site.name,
            siteCode: site.code,
            reportTitle: title || 'Monthly Financial Statement',
            periodLabel: monthLabel || `${startDate} to ${endDate}`,
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
        filename = sanitizeReportFilename(site.name, `Monthly_Finance_${(monthLabel || startDate).replace(/\s+/g, '_')}`);
        break;
      }

      case 'ROLE_REPORT': {
        if (!roleId) {
          return NextResponse.json({ error: 'roleId is required for role report' }, { status: 400 });
        }
        if (!startDate || !endDate) {
          return NextResponse.json({ error: 'startDate and endDate are required for role report' }, { status: 400 });
        }
        const isAll = roleId === 'ALL';
        const records = isAll
          ? getAttendanceByDateRange(siteId, startDate, endDate)
          : getAttendanceByDateRange(siteId, startDate, endDate, undefined, roleId);
        
        let roleName = isAll ? 'All Roles (All Workers)' : 'Role';
        let categoryName = isAll ? 'All Categories' : 'General';
        if (!isAll) {
          if (records.length > 0 && records[0].role_name) {
            roleName = records[0].role_name;
            categoryName = records[0].category_name || 'General';
          } else {
            const allRoles = getAllRoles(siteId);
            const matched = allRoles.find((r) => r.id === roleId);
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
            periodLabel: monthLabel || `${startDate} to ${endDate}`,
            filtersSummary: isAll ? 'All Roles & Categories' : `Role: ${roleName}`,
          },
          { roleName, categoryName, records, isAllRoles: isAll }
        );
        filename = sanitizeReportFilename(site.name, `Role_${roleName.replace(/\s+/g, '_')}_${(monthLabel || startDate).replace(/\s+/g, '_')}`);
        break;
      }

      case 'CATEGORY_REPORT': {
        if (!categoryId) {
          return NextResponse.json({ error: 'categoryId is required for category report' }, { status: 400 });
        }
        if (!startDate || !endDate) {
          return NextResponse.json({ error: 'startDate and endDate are required for category report' }, { status: 400 });
        }
        const records = getAttendanceByDateRange(siteId, startDate, endDate, categoryId);

        let categoryName = 'Category';
        if (records.length > 0 && records[0].category_name) {
          categoryName = records[0].category_name;
        } else {
          const allCats = getAllCategories();
          const matched = allCats.find((c) => c.id === categoryId);
          if (matched) {
            categoryName = matched.name;
          }
        }

        pdfBuffer = generateCategoryReportPDF(
          {
            siteName: site.name,
            siteCode: site.code,
            reportTitle: title || 'Category Breakdown Report',
            periodLabel: monthLabel || `${startDate} to ${endDate}`,
            filtersSummary: `Category: ${categoryName}`,
          },
          { categoryName, records }
        );
        filename = sanitizeReportFilename(site.name, `Category_${categoryName.replace(/\s+/g, '_')}_${(monthLabel || startDate).replace(/\s+/g, '_')}`);
        break;
      }

      case 'SITE_REPORT': {
        if (!startDate || !endDate) {
          return NextResponse.json({ error: 'startDate and endDate are required for site performance report' }, { status: 400 });
        }
        const attendanceRecords = getAttendanceByDateRange(siteId, startDate, endDate);
        const openingBalancePaise = getCumulativeBalanceBeforeDate(siteId, startDate);
        const txs = getFinancialTransactions(siteId, { startDate, endDate });
        const items = txs.map(mapDbRecordToItem);
        const financialSummary = calculateFinancialSummary(items, openingBalancePaise);

        pdfBuffer = generateSitePerformancePDF(
          {
            siteName: site.name,
            siteCode: site.code,
            reportTitle: title || 'Site Performance Report',
            periodLabel: monthLabel || `${startDate} to ${endDate}`,
          },
          {
            siteName: site.name,
            siteLocation: site.location,
            attendanceRecords,
            financialSummary,
          }
        );
        filename = sanitizeReportFilename(site.name, `Site_Performance_${(monthLabel || startDate).replace(/\s+/g, '_')}`);
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown export type: ${type}` }, { status: 400 });
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
