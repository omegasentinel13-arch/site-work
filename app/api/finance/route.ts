import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess, UnauthorizedError, ForbiddenError } from '@/lib/auth/permissions';
import { canAccess } from '@/lib/permissions/evaluator';
import { 
  createFinancialTransaction, 
  getFinancialTransactions, 
  mapDbRecordToItem,
  getCumulativeBalanceBeforeDate,
  getAllTimeSiteBalance,
  getYearMonthlyOverview,
  getMonthlyRollForward
} from '@/lib/db/repositories/finance-repo';
import { getSiteById } from '@/lib/db/repositories/site-repo';
import { findOrCreateInvestor } from '@/lib/db/repositories/investor-repo';
import { toPaise } from '@/lib/domain/money';
import { calculateFinancialSummary } from '@/lib/domain/finance-engine';
import { logAudit } from '@/lib/audit/logger';
import { getDb, runTransaction } from '@/lib/db';
import { 
  validateAttachment, 
  saveAttachmentBuffer, 
  removeAttachmentFile 
} from '@/lib/finance/attachment';
import { 
  singleFlightManager, 
  computeCanonicalSingleFlightKey 
} from '@/lib/finance/single-flight';
import crypto from 'crypto';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ALLOWED_AMOUNT_PAISE = 100_000_000_00; // 100 Crore Paise

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to view financial ledger.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const startDateParam = searchParams.get('startDate') || undefined;
    const endDateParam = searchParams.get('endDate') || undefined;
    const type = (searchParams.get('type') as 'CREDIT' | 'DEBIT') || undefined;
    const debitCategory = (searchParams.get('debitCategory') as any) || undefined;

    if (!siteId || typeof siteId !== 'string' || !siteId.trim()) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    const access = canAccess({
      session,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'VIEW',
      siteId,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    const site = getSiteById(siteId);
    if (!site) {
      return NextResponse.json({ error: 'Site not found' }, { status: 404 });
    }

    // Date validation
    if (startDateParam && !DATE_REGEX.test(startDateParam)) {
      return NextResponse.json({ error: 'Invalid startDate format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (endDateParam && !DATE_REGEX.test(endDateParam)) {
      return NextResponse.json({ error: 'Invalid endDate format. Expected YYYY-MM-DD.' }, { status: 400 });
    }
    if (startDateParam && endDateParam && startDateParam > endDateParam) {
      return NextResponse.json({ error: 'startDate cannot be after endDate' }, { status: 400 });
    }

    const db = getDb();
    const boundsRow = db.prepare(
      'SELECT MIN(date) as earliestDate, MAX(date) as latestDate FROM financial_transactions WHERE site_id = ?'
    ).get(siteId) as { earliestDate: string | null; latestDate: string | null } | undefined;

    const earliestDate = boundsRow?.earliestDate || null;
    const latestDate = boundsRow?.latestDate || null;
    const today = new Date().toISOString().split('T')[0];

    // Date range defaulting semantics:
    // - both supplied -> exact inclusive range
    // - only startDate -> endDate = current day
    // - only endDate -> startDate = earliestDate || endDate
    // - neither -> startDate = earliestDate || today, endDate = today
    let appliedStartDate = startDateParam;
    let appliedEndDate = endDateParam;

    if (!appliedStartDate && !appliedEndDate) {
      appliedStartDate = earliestDate || today;
      appliedEndDate = today;
    } else if (appliedStartDate && !appliedEndDate) {
      appliedEndDate = today;
    } else if (!appliedStartDate && appliedEndDate) {
      appliedStartDate = earliestDate || appliedEndDate;
    }

    if (appliedStartDate && appliedEndDate && appliedStartDate > appliedEndDate) {
      appliedEndDate = appliedStartDate;
    }

    // Authoritative calculations
    const periodOpeningBalancePaise = appliedStartDate 
      ? getCumulativeBalanceBeforeDate(siteId, appliedStartDate) 
      : 0;

    const currentSiteBalancePaise = getAllTimeSiteBalance(siteId);

    // Attendance labour cost for the same applied period
    const labourCostRow = db.prepare(`
      SELECT COALESCE(SUM(total_cost_paise), 0) as total 
      FROM attendance_records 
      WHERE site_id = ? AND date >= ? AND date <= ?
    `).get(siteId, appliedStartDate, appliedEndDate) as { total: number };
    const attendanceLabourCostPaise = labourCostRow ? labourCostRow.total : 0;

    // Period transactions & summary
    const records = getFinancialTransactions(siteId, {
      startDate: appliedStartDate,
      endDate: appliedEndDate,
      type,
      debitCategory,
    });
    const items = records.map(mapDbRecordToItem);
    const summary = calculateFinancialSummary(items, periodOpeningBalancePaise);

    const activeYear = appliedStartDate ? (parseInt(appliedStartDate.slice(0, 4), 10) || new Date().getFullYear()) : new Date().getFullYear();
    const yearOverview = getYearMonthlyOverview(siteId, activeYear);
    const monthlyRollForward = getMonthlyRollForward(siteId, appliedStartDate || today);

    return NextResponse.json({
      site: { id: site.id, name: site.name, code: site.code },
      startDate: appliedStartDate,
      endDate: appliedEndDate,
      earliestDate,
      latestDate,
      periodOpeningBalancePaise,
      periodCreditPaise: summary.totalCreditPaise,
      periodDebitPaise: summary.totalDebitPaise,
      periodNetMovementPaise: summary.netCashFlowPaise,
      currentSiteBalancePaise,
      transactionCount: records.length,
      attendanceLabourCostPaise,
      summary,
      transactions: records,
      breakdown: {
        credits: summary.totalCreditPaise,
        supplies: summary.suppliesDebitPaise,
        salary: summary.salaryDebitPaise,
        specialWorkerTask: summary.specialWorkerTaskDebitPaise,
        totalDebit: summary.totalDebitPaise,
        netMovement: summary.netCashFlowPaise,
      },
      yearOverview,
      monthlyRollForward,
    });
  } catch (err: unknown) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : 'Error fetching finance transactions';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let lockKey: string | null = null;
  let savedAttachmentFilename: string | null = null;

  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to record transactions.' }, { status: 401 });
    }

    const contentType = req.headers.get('content-type') || '';
    let siteId: string | undefined;
    let date: string | undefined;
    let type: 'CREDIT' | 'DEBIT' | undefined;
    let debitCategory: string | null = null;
    let amountRupees: number | string | undefined;
    let amountPaise: number | undefined;
    let referenceNote: string | null = null;
    let investorId: string | null = null;
    let investorName: string | null = null;
    let workCategoryId: string | null = null;
    let workRoleId: string | null = null;
    let userDescription: string | null = null;
    let attachmentFile: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      siteId = (formData.get('siteId') as string) || undefined;
      date = (formData.get('date') as string) || undefined;
      type = (formData.get('type') as 'CREDIT' | 'DEBIT') || undefined;
      debitCategory = (formData.get('debitCategory') as string) || null;
      amountRupees = (formData.get('amountRupees') as string) || undefined;
      if (formData.has('amountPaise')) {
        amountPaise = Number(formData.get('amountPaise'));
      }
      referenceNote = (formData.get('referenceNote') as string) || null;
      investorId = (formData.get('investorId') as string) || null;
      investorName = (formData.get('investorName') as string) || null;
      workCategoryId = (formData.get('workCategoryId') as string) || null;
      workRoleId = (formData.get('workRoleId') as string) || null;
      userDescription = (formData.get('description') as string) || null;

      const fileField = formData.get('attachment') || formData.get('file');
      if (fileField && typeof fileField === 'object' && 'arrayBuffer' in fileField) {
        attachmentFile = fileField as File;
      }
    } else {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 });
      }
      siteId = body.siteId;
      date = body.date;
      type = body.type;
      debitCategory = body.debitCategory || null;
      amountRupees = body.amountRupees;
      amountPaise = body.amountPaise;
      referenceNote = body.referenceNote || null;
      investorId = body.investorId || null;
      investorName = body.investorName || null;
      workCategoryId = body.workCategoryId || null;
      workRoleId = body.workRoleId || null;
      userDescription = body.description || null;
    }

    // Common validations
    if (!siteId || typeof siteId !== 'string' || !siteId.trim()) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }
    if (!date || typeof date !== 'string' || !DATE_REGEX.test(date)) {
      return NextResponse.json({ error: 'Valid transaction date (YYYY-MM-DD) is required.' }, { status: 400 });
    }
    if (!type || (type !== 'CREDIT' && type !== 'DEBIT')) {
      return NextResponse.json({ error: 'Transaction type must be CREDIT or DEBIT.' }, { status: 400 });
    }

    // Site permission check
    const access = canAccess({
      session,
      page: 'PAGE_FINANCE_TRANSACTIONS',
      action: 'CREATE',
      siteId,
    });
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.ruleSource === 'AUTHENTICATION_REQUIRED' ? 401 : 403 });
    }

    // Amount validation
    const parsedAmountPaise = amountPaise !== undefined 
      ? Math.floor(Number(amountPaise)) 
      : toPaise(Number(amountRupees || 0));

    if (isNaN(parsedAmountPaise) || parsedAmountPaise <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than zero.' }, { status: 400 });
    }
    if (parsedAmountPaise > MAX_ALLOWED_AMOUNT_PAISE) {
      return NextResponse.json({ error: 'Amount exceeds maximum allowable limit.' }, { status: 400 });
    }

    const db = getDb();
    let resolvedInvestorId: string | null = null;
    let resolvedInvestorName: string | null = null;
    let resolvedWorkCategoryName: string | null = null;
    let resolvedWorkRoleName: string | null = null;
    let finalDescription = userDescription?.trim() || '';

    // CREDIT Type Validation
    if (type === 'CREDIT') {
      if (debitCategory) {
        return NextResponse.json({ error: 'debitCategory must be null for Credit transactions.' }, { status: 400 });
      }

      const invNameCandidate = (investorName || '').trim();
      if (!invNameCandidate && !investorId) {
        return NextResponse.json({ error: 'Investor name is required for Credit transactions.' }, { status: 400 });
      }

      if (investorId) {
        const invRow = db.prepare('SELECT id, name FROM investors WHERE id = ?').get(investorId) as { id: string; name: string } | undefined;
        if (!invRow) {
          return NextResponse.json({ error: 'Referenced investor not found.' }, { status: 400 });
        }
        resolvedInvestorId = invRow.id;
        resolvedInvestorName = invRow.name;
      } else {
        const inv = findOrCreateInvestor(invNameCandidate);
        resolvedInvestorId = inv.id;
        resolvedInvestorName = inv.name;
      }

      if (!finalDescription) {
        finalDescription = `Credit from ${resolvedInvestorName}`;
      }
    }

    // DEBIT Type Validation
    if (type === 'DEBIT') {
      if (!debitCategory || (debitCategory !== 'SUPPLIES' && debitCategory !== 'SALARY')) {
        return NextResponse.json({ 
          error: 'Debit category is required and must be either SUPPLIES or SALARY for new transactions.' 
        }, { status: 400 });
      }

      if (debitCategory === 'SALARY') {
        if (workCategoryId) {
          const catRow = db.prepare('SELECT id, name FROM work_categories WHERE id = ?').get(workCategoryId) as { id: string; name: string } | undefined;
          if (!catRow) {
            return NextResponse.json({ error: 'Referenced work category not found.' }, { status: 400 });
          }
          resolvedWorkCategoryName = catRow.name;
        }

        if (workRoleId) {
          const roleRow = db.prepare('SELECT id, category_id, name FROM work_roles WHERE id = ?').get(workRoleId) as { id: string; category_id: string; name: string } | undefined;
          if (!roleRow) {
            return NextResponse.json({ error: 'Referenced work role not found.' }, { status: 400 });
          }
          if (workCategoryId && roleRow.category_id !== workCategoryId) {
            return NextResponse.json({ 
              error: 'Selected work role does not belong to the selected work category.' 
            }, { status: 400 });
          }
          resolvedWorkRoleName = roleRow.name;
        }

        if (!finalDescription) {
          if (resolvedWorkRoleName) {
            finalDescription = `Salary: ${resolvedWorkRoleName}`;
          } else if (resolvedWorkCategoryName) {
            finalDescription = `Salary: ${resolvedWorkCategoryName}`;
          } else {
            finalDescription = 'Workforce Salary';
          }
        }
      } else if (debitCategory === 'SUPPLIES') {
        workCategoryId = null;
        workRoleId = null;
        if (!finalDescription) {
          finalDescription = referenceNote ? `Supplies: ${referenceNote}` : 'Supplies / Materials';
        }
      }
    }

    // Validate attachment in memory before writing to DB
    let attachmentBuffer: Buffer | null = null;
    let attachmentExtension: string | null = null;

    if (attachmentFile && attachmentFile.size > 0) {
      attachmentBuffer = Buffer.from(await attachmentFile.arrayBuffer());
      const val = validateAttachment(attachmentBuffer, attachmentFile.name, attachmentFile.type);
      if (!val.valid) {
        return NextResponse.json({ error: val.error || 'Invalid attachment file.' }, { status: 400 });
      }
      attachmentExtension = val.extension!;
    }

    // Deterministic Canonical Single-Flight Duplicate Submission Lock
    const attachmentHash = attachmentBuffer 
      ? crypto.createHash('sha256').update(attachmentBuffer).digest('hex')
      : null;

    lockKey = computeCanonicalSingleFlightKey({
      userId: session.userId,
      siteId,
      date,
      amountPaise: parsedAmountPaise,
      type,
      investorName: resolvedInvestorName,
      investorId: resolvedInvestorId,
      debitCategory: type === 'DEBIT' ? debitCategory : null,
      workCategoryId: type === 'DEBIT' ? workCategoryId : null,
      workRoleId: type === 'DEBIT' ? workRoleId : null,
      note: referenceNote?.trim() || null,
      attachmentHash,
    });

    if (!singleFlightManager.acquire(lockKey, 2000)) {
      return NextResponse.json(
        { error: 'A transaction with identical details is currently processing or was just submitted. Please wait.' },
        { status: 409 }
      );
    }

    // Atomic database insertion
    let transactionId = '';
    runTransaction(db, () => {
      transactionId = createFinancialTransaction({
        siteId,
        date,
        type,
        debitCategory: type === 'DEBIT' ? (debitCategory as any) : null,
        amountPaise: parsedAmountPaise,
        description: finalDescription,
        referenceNote: referenceNote?.trim() || null,
        investorId: resolvedInvestorId,
        investorName: resolvedInvestorName,
        workCategoryId,
        workRoleId,
        userId: session.userId,
      });
    });

    // Finalize attachment file ONLY after successful DB transaction
    if (attachmentBuffer && attachmentExtension) {
      try {
        savedAttachmentFilename = saveAttachmentBuffer(attachmentBuffer, attachmentExtension);
        const attachmentUrl = `/api/finance/attachments/${savedAttachmentFilename}`;
        db.prepare('UPDATE financial_transactions SET attachment_url = ? WHERE id = ?').run(attachmentUrl, transactionId);
      } catch (fileErr) {
        // Rollback transaction to maintain consistency and prevent orphans
        db.prepare('DELETE FROM financial_transactions WHERE id = ?').run(transactionId);
        if (savedAttachmentFilename) {
          removeAttachmentFile(savedAttachmentFilename);
        }
        throw new Error('Failed to store attachment file safely.');
      }
    }

    // Log authoritative audit entry
    logAudit({
      entityType: 'FINANCE',
      entityId: transactionId,
      action: 'FINANCE_TRANSACTION_CREATED',
      siteId,
      userId: session.userId,
      afterState: {
        id: transactionId,
        siteId,
        date,
        type,
        debitCategory,
        amountPaise: parsedAmountPaise,
        description: finalDescription,
        investorName: resolvedInvestorName,
        hasAttachment: !!savedAttachmentFilename,
      },
    });

    return NextResponse.json({ success: true, transactionId });
  } catch (err: unknown) {
    if (lockKey) {
      singleFlightManager.release(lockKey);
    }
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    const msg = err instanceof Error ? err.message : 'Error saving transaction';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
