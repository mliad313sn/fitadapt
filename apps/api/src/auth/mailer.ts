import type { Locale } from '@fitadapt/shared';

export interface OneTimeCodeMessage {
  to: string;
  code: string;
  locale: Locale;
  expiresInSeconds: number;
}

/**
 * Delivers one-time codes. Implementations must never log the code or the
 * address. Email wording will come from packages/i18n (and packages/legal
 * for any legal footer) when a real provider is chosen.
 */
export interface Mailer {
  sendOneTimeCode(message: OneTimeCodeMessage): Promise<void>;
}

/** Keeps messages in memory. Used by tests to capture codes, and by the local dev mailbox. */
export class MemoryMailer implements Mailer {
  readonly sent: OneTimeCodeMessage[] = [];

  async sendOneTimeCode(message: OneTimeCodeMessage): Promise<void> {
    this.sent.push({ ...message });
  }

  lastCodeFor(email: string): string | undefined {
    return this.sent.findLast((m) => m.to === email)?.code;
  }
}
