import { z } from 'zod';

/**
 * Every numeric coefficient or threshold carries its source and validation
 * status (CLAUDE.md rule 4). `validated: true` additionally requires the
 * council seat and sign-off record (docs/governance/03-expert-advisory-council.md §5).
 */
export const ConfigValueSchema = z
  .object({
    value: z.number(),
    unit: z.string().min(1).optional(),
    source: z.string().min(1),
    validated: z.boolean(),
    validatedBy: z.string().min(1).optional(),
    signOff: z.string().min(1).optional(),
  })
  .refine((v) => !v.validated || (v.validatedBy !== undefined && v.signOff !== undefined), {
    message: 'validated:true requires validatedBy and signOff',
  });
export type ConfigValue = z.infer<typeof ConfigValueSchema>;

/**
 * Validates a record of config values at load time and returns it typed and
 * deeply frozen (SAF-9): no in-process caller (API, AI coach, a test) can
 * change a coefficient that S2 or S4 read at runtime. A change is a code
 * change, reviewed like one.
 */
export function defineConfig<K extends string>(values: Record<K, ConfigValue>): Readonly<Record<K, Readonly<ConfigValue>>> {
  for (const [key, value] of Object.entries<ConfigValue>(values)) {
    const parsed = ConfigValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new Error(`Invalid config value "${key}": ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    Object.freeze(value);
  }
  return Object.freeze(values);
}

/** Lists the keys still awaiting expert validation (for status files and launch checks). */
export function unvalidatedKeys(values: Record<string, ConfigValue>): string[] {
  return Object.entries(values)
    .filter(([, v]) => !v.validated)
    .map(([k]) => k)
    .sort();
}
