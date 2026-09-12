/**
 * Stage 1. The tests that matter here are about the denominator: every one of these defects would
 * have silently changed a published figure rather than causing a visible failure.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildDiscoverManifest,
  collapseToOrganizations,
  deduplicate,
  isRoutableHost,
  loadSharedPlatforms,
  onlyOperatorPublished,
  pathCandidates,
  type Candidate,
} from '../src/stages/discover.js';

function candidate(host: string, path = '/mcp'): Candidate {
  return {
    host,
    path,
    source: 'ct',
    confidence: 'primary',
    operatorPublished: false,
    provenance: 'test',
  };
}

function published(host: string, path = '/mcp'): Candidate {
  return { ...candidate(host, path), source: 'registry', operatorPublished: true };
}

describe('discover', () => {
  /**
   * Certificate logs return one row per certificate. In the first live run 8,134 rows were 1,100
   * distinct hosts — counting rows would have overstated the population sevenfold.
   */
  test('duplicate certificate rows collapse to distinct hosts', () => {
    const deduped = deduplicate([
      candidate('mcp.example.com'),
      candidate('mcp.example.com'),
      candidate('mcp.example.com', '/api/mcp'),
    ]);
    expect(deduped).toHaveLength(2);
  });

  test('regional endpoints of one company are one organization', async () => {
    const orgs = await collapseToOrganizations([
      candidate('eu.mcp.acme.com'),
      candidate('us.mcp.acme.com'),
      candidate('mcp.acme.com'),
    ]);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.collapsedFrom).toHaveLength(3);
  });

  /**
   * The opposite error, and the one that actually showed up in both live runs: unrelated tenants
   * under one suffix share a registrable domain and would have counted as a single data point.
   * 427 Cloudflare Workers tenants collapsed into one "organization" before this was fixed.
   */
  test('unrelated tenants on a shared platform stay separate organizations', async () => {
    const platforms = await loadSharedPlatforms();
    expect(platforms.platforms).toContain('hosted.app');

    const orgs = await collapseToOrganizations(
      [candidate('alice-mcp.hosted.app'), candidate('bob-mcp.hosted.app')],
      platforms.platforms,
    );
    expect(orgs).toHaveLength(2);
  });

  /**
   * The Public Suffix List's private section already enumerates these, maintained by the platforms
   * themselves. tldts ignores it unless asked, which is what caused the collapse. Relying on the
   * PSL rather than a hand-maintained list is what makes this keep working.
   */
  test('PSL private suffixes separate tenants without a local rule', async () => {
    for (const host of ['workers.dev', 'vercel.app', 'github.io', 'pages.dev']) {
      const orgs = await collapseToOrganizations([
        candidate(`alice.${host}`),
        candidate(`bob.${host}`),
      ]);
      expect(orgs, host).toHaveLength(2);
    }
  });

  /**
   * The two mechanisms are not redundant. The PSL covers platforms that registered themselves;
   * rules/shared-platforms.json covers the ones that have not, and railway.app is currently one of
   * them — it collapses without the local list and separates with it.
   */
  test('the local list covers platforms the PSL does not', async () => {
    const withoutList = await collapseToOrganizations([
      candidate('alice.railway.app'),
      candidate('bob.railway.app'),
    ]);
    expect(withoutList).toHaveLength(1);

    const platforms = await loadSharedPlatforms();
    const withList = await collapseToOrganizations(
      [candidate('alice.railway.app'), candidate('bob.railway.app')],
      platforms.platforms,
    );
    expect(withList).toHaveLength(2);
  });

  test('ordinary domains still collapse, private suffixes or not', async () => {
    const orgs = await collapseToOrganizations([
      candidate('eu.mcp.acme.com'),
      candidate('us.mcp.acme.com'),
      candidate('mcp.acme.co.uk'),
    ]);
    expect(orgs).toHaveLength(2);
  });

  /**
   * The asymmetry is deliberate: broad when deciding whom to contact, precise when counting.
   * An opt-out entry for a platform suffix should cover its tenants; a statistic must not.
   */
  test('opt-out matching stays broad where organization counting is precise', async () => {
    const { isOnList, organizationDomain } = await import('../src/net/optout.js');
    const { freshOptOutList } = await import('./helpers/harness.js');

    const list = freshOptOutList(['workers.dev']);
    expect(isOnList(list, 'alice.workers.dev')).toBe(true);
    expect(organizationDomain('alice.workers.dev')).toBe('alice.workers.dev');
  });

  test('the collapse is auditable', async () => {
    const orgs = await collapseToOrganizations([candidate('a.acme.com'), candidate('b.acme.com')]);
    expect(orgs[0]?.collapsedFrom).toEqual(['a.acme.com', 'b.acme.com']);
  });

  test('organization keys are opaque, so the derived tier holds no hostname', async () => {
    const orgs = await collapseToOrganizations([candidate('mcp.acme.com')]);
    expect(orgs[0]?.orgKey).not.toContain('acme');
    expect(orgs[0]?.orgKey).toMatch(/^[0-9a-f]{16}$/);
  });

  test('non-routable and bare names are excluded', async () => {
    expect(isRoutableHost('mcp.example.com')).toBe(true);
    for (const host of ['bmcp.local', 'server.internal', 'box.lan', 'thing.test', 'x.invalid']) {
      expect(isRoutableHost(host), host).toBe(false);
    }
    // A bare name with no public suffix is not an organization.
    const orgs = await collapseToOrganizations([candidate('mcp'), candidate('bmcp.local')]);
    expect(orgs).toEqual([]);
  });

  test('path candidates are marked lower confidence', () => {
    const generated = pathCandidates(['acme.com']);
    expect(generated).toHaveLength(3);
    expect(generated.every((c) => c.confidence === 'lower')).toBe(true);
  });

  test('the manifest reports both the distinct and the raw counts', async () => {
    const manifest = await buildDiscoverManifest([
      candidate('mcp.acme.com'),
      candidate('mcp.acme.com'),
    ]);
    expect(manifest.rawRowCount).toBe(2);
    expect(manifest.candidateCount).toBe(1);
    expect(manifest.manifestHash).toHaveLength(64);
  });

  /**
   * The distinction v1's population rests on. A registry entry is an operator publishing an endpoint
   * so that clients connect to it; a certificate-log hostname is us guessing. See LEGAL.md item 1.
   */
  test('operator-published candidates are distinguished from inferred ones', async () => {
    const mixed = [published('mcp.acme.com'), candidate('mcp.guessed.com')];
    expect(onlyOperatorPublished(mixed)).toHaveLength(1);
    expect(onlyOperatorPublished(mixed)[0]?.host).toBe('mcp.acme.com');

    const manifest = await buildDiscoverManifest(mixed);
    expect(manifest.candidateCount).toBe(2);
    expect(manifest.operatorPublishedCount).toBe(1);
  });

  test('a path from a registry entry is the operator\'s, not a guess', () => {
    // pathCandidates invents paths and says so; registry entries carry the operator's own.
    expect(pathCandidates(['acme.com']).every((c) => !c.operatorPublished)).toBe(true);
  });

  test('the manifest hash is stable across candidate ordering', async () => {
    const a = await buildDiscoverManifest([candidate('b.acme.com'), candidate('a.acme.com')]);
    const b = await buildDiscoverManifest([candidate('a.acme.com'), candidate('b.acme.com')]);
    expect(a.manifestHash).toBe(b.manifestHash);
  });
});
