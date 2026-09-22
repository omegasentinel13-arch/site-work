import nodemailer from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function isSmtpConfigured(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();

  return Boolean(host && user && pass);
}

function getSmtpConfig(): SmtpConfig | null {
  if (!isSmtpConfigured()) {
    return null;
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER!.trim();
  const from = process.env.SMTP_FROM?.trim() || `"AB CONSTRUCTIONS & INTERIORS — SITE WORK" <${user}>`;

  return {
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure,
    user,
    pass: process.env.SMTP_PASSWORD!.trim(),
    from,
  };
}

export async function sendRecoveryOtpEmail({
  to,
  username,
  otp,
}: {
  to: string;
  username: string;
  otp: string;
}): Promise<{ success: boolean; error?: string }> {
  const config = getSmtpConfig();

  if (!config) {
    return {
      success: false,
      error: 'RECOVERY EMAIL PROVIDER NOT CONFIGURED: SMTP environment variables (SMTP_HOST, SMTP_USER, SMTP_PASSWORD) are missing.',
    };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    const subject = 'SITE WORK — Administrator Password Recovery';

    const textContent = `
SITE WORK — AB CONSTRUCTIONS & INTERIORS
Administrator Password Recovery

Hello,

A password recovery request was received for the administrator account: @${username}

Your 6-digit recovery verification code is:

  ${otp}

This code is valid for 15 minutes and can only be used once.

SECURITY WARNING:
- Do not share this code with anyone.
- If you did not initiate this recovery request, please ignore this email. Your current password remains secure.

Best regards,
AB CONSTRUCTIONS & INTERIORS
SITE WORK System
`.trim();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .card { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: #0f172a; padding: 24px; text-align: center; }
    .header h1 { color: #f59e0b; margin: 0; font-size: 18px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
    .header p { color: #94a3b8; margin: 4px 0 0 0; font-size: 12px; font-weight: 600; }
    .content { padding: 32px 24px; }
    .greeting { font-size: 15px; font-weight: 600; color: #1e293b; margin-bottom: 16px; }
    .otp-box { background: #fef3c7; border: 2px dashed #f59e0b; border-radius: 8px; text-align: center; padding: 18px; margin: 24px 0; }
    .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #92400e; font-family: monospace; }
    .expiry { font-size: 12px; color: #b45309; font-weight: 600; margin-top: 6px; }
    .warning { background: #f1f5f9; border-left: 4px solid #64748b; padding: 12px 16px; border-radius: 4px; font-size: 12px; color: #475569; line-height: 1.5; margin-top: 24px; }
    .footer { padding: 16px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>AB CONSTRUCTIONS &amp; INTERIORS</h1>
      <p>SITE WORK MANAGEMENT SYSTEM</p>
    </div>
    <div class="content">
      <div class="greeting">Administrator Password Recovery</div>
      <p style="font-size: 14px; color: #334155; line-height: 1.5; margin: 0;">
        A password reset was requested for administrator account <strong>@${username}</strong>. Use the verification code below to reset your password:
      </p>
      
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
        <div class="expiry">Valid for 15 minutes &bull; Single-use code</div>
      </div>

      <div class="warning">
        <strong>Security Notice:</strong>
        <br>
        Never share this recovery code with anyone. If you did not make this request, you can safely ignore this email.
      </div>
    </div>
    <div class="footer">
      This is an automated system email from SITE WORK. Please do not reply directly to this message.
    </div>
  </div>
</body>
</html>
`.trim();

    await transporter.sendMail({
      from: config.from,
      to,
      subject,
      text: textContent,
      html: htmlContent,
    });

    return { success: true };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown email delivery error';
    return { success: false, error: errorMsg };
  }
}

export interface NewUserNotificationData {
  fullName: string;
  username: string;
  authorityTier: string;
  role: string;
  createdBy: string;
  createdAt: string;
  siteScope: string;
  siteNames?: string[];
  auditId?: string;
}

export async function sendNewUserNotificationEmail(data: NewUserNotificationData): Promise<{
  success: boolean;
  errors?: string[];
}> {
  const config = getSmtpConfig();
  if (!config) {
    return {
      success: false,
      errors: ['SMTP environment configuration missing'],
    };
  }

  const recipients = ['omegasentinel13@gmail.com', 'supermanskrypton@gmail.com'];
  const subject = 'SITE WORK — New User Created';

  const assignedSitesText = data.siteNames && data.siteNames.length > 0 
    ? data.siteNames.join(', ')
    : data.siteScope;

  const textContent = `
SITE WORK — AB CONSTRUCTIONS & INTERIORS
Identity & Access Governance Notification: New User Created

A new user account has been successfully provisioned in the system.

ACCOUNT DETAILS:
- Full Name: ${data.fullName}
- Username: @${data.username}
- Authority Tier: ${data.authorityTier}
- Operational Role: ${data.role}
- Created By: ${data.createdBy}
- Created Timestamp: ${data.createdAt}
- Assigned Site Scope: ${data.siteScope}
- Assigned Sites: ${assignedSitesText}
- Audit Event Reference: ${data.auditId || 'N/A'}

SECURITY NOTICE:
No password or credential material is included in this automated notification.
If this user creation was not authorized, please review the Audit Trail immediately.

Best regards,
AB CONSTRUCTIONS & INTERIORS
SITE WORK Governance System
`.trim();

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); }
    .header { background: #0f172a; padding: 20px 24px; text-align: center; }
    .header h1 { color: #f59e0b; margin: 0; font-size: 16px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
    .header p { color: #94a3b8; margin: 4px 0 0 0; font-size: 11px; font-weight: 600; }
    .content { padding: 28px 24px; }
    .title { font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 16px; }
    .table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }
    .table td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .table td.label { font-weight: 600; color: #64748b; width: 40%; }
    .table td.val { font-weight: 700; color: #0f172a; font-family: monospace; }
    .warning { background: #f8fafc; border-left: 4px solid #f59e0b; padding: 12px 16px; border-radius: 4px; font-size: 12px; color: #475569; margin-top: 20px; line-height: 1.5; }
    .footer { padding: 14px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>AB CONSTRUCTIONS &amp; INTERIORS</h1>
      <p>SITE WORK GOVERNANCE NOTIFICATION</p>
    </div>
    <div class="content">
      <div class="title">New User Account Created</div>
      <table class="table">
        <tr><td class="label">Full Name</td><td class="val">${data.fullName}</td></tr>
        <tr><td class="label">Username</td><td class="val">@${data.username}</td></tr>
        <tr><td class="label">Authority Tier</td><td class="val">${data.authorityTier}</td></tr>
        <tr><td class="label">Operational Role</td><td class="val">${data.role}</td></tr>
        <tr><td class="label">Created By</td><td class="val">${data.createdBy}</td></tr>
        <tr><td class="label">Created Timestamp</td><td class="val">${data.createdAt}</td></tr>
        <tr><td class="label">Site Scope</td><td class="val">${data.siteScope}</td></tr>
        <tr><td class="label">Assigned Sites</td><td class="val">${assignedSitesText}</td></tr>
        <tr><td class="label">Audit Reference</td><td class="val">${data.auditId || 'N/A'}</td></tr>
      </table>
      <div class="warning">
        <strong>Security Notice:</strong> No passwords or credentials are transmitted in this notification.
      </div>
    </div>
    <div class="footer">
      Automated administrative notification from SITE WORK Access Governance.
    </div>
  </div>
</body>
</html>
`.trim();

  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });

    const errors: string[] = [];
    for (const to of recipients) {
      try {
        await transporter.sendMail({
          from: config.from,
          to,
          subject,
          text: textContent,
          html: htmlContent,
        });
      } catch (err: unknown) {
        errors.push(`Failed to send to ${to}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return {
      success: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err: unknown) {
    return {
      success: false,
      errors: [err instanceof Error ? err.message : 'Transport configuration error'],
    };
  }
}
