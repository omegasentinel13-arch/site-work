import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { setSiteRoleRate } from '@/lib/db/repositories/role-repo';
import { toPaise } from '@/lib/domain/money';
import { logAudit } from '@/lib/audit/logger';

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const body = await req.json();
    const { siteId, roleId, rateRupees, ratePaise } = body;

    if (!siteId || !roleId) {
      return NextResponse.json({ error: 'Site and Role IDs are required' }, { status: 400 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_SETUP_ROLES',
      action: 'MANAGE',
      siteId,
      resourceSiteId: siteId,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const finalRatePaise = ratePaise !== undefined 
      ? (ratePaise === null ? null : ratePaise) 
      : (rateRupees !== null && rateRupees !== undefined ? toPaise(rateRupees) : null);

    setSiteRoleRate(siteId, roleId, finalRatePaise);

    logAudit({
      entityType: 'RATE',
      entityId: `${siteId}:${roleId}`,
      action: 'UPDATE',
      siteId,
      userId: session!.userId,
      afterState: { siteId, roleId, ratePaise: finalRatePaise },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error setting rate';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
