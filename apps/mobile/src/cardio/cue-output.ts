import type { CueHaptic } from '@fitadapt/engine';
import type { Locale } from '@fitadapt/shared';
import { setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

/**
 * How the interval timer speaks and vibrates (Marco: nobody looks at a
 * screen mid-interval; audio and haptics lead). Ports, so the timer logic is
 * tested without a device:
 * - CueOutput: the system text-to-speech voice (expo-speech, FR or EN) and
 *   the vibration motor (expo-haptics). No audio file is shipped, so no sound
 *   asset needs a licence (docs/legal/asset-licence-register.md).
 * - BackgroundAudio: the audio session that keeps the cues playing with the
 *   screen locked or the app in the background (expo-audio,
 *   `shouldPlayInBackground`; iOS UIBackgroundModes "audio" through the
 *   expo-audio config plugin, app.json). Proven on a device only by the manual
 *   test in docs/status/M03.md.
 * Nothing here may crash a workout: every call is guarded.
 */
export interface CueOutput {
  speak(text: string, locale: Locale): void;
  haptic(kind: CueHaptic): void;
  stop(): void;
}

export interface BackgroundAudio {
  enable(): Promise<void>;
  disable(): Promise<void>;
}

const guard = (run: () => unknown) => {
  try {
    const out = run();
    if (out && typeof (out as Promise<unknown>).catch === 'function') (out as Promise<unknown>).catch(() => undefined);
  } catch {
    // A missing voice or motor never stops the session: the screen still shows every step.
  }
};

export const expoCueOutput: CueOutput = {
  speak: (text, locale) => guard(() => Speech.speak(text, { language: locale === 'fr' ? 'fr-FR' : 'en-GB' })),
  haptic: (kind) =>
    guard(() => {
      if (kind === 'work') return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (kind === 'rest') return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (kind === 'finish') return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return Haptics.selectionAsync();
    }),
  stop: () => guard(() => Speech.stop()),
};

export const expoBackgroundAudio: BackgroundAudio = {
  enable: async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'duckOthers' });
    } catch {
      // Without the audio session the cues still play in the foreground.
    }
  },
  disable: async () => {
    try {
      await setAudioModeAsync({ shouldPlayInBackground: false });
    } catch {
      // Nothing to undo.
    }
  },
};

let output: CueOutput = expoCueOutput;
let audio: BackgroundAudio = expoBackgroundAudio;

export const cueOutput = (): CueOutput => output;
export const backgroundAudio = (): BackgroundAudio => audio;

/** Replaces the outputs (tests, a future M14 voice coach). Returns the previous ones. */
export function setCueOutputs(next: { output?: CueOutput; audio?: BackgroundAudio }): { output: CueOutput; audio: BackgroundAudio } {
  const previous = { output, audio };
  if (next.output) output = next.output;
  if (next.audio) audio = next.audio;
  return previous;
}
