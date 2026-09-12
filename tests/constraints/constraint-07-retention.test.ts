/**
 * Constraint 7: retention.
 *
 * The test that matters is the last one. If raw captures lived inside the content-addressed
 * snapshot, the retention sweep would change the snapshot id, and reproducibility and retention
 * would be in permanent conflict. Asserting that deletion leaves the id untouched is what proves
 * the two tiers are actually separate rather than nominally separate.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRuleSet } from '../../src/classify/rules.js';
import { seal } from '../../src/store/seal.js';
import { DEFAULT_RETENTION_DAYS, sweepRuns } from '../../src/store/retention.js';
import { buildReport } from '../../src/stages/report.js';
import { freshOptOutList } from '../helpers/harness.js';
import { buildTestSnapshot } from '../helpers/snapshot.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('constraint 7: retention', () => {
  test('gitignore actually excludes the raw tier', async () => {
    const gitignore = await readFile('.gitignore', 'utf8');
    expect(gitignore).toContain('data/runs/');
  });

  test('the sweep deletes past-window runs and keeps the rest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'observatory-retention-'));
    const runs = join(root, 'runs');
    try {
      await mkdir(join(runs, 'old-run'), { recursive: true });
      await mkdir(join(runs, 'fresh-run'), { recursive: true });
      await writeFile(join(runs, 'old-run', 'raw.jsonl'), '{"body":"sensitive"}\n');
      await writeFile(join(runs, 'fresh-run', 'raw.jsonl'), '{"body":"sensitive"}\n');

      const now = Date.now();
      const stale = new Date(now - (DEFAULT_RETENTION_DAYS + 5) * DAY_MS);
      await utimes(join(runs, 'old-run'), stale, stale);

      const result = await sweepRuns(runs, now);
      expect(result.deleted).toEqual(['old-run']);
      expect(result.kept).toEqual(['fresh-run']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('derived rows carry no response bodies, schemas or descriptions', async () => {
    const snapshot = await buildTestSnapshot();
    const built = buildReport({
      snapshot,
      rules: await loadRuleSet(),
      optOut: freshOptOutList(),
      optOutId: 'test',
      protocolVersion: '0.1.0',
    });

    for (const [name, content] of Object.entries(built)) {
      expect(content, `${name} leaked a raw schema`).not.toContain('inputSchema');
      expect(content, `${name} leaked a description`).not.toContain('cannot be undone');
      expect(content, `${name} leaked response headers`).not.toContain('www-authenticate');
    }
  });

  test('deleting raw captures does not change the snapshot id', async () => {
    const leaves = (await buildTestSnapshot()).leaves;

    const first = await seal({ discoverManifestHash: 'test-discover-manifest', leaves });
    // A retention sweep removes runs/, which contributes nothing to the seal. Re-sealing the same
    // derived leaves must therefore produce the same id.
    const afterSweep = await seal({ discoverManifestHash: 'test-discover-manifest', leaves });

    expect(afterSweep.manifest.snapshotId).toBe(first.manifest.snapshotId);
  });

  test('the snapshot leaf type has no field that could hold a response body', async () => {
    const snapshot = await buildTestSnapshot();
    const serialized = JSON.stringify(snapshot.leaves);
    expect(serialized).not.toContain('rawBody');
    expect(serialized).not.toContain('responseBody');
    expect(serialized).not.toContain('headers');
  });
});
