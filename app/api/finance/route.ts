import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { 
  createFinancialTransaction, 
  getFinancialTransactions, 
  mapDbRecordToItem 
} from '@/lib/db/repositories/finance-repo';
import { toPaise } from '@/lib/domain/money';
import { calculateFinancialSummary } from '@/lib/domain/finance-engine';
import { logAudit } from '@/lib/audit/logger';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const type = (searchParams.get('type') as 'CREDIT' | 'DEBIT') || undefined;
    const debitCategory = (searchParams.get('debitCategory') as 'SUPPLIES' | 'SPECIAL_WORKER_TASK') || undefined;

    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    validateSiteAccess(session, siteId, 'READ');

    const records = getFinancialTransactions(siteId, { startDate, endDate, type, debitCategory });
    const items = records.map(mapDbRecordToItem);
    const summary = calculateFinancialSummary(items, 0);

    return NextResponse.json({
      transactions: records,
      summary,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error fetching finance transactions';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const body = await req.json();
    const { siteId, date, type, debitCategory, amountRupees, amountPaise, description, referenceNote } = body;

    if (!siteId || !date || !type || !description) {
      return NextResponse.json({ error: 'siteId, date, type, and description are required' }, { status: 400 });
    }

    validateSiteAccess(session, siteId, 'WRITE');

    const finalAmountPaise = amountPaise !== undefined ? amountPaise : toPaise(amountRupees || 0);
    if (finalAmountPaise <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 });
    }

    const id = createFinancialTransaction({
      siteId,
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
      entityId: id,
      action: 'CREATE',
      siteId,
      userId: session!.userId,
      afterState: { type, debitCategory, amountPaise: finalAmountPaise, description },
    });

    return NextResponse.json({ success: true, transactionId: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error saving transaction';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
