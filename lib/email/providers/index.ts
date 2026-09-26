import { TransactionalEmailProvider } from './types';
import { ResendEmailProvider } from './resend-provider';
import { MockTransactionalEmailProvider } from './mock-provider';
import { SmtpEmailProvider } from './smtp-provider';
import { DevCapturedEmailProvider } from './dev-captured-provider';

export * from './types';
export * from './resend-provider';
export * from './mock-provider';
export * from './smtp-provider';
export * from './dev-captured-provider';

let testProviderInstance: TransactionalEmailProvider | null = null;

export function setTestEmailProvider(provider: TransactionalEmailProvider | null): void {
  testProviderInstance = provider;
}

export function getTransactionalEmailProvider(): TransactionalEmailProvider {
  if (testProviderInstance) {
    return testProviderInstance;
  }

  const configuredProvider = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const emailMode = (process.env.EMAIL_MODE || '').trim().toLowerCase();

  if (configuredProvider === 'mock') {
    return new MockTransactionalEmailProvider();
  }

  // Production or explicitly requested Resend
  if (configuredProvider === 'resend' || process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT) {
    return new ResendEmailProvider();
  }

  // Localhost explicitly requesting SMTP
  if (configuredProvider === 'smtp' || emailMode === 'smtp') {
    return new SmtpEmailProvider();
  }

  // Safe default for offline local development
  return new DevCapturedEmailProvider();
}
