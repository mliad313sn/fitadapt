import { createTranslator, type Locale } from '@fitadapt/i18n';
import { InMemoryTransport, MemoryLocalStore, MemoryServerStore, SyncClient, SyncServer } from '@fitadapt/sync';
import { render, screen } from '@testing-library/react-native';
import { randomUUID } from 'node:crypto';
import { AppProviders } from '../src/AppProviders';
import { HomeScreen } from '../src/screens/HomeScreen';

export function memoryClient() {
  const transport = new InMemoryTransport(new SyncServer({ store: new MemoryServerStore() }), randomUUID());
  const client = new SyncClient({ deviceId: randomUUID(), store: new MemoryLocalStore(), transport, newId: randomUUID });
  return { client, transport };
}

export function renderHome(locale: Locale, client = memoryClient().client) {
  return render(
    <AppProviders syncClient={client} initialLocale={locale}>
      <HomeScreen />
    </AppProviders>,
  );
}

/** Every string a user can see or hear: text content plus accessibility labels and hints. */
export function visibleStrings(): string[] {
  const root = screen.root;
  const out = new Set<string>();
  const walk = (node: typeof root) => {
    const { accessibilityLabel, accessibilityHint } = node.props as { accessibilityLabel?: unknown; accessibilityHint?: unknown };
    if (typeof accessibilityLabel === 'string') out.add(accessibilityLabel);
    if (typeof accessibilityHint === 'string') out.add(accessibilityHint);
    for (const child of node.children) {
      if (typeof child === 'string') {
        if (child.trim()) out.add(child);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return [...out].sort();
}

export const tr = (locale: Locale) => createTranslator(locale);
