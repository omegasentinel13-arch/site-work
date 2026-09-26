import nodemailer from 'nodemailer';
import { EmailMessage, DeliveryResult, TransactionalEmailProvider } from './types';
import { isSmtpConfigured, getSmtpConfig } from '../mailer';

export class SmtpEmailProvider implements TransactionalEmailProvider {
  readonly name = 'smtp';

  async send(message: EmailMessage): Promise<DeliveryResult> {
    // Hard guard: Railway and production strictly disallow raw SMTP
    if (process.env.RAILWAY_ENVIRONMENT || (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SMTP !== 'true')) {
      return {
        success: false,
        provider: 'smtp',
        deliveryStatus: 'FAILED',
        errorCode: 'SMTP_DISALLOWED_IN_PRODUCTION',
        errorMessage: 'Raw SMTP is blocked on Railway. Production requires an HTTPS transactional email provider (EMAIL_PROVIDER=resend).',
        rejected: [message.to],
      };
    }

    if (!isSmtpConfigured()) {
      return {
        success: false,
        provider: 'smtp',
        deliveryStatus: 'FAILED',
        errorCode: 'SMTP_NOT_CONFIGURED',
        errorMessage: 'SMTP credentials missing (SMTP_HOST, SMTP_USER, SMTP_PASSWORD required)',
        rejected: [message.to],
      };
    }

    const config = getSmtpConfig()!;
    const fromAddress = message.from || config.from;
    const sanitizedTo = message.to.trim();

    try {
      const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
          user: config.user,
          pass: config.pass,
        },
      } as any);

      const info = await transporter.sendMail({
        from: fromAddress,
        to: sanitizedTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        envelope: {
          from: config.user,
          to: [sanitizedTo],
        },
      });

      return {
        success: true,
        provider: 'smtp',
        deliveryStatus: 'SENT',
        providerMessageId: info.messageId,
        accepted: [sanitizedTo],
        envelope: {
          from: config.user,
          to: [sanitizedTo],
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'SMTP delivery failed';
      return {
        success: false,
        provider: 'smtp',
        deliveryStatus: 'FAILED',
        errorCode: 'SMTP_TRANSPORT_ERROR',
        errorMessage: msg,
        rejected: [sanitizedTo],
      };
    }
  }
}
