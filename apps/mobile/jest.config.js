/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.{ts,tsx}'],
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|expo-router|standard-navigation|react-navigation|@react-navigation/.*|intl-messageformat|@formatjs/.*|drizzle-orm))',
  ],
  collectCoverageFrom: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}'],
  coverageReporters: ['text-summary', 'lcov'],
  // Whole-app journeys (router + on-device SQLite) take 3–6 s alone; under turbo's parallel
  // workspace run the 5 s default was hit. Same budget as the engine and legal packages.
  testTimeout: 30_000,
  coverageThreshold: { global: { lines: 80, statements: 80, functions: 80, branches: 80 } },
};
