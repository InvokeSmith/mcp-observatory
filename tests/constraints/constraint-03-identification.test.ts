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
  PGP_FINGERPRINT,
  PGP_KEY_PATH,
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
   * The same rule as the contact address, for the same reason. A disclosure policy that advertises
   * encryption it cannot accept is worse than one advertising none: a reporter encrypts a real
   * finding to a key nobody holds, and believes they have reported it safely.
   *
   * This repository shipped that defect twice already — an email address on a domain that did not
   * exist, and a PGP key promised before first live probing that was not published before probing
   * began. So the promise is now tied to the declaration.
   */
  test('no PGP key is advertised unless one is actually published', async () => {
    const { readFile, access } = await import('node:fs/promises');

    if (PGP_FINGERPRINT === null) {
      // Nothing may read as an offer to receive encrypted mail.
      for (const file of ['DISCLOSURE.md', 'SECURITY.md', 'README.md']) {
        const text = await readFile(file, 'utf8');
        expect(text, `${file} advertises a fingerprint while identity declares none`).not.toMatch(
          /\b[0-9A-F]{4}(\s?[0-9A-F]{4}){7,9}\b/,
        );
        expect(text, `${file} tells a reporter to encrypt, but no key is declared`).not.toMatch(
          /encrypt (it|this|your report|the report) (to|with|using)/i,
        );
      }
      return;
    }

    // A declared fingerprint means the key must actually be in the repository.
    await expect(access(PGP_KEY_PATH)).resolves.toBeUndefined();
    const armoured = await readFile(PGP_KEY_PATH, 'utf8');
    expect(armoured).toContain('BEGIN PGP PUBLIC KEY BLOCK');

    // And the fingerprint must appear where a reporter would look for it.
    const normalized = PGP_FINGERPRINT.replace(/\s+/g, '').toUpperCase();
    for (const file of ['DISCLOSURE.md', 'SECURITY.md']) {
      const text = (await readFile(file, 'utf8')).replace(/\s+/g, '').toUpperCase();
      expect(text, `${file} does not carry the declared fingerprint`).toContain(normalized);
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
