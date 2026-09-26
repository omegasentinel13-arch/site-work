import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { PermissionRepository } from '@/lib/db/repositories/permission-repo';
import { getUserById } from '@/lib/db/repositories/user-repo';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { isSuperiorPrime, canManageAuthority } from '@/lib/auth/authority';
import { logAudit } from '@/lib/audit/logger';

import { getDb, runTransaction } from '@/lib/db';

async function handleUserOverrideMutation(req: Request) {
  const session = await getSession();
  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_SETUP_USERS',
      action: 'MANAGE_PERMISSIONS',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    const body = await req.json();

    // ------------------------------------------------------------------------
    // BATCH MUTATION SUPPORT: { userId, changes: Array<{ permissionId, effect, siteId? }> }
    // ------------------------------------------------------------------------
    if (body.changes && Array.isArray(body.changes)) {
      const { userId, changes } = body;
      if (!userId || typeof userId !== 'string') {
        return NextResponse.json({ error: 'Valid userId is required' }, { status: 400 });
      }

      if (userId === session.userId) {
        return NextResponse.json({ error: 'Administrators cannot modify their own permission overrides (Self-modification prevented).' }, { status: 403 });
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
        return NextResponse.json({ error: 'Insufficient authority to configure permissions for this user' }, { status: 403 });
      }

      // Check if changes include ACCESS_REQUEST_REVIEW
      const hasAccessReview = changes.some((c: any) => {
        const pDef = PermissionRepository.getPermissionDefinition(c.permissionId);
        return pDef && (pDef.action_id === 'ACCESS_REQUEST_REVIEW' || pDef.page_id === 'PAGE_ACCESS_REQUESTS');
      });
      if (hasAccessReview && session.authorityTier !== 'KING_MAKER' && session.authorityTier !== 'SUPERIOR_PRIME' && session.authorityTier !== 'CLIENT_PRIME') {
        return NextResponse.json({ error: 'Only Prime Administrators can grant or delegate Access Request Review permissions.' }, { status: 403 });
      }

      const { appliedCount, newVersion } = PermissionRepository.setUserOverridesBatch({
        userId,
        changes,
        grantedBy: session.userId,
      });

      logAudit({
        entityType: 'PERMISSION',
        entityId: userId,
        action: 'PERMISSIONS_BATCH_UPDATED',
        userId: targetUser.id,
        afterState: {
          userId,
          appliedChangesCount: appliedCount,
          updatedBy: session.userId,
          permissionVersion: newVersion,
        },
      });

      return NextResponse.json({
        success: true,
        permissionVersion: newVersion,
      });
    }

    const { userId, permissionId, siteId, effect } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'Valid userId is required' }, { status: 400 });
    }

    if (userId === session.userId) {
      return NextResponse.json({ error: 'Administrators cannot modify their own permission overrides (Self-modification prevented).' }, { status: 403 });
    }

    if (!permissionId || typeof permissionId !== 'string') {
      return NextResponse.json({ error: 'Valid permissionId is required' }, { status: 400 });
    }

    if (effect !== 'ALLOW' && effect !== 'DENY') {
      return NextResponse.json({ error: "effect must be 'ALLOW' or 'DENY'" }, { status: 400 });
    }

    // 1. User validation
    const targetUser = getUserById(userId, null);
    if (!targetUser) {
      return NextResponse.json({ error: `User not found: ${userId}` }, { status: 404 });
    }

    // King Maker & Superior Prime protection
    if ((targetUser.authority_tier === 'KING_MAKER' || targetUser.authority_tier === 'SUPERIOR_PRIME') &&
        session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Authority hierarchy validation
    if (!canManageAuthority(session, targetUser) && session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
      return NextResponse.json({ error: 'Insufficient authority to configure permissions for this user' }, { status: 403 });
    }

    // 2. Permission validation
    const permDef = PermissionRepository.getPermissionDefinition(permissionId);
    if (!permDef) {
      return NextResponse.json({ error: `Unknown permission ID: ${permissionId}` }, { status: 400 });
    }

    if ((permDef.action_id === 'ACCESS_REQUEST_REVIEW' || permDef.page_id === 'PAGE_ACCESS_REQUESTS') &&
        session.authorityTier !== 'KING_MAKER' && session.authorityTier !== 'SUPERIOR_PRIME' && session.authorityTier !== 'CLIENT_PRIME') {
      return NextResponse.json({ error: 'Only Prime Administrators can grant or delegate Access Request Review permissions.' }, { status: 403 });
    }

    // 3. Scope validation
    const normalizedSiteId = siteId && siteId.trim() !== '' ? siteId.trim() : null;

    if (permDef.is_site_scoped === 0 && normalizedSiteId !== null) {
      return NextResponse.json({ error: `Permission '${permissionId}' is global and cannot be scoped to a site` }, { status: 400 });
    }

    if (normalizedSiteId !== null) {
      const site = getSiteById(normalizedSiteId);
      if (!site) {
        return NextResponse.json({ error: `Site not found: ${normalizedSiteId}` }, { status: 404 });
      }
    }

    // 4. Save override
    const overrideId = PermissionRepository.setUserOverride({
      userId,
      permissionId,
      siteId: normalizedSiteId,
      effect,
      grantedBy: session.userId,
    });

    const newVersion = PermissionRepository.getPermissionVersion(userId);

    // 5. Audit log
    logAudit({
      entityType: 'PERMISSION',
      entityId: permissionId,
      action: effect === 'ALLOW' ? 'PERMISSION_GRANTED' : 'PERMISSION_DENIED',
      siteId: normalizedSiteId,
      userId: targetUser.id,
      afterState: {
        userId,
        permissionId,
        siteId: normalizedSiteId,
        effect,
        grantedBy: session.userId,
        permissionVersion: newVersion,
      },
    });

    return NextResponse.json({
      success: true,
      id: overrideId,
      permissionVersion: newVersion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error setting user permission override';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return handleUserOverrideMutation(req);
}

export async function PUT(req: Request) {
  return handleUserOverrideMutation(req);
}

export async function PATCH(req: Request) {
  return handleUserOverrideMutation(req);
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
      action: 'MANAGE_PERMISSIONS',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    let userId: string | null = null;
    let permissionId: string | null = null;
    let siteId: string | null = null;

    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json();
      userId = body.userId;
      permissionId = body.permissionId;
      siteId = body.siteId || null;
    } else {
      const { searchParams } = new URL(req.url);
      userId = searchParams.get('userId');
      permissionId = searchParams.get('permissionId');
      siteId = searchParams.get('siteId') || null;
    }

    if (!userId || !permissionId) {
      return NextResponse.json({ error: 'userId and permissionId are required' }, { status: 400 });
    }

    if (userId === session.userId) {
      return NextResponse.json({ error: 'Administrators cannot modify their own permission overrides (Self-modification prevented).' }, { status: 403 });
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
      return NextResponse.json({ error: 'Insufficient authority to remove permissions for this user' }, { status: 403 });
    }

    const permDef = PermissionRepository.getPermissionDefinition(permissionId);
    if (!permDef) {
      return NextResponse.json({ error: `Unknown permission ID: ${permissionId}` }, { status: 400 });
    }

    if ((permDef.action_id === 'ACCESS_REQUEST_REVIEW' || permDef.page_id === 'PAGE_ACCESS_REQUESTS') &&
        session.authorityTier !== 'KING_MAKER' && session.authorityTier !== 'SUPERIOR_PRIME' && session.authorityTier !== 'CLIENT_PRIME') {
      return NextResponse.json({ error: 'Only Prime Administrators can modify Access Request Review permissions.' }, { status: 403 });
    }

    const normalizedSiteId = siteId && siteId.trim() !== '' ? siteId.trim() : null;

    const removed = PermissionRepository.removeUserOverride(userId, permissionId, normalizedSiteId);
    const newVersion = PermissionRepository.getPermissionVersion(userId);

    logAudit({
      entityType: 'PERMISSION',
      entityId: permissionId,
      action: 'PERMISSION_REMOVED',
      siteId: normalizedSiteId,
      userId: targetUser.id,
      afterState: {
        userId,
        permissionId,
        siteId: normalizedSiteId,
        removedBy: session.userId,
        permissionVersion: newVersion,
        wasFound: removed,
      },
    });

    return NextResponse.json({
      success: true,
      removed,
      permissionVersion: newVersion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error removing user permission override';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
