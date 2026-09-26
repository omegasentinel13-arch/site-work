import { EmailMessage, DeliveryResult, TransactionalEmailProvider } from './types';

export interface MockRecipientRule {
  recipientPattern?: RegExp | string;
  status: 'SENT' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
  providerMessageId?: string;
}

export class MockTransactionalEmailProvider implements TransactionalEmailProvider {
  readonly name = 'mock';
  public sentMessages: EmailMessage[] = [];
  public customRules: MockRecipientRule[] = [];
  public defaultStatus: 'SENT' | 'FAILED' = 'SENT';

  reset(): void {
    this.sentMessages = [];
    this.customRules = [];
    this.defaultStatus = 'SENT';
  }

  addRule(rule: MockRecipientRule): void {
    this.customRules.push(rule);
  }

  async send(message: EmailMessage): Promise<DeliveryResult> {
    this.sentMessages.push({ ...message });

    // Check custom recipient rules
    for (const rule of this.customRules) {
      if (rule.recipientPattern) {
        const matches = typeof rule.recipientPattern === 'string'
          ? message.to.includes(rule.recipientPattern)
          : rule.recipientPattern.test(message.to);

        if (matches) {
          if (rule.status === 'FAILED') {
            return {
              success: false,
              provider: 'mock',
              deliveryStatus: 'FAILED',
              errorCode: rule.errorCode || 'MOCK_DELIVERY_FAILURE',
              errorMessage: rule.errorMessage || `Simulated delivery failure for ${message.to}`,
              rejected: [message.to],
            };
          }
          return {
            success: true,
            provider: 'mock',
            deliveryStatus: 'SENT',
            providerMessageId: rule.providerMessageId || `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            accepted: [message.to],
            envelope: { from: message.from || 'mock@sitework.local', to: [message.to] },
          };
        }
      }
    }

    if (this.defaultStatus === 'FAILED') {
      return {
        success: false,
        provider: 'mock',
        deliveryStatus: 'FAILED',
        errorCode: 'MOCK_DEFAULT_FAILURE',
        errorMessage: 'Default mock delivery failure',
        rejected: [message.to],
      };
    }

    return {
      success: true,
      provider: 'mock',
      deliveryStatus: 'SENT',
      providerMessageId: `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      accepted: [message.to],
      envelope: { from: message.from || 'mock@sitework.local', to: [message.to] },
    };
  }
}
