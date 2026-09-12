/**
 * Constraint 7. In v1 this is enforced by not having a raw tier at all.
 *
 * Captures live in memory for the duration of one probe and are discarded with the process; nothing
 * writes a response body to disk. The cheapest way to answer "is a 90-day retention window
 * defensible, and does GDPR reach incidental personal data in a tool description?" turned out to be
 * to stop needing an answer. The cost is that a classifier change cannot be re-derived against old
 * raw data — which matters later, not now.
 *
 * This module stays as a safety net rather than as the primary control: if anything ever does write
 * to `data/runs/`, `observatory sweep` removes it past the window. The structural separation it
 * assumes still holds and still matters — raw would live in `data/runs/`, mutable and gitignored,
 * never inside `data/snapshots/`, whose directory name is a hash of its own contents. Putting raw
 * inside the hashed tree would set retention and reproducibility in permanent conflict, and one of
 * them would quietly lose.
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
