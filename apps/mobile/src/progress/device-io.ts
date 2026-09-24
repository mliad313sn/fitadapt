import type { ProgressPhoto } from '@fitadapt/shared';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { photosValue } from '../config/photos.config';

/**
 * The device side effects of M04, behind small ports so screens stay
 * testable: sharing an export file, picking a file to import, taking or
 * choosing a photo. None of them touches the network.
 */
export interface ProgressDeviceIo {
  /** Writes `content` to a temporary file, opens the share sheet, then deletes the temporary file. */
  shareFile(name: string, content: string, mimeType: string): Promise<void>;
  /** The text of a file the user picks (null when cancelled); the picker's copy is deleted. */
  pickTextFile(): Promise<string | null>;
  /** A photo from the camera or the photo library (null when cancelled or not allowed); the picker's temporary copy is deleted. */
  capturePhoto(source: 'camera' | 'library'): Promise<{ image: Uint8Array; mimeType: ProgressPhoto['mimeType'] } | { denied: true } | null>;
}

const MIME: readonly ProgressPhoto['mimeType'][] = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];

/** Reads a picked file and deletes it only when it is the picker's temporary copy in the app cache (never a user's original). */
function takeFile(uri: string): Uint8Array {
  const file = new File(uri);
  try {
    return file.bytesSync();
  } finally {
    if (uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
  }
}

export const expoProgressDeviceIo: ProgressDeviceIo = {
  async shareFile(name, content, mimeType) {
    const file = new File(Paths.cache, name);
    file.write(content);
    try {
      await Sharing.shareAsync(file.uri, { mimeType, UTI: mimeType === 'application/json' ? 'public.json' : 'public.comma-separated-values-text' });
    } finally {
      if (file.exists) file.delete();
    }
  },
  async pickTextFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/csv', 'text/comma-separated-values', 'text/plain'], copyToCacheDirectory: true, multiple: false });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return null;
    return new TextDecoder().decode(takeFile(asset.uri));
  },
  async capturePhoto(source) {
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: photosValue('capture.quality'), allowsEditing: false, exif: false, base64: false };
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) return { denied: true };
    }
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return null;
    const mimeType = MIME.find((m) => m === asset.mimeType) ?? 'image/jpeg';
    return { image: takeFile(asset.uri), mimeType };
  },
};
