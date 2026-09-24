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

describe('app.config.js exercise-library release guard (M06)', () => {
  const config = { name: 'Companion (dev)' };

  it('refuses a production build while any exercise lacks the physio review, even once legal texts are approved', () => {
    jest.isolateModules(() => {
      jest.doMock('@fitadapt/legal', () => ({ ...jest.requireActual('@fitadapt/legal'), assertLegalReleaseReady: () => undefined }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const guarded = require('../app.config.js') as (ctx: { config: Record<string, unknown> }) => Record<string, unknown>;
      expect(() => withEnv({ APP_VARIANT: 'production' }, () => guarded({ config }))).toThrow(/Production build refused: \d+ exercise\(s\) lack the physio review \(A2\)/);
      expect(withEnv({ APP_VARIANT: 'preview' }, () => guarded({ config }))).toBe(config);
    });
    jest.dontMock('@fitadapt/legal');
  });
});

describe('app.json background audio for the interval cues (M03)', () => {
  it('enables background playback (iOS UIBackgroundModes audio, Android media-playback service) without asking for the microphone', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const app = require('../app.json') as { expo: { plugins: (string | [string, Record<string, unknown>])[] } };
    const audio = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-audio') as [string, Record<string, unknown>];
    expect(audio[1]).toEqual({ microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: true });
  });
});

describe('app.json and app.config.js for M04 (encrypted database, progress photos)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const app = require('../app.json') as { expo: { plugins: (string | [string, Record<string, unknown>])[] } };
  const plugin = (name: string) => app.expo.plugins.find((p) => (Array.isArray(p) ? p[0] : p) === name);

  it('expo-sqlite is built with SQLCipher (the Android and iOS build properties `expo.sqlite.useSQLCipher`)', () => {
    expect(plugin('expo-sqlite')).toEqual(['expo-sqlite', { useSQLCipher: true }]);
    // The plain plugin entry (no cipher) is gone.
    expect(app.expo.plugins).not.toContain('expo-sqlite');
  });

  it('the image picker never asks for the microphone; the camera and photo-library texts come from packages/i18n in EN and FR', () => {
    expect(plugin('expo-image-picker')).toEqual(['expo-image-picker', { microphonePermission: false }]);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { en, fr } = require('@fitadapt/i18n') as { en: Record<string, string>; fr: Record<string, string> };
    const input = JSON.parse(JSON.stringify(app.expo)) as Record<string, unknown>;
    const out = withEnv({ APP_VARIANT: 'dev' }, () => appConfig({ config: input })) as { plugins: [string, Record<string, unknown>][]; locales: Record<string, Record<string, string>> };
    expect(out.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker')![1]).toEqual({ microphonePermission: false, cameraPermission: en['photos.permission.camera'], photosPermission: en['photos.permission.library'] });
    expect(out.locales).toEqual({
      en: { NSCameraUsageDescription: en['photos.permission.camera'], NSPhotoLibraryUsageDescription: en['photos.permission.library'] },
      fr: { NSCameraUsageDescription: fr['photos.permission.camera'], NSPhotoLibraryUsageDescription: fr['photos.permission.library'] },
    });
    expect(Object.values(out.locales.fr!).every((t) => t.length > 0 && t !== en['photos.permission.camera'])).toBe(true);
  });
});

describe('M04 device configs (CLAUDE.md rule 4)', () => {
  it('every photo-storage and dashboard value has a source and stays validated:false', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { photosConfig } = require('../src/config/photos.config') as { photosConfig: Record<string, { value: number; source: string; validated: boolean }> };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { dashboardConfig } = require('../src/config/dashboard.config') as { dashboardConfig: Record<string, { value: number; source: string; validated: boolean }> };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { legalLogConfig } = require('../src/config/legal-log.config') as { legalLogConfig: Record<string, { value: number; source: string; validated: boolean }> };
    // Fix wave: + display.cacheMaxBytes (MOB-05) and device.segmentMaxEvents (MOB-11), both validated:false.
    const all = { ...photosConfig, ...dashboardConfig, ...legalLogConfig };
    expect(Object.keys(all)).toHaveLength(11);
    for (const [key, v] of Object.entries(all)) expect({ key, number: Number.isFinite(v.value), source: v.source.length > 10, validated: v.validated }).toEqual({ key, number: true, source: true, validated: false });
  });
});
