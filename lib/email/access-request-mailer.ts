import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { isSmtpConfigured, getSmtpConfig } from './mailer';
import { captureDevEmail, CapturedEmail } from './dev-inbox';

export interface NewAccessRequestEmailData {
  requesterName: string;
  requestedUsername: string;
  requestedEmail: string;
  requestedRole: string;
  requestId: string;
  timestamp: string;
  reviewUrl: string;
}

export interface RequestApprovedEmailData {
  fullName: string;
  username: string;
  role: string;
  signInUrl: string;
}

export interface RequestDeniedEmailData {
  fullName: string;
  username: string;
  reason?: string | null;
}

function getBaseStyles(): string {
  return `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: #0f172a; padding: 22px 24px; text-align: center; }
    .header h1 { color: #f59e0b; margin: 0; font-size: 16px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
    .header p { color: #94a3b8; margin: 4px 0 0 0; font-size: 11px; font-weight: 600; }
    .content { padding: 28px 24px; }
    .title { font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 12px; }
    .subtitle { font-size: 13px; color: #475569; line-height: 1.5; margin-bottom: 20px; }
    .table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px; }
    .table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; }
    .table td.label { font-weight: 600; color: #64748b; width: 38%; }
    .table td.val { font-weight: 700; color: #0f172a; }
    .btn-wrap { text-align: center; margin: 24px 0 16px 0; }
    .btn { display: inline-block; padding: 12px 28px; background: #0f172a; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 13px; letter-spacing: 0.02em; }
    .badge-pending { display: inline-block; padding: 3px 8px; background: #fef3c7; color: #92400e; border-radius: 6px; font-weight: 700; font-size: 11px; }
    .badge-approved { display: inline-block; padding: 3px 8px; background: #dcfce7; color: #15803d; border-radius: 6px; font-weight: 700; font-size: 11px; }
    .badge-denied { display: inline-block; padding: 3px 8px; background: #fee2e2; color: #b91c1c; border-radius: 6px; font-weight: 700; font-size: 11px; }
    .warning { background: #f8fafc; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; font-size: 12px; color: #475569; margin-top: 20px; line-height: 1.5; }
    .footer { padding: 14px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  `;
}

export function renderNewAccessRequestEmail(data: NewAccessRequestEmailData): { subject: string; text: string; html: string } {
  const subject = `SITE WORK — New Access Request [${data.requestId}]`;

  const text = `
SITE WORK — AB CONSTRUCTIONS & INTERIORS
ACCESS REQUEST NOTIFICATION

A new user has requested access to the system.

REQUEST DETAILS:
- Request ID: ${data.requestId}
- Requester Name: ${data.requesterName}
- Requested Username: @${data.requestedUsername}
- Email: ${data.requestedEmail}
- Requested Role: ${data.requestedRole}
- Requested Timestamp: ${data.timestamp}

Please review this request:
${data.reviewUrl}

SECURITY NOTICE:
No credentials or passwords are included in this transmission.
Login is required to review, accept, or deny this access request.

Best regards,
AB CONSTRUCTIONS & INTERIORS
SITE WORK Governance System
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${getBaseStyles()}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>AB CONSTRUCTIONS &amp; INTERIORS</h1>
      <p>SITE WORK ACCESS GOVERNANCE</p>
    </div>
    <div class="content">
      <div class="title">New Account Access Request</div>
      <div class="subtitle">A new user has submitted a request for access. An authorized administrator must review and accept or deny this request.</div>
      
      <table class="table">
        <tr><td class="label">Request Reference</td><td class="val"><span class="badge-pending">${data.requestId}</span></td></tr>
        <tr><td class="label">Full Name</td><td class="val">${data.requesterName}</td></tr>
        <tr><td class="label">Username</td><td class="val">@${data.requestedUsername}</td></tr>
        <tr><td class="label">Email Address</td><td class="val">${data.requestedEmail}</td></tr>
        <tr><td class="label">Requested Role</td><td class="val">${data.requestedRole}</td></tr>
        <tr><td class="label">Submitted</td><td class="val">${data.timestamp}</td></tr>
      </table>

      <div class="btn-wrap">
        <a href="${data.reviewUrl}" class="btn" style="color: #ffffff;">REVIEW ACCESS REQUEST</a>
      </div>

      <div class="warning">
        <strong>Administrative Notice:</strong> Clicking this button will navigate to the secure administrative review console. Authenticated credentials are required to take any action.
      </div>
    </div>
    <div class="footer">
      Automated access control notification from SITE WORK Management System.
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

export function renderAccessRequestApprovedEmail(data: RequestApprovedEmailData): { subject: string; text: string; html: string } {
  const subject = 'SITE WORK — Your Access Request Has Been Approved';

  const text = `
SITE WORK — AB CONSTRUCTIONS & INTERIORS
ACCESS REQUEST APPROVED

Hello ${data.fullName},

Your request for account access has been reviewed and approved by an administrator.

ACCOUNT DETAILS:
- Username: @${data.username}
- Role: ${data.role}
- Status: ACTIVE

You may now sign in to your account with the password you chose during registration:
${data.signInUrl}

SECURITY NOTICE:
Never share your login credentials with anyone. If you have questions regarding site access or permissions, please contact your site administrator.

Best regards,
AB CONSTRUCTIONS & INTERIORS
SITE WORK System
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${getBaseStyles()}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>AB CONSTRUCTIONS &amp; INTERIORS</h1>
      <p>SITE WORK ACCESS MANAGEMENT</p>
    </div>
    <div class="content">
      <div class="title">Access Request Approved</div>
      <div class="subtitle">Hello <strong>${data.fullName}</strong>, your account has been approved and activated by an administrator.</div>
      
      <table class="table">
        <tr><td class="label">Username</td><td class="val">@${data.username}</td></tr>
        <tr><td class="label">Assigned Role</td><td class="val">${data.role}</td></tr>
        <tr><td class="label">Account Status</td><td class="val"><span class="badge-approved">ACTIVE</span></td></tr>
      </table>

      <div class="btn-wrap">
        <a href="${data.signInUrl}" class="btn" style="color: #ffffff;">SIGN IN TO SITE WORK</a>
      </div>

      <div class="warning">
        <strong>Security Notice:</strong> You can sign in using your username and the password chosen during your initial access request.
      </div>
    </div>
    <div class="footer">
      AB CONSTRUCTIONS &amp; INTERIORS &bull; SITE WORK Management System
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

export function renderAccessRequestDeniedEmail(data: RequestDeniedEmailData): { subject: string; text: string; html: string } {
  const subject = 'SITE WORK — Access Request Status Update';

  const reasonText = data.reason ? `Reason: ${data.reason}\n` : '';

  const text = `
SITE WORK — AB CONSTRUCTIONS & INTERIORS
ACCESS REQUEST STATUS UPDATE

Hello ${data.fullName},

Your request for account access (@${data.username}) was reviewed and has not been approved at this time.
${reasonText}
If you believe this was an error or need further assistance, please contact your organization administrator.

Best regards,
AB CONSTRUCTIONS & INTERIORS
SITE WORK System
`.trim();

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>${getBaseStyles()}</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>AB CONSTRUCTIONS &amp; INTERIORS</h1>
      <p>SITE WORK ACCESS MANAGEMENT</p>
    </div>
    <div class="content">
      <div class="title">Access Request Not Approved</div>
      <div class="subtitle">Hello <strong>${data.fullName}</strong>, your request for account access (@${data.username}) has not been approved at this time.</div>
      
      ${data.reason ? `
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 14px; margin: 16px 0; font-size: 13px; color: #991b1b;">
        <strong>Administrator Note:</strong> ${data.reason}
      </div>` : ''}

      <div class="warning">
        If you have questions regarding this decision, please speak directly with your site supervisor or organization administrator.
      </div>
    </div>
    <div class="footer">
      AB CONSTRUCTIONS &amp; INTERIORS &bull; SITE WORK Management System
    </div>
  </div>
</body>
</html>
`.trim();

  return { subject, text, html };
}

export type EmailTransportMode = 'DEV_CAPTURED' | 'SMTP';

/**
 * Deterministic source-of-truth for email transport selection.
 * Decision Matrix:
 * - EMAIL_MODE=smtp               -> 'SMTP' (Real email)
 * - EMAIL_MODE=development / dev  -> 'DEV_CAPTURED' (Dev-inbox only)
 * - NODE_ENV=production           -> 'SMTP' (Production standard)
 * - Default / missing flag        -> 'DEV_CAPTURED' (Safe fallback)
 */
export function resolveEmailTransportMode(): EmailTransportMode {
  const emailMode = (process.env.EMAIL_MODE || '').trim().toLowerCase();

  if (emailMode === 'smtp') {
    return 'SMTP';
  }

  if (emailMode === 'development' || emailMode === 'dev') {
    return 'DEV_CAPTURED';
  }

  if (process.env.NODE_ENV === 'production') {
    return 'SMTP';
  }

  return 'DEV_CAPTURED';
}

/**
 * Non-destructive connectivity verification for SMTP transport.
 * Tests host reachability and credentials without dispatching an email blast.
 */
export async function verifySmtpConnection(): Promise<{ success: boolean; error?: string }> {
  if (!isSmtpConfigured()) {
    return {
      success: false,
      error: 'SMTP credentials missing (SMTP_HOST, SMTP_USER, SMTP_PASSWORD required in .env.local)',
    };
  }

  try {
    const config = getSmtpConfig()!;
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    await transporter.verify();
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'SMTP verification failed';
    return { success: false, error: msg };
  }
}

export interface DispatchResult {
  success: boolean;
  deliveryStatus: 'SENT' | 'DEV_CAPTURED' | 'FAILED';
  error?: string;
  devCaptured?: boolean;
  messageId?: string;
  response?: string;
  envelope?: { from: string; to: string[] };
  accepted?: string[];
  rejected?: string[];
}

/**
 * Universal safe dispatcher for access request emails.
 * Supports configurable local SMTP when EMAIL_MODE=smtp,
 * and defaults to dev-inbox for offline/safe testing.
 */
export async function dispatchAccessRequestEmail({
  to,
  subject,
  text,
  html,
  metadata,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata?: Record<string, unknown>;
}): Promise<DispatchResult> {
  const transportMode = resolveEmailTransportMode();

  // 1. Development Dev-Inbox Transport
  if (transportMode === 'DEV_CAPTURED') {
    try {
      captureDevEmail({
        to,
        from: 'system@sitework.local',
        subject,
        text,
        html,
        metadata,
      });
      return { success: true, deliveryStatus: 'DEV_CAPTURED', devCaptured: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to capture dev email';
      return { success: false, deliveryStatus: 'FAILED', error: msg };
    }
  }

  // 2. Real SMTP Transport (Requested via EMAIL_MODE=smtp or in Production)
  if (!isSmtpConfigured()) {
    return {
      success: false,
      deliveryStatus: 'FAILED',
      error: 'SMTP configuration missing or incomplete (SMTP_HOST, SMTP_USER, SMTP_PASSWORD required)',
    };
  }

  try {
    const config = getSmtpConfig()!;
    const isDebugActive = process.env.NODE_ENV !== 'production' || process.env.DEBUG_SMTP === 'true';

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      debug: isDebugActive,
      logger: isDebugActive
        ? {
            level: () => {},
            trace: () => {},
            debug: (entry: any, ...args: any[]) => {
              const str = typeof entry === 'string' ? entry : JSON.stringify(entry);
              if (!str.includes('AUTH') && !str.includes(config.pass)) {
                console.log('[SMTP DEBUG]', str, ...args);
              }
            },
            info: (entry: any, ...args: any[]) => {
              const str = typeof entry === 'string' ? entry : JSON.stringify(entry);
              if (!str.includes(config.pass)) {
                console.log('[SMTP INFO]', str, ...args);
              }
            },
            warn: (entry: any, ...args: any[]) => console.warn('[SMTP WARN]', entry, ...args),
            error: (entry: any, ...args: any[]) => console.error('[SMTP ERROR]', entry, ...args),
          }
        : false,
    } as any);

    const envelope = {
      from: config.user,
      to: [to],
    };

    const hostDomain = config.user.includes('@') ? config.user.split('@')[1] : 'sitework.local';
    const uniqueMessageId = `<ar-${Date.now()}-${crypto.randomBytes(4).toString('hex')}@${hostDomain}>`;

    const info = await transporter.sendMail({
      from: config.from,
      to,
      subject,
      text,
      html,
      envelope,
      messageId: uniqueMessageId,
      date: new Date(),
      headers: {
        'X-Entity-Ref-ID': (metadata?.requestId as string) || uniqueMessageId,
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
      },
    });

    const acceptedList = (info.accepted || []).map((a: any) =>
      typeof a === 'string' ? a : a.address || String(a)
    );
    const rejectedList = (info.rejected || []).map((r: any) =>
      typeof r === 'string' ? r : r.address || String(r)
    );

    const wasAccepted = acceptedList.some(
      (a: string) => a.toLowerCase() === to.toLowerCase()
    );
    const wasRejected = rejectedList.some(
      (r: string) => r.toLowerCase() === to.toLowerCase()
    );

    if (wasRejected || !wasAccepted) {
      const rejectReason = wasRejected
        ? `Recipient rejected by SMTP server: ${info.response || 'Unknown rejection'}`
        : `Recipient was not accepted by SMTP server: ${info.response || 'Unconfirmed delivery'}`;

      return {
        success: false,
        deliveryStatus: 'FAILED',
        error: rejectReason,
        messageId: info.messageId || uniqueMessageId,
        response: info.response,
        envelope,
        accepted: acceptedList,
        rejected: rejectedList,
      };
    }

    return {
      success: true,
      deliveryStatus: 'SENT',
      messageId: info.messageId || uniqueMessageId,
      response: info.response,
      envelope,
      accepted: acceptedList,
      rejected: rejectedList,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown SMTP dispatch error';
    return { success: false, deliveryStatus: 'FAILED', error: msg };
  }
}
