import { fileURLToPath } from 'node:url';
import { ESLint, RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import plugin from '../index.js';
import rule from '../rules/no-hardcoded-jsx-strings.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function makeEslint() {
  return new ESLint({
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        files: ['**/*.tsx'],
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { fitadapt: plugin },
        rules: { 'fitadapt/no-hardcoded-jsx-strings': 'error' },
      },
    ],
  });
}

describe('goal condition 4 — lint rule blocks hard-coded JSX strings', () => {
  it('fails on the fixture containing a hard-coded JSX string', async () => {
    const [result] = await makeEslint().lintFiles([fixture('hardcoded-string.tsx')]);
    expect(result?.errorCount).toBe(2);
    expect(result?.messages.map((m) => [m.ruleId, m.line])).toEqual([
      ['fitadapt/no-hardcoded-jsx-strings', 6],
      ['fitadapt/no-hardcoded-jsx-strings', 7],
    ]);
    expect(result?.messages[1]?.message).toContain('Hello athlete');
  });

  it('passes on the translated fixture', async () => {
    const [result] = await makeEslint().lintFiles([fixture('translated.tsx')]);
    expect(result?.errorCount).toBe(0);
  });
});

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run('no-hardcoded-jsx-strings', rule, {
      valid: [
        '<Text>{t("home.title")}</Text>',
        '<Text>{count}</Text>',
        '<Text>   </Text>',
        '<Text>12 · 3 — 4:05</Text>',
        '<Text>{"—"}</Text>',
        '<View testID="home-screen" />',
        '<Text style={{ fontWeight: "bold" }}>{label}</Text>',
        '<Button accessibilityLabel={t("ui.sheet.close")} />',
        '<Text>{ready && label}</Text>',
        '<Text>{`${a}${b}`}</Text>',
        '<Input label />',
        'const x = <Text {...props} />',
        '<svg:rect xlink:href="x" />',
        // PKG-15: translated dialogs, options and notifications; ids and non-letter text are fine.
        'Alert.alert(t("pair.leave.title"), t("pair.leave.body"), [{ text: t("ui.ok"), style: "cancel" }])',
        'Alert.alert(title)',
        'ToastAndroid.show(t("x"), ToastAndroid.SHORT)',
        '<Stack.Screen name="index" options={{ title: t("home.title"), headerShown: false }} />',
        '<Tabs screenOptions={() => ({ tabBarLabel: label, tabBarIcon: icon })} />',
        '<Stack.Screen options={opts} />',
        'navigation.setOptions({ title: t("x"), animation: "fade" })',
        'navigation.setOptions(opts)',
        'Notifications.scheduleNotificationAsync({ content: { title: t("x"), body: t("y"), data: { kind: "rest" } }, trigger: null })',
        'Notifications.scheduleNotificationAsync(request)',
        'other.alert("not a dialog")',
        'log.show("x")',
        'setOptions({ ["title"]: "x" })',
        '<Screen options={{ title: "12:05" }} />',
      ],
      invalid: [
        { code: '<Text>Hello</Text>', errors: [{ messageId: 'text' }] },
        { code: '<Text>Élan</Text>', errors: [{ messageId: 'text' }] },
        { code: '<>Bonjour</>', errors: [{ messageId: 'text' }] },
        { code: "<Text>{'Hello'}</Text>", errors: [{ messageId: 'text' }] },
        { code: '<Text>{`Hello ${name}`}</Text>', errors: [{ messageId: 'text' }] },
        { code: "<Text>{ok ? 'Yes' : label}</Text>", errors: [{ messageId: 'text' }] },
        { code: "<Text>{label || 'Fallback'}</Text>", errors: [{ messageId: 'text' }] },
        { code: "<Text>{'Hi' as string}</Text>", errors: [{ messageId: 'text' }] },
        { code: '<Button accessibilityLabel="Close" />', errors: [{ messageId: 'attribute' }] },
        { code: "<Input placeholder={'Email'} />", errors: [{ messageId: 'attribute' }] },
        { code: '<img aria-label="Logo" />', errors: [{ messageId: 'attribute' }] },
        {
          code: '<Card caption="Words" />',
          options: [{ attributes: ['caption'] }],
          errors: [{ messageId: 'attribute' }],
        },
        // PKG-15: dialogs, toasts, navigation titles and notification content outside JSX text.
        { code: "Alert.alert('Delete?', 'This cannot be undone')", errors: [{ messageId: 'call' }, { messageId: 'call' }] },
        { code: "Alert.alert(t('x'), undefined, [{ text: 'OK' }, { text: t('ui.cancel') }])", errors: [{ messageId: 'option' }] },
        { code: 'Alert.prompt(`Name for ${x}`)', errors: [{ messageId: 'call' }] },
        { code: "ToastAndroid.show('Saved', ToastAndroid.SHORT)", errors: [{ messageId: 'call' }] },
        { code: "RN.Alert.alert('Oops')", errors: [{ messageId: 'call' }] },
        { code: "<Stack.Screen name=\"index\" options={{ title: 'Home' }} />", errors: [{ messageId: 'option' }] },
        { code: "<Tabs screenOptions={() => ({ tabBarLabel: 'Today', headerTitle: ok ? 'A' : t('b') })} />", errors: [{ messageId: 'option' }, { messageId: 'option' }] },
        { code: "<Stack.Screen options={{ 'headerBackTitle': 'Back' } as const} />", errors: [{ messageId: 'option' }] },
        { code: "navigation.setOptions({ title: 'Workout' })", errors: [{ messageId: 'option' }] },
        { code: "setOptions(() => ({ drawerLabel: 'Menu' }))", errors: [{ messageId: 'option' }] },
        { code: "Notifications.scheduleNotificationAsync({ content: { title: 'Rest over', body: `Next: ${name}` }, trigger: null })", errors: [{ messageId: 'option' }, { messageId: 'option' }] },
        { code: "presentNotificationAsync({ content: { subtitle: 'Go' } })", errors: [{ messageId: 'option' }] },
        {
          code: '<Text>This is a very long sentence that should be truncated in the message</Text>',
          errors: [{ message: 'Hard-coded user-facing text "This is a very long sentence that sho...". Use a packages/i18n message (FR and EN).' }],
        },
      ],
});
