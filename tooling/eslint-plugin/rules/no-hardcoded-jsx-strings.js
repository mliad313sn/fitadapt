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
 *  - PKG-15, outside JSX (also in .ts files):
 *    - native dialogs and toasts:             Alert.alert('Delete?', 'Sure?', [{ text: 'OK' }]), Alert.prompt, ToastAndroid.show
 *    - navigation titles:                     options={{ title: 'Home' }}, options={() => ({ headerTitle: 'x' })},
 *                                             navigation.setOptions({ tabBarLabel: 'x' })
 *    - notification content:                  scheduleNotificationAsync({ content: { title: 'x', body: 'y' } })
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

/** Navigation option keys shown to the user (React Navigation / expo-router). */
const OPTION_KEYS = new Set(['title', 'headerTitle', 'headerBackTitle', 'tabBarLabel', 'tabBarAccessibilityLabel', 'drawerLabel', 'tabBarBadge']);
/** Notification content keys shown to the user (expo-notifications). */
const NOTIFICATION_KEYS = new Set(['title', 'subtitle', 'body']);
/** Dialog and toast calls: object.method -> indexes of the arguments shown to the user. */
const DIALOG_CALLS = new Map([
  ['Alert.alert', [0, 1]],
  ['Alert.prompt', [0, 1]],
  ['ToastAndroid.show', [0]],
  ['ToastAndroid.showWithGravity', [0]],
]);
const NOTIFICATION_CALLS = new Set(['scheduleNotificationAsync', 'presentNotificationAsync']);

/**
 * @param {any} node
 * @returns {string | null} the name of a non-computed identifier or string-literal property key
 */
function keyName(node) {
  if (!node || node.type !== 'Property' || node.computed) return null;
  if (node.key.type === 'Identifier') return node.key.name;
  if (node.key.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
  return null;
}

/**
 * The object literal an options value describes: `{ … }` or `() => ({ … })`.
 * @param {any} node
 * @returns {any}
 */
function optionsObject(node) {
  if (!node) return null;
  if (node.type === 'ObjectExpression') return node;
  if ((node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') && node.body?.type === 'ObjectExpression') return node.body;
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') return optionsObject(node.expression);
  return null;
}

/**
 * `a.b` of a member-expression callee, or null.
 * @param {any} callee
 */
function calleeName(callee) {
  if (callee?.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return null;
  const object = callee.object.type === 'Identifier' ? callee.object.name : callee.object.type === 'MemberExpression' && !callee.object.computed ? callee.object.property.name : null;
  return object ? `${object}.${callee.property.name}` : null;
}

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
      call: 'Hard-coded user-facing text in {{name}}. Use a packages/i18n message (FR and EN).',
      option: 'Hard-coded user-facing option "{{name}}". Use a packages/i18n message (FR and EN).',
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

    /**
     * Reports literal text in the given keys of an object literal.
     * @param {any} object
     * @param {Set<string>} keys
     */
    const checkObject = (object, keys) => {
      for (const property of object?.properties ?? []) {
        const name = keyName(property);
        if (name && keys.has(name) && containsLiteralText(property.value)) context.report({ node: property, messageId: 'option', data: { name } });
      }
    };

    return {
      /** @param {any} node */
      CallExpression(node) {
        const name = calleeName(node.callee);
        const shown = name ? DIALOG_CALLS.get(name) : undefined;
        if (name && shown) {
          for (const index of shown) {
            if (containsLiteralText(node.arguments[index])) context.report({ node: node.arguments[index], messageId: 'call', data: { name } });
          }
          // Alert buttons: [{ text: 'OK' }].
          const buttons = node.arguments[2];
          if (name.startsWith('Alert.') && buttons?.type === 'ArrayExpression') {
            for (const button of buttons.elements) if (button?.type === 'ObjectExpression') checkObject(button, new Set(['text']));
          }
          return;
        }
        const method = node.callee?.type === 'MemberExpression' && !node.callee.computed ? node.callee.property.name : node.callee?.type === 'Identifier' ? node.callee.name : null;
        if (method === 'setOptions') checkObject(optionsObject(node.arguments[0]), OPTION_KEYS);
        if (method && NOTIFICATION_CALLS.has(method)) {
          const request = optionsObject(node.arguments[0]);
          for (const property of request?.properties ?? []) {
            if (keyName(property) === 'content') checkObject(optionsObject(property.value), NOTIFICATION_KEYS);
          }
        }
      },
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
        // options={{ title: '…' }} / screenOptions={() => ({ … })} on navigators and screens.
        if ((name === 'options' || name === 'screenOptions') && node.value?.type === 'JSXExpressionContainer') {
          checkObject(optionsObject(node.value.expression), OPTION_KEYS);
          return;
        }
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
