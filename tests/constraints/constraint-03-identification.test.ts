/**
 * Constraint 3: identify yourself.
 *
 * Two channels, because an operator reading HTTP logs and an operator reading MCP server logs are
 * often different people looking at different systems. A scanner present in only one of them is
 * invisible to whoever is actually asking "who just connected?"
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ProbeClient } from '../../src/mcp/probe-client.js';
import {
  CLIENT_INFO,
  CONTACT_EMAIL,
  CONTACT_URL,
  isPlaceholderIdentity,
  PROJECT_NAME,
  USER_AGENT,
} from '../../src/config/identity.js';
import { GateRefusal } from '../../src/net/errors.js';
import { FixtureServer } from '../fixtures/server.js';
import { makeGate, makeTicket } from '../helpers/harness.js';

describe('constraint 3: identify yourself', () => {
  let server: FixtureServer;

  beforeEach(() => {
    server = new FixtureServer({ kind: 'open' });
    server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  test('every request carries the User-Agent with a contact URL', async () => {
    const { gate } = makeGate();
    const ticket = makeTicket(server.url, server.mcpPath);
    const client = ProbeClient.create(gate, ticket);

    await client.initialize();
    await client.listTools();
    await client.close();

    expect(server.received.length).toBeGreaterThan(0);
    for (const request of server.received) {
      expect(request.userAgent).toBe(USER_AGENT);
      expect(request.userAgent).toContain(PROJECT_NAME);
      expect(request.userAgent).toContain(CONTACT_URL);
    }
  });

  test('initialize carries the same identity in clientInfo', async () => {
    const { gate } = makeGate();
    const ticket = makeTicket(server.url, server.mcpPath);
    await ProbeClient.create(gate, ticket).initialize();

    const initialize = server.received.find((r) => r.method === 'initialize');
    expect(initialize?.clientInfoName).toBe(CLIENT_INFO.name);
  });

  test('a caller cannot override the User-Agent', async () => {
    const { gate } = makeGate();
    const ticket = makeTicket(server.url, server.mcpPath);

    await gate.fetch(ticket, `${server.url}${server.mcpPath}`, {
      method: 'POST',
      headers: { 'user-agent': 'definitely-not-a-scanner/1.0' },
    });

    expect(server.received[0]?.userAgent).toBe(USER_AGENT);
  });

  test('the identity is not a placeholder', () => {
    expect(isPlaceholderIdentity()).toBe(false);
    expect(CONTACT_URL).toStartWith('https://');
  });

  /**
   * A contact address that receives nothing is worse than none: an operator writes to it, believes
   * they have opted out, and has not. This project shipped exactly that defect once — an address
   * invented for a domain with no MX, promised in four public documents — so the rule is now that
   * a published address must be one the preflight can check.
   */
  test('no contact channel is promised that cannot be verified', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const file of ['OPTOUT.md', 'DISCLOSURE.md', 'SECURITY.md', 'optout.txt', 'README.md']) {
      const text = await readFile(file, 'utf8');
      const addresses = text.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi) ?? [];
      for (const address of addresses) {
        expect(
          address,
          `${file} promises ${address}, which identity.ts does not declare as CONTACT_EMAIL`,
        ).toBe(CONTACT_EMAIL ?? '<no contact email is declared>');
      }
    }
  });

  /**
   * The preflight. A scanner whose contact URL 404s is worse than one with no User-Agent at all: it
   * looks like someone impersonating a research project. So unverified identity is a refusal, not a
   * warning.
   */
  test('probing is refused until the contact URL is verified to resolve', async () => {
    const { gate } = makeGate({ identityVerified: false });
    const ticket = makeTicket(server.url, server.mcpPath);

    await expect(
      gate.fetch(ticket, `${server.url}${server.mcpPath}`, { method: 'POST' }),
    ).rejects.toThrow(GateRefusal);

    expect(server.httpRequestCount).toBe(0);
  });
});
