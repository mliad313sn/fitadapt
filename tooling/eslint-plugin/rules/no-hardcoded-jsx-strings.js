// @ts-check
/**
 * Fails on user-facing text written directly in JSX (CLAUDE.md rule 5): every
 * visible or announced string must come from packages/i18n.
 *
 * Reported:
 *  - JSX text containing a letter:            <Text>Hello</Text>
 *  - string literals rendered as children:    <Text>{'Hello'}</Text>, {ok ? 'Yes' : 'No'}
 *  - template literals with literal letters:  <Text>{`Hello ${name}`}</Text>
 *  - user-facing props given a literal:       accessibilityLabel="Close", placeholder="Email"
 *
 * Text with no letters (numbers, punctuation, separators such as "·") is allowed.
 */

/** Props whose value is shown or announced to the user. */
const DEFAULT_ATTRIBUTES = [
  'accessibilityLabel',
  'accessibilityHint',
  'accessibilityValue',
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'placeholder',
  'title',
  'label',
  'alt',
  'hint',
  'message',
  'subtitle',
  'description',
  'headerTitle',
];

const HAS_LETTER = /\p{L}/u;

/**
 * @param {unknown} node
 * @returns {boolean}
 */
function containsLiteralText(node) {
  const n = /** @type {{ type: string } & Record<string, any>} */ (node);
  if (!n) return false;
  switch (n.type) {
    case 'Literal':
      return typeof n.value === 'string' && HAS_LETTER.test(n.value);
    case 'TemplateLiteral':
      return n.quasis.some((/** @type {{ value: { cooked?: string | null; raw: string } }} */ q) =>
        HAS_LETTER.test(q.value.cooked ?? q.value.raw),
      );
    case 'ConditionalExpression':
      return containsLiteralText(n.consequent) || containsLiteralText(n.alternate);
    case 'LogicalExpression':
      return containsLiteralText(n.right) || (n.operator !== '&&' && containsLiteralText(n.left));
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return containsLiteralText(n.expression);
    default:
      return false;
  }
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow hard-coded user-facing strings in JSX; use packages/i18n instead.',
    },
    schema: [
      {
        type: 'object',
        properties: {
          attributes: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      text: 'Hard-coded user-facing text "{{text}}". Use a packages/i18n message (FR and EN).',
      attribute: 'Hard-coded user-facing prop "{{name}}". Use a packages/i18n message (FR and EN).',
    },
  },
  create(context) {
    const options = /** @type {{ attributes?: string[] } | undefined} */ (context.options[0]);
    const attributes = new Set([...DEFAULT_ATTRIBUTES, ...(options?.attributes ?? [])]);

    /** @param {string} text */
    const preview = (text) => {
      const t = text.trim().replace(/\s+/g, ' ');
      return t.length > 40 ? `${t.slice(0, 37)}...` : t;
    };

    return {
      /** @param {any} node */
      JSXText(node) {
        if (HAS_LETTER.test(node.value)) {
          context.report({ node, messageId: 'text', data: { text: preview(node.value) } });
        }
      },
      /** @param {any} node */
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent && (parent.type === 'JSXElement' || parent.type === 'JSXFragment') && containsLiteralText(node.expression)) {
          context.report({ node, messageId: 'text', data: { text: preview(context.sourceCode.getText(node.expression)) } });
        }
      },
      /** @param {any} node */
      JSXAttribute(node) {
        const name = node.name.type === 'JSXNamespacedName' ? `${node.name.namespace.name}:${node.name.name.name}` : node.name.name;
        if (!attributes.has(name) || !node.value) return;
        const value = node.value.type === 'JSXExpressionContainer' ? node.value.expression : node.value;
        if (containsLiteralText(value)) {
          context.report({ node, messageId: 'attribute', data: { name } });
        }
      },
    };
  },
};

export default rule;
