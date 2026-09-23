// eslint-plugin-security 4 ships no type declarations.
declare module 'eslint-plugin-security' {
  import type { ESLint, Linter } from 'eslint';
  const plugin: ESLint.Plugin & { configs: { recommended: { rules: Linter.RulesRecord } } };
  export default plugin;
}
