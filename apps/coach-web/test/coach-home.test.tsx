import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CoachHome } from '../src/CoachHome';
import { localeFromAcceptLanguage } from '../src/locale';

describe('coach portal stub', () => {
  it('renders in French and English from the i18n catalogues', () => {
    expect(renderToStaticMarkup(<CoachHome locale="fr" />)).toContain('Portail coach');
    expect(renderToStaticMarkup(<CoachHome locale="en" />)).toContain('Coach portal');
  });

  it('resolves the locale from Accept-Language', () => {
    expect(localeFromAcceptLanguage('en-GB,en;q=0.9,fr;q=0.8')).toBe('en');
    expect(localeFromAcceptLanguage('de-DE, fr-SN;q=0.5')).toBe('fr');
    expect(localeFromAcceptLanguage(null)).toBe('fr');
    expect(localeFromAcceptLanguage('')).toBe('fr');
  });
});
