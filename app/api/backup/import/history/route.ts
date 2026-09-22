import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getRecoveryHistory } from '@/lib/backup/import';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Please log in to continue.' }, { status: 401 });
    }

    if (session.role === 'VIEWER') {
      return NextResponse.json(
        { error: 'Access denied: Viewers cannot view recovery history.' },
        { status: 403 }
      );
    }

    const history = getRecoveryHistory();

    return NextResponse.json({ history });
  } catch (error: any) {
    console.error('Error fetching recovery history:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch recovery history' }, { status: 500 });
  }
}
