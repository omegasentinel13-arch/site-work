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
