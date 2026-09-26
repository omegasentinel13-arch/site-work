import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { AccessRequestRepository } from '@/lib/db/repositories/access-request-repo';

export async function POST(
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

    let siteIds: string[] | undefined;
    let reviewReason: string | undefined;

    try {
      const body = await req.json();
      if (body) {
        if (Array.isArray(body.siteIds)) {
          siteIds = body.siteIds;
        }
        if (typeof body.reviewReason === 'string') {
          reviewReason = body.reviewReason.trim();
        }
      }
    } catch {
      // Body is optional
    }

    const result = AccessRequestRepository.approveAccessRequest(
      requestId,
      {
        userId: session.userId,
        role: session.role,
        authorityTier: session.authorityTier,
      },
      { siteIds, reviewReason }
    );

    return NextResponse.json({
      success: true,
      message: `Access request approved successfully. User account '@${result.user.username}' has been created.`,
      user: result.user,
      request: {
        id: result.request.id,
        status: result.request.status,
        reviewedAt: result.request.reviewed_at,
        reviewedBy: result.request.reviewed_by,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error approving access request';
    const isConflict =
      errorMsg.includes('already been processed') ||
      errorMsg.includes('already taken') ||
      errorMsg.includes('already linked');

    return NextResponse.json({ error: errorMsg }, { status: isConflict ? 409 : 400 });
  }
}
