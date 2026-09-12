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
  pathCandidates,
  type Candidate,
} from '../src/stages/discover.js';

function candidate(host: string, path = '/mcp'): Candidate {
  return { host, path, source: 'ct', confidence: 'primary', provenance: 'test' };
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
   * The opposite error, and the one that actually showed up in the live run: thirty-one unrelated
   * projects on *.hosted.app share a registrable domain and would have counted as one data point.
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

  test('the manifest hash is stable across candidate ordering', async () => {
    const a = await buildDiscoverManifest([candidate('b.acme.com'), candidate('a.acme.com')]);
    const b = await buildDiscoverManifest([candidate('a.acme.com'), candidate('b.acme.com')]);
    expect(a.manifestHash).toBe(b.manifestHash);
  });
});
