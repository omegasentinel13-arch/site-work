import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin, validateSiteAccess } from '@/lib/auth/permissions';
import { getAllRoles, addRole, updateRole, toggleRoleActive } from '@/lib/db/repositories/role-repo';
import { toPaise } from '@/lib/domain/money';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const siteId = searchParams.get('siteId') || undefined;
  const includeInactive = searchParams.get('includeInactive') === 'true';

  if (siteId) {
    validateSiteAccess(session, siteId, 'READ');
  }

  const roles = getAllRoles(siteId, includeInactive);
  return NextResponse.json({ roles });
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
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
      action: 'CREATE',
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
    requireAdmin(session);
    const body = await req.json();
    const { id, name, defaultRateRupees, defaultRatePaise, sortOrder, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Role ID is required' }, { status: 400 });
    }

    if (name) {
      const ratePaise = defaultRatePaise !== undefined ? defaultRatePaise : toPaise(defaultRateRupees || 0);
      updateRole(id, name, ratePaise, sortOrder);
    }

    if (isActive !== undefined) {
      toggleRoleActive(id, isActive);
    }

    logAudit({
      entityType: 'ROLE',
      entityId: id,
      action: 'UPDATE',
      userId: session!.userId,
      afterState: { name, defaultRatePaise, isActive },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating role';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
