import type { SyncClient } from '@fitadapt/sync';
import { EXPORT_COLLECTION_NAMES, photoImage, type ExportBundle } from './export';
import type { PhotoVault } from './photo-vault';

/**
 * Importer of an export (JSON or CSV): records keep their ids, so importing
 * the same file twice adds nothing, and records already on the device are
 * never overwritten (every collection is append-only). Imported records go
 * through the outbox like any local record (and the server validates them
 * like any other).
 */
export function importBundle(bundle: ExportBundle, sync: SyncClient, vault?: PhotoVault | null): number {
  let count = 0;
  for (const collection of EXPORT_COLLECTION_NAMES) {
    for (const { id, data } of bundle.collections[collection]) {
      if (sync.get(collection, id)) continue;
      sync.insert(collection, data as Parameters<SyncClient['insert']>[1], id);
      count += 1;
    }
  }
  if (vault) for (const p of bundle.photos) if (vault.importPlain(p.meta, photoImage(p))) count += 1;
  return count;
}
