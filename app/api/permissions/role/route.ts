import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { PermissionRepository } from '@/lib/db/repositories/permission-repo';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { isPrimeAuthority } from '@/lib/auth/authority';
import { RoleScopeType } from '@/lib/permissions/registry';
import { logAudit } from '@/lib/audit/logger';

const VALID_ROLES = new Set(['ADMIN', 'SITE_MANAGER', 'VIEWER']);
const VALID_SCOPES = new Set<RoleScopeType>(['GLOBAL', 'ASSIGNED_SITES', 'SPECIFIC_SITE']);

async function handleRolePermissionMutation(req: Request) {
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

    // Only Primes or authorized admins can modify role baselines
    if (!isPrimeAuthority(session)) {
      return NextResponse.json({ error: 'Role baseline modifications require Prime authority' }, { status: 403 });
    }

    const body = await req.json();
    const { role, permissionId, scopeType, siteId } = body;

    if (!role || !VALID_ROLES.has(role)) {
      return NextResponse.json({ error: `Invalid role: ${role}. Expected ADMIN, SITE_MANAGER, or VIEWER` }, { status: 400 });
    }

    if (!permissionId || typeof permissionId !== 'string') {
      return NextResponse.json({ error: 'Valid permissionId is required' }, { status: 400 });
    }

    if (!scopeType || !VALID_SCOPES.has(scopeType)) {
      return NextResponse.json({ error: `Invalid scope: ${scopeType}. Expected GLOBAL, ASSIGNED_SITES, or SPECIFIC_SITE` }, { status: 400 });
    }

    const permDef = PermissionRepository.getPermissionDefinition(permissionId);
    if (!permDef) {
      return NextResponse.json({ error: `Unknown permission ID: ${permissionId}` }, { status: 400 });
    }

    // Scope rules
    const normalizedSiteId = siteId && siteId.trim() !== '' ? siteId.trim() : null;

    if (scopeType === 'SPECIFIC_SITE') {
      if (!normalizedSiteId) {
        return NextResponse.json({ error: 'SPECIFIC_SITE scope requires a valid siteId' }, { status: 400 });
      }
      const site = getSiteById(normalizedSiteId);
      if (!site) {
        return NextResponse.json({ error: `Site not found: ${normalizedSiteId}` }, { status: 404 });
      }
    } else {
      if (normalizedSiteId !== null) {
        return NextResponse.json({ error: `${scopeType} scope cannot specify a siteId` }, { status: 400 });
      }
    }

    if (permDef.is_site_scoped === 0 && scopeType !== 'GLOBAL') {
      return NextResponse.json({ error: `Permission '${permissionId}' is global and can only have scope_type 'GLOBAL'` }, { status: 400 });
    }

    const id = PermissionRepository.setRolePermission({
      role,
      permissionId,
      scopeType,
      siteId: normalizedSiteId,
    });

    logAudit({
      entityType: 'ROLE',
      entityId: permissionId,
      action: 'ROLE_PERMISSION_CHANGED',
      siteId: normalizedSiteId,
      userId: session.userId,
      afterState: {
        id,
        role,
        permissionId,
        scopeType,
        siteId: normalizedSiteId,
        updatedBy: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      id,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error setting role permission baseline';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  return handleRolePermissionMutation(req);
}

export async function PATCH(req: Request) {
  return handleRolePermissionMutation(req);
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

    if (!isPrimeAuthority(session)) {
      return NextResponse.json({ error: 'Role baseline modifications require Prime authority' }, { status: 403 });
    }

    let role: string | null = null;
    let permissionId: string | null = null;
    let scopeType: RoleScopeType | undefined;
    let siteId: string | null = null;

    if (req.headers.get('content-type')?.includes('application/json')) {
      const body = await req.json();
      role = body.role;
      permissionId = body.permissionId;
      scopeType = body.scopeType;
      siteId = body.siteId || null;
    } else {
      const { searchParams } = new URL(req.url);
      role = searchParams.get('role');
      permissionId = searchParams.get('permissionId');
      scopeType = (searchParams.get('scopeType') as RoleScopeType) || undefined;
      siteId = searchParams.get('siteId') || null;
    }

    if (!role || !VALID_ROLES.has(role)) {
      return NextResponse.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }

    if (!permissionId) {
      return NextResponse.json({ error: 'permissionId is required' }, { status: 400 });
    }

    const permDef = PermissionRepository.getPermissionDefinition(permissionId);
    if (!permDef) {
      return NextResponse.json({ error: `Unknown permission ID: ${permissionId}` }, { status: 400 });
    }

    const normalizedSiteId = siteId && siteId.trim() !== '' ? siteId.trim() : null;

    const removed = PermissionRepository.removeRolePermission({
      role,
      permissionId,
      scopeType,
      siteId: normalizedSiteId,
    });

    logAudit({
      entityType: 'ROLE',
      entityId: permissionId,
      action: 'ROLE_PERMISSION_CHANGED',
      siteId: normalizedSiteId,
      userId: session.userId,
      afterState: {
        role,
        permissionId,
        scopeType,
        siteId: normalizedSiteId,
        removed: true,
        removedBy: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      removed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error removing role baseline permission';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
