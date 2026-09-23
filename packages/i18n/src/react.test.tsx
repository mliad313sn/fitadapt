import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, useI18n } from './react.js';

function Probe() {
  const i18n = useI18n();
  return (
    <p>
      {i18n.locale}|{i18n.unitSystem}|{i18n.t('home.title')}
    </p>
  );
}

describe('I18nProvider', () => {
  it('provides the translator for the initial locale', () => {
    expect(renderToStaticMarkup(<I18nProvider initialLocale="en"><Probe /></I18nProvider>)).toBe(
      '<p>en|metric|Welcome</p>',
    );
    expect(
      renderToStaticMarkup(
        <I18nProvider initialLocale="fr" initialUnitSystem="imperial">
          <Probe />
        </I18nProvider>,
      ),
    ).toBe('<p>fr|imperial|Bienvenue</p>');
  });

  it('throws when used outside the provider', () => {
    expect(() => renderToStaticMarkup(<Probe />)).toThrow(/I18nProvider/);
  });
});
