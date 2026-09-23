import { act, fireEvent, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useSettings } from '../src/state/settings';
import { memoryClient, renderHome, tr, visibleStrings } from './helpers';

beforeEach(() => {
  useSettings.setState({ gymMode: false });
});

describe('home screen (goal condition 4)', () => {
  it('renders in English', () => {
    renderHome('en');
    const t = tr('en');
    expect(screen.getByRole('header', { name: t.t('home.title') })).toBeTruthy();
    expect(screen.getByText('Your sessions work offline, in English or French.')).toBeTruthy();
    expect(screen.getByText('Everything is synced')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to French' })).toBeTruthy();
  });

  it('renders in French', () => {
    renderHome('fr');
    expect(screen.getByRole('header', { name: 'Bienvenue' })).toBeTruthy();
    expect(screen.getByText('Vos séances fonctionnent hors ligne, en français ou en anglais.')).toBeTruthy();
    expect(screen.getByText('Tout est synchronisé')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Passer en anglais' })).toBeTruthy();
  });

  it('switching FR/EN changes every visible string', () => {
    renderHome('en');
    const english = visibleStrings();
    screen.unmount();
    renderHome('fr');
    const french = visibleStrings();
    screen.unmount();

    renderHome('en');
    expect(visibleStrings()).toEqual(english);
    fireEvent.press(screen.getByRole('button', { name: 'Switch to French' }));
    const switched = visibleStrings();
    expect(switched).toEqual(french);
    // No English string survives the switch.
    expect(switched.filter((s) => english.includes(s))).toEqual([]);
    expect(english.length).toBeGreaterThanOrEqual(10);

    fireEvent.press(screen.getByRole('button', { name: 'Passer en anglais' }));
    expect(visibleStrings()).toEqual(english);
  });

  it('toggles gym mode (56 dp targets) and units', () => {
    renderHome('en');
    const gym = screen.getByRole('button', { name: 'Turn on gym mode' });
    expect(StyleSheet.flatten(gym.props.style)).toEqual(expect.objectContaining({ minHeight: 48 }));
    fireEvent.press(gym);
    const on = screen.getByRole('button', { name: 'Turn off gym mode' });
    expect(StyleSheet.flatten(on.props.style)).toEqual(expect.objectContaining({ minHeight: 56 }));

    fireEvent.press(screen.getByRole('button', { name: 'Units: metric (kg, cm)' }));
    expect(screen.getByRole('button', { name: 'Units: imperial (lb, in)' })).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Units: imperial (lb, in)' }));
    expect(screen.getByRole('button', { name: 'Units: metric (kg, cm)' })).toBeTruthy();
  });

  it('shows the outbox size with ICU plurals', async () => {
    const { client, transport } = memoryClient();
    transport.online = false;
    client.insert('set_logs', { demo: true });
    client.insert('set_logs', { demo: true });
    renderHome('fr', client);
    expect(screen.getByText('2 modifications en attente de synchronisation')).toBeTruthy();
    transport.online = true;
    await act(async () => {
      await client.sync();
    });
    expect(client.pendingCount()).toBe(0);
  });
});
