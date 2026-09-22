import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess, CanAccessSession } from '@/lib/permissions/evaluator';
import { REGISTERED_PAGES, PageId, ActionId } from '@/lib/permissions/registry';
import { getUserById } from '@/lib/db/repositories/user-repo';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { PermissionRepository } from '@/lib/db/repositories/permission-repo';
import { isSuperiorPrime, canManageAuthority } from '@/lib/auth/authority';

const VALID_ACTIONS = new Set<string>([
  'VIEW',
  'CREATE',
  'EDIT',
  'DELETE',
  'EXPORT',
  'MANAGE',
  'RESTORE',
  'ARCHIVE',
  'RECYCLE',
  'PERMANENT_DELETE',
  'ASSIGN_SITE',
  'MANAGE_PERMISSIONS',
  'MANAGE_USERS',
  'RESET_PASSWORD',
  'CHANGE_USERNAME',
  'CHANGE_RECOVERY',
]);

export async function GET(req: Request) {
  const session = await getSession();
  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const page = searchParams.get('page');
    const action = searchParams.get('action');
    const siteId = searchParams.get('siteId') || searchParams.get('site') || null;
    const targetUserId = searchParams.get('userId') || session.userId;

    if (!page || !action) {
      return NextResponse.json({ error: 'page and action query parameters are required' }, { status: 400 });
    }

    if (!REGISTERED_PAGES[page as PageId]) {
      return NextResponse.json({ error: `Invalid page: ${page}` }, { status: 400 });
    }

    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json({ error: `Invalid action: ${action}` }, { status: 400 });
    }

    if (siteId && siteId.trim() !== '') {
      const site = getSiteById(siteId);
      if (!site) {
        return NextResponse.json({ error: `Site not found: ${siteId}` }, { status: 404 });
      }
    }

    // Resolve target principal
    let targetPrincipal: CanAccessSession = {
      userId: session.userId,
      role: session.role,
      authorityTier: session.authorityTier,
      isActive: true,
    };

    if (targetUserId !== session.userId) {
      const viewAccess = canAccess({
        session,
        page: 'PAGE_SETUP_USERS',
        action: 'VIEW',
      });
      if (!viewAccess.allowed) {
        return NextResponse.json({ error: viewAccess.reason }, { status: 403 });
      }

      const targetDbUser = getUserById(targetUserId, null);
      if (!targetDbUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      if ((targetDbUser.authority_tier === 'KING_MAKER' || targetDbUser.authority_tier === 'SUPERIOR_PRIME') &&
          session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      if (!canManageAuthority(session, targetDbUser) && session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
        return NextResponse.json({ error: 'Insufficient authority to inspect effective permissions for this user' }, { status: 403 });
      }

      targetPrincipal = {
        userId: targetDbUser.id,
        role: targetDbUser.role,
        authorityTier: targetDbUser.authority_tier,
        isActive: targetDbUser.is_active === 1,
      };
    }

    const decision = canAccess({
      session: {
        userId: targetPrincipal.userId,
        role: targetPrincipal.role,
        authorityTier: targetPrincipal.authorityTier,
        isActive: targetPrincipal.isActive !== false,
        assignedSiteIds: PermissionRepository.getUserAssignedSiteIds(targetPrincipal.userId!),
      },
      page: page as PageId,
      action: action as ActionId,
      siteId: siteId || undefined,
      resourceSiteId: siteId || undefined,
    });

    return NextResponse.json({
      userId: targetPrincipal.userId,
      page,
      action,
      siteId: siteId || null,
      allowed: decision.allowed,
      reason: decision.reason,
      ruleSource: decision.ruleSource,
      effectiveSiteId: decision.effectiveSiteId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error evaluating effective permissions';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
