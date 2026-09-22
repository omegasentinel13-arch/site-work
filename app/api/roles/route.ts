import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin, validateSiteAccess } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { 
  getAllRoles, 
  addRole, 
  updateRole, 
  toggleRoleActive,
  archiveRole,
  recycleRole,
  restoreRole 
} from '@/lib/db/repositories/role-repo';
import { toPaise } from '@/lib/domain/money';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('siteId') || undefined;
  const includeInactive = searchParams.get('includeInactive') === 'true';

  const access = canAccess({
    session,
    page: 'PAGE_SETUP_ROLES',
    action: 'VIEW',
    siteId,
  });
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
  }

  const roles = getAllRoles(siteId, includeInactive);
  return NextResponse.json({ roles });
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_ROLES',
      action: 'MANAGE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { categoryId, name, defaultRateRupees, defaultRatePaise, sortOrder } = body;

    if (!categoryId || !name || !name.trim()) {
      return NextResponse.json({ error: 'Category and role name are required' }, { status: 400 });
    }

    const ratePaise = defaultRatePaise !== undefined ? defaultRatePaise : toPaise(defaultRateRupees || 0);
    const roleId = addRole(categoryId, name, ratePaise, sortOrder || 0);

    logAudit({
      entityType: 'ROLE',
      entityId: roleId,
      action: 'ROLE_CREATED',
      userId: session!.userId,
      afterState: { categoryId, name, ratePaise },
    });

    return NextResponse.json({ success: true, roleId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error creating role';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_ROLES',
      action: 'MANAGE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { id, name, categoryId, defaultRateRupees, defaultRatePaise, sortOrder, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    if (name) {
      const ratePaise = defaultRatePaise !== undefined ? defaultRatePaise : toPaise(defaultRateRupees || 0);
      updateRole(id, name, ratePaise, sortOrder, categoryId);
    }

    if (isActive !== undefined) {
      toggleRoleActive(id, isActive, session!.userId);
    }

    logAudit({
      entityType: 'ROLE',
      entityId: id,
      action: 'ROLE_UPDATED',
      userId: session!.userId,
      afterState: { name, defaultRatePaise, isActive },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating role';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_ROLES',
      action: 'MANAGE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { id, action, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    // Direct lifecycle action
    if (action) {
      switch (action) {
        case 'ACTIVATE':
          toggleRoleActive(id, true, session!.userId);
          return NextResponse.json({ success: true, message: 'Role activated' });
        case 'DEACTIVATE':
          toggleRoleActive(id, false, session!.userId);
          return NextResponse.json({ success: true, message: 'Role deactivated' });
        case 'ARCHIVE':
          archiveRole(id, session!.userId);
          return NextResponse.json({ success: true, message: 'Role archived' });
        case 'RECYCLE':
          recycleRole(id, session!.userId);
          return NextResponse.json({ success: true, message: 'Role moved to Recycle Bin' });
        case 'RESTORE':
        case 'RESTORE_FROM_BIN':
          restoreRole(id, session!.userId);
          return NextResponse.json({ success: true, message: 'Role restored' });
        default:
          return NextResponse.json({ error: `Invalid lifecycle action: ${action}` }, { status: 400 });
      }
    }

    // Backwards-compatible toggle for isActive boolean
    if (typeof isActive === 'boolean') {
      toggleRoleActive(id, isActive, session!.userId);
      return NextResponse.json({ 
        success: true, 
        message: isActive ? 'Role activated' : 'Role deactivated' 
      });
    }

    return NextResponse.json({ error: 'Either action or isActive must be provided' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to perform role action';
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes('Recycle Bin') || msg.includes('Cannot toggle')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_ROLES',
      action: 'MANAGE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    let id: string | null = null;
    const { searchParams } = new URL(req.url);
    id = searchParams.get('id');
    if (!id) {
      try {
        const body = await req.json();
        id = body?.id || null;
      } catch {
        // body may be empty
      }
    }

    if (!id) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    recycleRole(id, session!.userId);
    return NextResponse.json({ success: true, message: 'Role moved to Recycle Bin' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to delete role';
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
