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
  coverageThreshold: { global: { lines: 80, statements: 80, functions: 80, branches: 80 } },
};
