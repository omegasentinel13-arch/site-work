import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin, validateSiteAccess } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { 
  getSiteById, 
  updateSite, 
  toggleSiteArchived, 
  moveSiteToRecycleBin,
  restoreSiteFromRecycleBin,
  permanentlyDeleteSite,
  getSiteUserIds, 
  setSiteUsers 
} from '@/lib/db/repositories/site-repo';
import { getLifecycleRecord, toggleLifecycleKeepPermanently } from '@/lib/db/repositories/global-lifecycle-repo';
import { evaluateSiteDependencies } from '@/lib/lifecycle/site-dependency';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_SITES',
      action: 'VIEW',
      siteId: params.id,
      resourceSiteId: params.id,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const site = getSiteById(params.id);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    const assignedUserIds = getSiteUserIds(params.id);
    const lifecycleRecord = getLifecycleRecord('SITE', params.id);
    const dependencyReport = evaluateSiteDependencies(params.id);

    return NextResponse.json({ 
      site, 
      assignedUserIds, 
      lifecycleRecord,
      dependencyReport 
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Access denied';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_SITES',
      action: 'EDIT',
      siteId: params.id,
      resourceSiteId: params.id,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
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
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_SITES',
      action: 'EDIT',
      siteId: params.id,
      resourceSiteId: params.id,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { action, isArchived, toArchived, keep } = body;

    const existing = getSiteById(params.id);
    if (!existing) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    if (action === 'ARCHIVE') {
      toggleSiteArchived(params.id, true, session!.userId);
      logAudit({
        entityType: 'SITE',
        entityId: params.id,
        action: 'SITE_ARCHIVED',
        siteId: params.id,
        userId: session!.userId,
        afterState: { state: 'ARCHIVED', is_archived: 1 },
      });
      return NextResponse.json({ success: true, message: 'Site archived successfully' });
    }

    if (action === 'RESTORE') {
      toggleSiteArchived(params.id, false, session!.userId);
      logAudit({
        entityType: 'SITE',
        entityId: params.id,
        action: 'SITE_RESTORED',
        siteId: params.id,
        userId: session!.userId,
        afterState: { state: 'ACTIVE', is_archived: 0 },
      });
      return NextResponse.json({ success: true, message: 'Site restored successfully' });
    }

    if (action === 'MOVE_TO_BIN' || action === 'RECYCLE' || action === 'DELETE') {
      moveSiteToRecycleBin(params.id, session!.userId);
      logAudit({
        entityType: 'SITE',
        entityId: params.id,
        action: 'SITE_DELETED_TO_RECYCLE_BIN',
        siteId: params.id,
        userId: session!.userId,
        afterState: { state: 'RECYCLE_BIN', is_archived: 1 },
      });
      return NextResponse.json({ success: true, message: 'Site moved to Recycle Bin' });
    }

    if (action === 'RESTORE_FROM_BIN') {
      restoreSiteFromRecycleBin(params.id, toArchived === true, session!.userId);
      logAudit({
        entityType: 'SITE',
        entityId: params.id,
        action: 'SITE_RESTORED_FROM_RECYCLE_BIN',
        siteId: params.id,
        userId: session!.userId,
        afterState: { state: toArchived ? 'ARCHIVED' : 'ACTIVE', is_archived: toArchived ? 1 : 0 },
      });
      return NextResponse.json({ success: true, message: 'Site restored from Recycle Bin' });
    }

    if (action === 'TOGGLE_KEEP') {
      const lfc = getLifecycleRecord('SITE', params.id);
      if (!lfc) {
        return NextResponse.json({ error: 'Site is not in the lifecycle registry' }, { status: 404 });
      }
      toggleLifecycleKeepPermanently(lfc.id, Boolean(keep));
      logAudit({
        entityType: 'SITE',
        entityId: params.id,
        action: 'SITE_KEEP_PERMANENTLY_TOGGLED',
        siteId: params.id,
        userId: session!.userId,
        afterState: { keep_permanently: Boolean(keep) ? 1 : 0 },
      });
      return NextResponse.json({ success: true, keepPermanently: Boolean(keep) });
    }

    // Legacy fallback for toggleSiteArchived
    if (typeof isArchived === 'boolean') {
      toggleSiteArchived(params.id, isArchived, session!.userId);
      logAudit({
        entityType: 'SITE',
        entityId: params.id,
        action: isArchived ? 'SITE_ARCHIVED' : 'SITE_RESTORED',
        siteId: params.id,
        userId: session!.userId,
        afterState: { isArchived },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Invalid lifecycle action specified' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Lifecycle action failed';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_SITES',
      action: 'DELETE',
      siteId: params.id,
      resourceSiteId: params.id,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const existing = getSiteById(params.id);
    if (!existing) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Safety dependency check
    const depReport = evaluateSiteDependencies(params.id);
    if (!depReport.canDelete) {
      return NextResponse.json(
        { 
          error: depReport.blockingReason,
          isBlocked: true,
          counts: depReport.counts 
        }, 
        { status: 409 }
      );
    }

    permanentlyDeleteSite(params.id);

    logAudit({
      entityType: 'SITE',
      entityId: params.id,
      action: 'SITE_PERMANENTLY_DELETED',
      siteId: null,
      userId: session!.userId,
      beforeState: existing as unknown as Record<string, unknown>,
      afterState: null,
    });

    return NextResponse.json({ success: true, message: 'Site permanently deleted' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to permanently delete site';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
