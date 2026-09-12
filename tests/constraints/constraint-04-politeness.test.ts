/**
 * Constraint 4: be gentle.
 *
 * The unit that matters is the operator, not the hostname — see src/net/politeness.ts. And the 429
 * skip has to survive process restarts, because a counter that resets every run is satisfied within
 * a run and violated across them, which is the version the operator experiences.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GateRefusal } from '../../src/net/errors.js';
import { HostState, RATE_LIMIT_SKIP_THRESHOLD } from '../../src/net/host-state.js';
import { operatorKey, PolitenessQueue, backoffDelayMs } from '../../src/net/politeness.js';
import { FixtureServer } from '../fixtures/server.js';
import { makeGate, makeTicket } from '../helpers/harness.js';

describe('constraint 4: be gentle', () => {
  let server: FixtureServer;

  beforeEach(() => {
    server = new FixtureServer({ kind: 'open', delayMs: 15 });
    server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  test('never more than one request in flight against the same operator', async () => {
    const { gate, queue } = makeGate();

    await Promise.all(
      Array.from({ length: 6 }, () => {
        const ticket = makeTicket(server.url, server.mcpPath);
        return gate.fetch(ticket, `${server.url}${server.mcpPath}`, { method: 'POST' });
      }),
    );

    expect(server.peakConcurrent).toBe(1);
    expect(queue.peakInFlight('127.0.0.1')).toBe(1);
    expect(server.httpRequestCount).toBe(6);
  });

  test('the politeness unit is the operator, not the hostname', () => {
    // Sibling subdomains are one operator. Otherwise 3,000 CDN subdomains become 3,000 "hosts",
    // each politely at one connection, and the operator absorbs all of them at once.
    expect(operatorKey('mcp.example.com')).toBe(operatorKey('eu.mcp.example.com'));
    expect(operatorKey('mcp.example.com')).not.toBe(operatorKey('mcp.other.com'));
  });

  test('the global cap bounds total concurrency', async () => {
    const queue = new PolitenessQueue(2);
    let active = 0;
    let peak = 0;

    await Promise.all(
      ['a.example.com', 'b.example.com', 'c.example.com', 'd.example.com'].map((host) =>
        queue.run(host, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await Bun.sleep(10);
          active -= 1;
        }),
      ),
    );

    expect(peak).toBeLessThanOrEqual(2);
  });

  test('a second 429 permanently skips the host', async () => {
    const limited = new FixtureServer({ kind: 'rate-limited', rateLimitCount: 5 });
    limited.start();
    try {
      const { gate, hostState } = makeGate();
      const ticket = makeTicket(limited.url, limited.mcpPath);

      await gate
        .fetch(ticket, `${limited.url}${limited.mcpPath}`, { method: 'POST' })
        .catch(() => undefined);

      expect(hostState.get('127.0.0.1')?.rateLimitHits).toBeGreaterThanOrEqual(
        RATE_LIMIT_SKIP_THRESHOLD,
      );
      expect(hostState.terminalFor('127.0.0.1')).toBe('rate-limit-skip');

      const after = limited.httpRequestCount;
      const next = makeTicket(limited.url, limited.mcpPath);
      await expect(
        gate.fetch(next, `${limited.url}${limited.mcpPath}`, { method: 'POST' }),
      ).rejects.toThrow(GateRefusal);
      expect(limited.httpRequestCount).toBe(after);
    } finally {
      await limited.stop();
    }
  });

  test('the skip survives a restart, because host state is durable across runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'observatory-hoststate-'));
    const logPath = join(dir, 'hosts.ndjson');
    try {
      const first = await HostState.load(logPath);
      await first.noteRateLimit('mcp.example.com', 1);
      await first.noteRateLimit('mcp.example.com', 2);
      expect(first.terminalFor('mcp.example.com')).toBe('rate-limit-skip');

      const reloaded = await HostState.load(logPath);
      expect(reloaded.terminalFor('mcp.example.com')).toBe('rate-limit-skip');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('backoff grows and stays bounded', () => {
    expect(backoffDelayMs(0, () => 1)).toBe(1000);
    expect(backoffDelayMs(3, () => 1)).toBe(8000);
    expect(backoffDelayMs(20, () => 1)).toBe(30_000);
    expect(backoffDelayMs(2, () => 0)).toBe(0);
  });
});
