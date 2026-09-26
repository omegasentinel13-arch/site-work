import { NextResponse } from 'next/server';
import { AccessRequestRepository, PUBLIC_REQUESTABLE_ROLES } from '@/lib/db/repositories/access-request-repo';
import { checkRateLimit } from '@/lib/security/rate-limiter';

export async function GET() {
  return NextResponse.json({
    roles: Object.values(PUBLIC_REQUESTABLE_ROLES),
  });
}

export async function POST(req: Request) {
  try {
    // 1. Rate limiting by IP or header
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local-client';
    const rateCheck = checkRateLimit(`req-access:${ip}`, 10, 60_000); // 10 attempts per minute
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a few moments before trying again.' },
        { status: 429 }
      );
    }

    const body = await req.json();
    const { fullName, username, email, password, confirmPassword, roleId } = body;

    // 2. Validate required fields
    if (!fullName || typeof fullName !== 'string') {
      return NextResponse.json({ error: 'Full Name is required' }, { status: 400 });
    }

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Password and Confirm Password do not match' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long' }, { status: 400 });
    }

    if (!roleId || typeof roleId !== 'string') {
      return NextResponse.json({ error: 'Please select an intended role' }, { status: 400 });
    }

    const userAgent = req.headers.get('user-agent') || 'Unknown';
    const metadata = {
      ip,
      userAgent: userAgent.slice(0, 200),
      submittedAt: new Date().toISOString(),
    };

    // 3. Delegate to repository
    const result = AccessRequestRepository.createAccessRequest({
      fullName,
      username,
      email,
      passwordPlainText: password,
      roleId,
      metadata,
    });

    if (result.dispatchPromise) {
      await result.dispatchPromise;
    }

    return NextResponse.json({
      success: true,
      requestId: result.request.id,
      fullName: result.request.requester_full_name,
      role: result.request.requested_role_name_snapshot,
      status: result.request.status,
      statusToken: result.statusToken,
      typicalReviewTime: '24–48 hours',
      message: 'Access request submitted successfully and is pending administrator review.',
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Failed to submit access request';
    // Clean user-facing responses
    const isClientError =
      errorMsg.includes('required') ||
      errorMsg.includes('characters') ||
      errorMsg.includes('valid') ||
      errorMsg.includes('already') ||
      errorMsg.includes('pending') ||
      errorMsg.includes('match') ||
      errorMsg.includes('privileged');

    return NextResponse.json({ error: errorMsg }, { status: isClientError ? 400 : 500 });
  }
}
