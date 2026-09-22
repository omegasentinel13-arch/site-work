import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { getUserById } from '@/lib/db/repositories/user-repo';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ user: null });
  }

  const user = getUserById(session.userId);
  if (!user || user.is_active === 0) {
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      authorityTier: (user as any).authority_tier || 'STANDARD',
      mustChangePassword: (user as any).must_change_password === 1,
      recoveryEmail: user.role === 'ADMIN' ? user.recovery_email : null,
      assignedSiteIds: session.assignedSiteIds,
    },
  });
}
