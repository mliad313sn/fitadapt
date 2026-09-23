// @ts-check
import noHardcodedJsxStrings from './rules/no-hardcoded-jsx-strings.js';

/** Repository-local ESLint rules. */
const plugin = {
  meta: { name: '@fitadapt/eslint-plugin', version: '0.0.0' },
  rules: {
    'no-hardcoded-jsx-strings': noHardcodedJsxStrings,
  },
};

export default plugin;
