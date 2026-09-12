/**
 * Constraint 2: stop at the auth wall.
 *
 * The interesting case is not "we chose not to retry." It is that the SDK may retry on its own,
 * before our code ever sees the 401, so the terminal state has to be recorded inside the gate on the
 * response path. These tests assert on request counts observed by the server, not on our intentions.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProbeClient } from '../../src/mcp/probe-client.js';
import { GateRefusal } from '../../src/net/errors.js';
import { assertNoForbiddenMethods, FixtureServer } from '../fixtures/server.js';
import { makeGate, makeTicket } from '../helpers/harness.js';

describe('constraint 2: stop at the auth wall', () => {
  let server: FixtureServer;

  beforeEach(() => {
    server = new FixtureServer({ kind: 'auth-wall' });
    server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  test('a 401 produces exactly one request and no follow-up', async () => {
    const { gate } = makeGate();
    const ticket = makeTicket(server.url, server.mcpPath);
    const client = ProbeClient.create(gate, ticket);

    await expect(client.initialize()).rejects.toThrow();

    expect(server.httpRequestCount).toBe(1);
    expect(gate.capturesFor(ticket.targetId)).toHaveLength(1);
    assertNoForbiddenMethods(server);
  });

  test('the host is marked terminal, so a later attempt never reaches the wire', async () => {
    const { gate, hostState } = makeGate();
    const ticket = makeTicket(server.url, server.mcpPath);

    await expect(ProbeClient.create(gate, ticket).initialize()).rejects.toThrow();
    const afterFirst = server.httpRequestCount;

    expect(hostState.terminalFor('127.0.0.1')).toBe('auth-wall');

    const second = makeTicket(server.url, server.mcpPath);
    await expect(
      gate.fetch(second, `${server.url}${server.mcpPath}`, { method: 'POST' }),
    ).rejects.toThrow(GateRefusal);

    expect(server.httpRequestCount).toBe(afterFirst);
  });

  test('we never send credentials, and a caller cannot smuggle them in', async () => {
    const { gate } = makeGate();
    const ticket = makeTicket(server.url, server.mcpPath);

    await gate
      .fetch(ticket, `${server.url}${server.mcpPath}`, {
        method: 'POST',
        headers: { authorization: 'Bearer guessed-token', cookie: 'session=abc' },
      })
      .catch(() => undefined);

    expect(server.received).toHaveLength(1);
    expect(server.received[0]?.authorization).toBeNull();
  });

  test('the WWW-Authenticate metadata URL is never fetched', async () => {
    const { gate } = makeGate();
    const ticket = makeTicket(server.url, server.mcpPath);
    await expect(ProbeClient.create(gate, ticket).initialize()).rejects.toThrow();

    // The fixture advertises resource_metadata at auth.example.com. Following it would be a request
    // to a different origin, which the ticket does not admit by construction.
    const offOrigin = gate.captures.filter((c) => !c.url.startsWith(server.url));
    expect(offOrigin).toEqual([]);
  });

  test('a 403 on tools/list is a partial posture, still terminal', async () => {
    const partial = new FixtureServer({ kind: 'partial' });
    partial.start();
    try {
      const { gate, hostState } = makeGate();
      const ticket = makeTicket(partial.url, partial.mcpPath);
      const client = ProbeClient.create(gate, ticket);

      await client.initialize();
      await expect(client.listTools()).rejects.toThrow();

      expect(hostState.terminalFor('127.0.0.1')).toBe('auth-wall');
      expect(partial.methods).toContain('initialize');
      assertNoForbiddenMethods(partial);
    } finally {
      await partial.stop();
    }
  });
});
