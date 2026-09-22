import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { requireAdmin } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { 
  getAllCategories, 
  addCategory, 
  updateCategory, 
  toggleCategoryActive,
  archiveCategory,
  recycleCategory,
  restoreCategory,
  checkCategoryNameExists 
} from '@/lib/db/repositories/role-repo';
import { evaluateCategoryDependencies } from '@/lib/lifecycle/category-dependency';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  const access = canAccess({
    session,
    page: 'PAGE_SETUP_CATEGORIES',
    action: 'VIEW',
  });
  if (!access.allowed) {
    return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
  }

  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get('includeInactive') === 'true';
  const categories = getAllCategories(includeInactive);

  return NextResponse.json({ categories });
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_CATEGORIES',
      action: 'MANAGE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { name, sortOrder } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }

    if (checkCategoryNameExists(name)) {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 });
    }

    const id = addCategory(name, sortOrder || 0);

    logAudit({
      entityType: 'CATEGORY',
      entityId: id,
      action: 'CATEGORY_CREATED',
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
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_CATEGORIES',
      action: 'MANAGE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { id, name, sortOrder, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    if (name) {
      if (checkCategoryNameExists(name, id)) {
        return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 });
      }
      updateCategory(id, name, sortOrder);
    }

    if (isActive !== undefined) {
      toggleCategoryActive(id, isActive, session!.userId);
    }

    logAudit({
      entityType: 'CATEGORY',
      entityId: id,
      action: 'CATEGORY_UPDATED',
      userId: session!.userId,
      afterState: { name, sortOrder, isActive },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating category';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  try {
    const access = canAccess({
      session,
      page: 'PAGE_SETUP_CATEGORIES',
      action: 'MANAGE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }
    const body = await req.json();
    const { id, action, isActive } = body;

    if (!id) {
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    // Direct lifecycle action
    if (action) {
      switch (action) {
        case 'ACTIVATE':
          toggleCategoryActive(id, true, session!.userId);
          return NextResponse.json({ success: true, message: 'Category activated' });
        case 'DEACTIVATE':
          toggleCategoryActive(id, false, session!.userId);
          return NextResponse.json({ success: true, message: 'Category deactivated' });
        case 'ARCHIVE':
          archiveCategory(id, session!.userId);
          return NextResponse.json({ success: true, message: 'Category archived' });
        case 'RECYCLE': {
          const depReport = evaluateCategoryDependencies(id);
          if (!depReport.canDelete) {
            return NextResponse.json({ 
              error: depReport.blockingReason,
              isBlocked: true,
              counts: depReport.counts 
            }, { status: 409 });
          }
          recycleCategory(id, session!.userId);
          return NextResponse.json({ success: true, message: 'Category moved to Recycle Bin' });
        }
        case 'RESTORE':
        case 'RESTORE_FROM_BIN':
          restoreCategory(id, session!.userId);
          return NextResponse.json({ success: true, message: 'Category restored' });
        default:
          return NextResponse.json({ error: `Invalid lifecycle action: ${action}` }, { status: 400 });
      }
    }

    // Backwards-compatible toggle for isActive boolean
    if (typeof isActive === 'boolean') {
      toggleCategoryActive(id, isActive, session!.userId);
      return NextResponse.json({ 
        success: true, 
        message: isActive ? 'Category activated' : 'Category deactivated' 
      });
    }

    return NextResponse.json({ error: 'Either action or isActive must be provided' }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to perform category action';
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg.includes('Recycle Bin') || msg.includes('Cannot toggle') || msg.includes('depend on it')) {
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
      page: 'PAGE_SETUP_CATEGORIES',
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
      return NextResponse.json({ error: 'Category ID is required' }, { status: 400 });
    }

    const depReport = evaluateCategoryDependencies(id);
    if (!depReport.canDelete) {
      return NextResponse.json({ 
        error: depReport.blockingReason,
        isBlocked: true,
        counts: depReport.counts 
      }, { status: 409 });
    }

    recycleCategory(id, session!.userId);
    return NextResponse.json({ success: true, message: 'Category moved to Recycle Bin' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to delete category';
    if (msg.includes('not found')) {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
