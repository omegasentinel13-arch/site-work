import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { AccessRequestRepository, AccessRequestStatus } from '@/lib/db/repositories/access-request-repo';
import { getAllSites } from '@/lib/db/repositories/site-repo';

export async function GET(req: Request) {
  const session = await getSession();

  try {
    const access = canAccess({
      session,
      page: 'PAGE_ACCESS_REQUESTS',
      action: 'VIEW',
    });

    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason },
        { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const statusParam = searchParams.get('status');

    // Single request detail lookup
    if (id) {
      const request = AccessRequestRepository.getAccessRequestById(id);
      if (!request) {
        return NextResponse.json({ error: 'Access request not found' }, { status: 404 });
      }

      const notifications = AccessRequestRepository.getNotificationsForRequest(id);
      const sites = getAllSites(false);

      // Never expose password_hash or raw status_token_hash to admin UI
      return NextResponse.json({
        request: {
          id: request.id,
          requesterFullName: request.requester_full_name,
          requestedUsername: request.requested_username,
          requestedEmail: request.requested_email,
          requestedRoleId: request.requested_role_id,
          requestedRoleName: request.requested_role_name_snapshot,
          status: request.status,
          createdAt: request.created_at,
          updatedAt: request.updated_at,
          reviewedAt: request.reviewed_at,
          reviewedBy: request.reviewed_by,
          reviewerRole: request.reviewer_role,
          reviewReason: request.review_reason,
          denialReason: request.denial_reason,
          approvalTimestamp: request.approval_timestamp,
          metadata: request.request_metadata ? JSON.parse(request.request_metadata) : null,
        },
        notifications,
        availableSites: sites.map((s) => ({ id: s.id, name: s.name, code: s.code })),
      });
    }

    // List of requests
    let filterStatus: AccessRequestStatus | undefined;
    if (statusParam && statusParam !== 'ALL') {
      filterStatus = statusParam as AccessRequestStatus;
    }

    const requests = AccessRequestRepository.listAccessRequests(
      filterStatus ? { status: filterStatus } : undefined
    );

    const pendingCount = AccessRequestRepository.countPendingRequests();
    const approvers = AccessRequestRepository.resolveAccessRequestApprovers();

    const sanitizedRequests = requests.map((r) => ({
      id: r.id,
      requesterFullName: r.requester_full_name,
      requestedUsername: r.requested_username,
      requestedEmail: r.requested_email,
      requestedRoleId: r.requested_role_id,
      requestedRoleName: r.requested_role_name_snapshot,
      status: r.status,
      createdAt: r.created_at,
      reviewedAt: r.reviewed_at,
      reviewedBy: r.reviewed_by,
      reviewerRole: r.reviewer_role,
      reviewReason: r.review_reason,
      denialReason: r.denial_reason,
    }));

    return NextResponse.json({
      requests: sanitizedRequests,
      pendingCount,
      eligibleApprovers: approvers.map((a) => ({
        id: a.id,
        username: a.username,
        fullName: a.fullName,
        email: a.email,
        role: a.role,
        authorityTier: a.authorityTier,
        delegationSource: a.delegationSource,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching access requests';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
