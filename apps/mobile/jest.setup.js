jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// M01: the OS keystore (expo-secure-store) has no native module under jest; an in-memory stand-in.
jest.mock('expo-secure-store', () => {
  const items = new Map();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: async (key) => (items.has(key) ? items.get(key) : null),
    setItemAsync: async (key, value) => {
      items.set(key, value);
    },
    deleteItemAsync: async (key) => {
      items.delete(key);
    },
    __items: items,
  };
});
// M03: the system voice, the vibration motor and the audio session have no native module under jest.
// Recording stand-ins (the cue test harness): tests read what was spoken, vibrated and how the audio session was set.
jest.mock('expo-speech', () => {
  const spoken = [];
  return {
    speak: jest.fn((text, options) => {
      spoken.push({ text, language: options && options.language });
    }),
    stop: jest.fn(async () => undefined),
    __spoken: spoken,
  };
});
jest.mock('expo-haptics', () => {
  const felt = [];
  const record = (kind) => async () => {
    felt.push(kind);
  };
  return {
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
    NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
    impactAsync: jest.fn(async (style) => {
      felt.push(`impact:${style}`);
    }),
    notificationAsync: jest.fn(async (type) => {
      felt.push(`notification:${type}`);
    }),
    selectionAsync: jest.fn(record('selection')),
    __felt: felt,
  };
});
jest.mock('expo-audio', () => {
  const modes = [];
  return {
    setAudioModeAsync: jest.fn(async (mode) => {
      modes.push(mode);
    }),
    __modes: modes,
  };
});
