import { EmailMessage, DeliveryResult, TransactionalEmailProvider } from './types';
import { captureDevEmail } from '../dev-inbox';

export class DevCapturedEmailProvider implements TransactionalEmailProvider {
  readonly name = 'dev_captured';

  async send(message: EmailMessage): Promise<DeliveryResult> {
    if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
      return {
        success: false,
        provider: 'dev_captured',
        deliveryStatus: 'FAILED',
        errorCode: 'DEV_CAPTURED_DISALLOWED_IN_PRODUCTION',
        errorMessage: 'Dev-captured email transport is strictly prohibited in production environments.',
        rejected: [message.to],
      };
    }

    try {
      captureDevEmail({
        to: message.to,
        from: message.from || 'system@sitework.local',
        subject: message.subject,
        text: message.text,
        html: message.html,
        metadata: message.metadata,
      });

      return {
        success: true,
        provider: 'dev_captured',
        deliveryStatus: 'DEV_CAPTURED',
        providerMessageId: `dev-${Date.now()}`,
        accepted: [message.to],
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dev capture failed';
      return {
        success: false,
        provider: 'dev_captured',
        deliveryStatus: 'FAILED',
        errorCode: 'CAPTURE_ERROR',
        errorMessage: msg,
        rejected: [message.to],
      };
    }
  }
}
