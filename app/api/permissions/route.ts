import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { PermissionRepository } from '@/lib/db/repositories/permission-repo';
import { getUserById } from '@/lib/db/repositories/user-repo';
import { isSuperiorPrime, canManageAuthority } from '@/lib/auth/authority';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const targetUserId = searchParams.get('userId');

    // If targetUserId is specified and different from caller, caller must have permission to view users
    if (targetUserId && targetUserId !== session.userId) {
      const access = canAccess({
        session,
        page: 'PAGE_SETUP_USERS',
        action: 'VIEW',
      });
      if (!access.allowed) {
        return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
      }

      const targetUser = getUserById(targetUserId, null);
      if (!targetUser) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // King Maker & Superior Prime are completely invisible to lower authority tiers
      if ((targetUser.authority_tier === 'KING_MAKER' || targetUser.authority_tier === 'SUPERIOR_PRIME') &&
          session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session) && session.userId !== targetUser.id) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
      }

      // Check authority hierarchy
      if (!canManageAuthority(session, targetUser) && session.authorityTier !== 'KING_MAKER' && !isSuperiorPrime(session)) {
        return NextResponse.json({ error: 'Insufficient authority to view permissions for this user' }, { status: 403 });
      }

      const definitions = PermissionRepository.listPermissionDefinitions();
      const roleBaselines = [
        ...PermissionRepository.getRolePermissions('ADMIN'),
        ...PermissionRepository.getRolePermissions('SITE_MANAGER'),
        ...PermissionRepository.getRolePermissions('VIEWER'),
      ];
      const userOverrides = PermissionRepository.getUserOverrides(targetUserId);
      const assignedSiteIds = PermissionRepository.getUserAssignedSiteIds(targetUserId);
      const permissionVersion = PermissionRepository.getPermissionVersion(targetUserId);

      return NextResponse.json({
        definitions,
        roleBaselines,
        userOverrides,
        assignedSiteIds,
        permissionVersion,
      });
    }

    // Default: querying self or general system definitions
    const definitions = PermissionRepository.listPermissionDefinitions();
    const roleBaselines = [
      ...PermissionRepository.getRolePermissions('ADMIN'),
      ...PermissionRepository.getRolePermissions('SITE_MANAGER'),
      ...PermissionRepository.getRolePermissions('VIEWER'),
    ];
    const userOverrides = PermissionRepository.getUserOverrides(session.userId);
    const assignedSiteIds = PermissionRepository.getUserAssignedSiteIds(session.userId);
    const permissionVersion = PermissionRepository.getPermissionVersion(session.userId);

    return NextResponse.json({
      definitions,
      roleBaselines,
      userOverrides,
      assignedSiteIds,
      permissionVersion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching permissions';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
