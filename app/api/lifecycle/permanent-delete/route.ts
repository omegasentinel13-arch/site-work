import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { 
  executePermanentDelete, 
  PermanentDeleteConflictError, 
  PermanentDeleteNotFoundError 
} from '@/lib/lifecycle/permanent-delete-engine';

export async function POST(req: Request) {
  const session = await getSession();
  const access = canAccess({
    session,
    page: 'PAGE_GLOBAL_RECYCLE_BIN',
    action: 'PERMANENT_DELETE',
  });
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.reason },
      { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 }
    );
  }

  try {
    const body = await req.json();
    const { entityType, entityId, reason } = body;

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: 'entityType and entityId are required' },
        { status: 400 }
      );
    }

    const result = executePermanentDelete(
      entityType,
      entityId,
      session!.userId || 'system',
      reason
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof PermanentDeleteNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof PermanentDeleteConflictError) {
      return NextResponse.json({ error: err.message, isBlocked: true }, { status: 409 });
    }
    const msg = err instanceof Error ? err.message : 'Permanent deletion failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  return POST(req);
}
