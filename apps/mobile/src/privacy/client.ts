import {
  ACCOUNT_DELETION_CONFIRMATION,
  AccountDeletionResponseSchema,
  DataExportSchema,
  type AccountDeletionResponse,
  type DataExport,
} from '@fitadapt/shared';

/** The API's data-subject-rights endpoints, as the privacy screen uses them. */
export interface PrivacyClient {
  exportData(): Promise<DataExport>;
  deleteAccount(): Promise<AccountDeletionResponse>;
}

export class PrivacyRequestError extends Error {
  constructor(readonly status: number) {
    super(`privacy request failed with status ${status}`);
    this.name = 'PrivacyRequestError';
  }
}

export function createHttpPrivacyClient(deps: {
  baseUrl: string;
  getAccessToken: () => string | Promise<string>;
  fetch?: typeof fetch;
}): PrivacyClient {
  const doFetch = deps.fetch ?? fetch;
  const call = async (path: string, init: RequestInit) => {
    const res = await doFetch(`${deps.baseUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${await deps.getAccessToken()}`, 'content-type': 'application/json' },
    });
    if (!res.ok) throw new PrivacyRequestError(res.status);
    return res.json() as Promise<unknown>;
  };
  return {
    async exportData() {
      return DataExportSchema.parse(await call('/v1/privacy/export', { method: 'GET' }));
    },
    async deleteAccount() {
      const body = JSON.stringify({ confirm: ACCOUNT_DELETION_CONFIRMATION });
      return AccountDeletionResponseSchema.parse(await call('/v1/privacy/deletion', { method: 'POST', body }));
    },
  };
}
