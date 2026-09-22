import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { isSuperiorPrime } from '@/lib/auth/authority';
import { AuditRepository } from '@/lib/db/repositories/audit-repo';
import { getUserAssignedSites } from '@/lib/db/repositories/user-repo';

export async function GET(req: Request) {
  const session = await getSession();

  // 1. Centralized Permission Evaluation via canAccess()
  const decision = canAccess({
    session,
    page: 'PAGE_AUDIT_TRAIL',
    action: 'VIEW',
  });

  if (!decision.allowed) {
    const status = decision.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403;
    return NextResponse.json(
      { error: decision.reason || 'Access denied: insufficient permissions to view audit trail' },
      { status }
    );
  }

  if (!session || !session.userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);

    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const actor = searchParams.get('actor') || searchParams.get('user');
    const site = searchParams.get('site') || searchParams.get('siteId');
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');
    const search = searchParams.get('search');
    const page = searchParams.get('page');
    const pageSize = searchParams.get('pageSize') || searchParams.get('limit');

    // 4. Resolve Context & Authority
    const isSupPrime = isSuperiorPrime(session) || session.authorityTier === 'KING_MAKER';
    const isGlobalAdmin =
      isSupPrime ||
      session.authorityTier === 'CLIENT_PRIME' ||
      session.authorityTier === 'STANDARD_ADMIN' ||
      session.role === 'ADMIN';

    const assignedSiteIds = session.assignedSiteIds || getUserAssignedSites(session.userId);

    // 5. Query Audit Repository
    const result = AuditRepository.getLogs(
      {
        from,
        to,
        actor,
        site,
        entityType,
        action,
        search,
        page,
        pageSize,
      },
      {
        session,
        isSuperiorPrime: isSupPrime,
        isGlobalAdmin,
        assignedSiteIds,
      }
    );

    const restoreDecision = canAccess({
      session,
      page: 'PAGE_AUDIT_TRAIL',
      action: 'RESTORE',
    });

    return NextResponse.json({
      ...result,
      canRestore: restoreDecision.allowed,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching audit logs';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
