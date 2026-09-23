import type { PullRequest, PullResponse, PushRequest, PushResponse } from '@fitadapt/shared';

/** How a device talks to the sync server. Throws OfflineError when the network is unavailable. */
export interface SyncTransport {
  push(request: PushRequest): Promise<PushResponse>;
  pull(request: PullRequest): Promise<PullResponse>;
}
