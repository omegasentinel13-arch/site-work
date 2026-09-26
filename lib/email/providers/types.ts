export interface EmailMessage {
  from?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface DeliveryResult {
  success: boolean;
  provider: 'gmail' | 'resend' | 'mock' | 'smtp' | 'dev_captured';
  deliveryStatus: 'SENT' | 'FAILED' | 'DEV_CAPTURED';
  providerMessageId?: string;
  accepted?: string[];
  rejected?: string[];
  errorCode?: string;
  errorMessage?: string;
  envelope?: { from: string; to: string[] };
}

export interface TransactionalEmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<DeliveryResult>;
}
