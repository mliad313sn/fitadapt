import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { clock } from '../clock';

/**
 * The rest timer lives on the device only (never on the server, never in
 * Redis). It is an end time, not a counter: the remaining time is always
 * `endsAt − now`, so it stays right after the app was in the background, the
 * screen was locked or the JS timers were paused. The display refreshes every
 * second and at once when the app comes back to the foreground.
 */
export function useRestRemaining(endsAt: number | null): number {
  const [now, setNow] = useState(() => clock.now().getTime());
  useEffect(() => {
    if (endsAt === null) return undefined;
    setNow(clock.now().getTime());
    const tick = setInterval(() => setNow(clock.now().getTime()), 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(clock.now().getTime());
      else if (state === 'background') restNotifier.schedule(endsAt);
    });
    return () => {
      clearInterval(tick);
      sub.remove();
      restNotifier.cancel();
    };
  }, [endsAt]);
  return endsAt === null ? 0 : Math.max(0, endsAt - now);
}

/**
 * Lock-screen notice at the end of a rest while the app is in the background.
 * A port: the OS notification (expo-notifications) is wired with M13, which
 * owns notifications; until then the default does nothing and the timer
 * itself stays correct (end time, recomputed on return).
 */
export interface RestNotifier {
  schedule(endsAt: number): void;
  cancel(): void;
}

let current: RestNotifier = { schedule: () => undefined, cancel: () => undefined };

export const restNotifier: RestNotifier = {
  schedule: (endsAt) => current.schedule(endsAt),
  cancel: () => current.cancel(),
};

/** Replaces the notifier (M13, tests). Returns the previous one. */
export function setRestNotifier(next: RestNotifier): RestNotifier {
  const previous = current;
  current = next;
  return previous;
}
