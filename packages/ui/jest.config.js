/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|intl-messageformat|@formatjs/.*))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/test-utils.tsx'],
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: { global: { lines: 80, statements: 80, functions: 80, branches: 80 } },
};
