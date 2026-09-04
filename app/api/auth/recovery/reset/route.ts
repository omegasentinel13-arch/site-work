import { NextResponse } from 'next/server';
import { getUserByUsername, updatePassword } from '@/lib/db/repositories/user-repo';
import { verifyRecoveryToken, consumeRecoveryToken } from '@/lib/db/repositories/recovery-repo';
import { logAudit } from '@/lib/audit/logger';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username, token, newPassword, confirmPassword } = body;

    if (!username || !token || !newPassword || !confirmPassword) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters long' }, { status: 400 });
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match' }, { status: 400 });
    }

    const user = getUserByUsername(username.trim());
    if (!user || user.is_active === 0 || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Invalid recovery request or account ineligible.' }, { status: 400 });
    }

    // Verify OTP against hashed token record in SQLite
    const verification = verifyRecoveryToken(user.id, token.trim());
    if (!verification.valid || !verification.tokenId) {
      return NextResponse.json({ error: verification.error || 'Invalid or expired recovery code.' }, { status: 400 });
    }

    // Update password and invalidate all previous active sessions
    updatePassword(user.id, newPassword);

    // Mark token as used
    consumeRecoveryToken(verification.tokenId);

    logAudit({
      entityType: 'SECURITY',
      entityId: user.id,
      action: 'RECOVERY_COMPLETE',
      userId: user.id,
      afterState: { targetUsername: user.username },
    });

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error resetting password';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
