import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/permissions';
import { getAllCategories, addCategory, updateCategory, toggleCategoryActive } from '@/lib/db/repositories/role-repo';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const categories = getAllCategories(includeInactive);

  return NextResponse.json({ categories });
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { name, sortOrder } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }

    const id = addCategory(name, sortOrder || 0);

    logAudit({
      entityType: 'ROLE',
      entityId: id,
      action: 'CREATE',
      userId: session!.userId,
      afterState: { categoryName: name },
    });

    return NextResponse.json({ success: true, categoryId: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error creating category';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function PUT(req: Request) {
  const session = await getSession();
  try {
    requireAdmin(session);
    const body = await req.json();
    const { id, name, sortOrder, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    if (name) {
      updateCategory(id, name, sortOrder);
    }

    if (isActive !== undefined) {
      toggleCategoryActive(id, isActive);
    }

    logAudit({
      entityType: 'ROLE',
      entityId: id,
      action: 'UPDATE',
      userId: session!.userId,
      afterState: { name, sortOrder, isActive },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating category';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
