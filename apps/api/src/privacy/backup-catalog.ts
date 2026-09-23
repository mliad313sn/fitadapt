/**
 * What the backup system can tell the deletion workflow. Backups are rotated
 * (retention `backupRetentionDays`); a deleted account's data leaves the last
 * backup once every backup taken before the deletion has been rotated out.
 * The production implementation queries the backup provider (M19).
 */
export interface BackupCatalog {
  /** Time of the oldest backup still retained, or null if there is none. */
  oldestRetainedBackupAt(): Promise<Date | null>;
}

/** Development and test environments keep no database backups. */
export class NoBackupsCatalog implements BackupCatalog {
  async oldestRetainedBackupAt(): Promise<Date | null> {
    return null;
  }
}

/** In-memory catalog for tests and local drills. */
export class MemoryBackupCatalog implements BackupCatalog {
  readonly backups: Date[] = [];
  async oldestRetainedBackupAt(): Promise<Date | null> {
    return this.backups.length ? new Date(Math.min(...this.backups.map((d) => d.getTime()))) : null;
  }
  /** Drops backups taken before `cutoff` (the rotation). */
  rotate(cutoff: Date): void {
    const kept = this.backups.filter((d) => d >= cutoff);
    this.backups.splice(0, this.backups.length, ...kept);
  }
}
