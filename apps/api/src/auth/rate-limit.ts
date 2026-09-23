import type { Redis } from 'ioredis';

/**
 * Fixed-window counter in Redis (Redis holds rate limits and queues, never
 * timer state). Keys contain only keyed hashes, never raw emails or IPs.
 */
export class RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  /** Counts one hit; returns false once the limit for the window is exceeded. */
  async hit(bucket: string, subjectHash: string, limit: number, windowSeconds: number): Promise<boolean> {
    const key = `${this.prefix}rl:${bucket}:${subjectHash}`;
    const [[, count]] = (await this.redis.multi().incr(key).expire(key, windowSeconds, 'NX').exec()) as [[Error | null, number]];
    return count <= limit;
  }

  /** Removes the counters of a subject (e.g. after account deletion). */
  async clear(buckets: readonly string[], subjectHash: string): Promise<void> {
    await this.redis.del(...buckets.map((bucket) => `${this.prefix}rl:${bucket}:${subjectHash}`));
  }
}
