import { createTranslator, type Locale } from '@fitadapt/i18n';

/** Placeholder for the coach portal (M15). All copy comes from packages/i18n. */
export function CoachHome({ locale }: { locale: Locale }) {
  const { t } = createTranslator(locale);
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1.5rem', color: '#111827' }}>
      <h1>{t('coachWeb.title')}</h1>
      <p style={{ color: '#4B5563' }}>{t('coachWeb.placeholder')}</p>
    </main>
  );
}
