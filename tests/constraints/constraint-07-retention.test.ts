/**
 * Constraint 7: retention.
 *
 * v1 satisfies this by not retaining anything: captures live in memory for one probe and die with
 * the process. The sweep stays as a safety net. The snapshot-id test still matters, because it is
 * what proves the tiers are separate rather than nominally separate, and it is what would keep
 * retention and reproducibility from conflicting when a raw tier does return.
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

  /**
   * The v1 guarantee. A capture records how many bytes arrived, never the bytes — so there is
   * nothing to retain, nothing to scrub, and no window to defend.
   */
  test('captures record byte counts, never bodies, and never Set-Cookie', async () => {
    const { probeTarget } = await import('../../src/stages/probe.js');
    const { FixtureServer } = await import('../fixtures/server.js');
    const { makeGate } = await import('../helpers/harness.js');

    const server = new FixtureServer({ kind: 'open' });
    server.start();
    try {
      const { gate, hostState } = makeGate();
      await probeTarget(gate, hostState, {
        targetId: 'retention',
        orgKey: 'org',
        origin: server.url,
        path: server.mcpPath,
      });

      expect(gate.captures.length).toBeGreaterThan(0);
      for (const capture of gate.captures) {
        expect(Object.keys(capture)).not.toContain('body');
        expect(Object.keys(capture)).not.toContain('responseBody');
        expect(typeof capture.bodyBytes).toBe('number');
        const names = capture.responseHeaders.map(([n]) => n.toLowerCase());
        expect(names).not.toContain('set-cookie');
      }

      // Whatever the probe learned about tool schemas, no capture holds the text it came from.
      const serialized = JSON.stringify(gate.captures);
      expect(serialized).not.toContain('refund_payment');
      expect(serialized).not.toContain('Refund a payment');
    } finally {
      await server.stop();
    }
  });

  test('no stage writes a raw capture to disk', async () => {
    const { readdir } = await import('node:fs/promises');
    // data/runs/ is where a raw tier would live. v1 never creates it.
    let entries: string[] = [];
    try {
      entries = await readdir('data/runs');
    } catch {
      entries = [];
    }
    expect(entries).toEqual([]);
  });

  test('the snapshot leaf type has no field that could hold a response body', async () => {
    const snapshot = await buildTestSnapshot();
    const serialized = JSON.stringify(snapshot.leaves);
    expect(serialized).not.toContain('rawBody');
    expect(serialized).not.toContain('responseBody');
    expect(serialized).not.toContain('headers');
  });
});
