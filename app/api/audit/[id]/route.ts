import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { isSuperiorPrime } from '@/lib/auth/authority';
import { AuditRepository } from '@/lib/db/repositories/audit-repo';
import { getUserAssignedSites } from '@/lib/db/repositories/user-repo';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
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
    const { id } = params;
    if (!id) {
      return NextResponse.json({ error: 'Missing audit log ID' }, { status: 400 });
    }

    // 2. Resolve Context & Authority
    const isSupPrime = isSuperiorPrime(session) || session.authorityTier === 'KING_MAKER';
    const isGlobalAdmin =
      isSupPrime ||
      session.authorityTier === 'CLIENT_PRIME' ||
      session.authorityTier === 'STANDARD_ADMIN' ||
      session.role === 'ADMIN';

    const assignedSiteIds = session.assignedSiteIds || getUserAssignedSites(session.userId);

    // 5. Query Audit Repository by ID
    const item = AuditRepository.getLogById(id, {
      session,
      isSuperiorPrime: isSupPrime,
      isGlobalAdmin,
      assignedSiteIds,
    });

    if (!item) {
      return NextResponse.json({ error: 'Audit log record not found' }, { status: 404 });
    }

    return NextResponse.json({ item });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching audit record';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
