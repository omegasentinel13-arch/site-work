import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { PermissionRepository } from '@/lib/db/repositories/permission-repo';
import { getUserById } from '@/lib/db/repositories/user-repo';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { isSuperiorPrime, canManageAuthority } from '@/lib/auth/authority';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get('userId') || session.userId;

    if (targetUserId !== session.userId) {
      const access = canAccess({
        session,
        page: 'PAGE_SETUP_USERS',
        action: 'VIEW',
      });
      if (!access.allowed) {
        return NextResponse.json({ error: access.reason }, { status: 403 });
      }

      const targetUser = getUserById(targetUserId, null);
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      if ((targetUser.authority_tier === 'KING_MAKER' || targetUser.authority_tier === 'SUPERIOR_PRIME') &&
          session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      if (!canManageAuthority(session, targetUser) && session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
        return NextResponse.json({ error: 'Insufficient authority' }, { status: 403 });
      }
    }

    const assignedSiteIds = PermissionRepository.getUserAssignedSiteIds(targetUserId);
    return NextResponse.json({
      userId: targetUserId,
      assignedSiteIds,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching site assignments';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'ASSIGN_SITE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    const body = await req.json();
    const { userId, siteId } = body;

    if (!userId || !siteId) {
      return NextResponse.json({ error: 'userId and siteId are required' }, { status: 400 });
    }

    const targetUser = getUserById(userId, null);
    if (!targetUser) {
      return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 });
    }

    if ((targetUser.authority_tier === 'KING_MAKER' || targetUser.authority_tier === 'SUPERIOR_PRIME') &&
        session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!canManageAuthority(session, targetUser) && session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'Insufficient authority to assign sites to this user' }, { status: 403 });
    }

    const site = getSiteById(siteId);
    if (!site) {
      return NextResponse.json({ error: `Site not found: ${siteId}` }, { status: 404 });
    }

    // Canonical site assignment into site_users table
    PermissionRepository.assignUserToSite(userId, siteId);
    const assignedSiteIds = PermissionRepository.getUserAssignedSiteIds(userId);
    const permissionVersion = PermissionRepository.getPermissionVersion(userId);

    logAudit({
      entityType: 'SITE',
      entityId: siteId,
      action: 'SITE_ACCESS_CHANGED',
      siteId,
      userId: targetUser.id,
      afterState: {
        action: 'ASSIGNED',
        userId,
        siteId,
        assignedBy: session.userId,
        permissionVersion,
      },
    });

    return NextResponse.json({
      success: true,
      assignedSiteIds,
      permissionVersion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error assigning user to site';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'ASSIGN_SITE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    let userId: string | null = null;
    let siteId: string | null = null;

    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json();
      userId = body.userId;
      siteId = body.siteId;
    } else {
      const { searchParams } = new URL(req.url);
      userId = searchParams.get('userId');
      siteId = searchParams.get('siteId');
    }

    if (!userId || !siteId) {
      return NextResponse.json({ error: 'userId and siteId are required' }, { status: 400 });
    }

    const targetUser = getUserById(userId, null);
    if (!targetUser) {
      return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 });
    }

    if ((targetUser.authority_tier === 'KING_MAKER' || targetUser.authority_tier === 'SUPERIOR_PRIME') &&
        session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!canManageAuthority(session, targetUser) && session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'Insufficient authority to remove site assignment for this user' }, { status: 403 });
    }

    const site = getSiteById(siteId);
    if (!site) {
      return NextResponse.json({ error: `Site not found: ${siteId}` }, { status: 404 });
    }

    // Canonical site assignment removal from site_users table
    const removed = PermissionRepository.removeUserFromSite(userId, siteId);
    const assignedSiteIds = PermissionRepository.getUserAssignedSiteIds(userId);
    const permissionVersion = PermissionRepository.getPermissionVersion(userId);

    logAudit({
      entityType: 'SITE',
      entityId: siteId,
      action: 'SITE_ACCESS_CHANGED',
      siteId,
      userId: targetUser.id,
      afterState: {
        action: 'REMOVED',
        userId,
        siteId,
        removedBy: session.userId,
        permissionVersion,
        wasFound: removed,
      },
    });

    return NextResponse.json({
      success: true,
      removed,
      assignedSiteIds,
      permissionVersion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error removing user from site';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'ASSIGN_SITE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    const body = await req.json();
    const { userId, siteIds, allSites } = body;

    if (!userId || !Array.isArray(siteIds)) {
      return NextResponse.json({ error: 'userId and siteIds array are required' }, { status: 400 });
    }

    const targetUser = getUserById(userId, null);
    if (!targetUser) {
      return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 });
    }

    if ((targetUser.authority_tier === 'KING_MAKER' || targetUser.authority_tier === 'SUPERIOR_PRIME') &&
        session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (!canManageAuthority(session, targetUser) && session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'Insufficient authority to assign sites to this user' }, { status: 403 });
    }

    // Atomically set site assignments in site_users table
    const assignedSiteIds = PermissionRepository.setUserSites(userId, siteIds);
    const permissionVersion = PermissionRepository.getPermissionVersion(userId);

    logAudit({
      entityType: 'SITE',
      entityId: userId,
      action: 'SITE_ACCESS_CHANGED',
      userId: targetUser.id,
      afterState: {
        action: 'SITE_ACCESS_UPDATED',
        userId,
        assignedSiteIds,
        allSites: Boolean(allSites),
        assignedBy: session.userId,
        permissionVersion,
      },
    });

    return NextResponse.json({
      success: true,
      assignedSiteIds,
      permissionVersion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating site assignments';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
