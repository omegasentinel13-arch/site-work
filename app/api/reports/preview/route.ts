import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { getDb } from '@/lib/db';
import { getSiteById, getAllSites } from '@/lib/db/repositories/site-repo';
import { getReportDefinition } from '@/lib/reports/registry';

export const dynamic = 'force-dynamic';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // RBAC: VIEWER is strictly blocked from Command Center
    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Viewer accounts are not permitted to generate or preview reports in the Command Center.' },
        { status: 403 }
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const { scope = 'SITE', siteId, reportType } = body;
    const effectiveScope = reportType === 'ALL_SITES_CONSOLIDATED' ? 'ALL_SITES' : scope;

    // 1. Validate Report Type
    if (!reportType) {
      return NextResponse.json({ error: 'reportType is required' }, { status: 400 });
    }

    const reportDef = getReportDefinition(reportType);
    if (!reportDef) {
      return NextResponse.json({ error: `Invalid report type: ${reportType}` }, { status: 400 });
    }

    // 2. Validate Dates (Support both from/to and startDate/endDate)
    const from = body.from || body.startDate;
    const to = body.to || body.endDate;

    if (from && !DATE_REGEX.test(from)) {
      return NextResponse.json({ error: 'Invalid "from" date format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (to && !DATE_REGEX.test(to)) {
      return NextResponse.json({ error: 'Invalid "to" date format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (from && to && from > to) {
      return NextResponse.json({ error: 'Start date cannot be after end date' }, { status: 400 });
    }

    const startDate = from || '2000-01-01';
    const endDate = to || '2099-12-31';

    // 3. Resolve & Authorize Target Sites
    let targetSiteIds: string[] = [];
    let targetSiteNames: string[] = [];

    const isGlobalAdmin =
      session.role === 'ADMIN' ||
      session.authorityTier === 'KING_MAKER' ||
      session.authorityTier === 'SUPERIOR_PRIME';

    if (effectiveScope === 'SITE') {
      if (!siteId || typeof siteId !== 'string' || !siteId.trim()) {
        return NextResponse.json({ error: 'siteId is required for single site scope' }, { status: 400 });
      }

      const cleanSiteId = siteId.trim();
      const site = getSiteById(cleanSiteId);
      if (!site) {
        return NextResponse.json({ error: 'Site not found' }, { status: 404 });
      }

      if (!isGlobalAdmin) {
        const assigned = session.assignedSiteIds || [];
        if (!assigned.includes(cleanSiteId)) {
          return NextResponse.json(
            { error: 'Forbidden: You are not assigned to view reports for this site.' },
            { status: 403 }
          );
        }
      }

      targetSiteIds = [cleanSiteId];
      targetSiteNames = [site.name];
    } else if (effectiveScope === 'ALL_SITES') {
      if (!reportDef.supportedScopes.includes('ALL_SITES')) {
        return NextResponse.json(
          { error: `${reportDef.label} does not support All-Sites scope.` },
          { status: 400 }
        );
      }

      const allDbSites = getAllSites();
      const authorizedSites = isGlobalAdmin
        ? allDbSites
        : allDbSites.filter((s) => session.assignedSiteIds?.includes(s.id));

      if (authorizedSites.length === 0) {
        return NextResponse.json(
          { error: 'No authorized sites available for consolidated reporting.' },
          { status: 403 }
        );
      }

      targetSiteIds = authorizedSites.map((s) => s.id);
      targetSiteNames = authorizedSites.map((s) => s.name);
    } else {
      return NextResponse.json({ error: `Invalid scope: ${scope}` }, { status: 400 });
    }

    // 4. Calculate Fast Server-Side Preview Summary
    const db = getDb();
    const sitePlaceholders = targetSiteIds.map(() => '?').join(',');

    // Attendance aggregation
    const attendanceRow = db
      .prepare(
        `SELECT 
          COUNT(*) as record_count,
          COALESCE(SUM(worker_days), 0) as total_worker_days,
          COALESCE(SUM(total_cost_paise), 0) as total_labour_cost_paise
         FROM attendance_records
         WHERE site_id IN (${sitePlaceholders})
           AND date >= ? AND date <= ?`
      )
      .get(...targetSiteIds, startDate, endDate) as {
      record_count: number;
      total_worker_days: number;
      total_labour_cost_paise: number;
    } | undefined;

    // Financial transaction aggregation
    const financeRow = db
      .prepare(
        `SELECT 
          COUNT(*) as tx_count,
          COALESCE(SUM(CASE WHEN type = 'CREDIT' THEN amount_paise ELSE 0 END), 0) as total_credits_paise,
          COALESCE(SUM(CASE WHEN type = 'DEBIT' THEN amount_paise ELSE 0 END), 0) as total_debits_paise
         FROM financial_transactions
         WHERE site_id IN (${sitePlaceholders})
           AND date >= ? AND date <= ?`
      )
      .get(...targetSiteIds, startDate, endDate) as {
      tx_count: number;
      total_credits_paise: number;
      total_debits_paise: number;
    } | undefined;

    const totalWorkerDays = attendanceRow?.total_worker_days ?? 0;
    const totalLabourCostPaise = attendanceRow?.total_labour_cost_paise ?? 0;
    const attendanceRecordsCount = attendanceRow?.record_count ?? 0;

    const transactionCount = financeRow?.tx_count ?? 0;
    const totalCreditsPaise = financeRow?.total_credits_paise ?? 0;
    const totalDebitsPaise = financeRow?.total_debits_paise ?? 0;
    const netCashFlowPaise = totalCreditsPaise - totalDebitsPaise;

    const hasData = attendanceRecordsCount > 0 || transactionCount > 0;

    return NextResponse.json({
      reportType,
      reportLabel: reportDef.label,
      scope: effectiveScope,
      periodLabel: from && to ? `${from} to ${to}` : 'All Historical Data',
      siteCount: targetSiteIds.length,
      siteNames: targetSiteNames,
      attendanceRecordsCount,
      totalWorkerDays,
      totalLabourCostPaise,
      transactionCount,
      totalCreditsPaise,
      totalDebitsPaise,
      netCashFlowPaise,
      hasData,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error calculating report preview';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
