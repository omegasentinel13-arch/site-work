import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getUserByUsername } from '@/lib/db/repositories/user-repo';
import { createRecoveryToken } from '@/lib/db/repositories/recovery-repo';
import { sendRecoveryOtpEmail } from '@/lib/email/mailer';
import { logAudit } from '@/lib/audit/logger';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { username } = body;

    if (!username || !username.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const user = getUserByUsername(username.trim());

    // Only active administrator accounts with configured recovery email are eligible for password recovery
    if (user && user.is_active === 1 && user.role === 'ADMIN' && user.recovery_email) {
      // Generate 6-digit cryptographically secure OTP
      const otp = crypto.randomInt(100000, 999999).toString();
      createRecoveryToken(user.id, otp);

      // Deliver OTP via secure email to configured recovery email address
      const emailResult = await sendRecoveryOtpEmail({
        to: user.recovery_email,
        username: user.username,
        otp,
      });

      if (!emailResult.success) {
        // Log sanitized audit event without exposing OTP or email credentials
        logAudit({
          entityType: 'SECURITY',
          entityId: user.id,
          action: 'RECOVERY_REQUEST',
          userId: user.id,
          afterState: {
            targetUsername: user.username,
            deliveryStatus: 'FAILED',
            reason: emailResult.error?.substring(0, 100),
          },
        });
      } else {
        logAudit({
          entityType: 'SECURITY',
          entityId: user.id,
          action: 'RECOVERY_REQUEST',
          userId: user.id,
          afterState: {
            targetUsername: user.username,
            deliveryStatus: 'DELIVERED',
          },
        });
      }
    }

    // Generic safe response to prevent username/account enumeration
    return NextResponse.json({
      success: true,
      message: 'If an administrator account with this username exists, a recovery code has been sent to the configured recovery email.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error processing recovery request';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
