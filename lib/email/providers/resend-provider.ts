import { EmailMessage, DeliveryResult, TransactionalEmailProvider } from './types';

export class ResendEmailProvider implements TransactionalEmailProvider {
  readonly name = 'resend';
  private apiKey: string;
  private defaultFrom: string;

  constructor(apiKey?: string, defaultFrom?: string) {
    this.apiKey = apiKey || process.env.RESEND_API_KEY || '';
    this.defaultFrom = defaultFrom || process.env.EMAIL_FROM || '"AB CONSTRUCTIONS & INTERIORS" <onboarding@resend.dev>';
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        provider: 'resend',
        deliveryStatus: 'FAILED',
        errorCode: 'MISSING_API_KEY',
        errorMessage: 'RESEND_API_KEY is not configured in the environment',
      };
    }

    const fromAddress = message.from || this.defaultFrom;
    const sanitizedTo = message.to.trim();

    try {
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${this.apiKey.trim()}`,
        'Content-Type': 'application/json',
      };

      if (message.idempotencyKey) {
        headers['Idempotency-Key'] = message.idempotencyKey;
      }

      const bodyPayload: Record<string, any> = {
        from: fromAddress,
        to: [sanitizedTo],
        subject: message.subject,
        html: message.html,
        text: message.text,
      };

      if (message.replyTo || process.env.EMAIL_REPLY_TO) {
        bodyPayload.reply_to = message.replyTo || process.env.EMAIL_REPLY_TO;
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyPayload),
      });

      const resData = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Mask any potential key exposure in error output
        const rawErr = typeof resData === 'object' && resData !== null
          ? (resData.message || resData.error || JSON.stringify(resData))
          : 'Unknown Resend API error';
        const safeError = String(rawErr).replace(this.apiKey, '***');

        return {
          success: false,
          provider: 'resend',
          deliveryStatus: 'FAILED',
          errorCode: `RESEND_HTTP_${response.status}`,
          errorMessage: safeError,
          rejected: [sanitizedTo],
        };
      }

      const providerMessageId = resData.id || `resend-${Date.now()}`;

      return {
        success: true,
        provider: 'resend',
        deliveryStatus: 'SENT',
        providerMessageId,
        accepted: [sanitizedTo],
        envelope: {
          from: fromAddress,
          to: [sanitizedTo],
        },
      };
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : 'Resend request failed';
      const safeMsg = rawMsg.replace(this.apiKey, '***');

      return {
        success: false,
        provider: 'resend',
        deliveryStatus: 'FAILED',
        errorCode: 'NETWORK_EXCEPTION',
        errorMessage: safeMsg,
        rejected: [sanitizedTo],
      };
    }
  }
}
