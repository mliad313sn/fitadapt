import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_HOST: z.string().default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  AUTH_JWT_SECRET: z.string().min(32),
  AUTH_TOKEN_PEPPER: z.string().min(32),
  SENTRY_DSN: z.url().optional().or(z.literal('').transform(() => undefined)),
  /**
   * API-8: how many reverse proxies (the M19 edge) sit in front of the API. 0: none, the socket address is the
   * client (X-Forwarded-For ignored). n: the client is the address n hops back in X-Forwarded-For, so per-address
   * rate limits (sign-in codes, pair join, WebSocket hellos) are per client, not per proxy. Set it to the exact
   * number of trusted hops: one more lets a client spoof its address (ADR-028).
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
}).superRefine((env, ctx) => {
  // The .env.example values are public. A production process started with
  // them would sign tokens anyone can forge, so it must refuse to start.
  if (env.NODE_ENV !== 'production') return;
  for (const key of ['AUTH_JWT_SECRET', 'AUTH_TOKEN_PEPPER'] as const) {
    if (/dev-only|change-me/i.test(env[key])) {
      ctx.addIssue({ code: 'custom', path: [key], message: 'development placeholder in production' });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses process.env at the process boundary; fails fast without echoing secret values. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment: ${fields}`);
  }
  return parsed.data;
}
