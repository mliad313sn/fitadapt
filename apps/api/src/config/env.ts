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
