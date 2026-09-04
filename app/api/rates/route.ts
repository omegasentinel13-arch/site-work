import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/permissions';
import { setSiteRoleRate } from '@/lib/db/repositories/role-repo';
import { toPaise } from '@/lib/domain/money';
import { logAudit } from '@/lib/audit/logger';

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { siteId, roleId, rateRupees, ratePaise } = body;

    if (!siteId || !roleId) {
      return NextResponse.json({ error: 'Site and Role IDs are required' }, { status: 400 });
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
