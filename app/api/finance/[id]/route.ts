import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { updateFinancialTransaction, deleteFinancialTransaction } from '@/lib/db/repositories/finance-repo';
import { toPaise } from '@/lib/domain/money';
import { logAudit } from '@/lib/audit/logger';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    const body = await req.json();
    const { siteId, date, type, debitCategory, amountRupees, amountPaise, description, referenceNote } = body;

    validateSiteAccess(session, siteId, 'WRITE');

    const finalAmountPaise = amountPaise !== undefined ? amountPaise : toPaise(amountRupees || 0);

    updateFinancialTransaction({
      id: params.id,
      date,
      type,
      debitCategory: type === 'DEBIT' ? debitCategory : null,
      amountPaise: finalAmountPaise,
      description,
      referenceNote,
      userId: session!.userId,
    });

    logAudit({
      entityType: 'FINANCE',
      entityId: params.id,
      action: 'UPDATE',
      siteId,
      userId: session!.userId,
      afterState: { type, amountPaise: finalAmountPaise, description },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error updating transaction';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');

    validateSiteAccess(session, siteId, 'WRITE');

    deleteFinancialTransaction(params.id);

    logAudit({
      entityType: 'FINANCE',
      entityId: params.id,
      action: 'DELETE',
      siteId: siteId || undefined,
      userId: session!.userId,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error deleting transaction';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
