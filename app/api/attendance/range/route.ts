import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { getAttendanceByDateRange } from '@/lib/db/repositories/attendance-repo';
import { getDb } from '@/lib/db';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const categoryId = searchParams.get('categoryId') || undefined;
    const roleId = searchParams.get('roleId') || undefined;

    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_ATTENDANCE_WEEKLY',
      action: 'VIEW',
      siteId,
      resourceSiteId: siteId,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const db = getDb();
    const boundsRow = db.prepare(
      'SELECT MIN(date) as earliestDate, MAX(date) as latestDate FROM attendance_records WHERE site_id = ?'
    ).get(siteId) as { earliestDate: string | null; latestDate: string | null } | undefined;

    if (searchParams.get('bounds') === 'true' || (!startDate && !endDate)) {
      return NextResponse.json({
        siteId,
        earliestDate: boundsRow?.earliestDate || null,
        latestDate: boundsRow?.latestDate || null,
      });
    }

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'siteId, startDate, and endDate are required' }, { status: 400 });
    }

    const records = getAttendanceByDateRange(siteId, startDate, endDate, categoryId, roleId);

    const totalCostPaise = records.reduce((sum, r) => sum + r.total_cost_paise, 0);
    const totalWorkers = records.reduce((sum, r) => sum + r.total_workers, 0);
    const totalWorkerDays = records.reduce((sum, r) => sum + r.worker_days, 0);
    const totalFullDays = records.reduce((sum, r) => sum + r.full_day_count, 0);
    const totalHalfDays = records.reduce((sum, r) => sum + r.half_day_count, 0);

    return NextResponse.json({
      siteId,
      startDate,
      endDate,
      records,
      earliestDate: boundsRow?.earliestDate || null,
      latestDate: boundsRow?.latestDate || null,
      totals: {
        totalCostPaise,
        totalWorkers,
        totalWorkerDays,
        totalFullDays,
        totalHalfDays,
        recordCount: records.length,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error querying range attendance';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
