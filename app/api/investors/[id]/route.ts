import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { archiveInvestor } from '@/lib/db/repositories/investor-repo';
import { logAudit } from '@/lib/audit/logger';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to manage investors.' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_FINANCE_LEDGER',
      action: 'EDIT',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const { id } = params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Investor ID is required' }, { status: 400 });
    }

    archiveInvestor(id);

    logAudit({
      entityType: 'FINANCE',
      entityId: id,
      action: 'FINANCE_INVESTOR_ARCHIVED',
      userId: session.userId,
      afterState: { id, is_archived: 1 },
    });

    return NextResponse.json({ success: true, archivedId: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error archiving investor';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
