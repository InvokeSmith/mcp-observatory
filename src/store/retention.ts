/**
 * Constraint 7. Raw captures are private and time-limited; only derived data is published.
 *
 * The structural point is that raw captures live in `data/runs/`, which is mutable, gitignored and
 * deletable, while sealed snapshots live in `data/snapshots/`, which is content-addressed and
 * immutable. Keeping raw inside the hashed tree would mean the 90-day sweep mutates a directory
 * whose name is a hash of its contents — retention and reproducibility would be in permanent
 * conflict, and one of them would quietly lose.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_RETENTION_DAYS = 90;

export interface SweepResult {
  readonly deleted: readonly string[];
  readonly kept: readonly string[];
}

export async function sweepRuns(
  runsDir: string,
  now: number,
  retentionDays = DEFAULT_RETENTION_DAYS,
): Promise<SweepResult> {
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const deleted: string[] = [];
  const kept: string[] = [];

  let entries: string[];
  try {
    // readdir is not sorted on macOS or Linux. Sort so a sweep's report is reproducible.
    entries = (await readdir(runsDir)).sort();
  } catch {
    return { deleted, kept };
  }

  for (const entry of entries) {
    const full = join(runsDir, entry);
    const info = await stat(full);
    if (info.mtimeMs < cutoff) {
      await rm(full, { recursive: true, force: true });
      deleted.push(entry);
    } else {
      kept.push(entry);
    }
  }

  return { deleted, kept };
}
