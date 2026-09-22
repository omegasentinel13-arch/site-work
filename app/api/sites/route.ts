import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { getAllSites, createSite, getSitesKPISummary, SiteFilter } from '@/lib/db/repositories/site-repo';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  const access = canAccess({
    session,
    page: 'PAGE_SETUP_SITES',
    action: 'VIEW',
  });
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get('status');
  const includeArchivedParam = searchParams.get('includeArchived') === 'true';

  let filter: SiteFilter = 'ACTIVE';
  if (statusParam) {
    const upper = statusParam.toUpperCase();
    if (upper === 'ALL' || upper === 'ACTIVE' || upper === 'ARCHIVED' || upper === 'RECYCLE_BIN') {
      filter = upper as SiteFilter;
    }
  } else if (includeArchivedParam) {
    filter = 'ALL';
  }

  const userAllowedSites = session!.role === 'ADMIN' ? null : session!.assignedSiteIds;
  const sites = getAllSites(filter, userAllowedSites);
  const kpiSummary = session!.role === 'ADMIN' ? getSitesKPISummary() : null;

  return NextResponse.json({ sites, kpiSummary });
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_SITES',
      action: 'CREATE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
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
