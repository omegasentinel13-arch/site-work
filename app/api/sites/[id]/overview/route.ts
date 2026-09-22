import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { getSiteOperationalStats } from '@/lib/db/repositories/site-repo';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    validateSiteAccess(session, params.id, 'READ');
    const stats = getSiteOperationalStats(params.id);
    if (!stats) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    return NextResponse.json({ stats });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Access denied';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
