import { headers } from 'next/headers';
import { CoachHome } from '../src/CoachHome';
import { localeFromAcceptLanguage } from '../src/locale';

export default async function Page() {
  const locale = localeFromAcceptLanguage((await headers()).get('accept-language'));
  return <CoachHome locale={locale} />;
}
