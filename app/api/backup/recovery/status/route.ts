import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { RestoreCoordinator, readRecoveryJournal } from '@/lib/backup';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Access denied: Only Administrators can inspect system recovery status.' },
        { status: 403 }
      );
    }

    const journal = readRecoveryJournal();

    return NextResponse.json({
      isLocked: RestoreCoordinator.isLocked(),
      isRecoveryMode: RestoreCoordinator.isRecoveryMode(),
      lockState: RestoreCoordinator.getLockState(),
      activeOperationId: RestoreCoordinator.getActiveOperationId(),
      journalEntries: journal.slice(-20), // return last 20 entries
    });
  } catch (error: any) {
    console.error('Error fetching recovery status:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch recovery status' }, { status: 500 });
  }
}
