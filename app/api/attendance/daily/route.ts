import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
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

    const access = canAccess({
      session,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: 'VIEW',
      siteId,
      resourceSiteId: siteId,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const records = getDailyAttendance(siteId, date);
    const allActiveRoles = getAllRoles(siteId, false);

    // Merge active roles with existing records so form displays every available role
    const recordMap = new Map(records.map(r => [r.role_id, r]));
    const activeRoleIds = new Set(allActiveRoles.map(r => r.id));

    // Find any historical roles that have records on this date but are currently inactive
    const allRolesWithInactive = getAllRoles(siteId, true);
    const historicalInactiveRoles = allRolesWithInactive.filter(
      r => recordMap.has(r.id) && !activeRoleIds.has(r.id)
    );

    const combinedRoles = [...allActiveRoles, ...historicalInactiveRoles];

    const mergedRoles = combinedRoles.map(r => {
      const existing = recordMap.get(r.id);
      return {
        roleId: r.id,
        roleName: r.name,
        categoryId: r.category_id,
        categoryName: r.category_name || '',
        isActive: r.is_active === 1,
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

    const existingRecords = getDailyAttendance(siteId, date);
    const hasExisting = existingRecords && existingRecords.length > 0;
    const requiredAction = hasExisting ? 'EDIT' : 'CREATE';

    const access = canAccess({
      session,
      page: 'PAGE_ATTENDANCE_DAILY',
      action: requiredAction,
      siteId,
      resourceSiteId: siteId,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

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
