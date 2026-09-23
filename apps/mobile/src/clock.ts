/**
 * The app's clock. Screens and stores read time through it so tests can move
 * time (fake clock) without touching the device clock.
 */
export const clock = {
  now: (): Date => new Date(),
};
