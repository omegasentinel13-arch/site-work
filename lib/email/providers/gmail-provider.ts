import { EmailMessage, DeliveryResult, TransactionalEmailProvider } from './types';

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

export class GmailApiEmailProvider implements TransactionalEmailProvider {
  readonly name = 'gmail';

  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private defaultFrom: string;
  private cachedToken: CachedToken | null = null;

  constructor(config?: { clientId?: string; clientSecret?: string; refreshToken?: string; defaultFrom?: string }) {
    this.clientId = (config?.clientId || process.env.GMAIL_CLIENT_ID || '').trim();
    this.clientSecret = (config?.clientSecret || process.env.GMAIL_CLIENT_SECRET || '').trim();
    this.refreshToken = (config?.refreshToken || process.env.GMAIL_REFRESH_TOKEN || '').trim();
    this.defaultFrom = (config?.defaultFrom || process.env.EMAIL_FROM || 'AB CONSTRUCTIONS & INTERIORS <omegasentinel13@gmail.com>').trim();
  }

  isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret && this.refreshToken);
  }

  /**
   * Deep sanitizer ensuring no access tokens, refresh tokens, client secrets,
   * or Authorization headers leak into persistent audit logs, databases, or console outputs.
   */
  private sanitizeError(raw: unknown): string {
    let str = typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : String(raw || 'Unknown error');
    if (this.clientSecret) str = str.split(this.clientSecret).join('***');
    if (this.refreshToken) str = str.split(this.refreshToken).join('***');
    if (this.cachedToken?.accessToken) str = str.split(this.cachedToken.accessToken).join('***');

    // Generic pattern redactor for tokens, headers, and credentials
    str = str.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer ***');
    str = str.replace(/ya29\.[A-Za-z0-9._-]+/gi, 'ya29.***');
    str = str.replace(/client_secret=[^&\s]+/gi, 'client_secret=***');
    str = str.replace(/refresh_token=[^&\s]+/gi, 'refresh_token=***');

    return str;
  }

  /**
   * Refreshes access token via HTTPS POST to https://oauth2.googleapis.com/token.
   * Caches token in-memory with a safe expiry buffer.
   * Fails closed without initiating interactive OAuth flows.
   */
  private async getAccessToken(): Promise<{ token?: string; error?: string; errorCode?: string }> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAtMs) {
      return { token: this.cachedToken.accessToken };
    }

    try {
      const body = new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      });

      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorDesc = this.sanitizeError(data.error_description || data.error || 'Token refresh failed');
        if (data.error === 'invalid_grant') {
          return {
            errorCode: 'GMAIL_AUTH_EXPIRED',
            error: `GMAIL_AUTH_EXPIRED: Refresh token expired or revoked (${errorDesc}). Reauthorization required.`,
          };
        }
        if (data.error === 'invalid_client') {
          return {
            errorCode: 'GMAIL_CLIENT_INVALID',
            error: `GMAIL_CLIENT_INVALID: OAuth Client ID or Secret rejected by Google (${errorDesc}).`,
          };
        }
        return {
          errorCode: 'GMAIL_AUTH_FAILED',
          error: `GMAIL_AUTH_FAILED: ${errorDesc}`,
        };
      }

      if (!data.access_token) {
        return { errorCode: 'GMAIL_TOKEN_MISSING', error: 'No access_token returned by Google token endpoint' };
      }

      const expiresInSec = typeof data.expires_in === 'number' ? data.expires_in : 3600;
      // Guard: Ensure expiresAtMs is always in the future even for short test expiries
      const bufferSec = expiresInSec > 120 ? 60 : Math.max(5, Math.floor(expiresInSec / 4));
      this.cachedToken = {
        accessToken: data.access_token,
        expiresAtMs: Date.now() + (expiresInSec - bufferSec) * 1000,
      };

      return { token: this.cachedToken.accessToken };
    } catch (err: unknown) {
      const msg = this.sanitizeError(err instanceof Error ? err.message : 'Network error during token refresh');
      return { errorCode: 'GMAIL_NETWORK_ERROR', error: `GMAIL_TOKEN_NETWORK_ERROR: ${msg}` };
    }
  }

  /**
   * Constructs compliant RFC-2822 MIME multipart message with strict CRLF line endings
   * preserving mandatory blank lines between headers and bodies.
   */
  public buildRfc2822Message(message: EmailMessage, fromAddress: string): string {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const encodedSubject = `=?UTF-8?B?${Buffer.from(message.subject, 'utf-8').toString('base64')}?=`;

    const headers: string[] = [
      `From: ${fromAddress}`,
      `To: ${message.to.trim()}`,
    ];
    if (message.replyTo) {
      headers.push(`Reply-To: ${message.replyTo.trim()}`);
    }
    headers.push(
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`
    );

    const parts: string[] = [
      headers.join('\r\n'),
      '', // Preserves blank line (CRLF CRLF) between message headers and multipart body
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '', // Preserves blank line between text part headers and text content
      message.text,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: 8bit',
      '', // Preserves blank line between html part headers and html content
      message.html,
      `--${boundary}--`,
      '', // Trailing CRLF
    ];

    return parts.join('\r\n');
  }

  /**
   * Converts RFC-2822 MIME string into URL-safe Base64 as required by the Gmail API.
   * Strips padding '=' and converts '+' -> '-' and '/' -> '_'.
   */
  public toBase64Url(mimeString: string): string {
    return Buffer.from(mimeString, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        provider: 'gmail',
        deliveryStatus: 'FAILED',
        errorCode: 'MISSING_GMAIL_CREDENTIALS',
        errorMessage: 'GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, or GMAIL_REFRESH_TOKEN is not configured in the environment',
        rejected: [message.to],
      };
    }

    const { token, error, errorCode } = await this.getAccessToken();
    if (!token || error) {
      return {
        success: false,
        provider: 'gmail',
        deliveryStatus: 'FAILED',
        errorCode: errorCode || 'GMAIL_AUTH_FAILED',
        errorMessage: error || 'Failed to authenticate with Google OAuth2',
        rejected: [message.to],
      };
    }

    const fromAddress = message.from || this.defaultFrom;
    const sanitizedTo = message.to.trim();

    try {
      const mime = this.buildRfc2822Message(message, fromAddress);
      const rawBase64Url = this.toBase64Url(mime);

      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw: rawBase64Url }),
      });

      const resData = await response.json().catch(() => ({}));

      if (!response.ok) {
        const rawErr = resData.error?.message || JSON.stringify(resData.error || resData);
        const safeError = this.sanitizeError(rawErr);

        let code = `GMAIL_HTTP_${response.status}`;
        if (response.status === 429 || resData.error?.errors?.[0]?.reason === 'rateLimitExceeded') {
          code = 'GMAIL_RATE_LIMITED';
        } else if (resData.error?.errors?.[0]?.reason === 'dailyLimitExceeded') {
          code = 'GMAIL_DAILY_LIMIT_EXCEEDED';
        }

        return {
          success: false,
          provider: 'gmail',
          deliveryStatus: 'FAILED',
          errorCode: code,
          errorMessage: safeError,
          rejected: [sanitizedTo],
        };
      }

      const providerMessageId = resData.id || `gmail-${Date.now()}`;

      return {
        success: true,
        provider: 'gmail',
        deliveryStatus: 'SENT',
        providerMessageId,
        accepted: [sanitizedTo],
        envelope: {
          from: fromAddress,
          to: [sanitizedTo],
        },
      };
    } catch (err: unknown) {
      const safeMsg = this.sanitizeError(err instanceof Error ? err.message : 'Gmail API request failed');

      return {
        success: false,
        provider: 'gmail',
        deliveryStatus: 'FAILED',
        errorCode: 'NETWORK_EXCEPTION',
        errorMessage: safeMsg,
        rejected: [sanitizedTo],
      };
    }
  }
}
