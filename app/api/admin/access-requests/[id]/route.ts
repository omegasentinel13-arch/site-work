import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { AccessRequestRepository } from '@/lib/db/repositories/access-request-repo';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getSession();

  try {
    if (!session || !session.userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'ACCESS_REQUEST_REVIEW',
    });

    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    const requestId = params.id;
    if (!requestId) {
      return NextResponse.json({ error: 'Request ID is required' }, { status: 400 });
    }

    const result = AccessRequestRepository.deleteHistoryRecords([requestId], {
      userId: session.userId,
      role: session.role,
    });

    if (result.skippedPending.includes(requestId)) {
      return NextResponse.json(
        { error: 'Cannot delete pending access requests. Requests must be reviewed or cancelled first.' },
        { status: 400 }
      );
    }

    if (result.notFound.includes(requestId)) {
      return NextResponse.json({ error: 'Access request not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: `Historical access request ${requestId} deleted successfully.`,
      deletedId: requestId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error deleting access request';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
