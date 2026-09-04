import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin, validateSiteAccess } from '@/lib/auth/permissions';
import { getSiteById, updateSite, toggleSiteArchived, getSiteUserIds, setSiteUsers } from '@/lib/db/repositories/site-repo';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    validateSiteAccess(session, params.id, 'READ');
    const site = getSiteById(params.id);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const assignedUserIds = getSiteUserIds(params.id);
    return NextResponse.json({ site, assignedUserIds });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Access denied';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { name, code, location, assignedUserIds } = body;

    const existing = getSiteById(params.id);
    if (!existing) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    updateSite(params.id, name, code, location);
    if (Array.isArray(assignedUserIds)) {
      setSiteUsers(params.id, assignedUserIds);
    }

    logAudit({
      entityType: 'SITE',
      entityId: params.id,
      action: 'UPDATE',
      siteId: params.id,
      userId: session!.userId,
      beforeState: existing as unknown as Record<string, unknown>,
      afterState: { name, code, location, assignedUserIds },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update site';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { isArchived } = body;

    const existing = getSiteById(params.id);
    if (!existing) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    toggleSiteArchived(params.id, isArchived);

    logAudit({
      entityType: 'SITE',
      entityId: params.id,
      action: isArchived ? 'ARCHIVE' : 'UPDATE',
      siteId: params.id,
      userId: session!.userId,
      afterState: { isArchived },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to archive site';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
