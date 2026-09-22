import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { getGlobalRecycledItems, toggleLifecycleKeepPermanently } from '@/lib/db/repositories/global-lifecycle-repo';
import { evaluateCategoryDependencies } from '@/lib/lifecycle/category-dependency';
import { evaluateRoleDependencies } from '@/lib/lifecycle/role-dependency';
import { evaluateSiteDependencies } from '@/lib/lifecycle/site-dependency';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  const access = canAccess({
    session,
    page: 'PAGE_GLOBAL_RECYCLE_BIN',
    action: 'VIEW',
  });
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType') || undefined;
    const search = searchParams.get('search') || undefined;

    const rawItems = getGlobalRecycledItems(entityType, search);

    const items = rawItems.map((item) => {
      let canPermanentlyDelete = true;
      let blockingReason: string | null = null;
      try {
        const type = item.entity_type.toUpperCase().trim();
        if (type === 'WORK_CATEGORY' || type === 'CATEGORY') {
          const dep = evaluateCategoryDependencies(item.entity_id);
          canPermanentlyDelete = dep.canDelete;
          blockingReason = dep.blockingReason || null;
        } else if (type === 'WORK_ROLE' || type === 'ROLE') {
          const dep = evaluateRoleDependencies(item.entity_id);
          canPermanentlyDelete = dep.canDelete;
          blockingReason = dep.blockingReason || null;
        } else if (type === 'SITE') {
          const dep = evaluateSiteDependencies(item.entity_id);
          canPermanentlyDelete = dep.canDelete;
          blockingReason = dep.blockingReason || null;
        }
      } catch {
        canPermanentlyDelete = false;
        blockingReason = 'Error evaluating dependencies';
      }
      return {
        ...item,
        canPermanentlyDelete,
        blockingReason,
      };
    });

    return NextResponse.json({ items });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching recycled items';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  const access = canAccess({
    session,
    page: 'PAGE_GLOBAL_RECYCLE_BIN',
    action: 'RESTORE',
  });
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 }
    );
  }

  try {
    const body = await req.json();
    const { id, keep } = body;

    if (!id) {
      return NextResponse.json({ error: 'Record ID is required' }, { status: 400 });
    }

    toggleLifecycleKeepPermanently(id, Boolean(keep));

    logAudit({
      entityType: 'LIFECYCLE',
      entityId: id,
      action: 'SITE_KEEP_PERMANENTLY_TOGGLED',
      userId: session!.userId,
      afterState: { keep_permanently: Boolean(keep) ? 1 : 0 },
    });

    return NextResponse.json({ success: true, keepPermanently: Boolean(keep) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update retention policy';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
