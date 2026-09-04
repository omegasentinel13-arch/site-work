import { NextResponse } from 'next/server';
import { getSession, clearSession } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit/logger';

export async function POST() {
  const session = await getSession();
  if (session) {
    logAudit({
      entityType: 'AUTH',
      entityId: session.userId,
      action: 'LOGOUT',
      userId: session.userId,
      afterState: { username: session.username },
    });
  }

  await clearSession();
  return NextResponse.json({ success: true });
}
