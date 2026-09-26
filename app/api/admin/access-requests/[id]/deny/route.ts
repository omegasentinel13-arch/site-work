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

    let denialReason: string | undefined;

    try {
      const body = await req.json();
      if (body && typeof body.reason === 'string') {
        denialReason = body.reason.trim();
      }
    } catch {
      // Reason is optional
    }

    const request = AccessRequestRepository.denyAccessRequest(
      requestId,
      {
        userId: session.userId,
        role: session.role,
        authorityTier: session.authorityTier,
      },
      denialReason
    );

    return NextResponse.json({
      success: true,
      message: 'Access request has been denied.',
      request: {
        id: request.id,
        status: request.status,
        reviewedAt: request.reviewed_at,
        reviewedBy: request.reviewed_by,
        denialReason: request.denial_reason,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Error denying access request';
    const isConflict = errorMsg.includes('already been processed');
    return NextResponse.json({ error: errorMsg }, { status: isConflict ? 409 : 400 });
  }
}
