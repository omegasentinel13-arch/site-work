import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { canAccess } from '@/lib/permissions/evaluator';
import { getAllActiveInvestors, findOrCreateInvestor } from '@/lib/db/repositories/investor-repo';
import { logAudit } from '@/lib/audit/logger';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to view investors.' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_FINANCE_LEDGER',
      action: 'VIEW',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const investors = getAllActiveInvestors();
    return NextResponse.json({ investors });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching investors';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to create an investor.' }, { status: 401 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_FINANCE_LEDGER',
      action: 'CREATE',
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    let body: { name?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const { name } = body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Investor name is required.' }, { status: 400 });
    }

    const trimmed = name.trim();
    if (trimmed.length > 100) {
      return NextResponse.json({ error: 'Investor name cannot exceed 100 characters.' }, { status: 400 });
    }

    const existingList = getAllActiveInvestors();
    const existing = existingList.find(i => i.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      return NextResponse.json({ success: true, investor: existing, existing: true });
    }

    const investor = findOrCreateInvestor(trimmed);

    logAudit({
      entityType: 'FINANCE',
      entityId: investor.id,
      action: 'FINANCE_INVESTOR_CREATED',
      userId: session.userId,
      afterState: { id: investor.id, name: investor.name },
    });

    return NextResponse.json({ success: true, investor });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error creating investor';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
