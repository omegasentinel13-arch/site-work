import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { AccessRequestRepository } from '@/lib/db/repositories/access-request-repo';

export async function POST(req: Request) {
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

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request payload' }, { status: 400 });
    }

    const { action, requestIds, siteIds, reviewReason, reason } = body || {};

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json(
        { error: 'requestIds must be a non-empty array of access request IDs' },
        { status: 400 }
      );
    }

    if (requestIds.length > 100) {
      return NextResponse.json(
        { error: 'Cannot process more than 100 requests in a single bulk operation' },
        { status: 400 }
      );
    }

    const reviewer = {
      userId: session.userId,
      role: session.role,
      authorityTier: session.authorityTier,
    };

    if (action === 'APPROVE') {
      const validSiteIds = Array.isArray(siteIds) ? siteIds : undefined;
      const note = typeof reviewReason === 'string' ? reviewReason.trim() : undefined;

      const result = AccessRequestRepository.bulkApprove(requestIds, reviewer, {
        siteIds: validSiteIds,
        reviewReason: note,
      });

      return NextResponse.json({
        success: true,
        action: 'APPROVE',
        succeeded: result.succeeded,
        failed: result.failed,
        total: requestIds.length,
        succeededCount: result.succeeded.length,
        failedCount: result.failed.length,
      });
    } else if (action === 'DENY') {
      const denialReason = typeof reason === 'string' ? reason.trim() : undefined;

      const result = AccessRequestRepository.bulkDeny(requestIds, reviewer, denialReason);

      return NextResponse.json({
        success: true,
        action: 'DENY',
        succeeded: result.succeeded,
        failed: result.failed,
        total: requestIds.length,
        succeededCount: result.succeeded.length,
        failedCount: result.failed.length,
      });
    } else {
      return NextResponse.json(
        { error: "Invalid action. Supported actions are 'APPROVE' and 'DENY'" },
        { status: 400 }
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error executing bulk operation';
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
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'ACCESS_REQUEST_REVIEW',
    });

    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: 403 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request payload' }, { status: 400 });
    }

    const { requestIds } = body || {};

    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return NextResponse.json(
        { error: 'requestIds must be a non-empty array of access request IDs to delete' },
        { status: 400 }
      );
    }

    const result = AccessRequestRepository.deleteHistoryRecords(requestIds, {
      userId: session.userId,
      role: session.role,
    });

    return NextResponse.json({
      success: true,
      deleted: result.deleted,
      skippedPending: result.skippedPending,
      notFound: result.notFound,
      deletedCount: result.deleted.length,
      message: `Successfully deleted ${result.deleted.length} historical record(s).${
        result.skippedPending.length > 0 ? ` ${result.skippedPending.length} pending request(s) were protected from deletion.` : ''
      }`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error deleting history records';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
