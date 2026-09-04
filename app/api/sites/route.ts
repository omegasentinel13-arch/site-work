import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess, requireAdmin } from '@/lib/auth/permissions';
import { getAllSites, createSite } from '@/lib/db/repositories/site-repo';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const includeArchived = searchParams.get('includeArchived') === 'true';

  const userAllowedSites = session.role === 'ADMIN' ? null : session.assignedSiteIds;
  const sites = getAllSites(includeArchived, userAllowedSites);

  return NextResponse.json({ sites });
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { name, code, location } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Site name is required' }, { status: 400 });
    }

    const siteId = createSite(name, code, location, session!.userId);

    logAudit({
      entityType: 'SITE',
      entityId: siteId,
      action: 'CREATE',
      siteId,
      userId: session!.userId,
      afterState: { name, code, location },
    });

    return NextResponse.json({ success: true, siteId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create site';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
