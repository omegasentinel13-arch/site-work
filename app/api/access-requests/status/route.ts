import { NextResponse } from 'next/server';
import { AccessRequestRepository } from '@/lib/db/repositories/access-request-repo';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'A valid status token is required to inspect access request state.' }, { status: 400 });
    }

    const request = AccessRequestRepository.getAccessRequestByStatusToken(token);
    if (!request) {
      return NextResponse.json({ error: 'Access request not found or status token is invalid.' }, { status: 404 });
    }

    // Return safe data only - zero passwords, zero internal hashes
    return NextResponse.json({
      id: request.id,
      requesterFullName: request.requester_full_name,
      requestedUsername: request.requested_username,
      requestedRole: request.requested_role_name_snapshot,
      status: request.status,
      createdAt: request.created_at,
      reviewedAt: request.reviewed_at,
      typicalReviewTime: '24–48 hours',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error retrieving request status';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
