import type { Change, PushResult } from '@fitadapt/shared';
import type { NewChange, ServerStore, ServerTx } from './types.js';

interface UserLog {
  changes: Change[];
  mutations: Map<string, PushResult>;
}

/** In-memory ServerStore for tests. Transactions are serialised per user and roll back on throw. */
export class MemoryServerStore implements ServerStore {
  private readonly users = new Map<string, UserLog>();
  private readonly locks = new Map<string, Promise<unknown>>();

  private log(userId: string): UserLog {
    let log = this.users.get(userId);
    if (!log) {
      log = { changes: [], mutations: new Map() };
      this.users.set(userId, log);
    }
    return log;
  }

  async transaction<T>(userId: string, fn: (tx: ServerTx) => Promise<T>): Promise<T> {
    const previous = this.locks.get(userId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const log = this.log(userId);
      const staged: UserLog = { changes: [...log.changes], mutations: new Map(log.mutations) };
      const tx: ServerTx = {
        findMutationResult: async (_u, id) => staged.mutations.get(id),
        saveMutationResult: async (_u, result) => {
          staged.mutations.set(result.mutationId, result);
        },
        latestChange: async (_u, collection, recordId) =>
          staged.changes.findLast((c) => c.collection === collection && c.recordId === recordId),
        appendChange: async (_u, change: NewChange) => {
          const full: Change = { ...change, revision: staged.changes.length + 1 };
          staged.changes.push(full);
          return full;
        },
      };
      const result = await fn(tx);
      this.users.set(userId, staged);
      return result;
    });
    this.locks.set(
      userId,
      run.catch(() => undefined),
    );
    return run;
  }

  async listChanges(userId: string, since: number, limit: number): Promise<Change[]> {
    return this.log(userId)
      .changes.filter((c) => c.revision > since)
      .slice(0, limit);
  }

  /** Test helper: number of changes stored for a user. */
  changeCount(userId: string): number {
    return this.log(userId).changes.length;
  }
}
