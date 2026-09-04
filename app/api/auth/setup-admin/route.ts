import { NextResponse } from 'next/server';
import { hasAdminUser, createUser } from '@/lib/db/repositories/user-repo';
import { createSessionCookie } from '@/lib/auth/session';
import { logAudit } from '@/lib/audit/logger';

export async function POST(req: Request) {
  try {
    // 1. Race-safe guard: One-time setup only
    if (hasAdminUser()) {
      return NextResponse.json(
        { error: 'First-time setup has already been completed. Please log in.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { username, password, confirmPassword, fullName, recoveryEmail } = body;

    // 2. Validations
    if (!username || !username.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
    }

    const email = recoveryEmail && recoveryEmail.trim().length > 0 
      ? recoveryEmail.trim().toLowerCase() 
      : 'omegasentinel13@gmail.com';

    // 3. Create initial Administrator
    const userId = createUser({
      username: username.trim(),
      passwordPlainText: password,
      fullName: fullName && fullName.trim().length > 0 ? fullName.trim() : 'Primary Administrator',
      role: 'ADMIN',
      recoveryEmail: email,
    });

    // 4. Create secure session
    await createSessionCookie({
      userId,
      username: username.trim(),
      fullName: fullName && fullName.trim().length > 0 ? fullName.trim() : 'Primary Administrator',
      role: 'ADMIN',
      assignedSiteIds: [],
      tokenVersion: 1,
    });

    // 5. Audit Log (Zero secrets)
    logAudit({
      entityType: 'SECURITY',
      entityId: userId,
      action: 'ADMIN_SETUP',
      userId,
      afterState: { username: username.trim(), recoveryEmail: email },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        username: username.trim(),
        fullName: fullName || 'Primary Administrator',
        role: 'ADMIN',
        recoveryEmail: email,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error setting up administrator';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
