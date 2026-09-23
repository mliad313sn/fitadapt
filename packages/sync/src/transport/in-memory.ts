import type { PullRequest, PullResponse, PushRequest, PushResponse } from '@fitadapt/shared';
import { OfflineError } from '../errors.js';
import type { SyncServer } from '../server/sync-server.js';
import type { SyncTransport } from './types.js';

/**
 * Connects a client directly to a SyncServer (tests, simulations). Supports
 * going offline and losing the response after the server applied a push,
 * which is how duplicate pushes happen in real life.
 */
export class InMemoryTransport implements SyncTransport {
  online = true;
  /** When set, the next push reaches the server but the response is lost. */
  dropNextPushResponse = false;
  pushCalls = 0;

  constructor(
    private readonly server: SyncServer,
    private readonly userId: string,
  ) {}

  async push(request: PushRequest): Promise<PushResponse> {
    if (!this.online) throw new OfflineError();
    this.pushCalls += 1;
    const response = await this.server.push(this.userId, request);
    if (this.dropNextPushResponse) {
      this.dropNextPushResponse = false;
      throw new OfflineError('connection lost before response');
    }
    return response;
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    if (!this.online) throw new OfflineError();
    return this.server.pull(this.userId, request);
  }
}
