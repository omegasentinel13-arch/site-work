import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { getDailyAttendance, saveDailyAttendance } from '@/lib/db/repositories/attendance-repo';
import { getAllRoles } from '@/lib/db/repositories/role-repo';
import { calculateDailySummary } from '@/lib/domain/attendance-engine';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const date = searchParams.get('date');

    if (!siteId || !date) {
      return NextResponse.json({ error: 'siteId and date are required' }, { status: 400 });
    }

    validateSiteAccess(session, siteId, 'READ');

    const records = getDailyAttendance(siteId, date);
    const allActiveRoles = getAllRoles(siteId, false);

    // Merge active roles with existing records so form displays every available role
    const recordMap = new Map(records.map(r => [r.role_id, r]));

    const mergedRoles = allActiveRoles.map(r => {
      const existing = recordMap.get(r.id);
      return {
        roleId: r.id,
        roleName: r.name,
        categoryId: r.category_id,
        categoryName: r.category_name || '',
        // If existing record exists, use its historical rate snapshot; otherwise use current effective rate
        rateInPaise: existing ? existing.rate_snapshot_paise : (r.effective_rate_paise || r.default_rate_paise),
        fullDayCount: existing ? existing.full_day_count : 0,
        halfDayCount: existing ? existing.half_day_count : 0,
        totalWorkers: existing ? existing.total_workers : 0,
        workerDays: existing ? existing.worker_days : 0,
        totalCostPaise: existing ? existing.total_cost_paise : 0,
        hasRecord: !!existing,
      };
    });

    const summary = calculateDailySummary(
      date,
      mergedRoles.filter(r => r.fullDayCount > 0 || r.halfDayCount > 0)
    );

    return NextResponse.json({
      siteId,
      date,
      roles: mergedRoles,
      summary,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch attendance';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const body = await req.json();
    const { siteId, date, items } = body;

    if (!siteId || !date || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Invalid attendance payload' }, { status: 400 });
    }

    validateSiteAccess(session, siteId, 'WRITE');

    saveDailyAttendance(
      siteId,
      date,
      items.map(i => ({
        roleId: i.roleId,
        fullDayCount: Math.max(0, parseInt(i.fullDayCount, 10) || 0),
        halfDayCount: Math.max(0, parseInt(i.halfDayCount, 10) || 0),
        rateInPaise: i.rateInPaise,
      })),
      session!.userId
    );

    logAudit({
      entityType: 'ATTENDANCE',
      entityId: `${siteId}:${date}`,
      action: 'UPDATE',
      siteId,
      userId: session!.userId,
      afterState: { date, count: items.length },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save attendance';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
