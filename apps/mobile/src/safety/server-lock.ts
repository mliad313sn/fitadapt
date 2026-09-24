import { ServerIntensityLockSchema, type ServerIntensityLock } from '@fitadapt/shared';
import { OfflineError } from '@fitadapt/sync';

/**
 * MOB-08 (ADR-027) × FIX-D: reads the S3 intensity lock the server retains
 * (`GET /v1/safety/intensity-lock`). Only called when online and signed in;
 * any failure leaves the device's last answer, and its own lock, in place.
 * No health detail is sent or logged: the answer holds a time and ids only.
 */
export function createServerLockApi(deps: { baseUrl: string; getAccessToken: () => string | Promise<string>; fetch?: typeof fetch }) {
  const doFetch = deps.fetch ?? fetch;
  return async function fetchServerLock(): Promise<ServerIntensityLock> {
    let res: Response;
    try {
      res = await doFetch(`${deps.baseUrl}/v1/safety/intensity-lock`, { method: 'GET', headers: { authorization: `Bearer ${await deps.getAccessToken()}` } });
    } catch {
      // No network (or not signed in): the device keeps its last answer and its own lock.
      throw new OfflineError('intensity-lock unreachable');
    }
    if (!res.ok) throw new Error(`intensity-lock request failed with status ${res.status}`);
    return ServerIntensityLockSchema.parse(await res.json());
  };
}

/**
 * Reads the server's lock into the profile store. Failures change nothing; being offline is not an error
 * (airplane mode), any other failure is reported (without data).
 */
export async function refreshServerLock(fetchServerLock: () => Promise<ServerIntensityLock>, receive: (lock: ServerIntensityLock) => void, onError: (error: unknown) => void): Promise<void> {
  try {
    receive(await fetchServerLock());
  } catch (error) {
    if (!(error instanceof OfflineError)) onError(error);
  }
}
