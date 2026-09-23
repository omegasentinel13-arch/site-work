import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getUserByUsername, getUserAssignedSites } from '@/lib/db/repositories/user-repo';
import { createSessionCookie } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit/logger';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const user = getUserByUsername(username);
    if (!user) {
      logAudit({
        entityType: 'AUTH',
        entityId: 'unauthenticated',
        action: 'LOGIN_FAILURE',
        afterState: { attemptedUsername: username },
      });
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    if (user.is_active === 0) {
      logAudit({
        entityType: 'AUTH',
        entityId: user.id,
        action: 'LOGIN_FAILURE',
        userId: user.id,
        afterState: { reason: 'ACCOUNT_DISABLED', username: user.username },
      });
      return NextResponse.json({ error: 'Account is disabled. Please contact an Administrator.' }, { status: 403 });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      logAudit({
        entityType: 'AUTH',
        entityId: user.id,
        action: 'LOGIN_FAILURE',
        userId: user.id,
        afterState: { reason: 'INVALID_CREDENTIALS', username: user.username },
      });
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    const assignedSiteIds = user.role === 'ADMIN' ? [] : getUserAssignedSites(user.id);

    await createSessionCookie({
      userId: user.id,
      username: user.username,
      fullName: user.full_name,
      role: user.role,
      assignedSiteIds,
      tokenVersion: user.token_version,
    });

    logAudit({
      entityType: 'AUTH',
      entityId: user.id,
      action: 'LOGIN_SUCCESS',
      userId: user.id,
      afterState: { username: user.username, role: user.role },
    });

    return NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        role: user.role,
        authorityTier: (user as any).authority_tier || 'STANDARD',
        mustChangePassword: (user as any).must_change_password === 1,
        recoveryEmail: user.role === 'ADMIN' ? user.recovery_email : null,
        assignedSiteIds,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Login failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
