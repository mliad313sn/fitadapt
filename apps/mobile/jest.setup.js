jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
// M01: the OS keystore (expo-secure-store) has no native module under jest; an in-memory stand-in.
// M04: the synchronous API (device keys for the encrypted database and photos) records the accessibility it was given.
jest.mock('expo-secure-store', () => {
  const items = new Map();
  const options = new Map();
  const failure = { error: null };
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
    getItemAsync: async (key) => (items.has(key) ? items.get(key) : null),
    setItemAsync: async (key, value, opts) => {
      items.set(key, value);
      options.set(key, opts);
    },
    deleteItemAsync: async (key) => {
      items.delete(key);
    },
    getItem: (key) => {
      if (failure.error) throw failure.error;
      return items.has(key) ? items.get(key) : null;
    },
    setItem: (key, value, opts) => {
      if (failure.error) throw failure.error;
      items.set(key, value);
      options.set(key, opts);
    },
    // M04 fail-closed tests: make the keystore fail (null: works again).
    __setFailure: (error) => {
      failure.error = error;
    },
    __items: items,
    __options: options,
  };
});
// M04: photo capture, files and sharing have no native module under jest. Files live in memory; the picker
// returns what a test queued (`__queue`), the share sheet records what it was given.
jest.mock('expo-image-picker', () => {
  const queue = [];
  const next = async () => {
    const asset = queue.shift();
    return asset ? { canceled: false, assets: [asset] } : { canceled: true, assets: null };
  };
  return {
    launchCameraAsync: jest.fn(next),
    launchImageLibraryAsync: jest.fn(next),
    requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
    __queue: queue,
  };
});
jest.mock('expo-file-system', () => {
  const files = new Map();
  const norm = (parts) =>
    parts
      .map((p) => (typeof p === 'string' ? p : p.uri))
      .join('/')
      .replace(/\/+/g, '/')
      .replace(/:\//, '://');
  class File {
    constructor(...parts) {
      this.uri = norm(parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    write(content) {
      files.set(this.uri, typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content));
    }
    bytesSync() {
      if (!files.has(this.uri)) throw new Error('no such file');
      return new Uint8Array(files.get(this.uri));
    }
    textSync() {
      return new TextDecoder().decode(this.bytesSync());
    }
    delete() {
      files.delete(this.uri);
    }
  }
  class Directory {
    constructor(...parts) {
      this.uri = norm(parts);
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [...files.keys()].filter((k) => k.startsWith(`${this.uri}/`)).map((k) => new File(k));
    }
  }
  return { File, Directory, Paths: { document: new Directory('file:///document'), cache: new Directory('file:///cache') }, __files: files };
});
jest.mock('expo-sharing', () => {
  const shared = [];
  return { isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async (uri, options) => shared.push({ uri, options })), __shared: shared };
});
jest.mock('expo-document-picker', () => {
  const queue = [];
  return {
    getDocumentAsync: jest.fn(async () => {
      const asset = queue.shift();
      return asset ? { canceled: false, assets: [asset] } : { canceled: true, assets: null };
    }),
    __queue: queue,
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
