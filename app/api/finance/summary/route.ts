import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { validateSiteAccess } from '@/lib/auth/permissions';
import { 
  getFinancialTransactions, 
  getCumulativeBalanceBeforeDate, 
  mapDbRecordToItem 
} from '@/lib/db/repositories/finance-repo';
import { calculateFinancialSummary } from '@/lib/domain/finance-engine';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    const { searchParams } = new URL(req.url);
    const siteId = searchParams.get('siteId');
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    if (!siteId) {
      return NextResponse.json({ error: 'siteId is required' }, { status: 400 });
    }

    validateSiteAccess(session, siteId, 'READ');

    const openingBalancePaise = startDate 
      ? getCumulativeBalanceBeforeDate(siteId, startDate) 
      : 0;

    const txRecords = getFinancialTransactions(siteId, { startDate, endDate });
    const items = txRecords.map(mapDbRecordToItem);
    const summary = calculateFinancialSummary(items, openingBalancePaise);

    return NextResponse.json({
      siteId,
      startDate,
      endDate,
      summary,
      transactions: txRecords,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error calculating financial summary';
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
