import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession, createSessionCookie } from '@/lib/auth/session';
import { 
  getUserById, 
  updateUsername, 
  updatePassword, 
  updateRecoveryEmail 
} from '@/lib/db/repositories/user-repo';
import { logAudit } from '@/lib/audit/logger';

// 1. Change Username
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { currentPassword, newUsername } = body;

    if (!currentPassword || !newUsername || !newUsername.trim()) {
      return NextResponse.json({ error: 'Current password and new username are required' }, { status: 400 });
    }

    const user = getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const isPasswordValid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Incorrect current password' }, { status: 401 });
    }

    const oldUsername = user.username;
    updateUsername(user.id, newUsername);

    // Fetch updated user to get new token_version and re-issue fresh session
    const updatedUser = getUserById(user.id)!;
    await createSessionCookie({
      userId: updatedUser.id,
      username: updatedUser.username,
      fullName: updatedUser.full_name,
      role: updatedUser.role,
      assignedSiteIds: session.assignedSiteIds,
      tokenVersion: updatedUser.token_version,
    });

    logAudit({
      entityType: 'SECURITY',
      entityId: user.id,
      action: 'USERNAME_CHANGE',
      userId: user.id,
      beforeState: { oldUsername },
      afterState: { newUsername: updatedUser.username },
    });

    return NextResponse.json({
      success: true,
      message: 'Username updated successfully',
      username: updatedUser.username,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update username';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// 2. Change Password
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { currentPassword, newPassword, confirmPassword } = body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters long' }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'New passwords do not match' }, { status: 400 });
    }

    const user = getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const isPasswordValid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Incorrect current password' }, { status: 401 });
    }

    updatePassword(user.id, newPassword);

    // Re-issue fresh session with new token_version for this active client
    const updatedUser = getUserById(user.id)!;
    await createSessionCookie({
      userId: updatedUser.id,
      username: updatedUser.username,
      fullName: updatedUser.full_name,
      role: updatedUser.role,
      assignedSiteIds: session.assignedSiteIds,
      tokenVersion: updatedUser.token_version,
    });

    logAudit({
      entityType: 'SECURITY',
      entityId: user.id,
      action: 'PASSWORD_CHANGE',
      userId: user.id,
      afterState: { action: 'PASSWORD_CHANGE_SELF' },
    });

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to change password';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

// 3. Change Recovery Email (Admin only)
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Administrator access required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { currentPassword, newRecoveryEmail } = body;

    if (!currentPassword || !newRecoveryEmail || !newRecoveryEmail.trim()) {
      return NextResponse.json({ error: 'Current password and recovery email are required' }, { status: 400 });
    }

    const user = getUserById(session.userId);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Verify current password
    const isPasswordValid = bcrypt.compareSync(currentPassword, user.password_hash);
    if (!isPasswordValid) {
      return NextResponse.json({ error: 'Incorrect current password' }, { status: 401 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newRecoveryEmail.trim())) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
    }

    const oldEmail = user.recovery_email;
    const normalized = newRecoveryEmail.trim().toLowerCase();
    updateRecoveryEmail(user.id, normalized);

    logAudit({
      entityType: 'SECURITY',
      entityId: user.id,
      action: 'RECOVERY_EMAIL_CHANGE',
      userId: user.id,
      beforeState: { oldEmail },
      afterState: { newEmail: normalized },
    });

    return NextResponse.json({
      success: true,
      message: 'Recovery email updated successfully',
      recoveryEmail: normalized,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to update recovery email';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
