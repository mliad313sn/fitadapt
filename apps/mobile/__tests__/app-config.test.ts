/**
 * M20 goal condition 2: the production build config fails while any enabled
 * legal text lacks counsel approval. Every text is a pending draft today.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const appConfig = require('../app.config.js') as (ctx: { config: Record<string, unknown> }) => Record<string, unknown>;

const withEnv = (vars: Record<string, string | undefined>, run: () => unknown) => {
  const saved = { APP_VARIANT: process.env.APP_VARIANT, EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE };
  Object.assign(process.env, vars);
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k];
  try {
    return run();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

describe('app.config.js legal release guard', () => {
  const config = { name: 'Companion (dev)' };

  it('refuses a production build: enabled legal texts lack counsel approval', () => {
    expect(() => withEnv({ APP_VARIANT: 'production' }, () => appConfig({ config }))).toThrow(/Production build refused: \d+ enabled legal text\(s\) lack counsel approval/);
    expect(() => withEnv({ APP_VARIANT: undefined, EAS_BUILD_PROFILE: 'production' }, () => appConfig({ config }))).toThrow(/lack counsel approval/);
  });

  it('dev and preview builds keep the drafts (shown with the draft banner)', () => {
    expect(withEnv({ APP_VARIANT: 'dev' }, () => appConfig({ config }))).toBe(config);
    expect(withEnv({ APP_VARIANT: 'preview' }, () => appConfig({ config }))).toBe(config);
    expect(withEnv({ APP_VARIANT: undefined, EAS_BUILD_PROFILE: undefined }, () => appConfig({ config }))).toBe(config);
  });

  it('the production profile in eas.json sets the variant the guard reads', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eas = require('../eas.json') as { build: { production: { env: Record<string, string> } } };
    expect(eas.build.production.env.APP_VARIANT).toBe('production');
  });
});
