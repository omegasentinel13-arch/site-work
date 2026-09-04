import { NextResponse } from 'next/server';
import { hasAdminUser } from '@/lib/db/repositories/user-repo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const adminExists = hasAdminUser();
    return NextResponse.json(
      { isSetupRequired: !adminExists },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
          Pragma: 'no-cache',
          Expires: '0',
        },
      }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error checking setup status';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

