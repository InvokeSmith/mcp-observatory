/**
 * The probe stage end to end, against real fixture servers. The postures are the product of this
 * stage, so each is asserted against a server that actually behaves that way rather than a mock.
 */
import { describe, expect, test } from 'bun:test';
import { probeTarget } from '../src/stages/probe.js';
import { assertNoForbiddenMethods, FixtureServer } from './fixtures/server.js';
import { makeGate } from './helpers/harness.js';

async function withServer<T>(
  server: FixtureServer,
  run: (server: FixtureServer) => Promise<T>,
): Promise<T> {
  server.start();
  try {
    return await run(server);
  } finally {
    await server.stop();
  }
}

function target(server: FixtureServer) {
  return {
    targetId: `t:${server.url}`,
    orgKey: 'org-test',
    origin: server.url,
    path: server.mcpPath,
  };
}

describe('probe stage', () => {
  test('an open server yields posture "open" and its declared tools', async () => {
    await withServer(new FixtureServer({ kind: 'open' }), async (server) => {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, target(server));

      expect(outcome.leaf.posture).toBe('open');
      expect(outcome.leaf.tools.map((t) => t.name)).toEqual(['list_invoices', 'refund_payment']);
      expect(outcome.leaf.serverName).toBe('fixture-open');
      assertNoForbiddenMethods(server);
    });
  });

  test('a 401 server yields "gated" and never gets a tools/list', async () => {
    await withServer(new FixtureServer({ kind: 'auth-wall' }), async (server) => {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, target(server));

      expect(outcome.leaf.posture).toBe('gated');
      expect(outcome.leaf.tools).toEqual([]);
      expect(server.methods).not.toContain('tools/list');
      assertNoForbiddenMethods(server);
    });
  });

  test('initialize ok but listing refused is "partial", a distinct fact from fully gated', async () => {
    await withServer(new FixtureServer({ kind: 'partial' }), async (server) => {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, target(server));

      expect(outcome.leaf.posture).toBe('partial');
      expect(server.methods).toContain('initialize');
      assertNoForbiddenMethods(server);
    });
  });

  test('a self-service opt-out stops before any MCP call', async () => {
    await withServer(new FixtureServer({ kind: 'well-known-optout' }), async (server) => {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, target(server));

      expect(outcome.leaf.posture).toBe('opted-out');
      expect(server.methods).toEqual([]);
      expect(server.httpRequestCount).toBe(1);
    });
  });

  test('an unreachable well-known defers rather than assuming consent', async () => {
    await withServer(new FixtureServer({ kind: 'well-known-unreachable' }), async (server) => {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, target(server));

      expect(outcome.leaf.posture).toBe('optout-undetermined');
      expect(server.methods).toEqual([]);
    });
  });

  test('pagination is followed and the tools are accumulated', async () => {
    await withServer(new FixtureServer({ kind: 'paginated' }), async (server) => {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, target(server));

      expect(outcome.leaf.posture).toBe('open');
      expect(outcome.leaf.tools).toHaveLength(2);
      expect(outcome.leaf.toolsTruncated).toBe(false);
      assertNoForbiddenMethods(server);
    });
  });

  test('http metadata is collected without authenticating', async () => {
    await withServer(new FixtureServer({ kind: 'auth-wall' }), async (server) => {
      const { gate, hostState } = makeGate();
      const outcome = await probeTarget(gate, hostState, target(server));
      expect(outcome.leaf.http.wwwAuthenticate).toContain('Bearer');
    });
  });
});
