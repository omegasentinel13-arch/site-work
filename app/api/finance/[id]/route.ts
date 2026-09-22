import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess, ForbiddenError, UnauthorizedError } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { 
  getFinancialTransactionById,
  updateFinancialTransaction, 
  deleteFinancialTransaction 
} from '@/lib/db/repositories/finance-repo';
import { toPaise } from '@/lib/domain/money';
import { logAudit } from '@/lib/audit/logger';

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    const { id } = params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    const existingTx = getFinancialTransactionById(id);
    if (!existingTx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
    }

    const { siteId, date, type, debitCategory, amountRupees, amountPaise, description, referenceNote } = body;

    // Authorization decision MUST be derived from the ACTUAL persisted transaction's site_id (Step 0 Invariant)
    const access = canAccess({
      session,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'EDIT',
      siteId: siteId || undefined,
      resourceSiteId: existingTx.site_id,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const finalAmountPaise = amountPaise !== undefined ? amountPaise : toPaise(amountRupees || 0);

    updateFinancialTransaction({
      id: existingTx.id,
      date: date || existingTx.date,
      type: type || existingTx.type,
      debitCategory: (type || existingTx.type) === 'DEBIT' ? (debitCategory ?? existingTx.debit_category) : null,
      amountPaise: finalAmountPaise,
      description: description !== undefined ? description : existingTx.description,
      referenceNote: referenceNote !== undefined ? referenceNote : existingTx.reference_note,
      investorId: existingTx.investor_id,
      investorName: existingTx.investor_name,
      workCategoryId: existingTx.work_category_id,
      workRoleId: existingTx.work_role_id,
      attachmentUrl: existingTx.attachment_url,
      userId: session.userId,
    });

    logAudit({
      entityType: 'FINANCE',
      entityId: existingTx.id,
      action: 'UPDATE',
      siteId: existingTx.site_id,
      userId: session.userId,
      beforeState: {
        siteId: existingTx.site_id,
        date: existingTx.date,
        type: existingTx.type,
        amountPaise: existingTx.amount_paise,
        description: existingTx.description,
      },
      afterState: {
        siteId: existingTx.site_id,
        date: date || existingTx.date,
        type: type || existingTx.type,
        amountPaise: finalAmountPaise,
        description: description !== undefined ? description : existingTx.description,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : 'Error updating transaction';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    const { id } = params;
    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Transaction ID is required' }, { status: 400 });
    }

    const existingTx = getFinancialTransactionById(id);
    if (!existingTx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const suppliedSiteId = searchParams.get('siteId');

    // Authorization decision MUST be derived from the ACTUAL persisted transaction's site_id (Step 0 Invariant)
    const access = canAccess({
      session,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'DELETE',
      siteId: suppliedSiteId || undefined,
      resourceSiteId: existingTx.site_id,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    deleteFinancialTransaction(existingTx.id);

    logAudit({
      entityType: 'FINANCE',
      entityId: existingTx.id,
      action: 'DELETE',
      siteId: existingTx.site_id,
      userId: session.userId,
      beforeState: {
        siteId: existingTx.site_id,
        date: existingTx.date,
        type: existingTx.type,
        amountPaise: existingTx.amount_paise,
        description: existingTx.description,
      },
      afterState: { deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    const msg = err instanceof Error ? err.message : 'Error deleting transaction';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
