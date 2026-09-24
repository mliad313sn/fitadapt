import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { reportError } from '../observability';

/**
 * MOB-12: while a screen shows decrypted progress photos or a recovery code,
 * the system may not capture it (expo-screen-capture, MIT):
 * - Android: FLAG_SECURE on the window: no screenshots, no screen recording,
 *   and a blank preview in the recent-apps list (Android has no `inactive`
 *   state, and the recents snapshot is taken before `background` arrives);
 * - iOS: screenshots and recordings are blocked (iOS 13+), and the app
 *   switcher preview is blurred.
 * The protection is keyed per screen and lifted when the screen unmounts.
 * A failure is reported (no data) and never blocks the screen; the in-app
 * hiding of photos in the background stays as a second layer.
 */
export function useScreenCaptureProtection(key: string): void {
  useEffect(() => {
    const onError = (error: unknown) => reportError(error, { area: 'photos' });
    ScreenCapture.preventScreenCaptureAsync(key).catch(onError);
    if (Platform.OS === 'ios') ScreenCapture.enableAppSwitcherProtectionAsync().catch(onError);
    return () => {
      ScreenCapture.allowScreenCaptureAsync(key).catch(onError);
      if (Platform.OS === 'ios') ScreenCapture.disableAppSwitcherProtectionAsync().catch(onError);
    };
  }, [key]);
}
