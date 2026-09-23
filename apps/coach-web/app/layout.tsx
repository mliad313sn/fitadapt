import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { localeFromAcceptLanguage } from '../src/locale';

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = localeFromAcceptLanguage((await headers()).get('accept-language'));
  return (
    <html lang={locale}>
      <body style={{ margin: 0, background: '#FFFFFF' }}>{children}</body>
    </html>
  );
}
