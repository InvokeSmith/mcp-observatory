/**
 * Constraint 5: honor opt-out.
 *
 * Two mechanisms with different contact costs, and the difference is the point. A published-list
 * entry means zero contact from any stage. A self-service entry costs exactly one GET to discover —
 * you cannot ask permission without asking — and then zero MCP calls.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkWellKnownOptOut } from '../../src/net/optout-check.js';
import { GateRefusal } from '../../src/net/errors.js';
import {
  interpretWellKnown,
  isListStale,
  isOnList,
  OPT_OUT_MAX_AGE_MS,
  parseOptOutList,
} from '../../src/net/optout.js';
import { FixtureServer } from '../fixtures/server.js';
import { freshOptOutList, makeGate, makeTicket } from '../helpers/harness.js';

describe('constraint 5: honor opt-out', () => {
  describe('the published list costs zero contact', () => {
    let server: FixtureServer;

    beforeEach(() => {
      server = new FixtureServer({ kind: 'open' });
      server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('a listed host is never contacted', async () => {
      const { gate } = makeGate({ optOut: ['127.0.0.1'] });
      const ticket = makeTicket(server.url, server.mcpPath);

      await expect(
        gate.fetch(ticket, `${server.url}${server.mcpPath}`, { method: 'POST' }),
      ).rejects.toThrow(GateRefusal);

      expect(server.httpRequestCount).toBe(0);
      expect(gate.captures).toEqual([]);
    });

    test('a registrable-domain entry covers every subdomain', () => {
      const list = freshOptOutList(['example.com']);
      expect(isOnList(list, 'example.com')).toBe(true);
      expect(isOnList(list, 'mcp.example.com')).toBe(true);
      expect(isOnList(list, 'eu.mcp.example.com')).toBe(true);
      expect(isOnList(list, 'example.org')).toBe(false);
      // Crucially not a naive suffix match: notexample.com must not be caught by example.com.
      expect(isOnList(list, 'notexample.com')).toBe(false);
    });

    test('comments and blank lines are ignored', () => {
      const list = parseOptOutList('# a comment\n\n  example.com  \n', Date.now());
      expect(list.entries.has('example.com')).toBe(true);
      expect(list.entries.size).toBe(1);
    });

    test('stale opt-out data halts the run rather than risking a probe', async () => {
      const stale = parseOptOutList('', Date.now() - OPT_OUT_MAX_AGE_MS - 1000);
      expect(isListStale(stale, Date.now())).toBe(true);

      const { gate } = makeGate({ optOutList: stale });
      const ticket = makeTicket(server.url, server.mcpPath);
      await expect(
        gate.fetch(ticket, `${server.url}${server.mcpPath}`, { method: 'POST' }),
      ).rejects.toThrow(GateRefusal);
      expect(server.httpRequestCount).toBe(0);
    });
  });

  describe('the self-service well-known', () => {
    test('an opted-out server receives the one GET and zero MCP calls', async () => {
      const server = new FixtureServer({ kind: 'well-known-optout' });
      server.start();
      try {
        const { gate } = makeGate();
        const decision = await checkWellKnownOptOut(gate, 'test:wk', server.url);

        expect(decision.kind).toBe('opted-out');
        expect(server.httpRequestCount).toBe(1);
        expect(server.received[0]?.path).toBe('/.well-known/mcp-scan-optout');
        expect(server.methods).toEqual([]);
      } finally {
        await server.stop();
      }
    });

    test('a JSON document can widen the scope to the whole registrable domain', async () => {
      const server = new FixtureServer({ kind: 'well-known-optout-json-domain' });
      server.start();
      try {
        const { gate } = makeGate();
        const decision = await checkWellKnownOptOut(gate, 'test:wk', server.url);
        expect(decision).toEqual({ kind: 'opted-out', source: 'well-known', scope: 'domain' });
      } finally {
        await server.stop();
      }
    });

    /**
     * The failure mode this guards against is subtle and would have been invisible: hosts that answer
     * 200 with HTML for every unknown path would all read as opted out, silently removing a large,
     * non-random slice of the population from the sample.
     */
    test('a catch-all 200 HTML page is NOT an opt-out', async () => {
      const server = new FixtureServer({ kind: 'catch-all-200' });
      server.start();
      try {
        const { gate } = makeGate();
        const decision = await checkWellKnownOptOut(gate, 'test:wk', server.url);
        expect(decision.kind).toBe('undetermined');
      } finally {
        await server.stop();
      }
    });

    test('a 404 means no preference expressed, and probing may proceed', async () => {
      const server = new FixtureServer({ kind: 'open' });
      server.start();
      try {
        const { gate } = makeGate();
        const decision = await checkWellKnownOptOut(gate, 'test:wk', server.url);
        expect(decision.kind).toBe('clear');
      } finally {
        await server.stop();
      }
    });

    test('an unreachable well-known is deferred, not treated as consent', async () => {
      const server = new FixtureServer({ kind: 'well-known-unreachable' });
      server.start();
      try {
        const { gate } = makeGate();
        const decision = await checkWellKnownOptOut(gate, 'test:wk', server.url);
        expect(decision.kind).toBe('undetermined');
      } finally {
        await server.stop();
      }
    });

    test('interpretation is tri-state across the response space', () => {
      expect(interpretWellKnown(200, 'text/plain', 'optout\n').kind).toBe('opted-out');
      expect(interpretWellKnown(200, 'application/json', '{"optout":true}').kind).toBe('opted-out');
      // An explicit opt-in is "no preference expressed", not permission: this survey does not rely
      // on anyone's permission to read a public declaration.
      expect(interpretWellKnown(200, 'application/json', '{"optout":false}').kind).toBe('clear');
      expect(interpretWellKnown(404, null, '').kind).toBe('clear');
      expect(interpretWellKnown(410, null, '').kind).toBe('clear');
      expect(interpretWellKnown(503, null, '').kind).toBe('undetermined');
      expect(interpretWellKnown(200, 'text/html', '<html></html>').kind).toBe('undetermined');
      expect(interpretWellKnown(200, 'application/json', 'not json').kind).toBe('undetermined');
      expect(interpretWellKnown(200, 'text/plain', 'go away please').kind).toBe('undetermined');
    });
  });
});
