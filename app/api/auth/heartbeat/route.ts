import { NextRequest, NextResponse } from 'next/server';
import { refreshSessionActivity, getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized or session expired' },
        { status: 401 }
      );
    }

    const result = await refreshSessionActivity();
    if (!result.success) {
      return NextResponse.json(
        { ok: false, error: result.message || 'Session refresh rejected' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      ok: true,
      refreshed: result.refreshed,
      message: result.refreshed ? 'Session extended' : 'Heartbeat throttled (< 5 min)',
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Heartbeat error' },
      { status: 500 }
    );
  }
}
