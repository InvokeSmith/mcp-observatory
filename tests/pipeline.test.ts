/**
 * The whole instrument end to end: probe real fixture servers, seal, classify, report.
 *
 * This is where the acceptance criteria meet: a snapshot id that is reproducible, a report
 * regenerable from that named snapshot, and — throughout — not one tool invoked.
 */
import { describe, expect, test } from 'bun:test';
import { loadRuleSet, loadVariants } from '../src/classify/rules.js';
import { classifySnapshot } from '../src/stages/classify.js';
import { probeTarget } from '../src/stages/probe.js';
import { buildReport } from '../src/stages/report.js';
import { lintArtifact, loadPublicationRules } from '../src/report/lint.js';
import { seal } from '../src/store/seal.js';
import type { SnapshotLeaf } from '../src/store/types.js';
import { assertNoForbiddenMethods, FixtureServer } from './fixtures/server.js';
import { freshOptOutList, makeGate } from './helpers/harness.js';

async function runPipeline() {
  const servers = [
    new FixtureServer({ kind: 'open' }),
    new FixtureServer({ kind: 'auth-wall' }),
    new FixtureServer({ kind: 'partial' }),
    new FixtureServer({ kind: 'well-known-optout' }),
    new FixtureServer({ kind: 'paginated' }),
  ];
  for (const server of servers) server.start();

  try {
    const leaves: SnapshotLeaf[] = [];

    // A gate per target, because in production each target is a distinct host. Every fixture here
    // shares 127.0.0.1, and durable host state is keyed by hostname — correctly, since a host that
    // answered with a credential challenge must not be contacted again. Sharing one gate would
    // therefore make the auth-wall fixture suppress every fixture after it, which is the right
    // behaviour for one host and the wrong model for five.
    for (const [index, server] of servers.entries()) {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, {
        targetId: `target-${String(index).padStart(3, '0')}`,
        orgKey: `org-${String(index).padStart(3, '0')}`,
        origin: server.url,
        path: server.mcpPath,
      });
      leaves.push(outcome.leaf);
    }

    // Discovered but never reached. Present so incompleteness is inside the hash: without it a run
    // that crashed halfway seals to an id indistinguishable from a complete one.
    leaves.push({
      targetId: 'target-999',
      orgKey: 'org-999',
      posture: 'not-attempted',
      protocolVersion: null,
      serverName: null,
      serverVersion: null,
      tools: [],
      toolsTruncated: false,
      http: {
        wwwAuthenticate: null,
        corsAllowOrigin: null,
        hasRateLimitHeaders: false,
        server: null,
        cdn: null,
      },
    });

    assertNoForbiddenMethods(...servers);

    const snapshot = await seal({ discoverManifestHash: 'pipeline-test', leaves });
    const rules = await loadRuleSet();
    const classified = classifySnapshot(snapshot, rules);
    const artifacts = buildReport({
      snapshot,
      rules,
      optOut: freshOptOutList(),
      optOutId: 'pipeline-optout',
      protocolVersion: '0.1.0',
      variants: (await loadVariants()).variants,
    });

    return { snapshot, classified, artifacts, servers };
  } finally {
    await Promise.all(servers.map((s) => s.stop()));
  }
}

describe('the full pipeline', () => {
  test('probe -> seal -> classify -> report, with no tool ever invoked', async () => {
    const { snapshot, classified, artifacts, servers } = await runPipeline();

    expect(snapshot.manifest.leafCount).toBe(6);
    expect(classified.rows.length).toBeGreaterThan(0);
    expect(artifacts['report.md']).toContain('## Limitations');

    for (const server of servers) {
      expect(server.methods).not.toContain('tools/call');
    }
  });

  test('every posture the instrument can record appears, including the honest ones', async () => {
    const { snapshot } = await runPipeline();
    const postures = new Set(snapshot.leaves.map((l) => l.posture));

    expect(postures).toContain('open');
    expect(postures).toContain('gated');
    expect(postures).toContain('partial');
    expect(postures).toContain('opted-out');
    // Incompleteness is a recorded fact, not a gap in the data.
    expect(postures).toContain('not-attempted');
  });

  test('the generated report passes the publication linter', async () => {
    const { artifacts } = await runPipeline();
    const rules = await loadPublicationRules();
    for (const [name, content] of Object.entries(artifacts)) {
      expect(lintArtifact(name, content, rules), name).toEqual([]);
    }
  });

  /** Acceptance criterion: every published figure regenerates from a named snapshot. */
  test('the report regenerates identically from the same named snapshot', async () => {
    const { snapshot, artifacts } = await runPipeline();
    const rules = await loadRuleSet();

    const again = buildReport({
      snapshot,
      rules,
      optOut: freshOptOutList(),
      optOutId: 'pipeline-optout',
      protocolVersion: '0.1.0',
      variants: (await loadVariants()).variants,
    });

    expect(again['stats.json']).toBe(artifacts['stats.json']);
    expect(again['tools.csv']).toBe(artifacts['tools.csv']);
    expect(again['report.md']).toBe(artifacts['report.md']);
  });

  test('an opted-out server contributes a posture and no tools', async () => {
    const { snapshot } = await runPipeline();
    const optedOut = snapshot.leaves.find((l) => l.posture === 'opted-out');
    expect(optedOut?.tools).toEqual([]);
  });
});
