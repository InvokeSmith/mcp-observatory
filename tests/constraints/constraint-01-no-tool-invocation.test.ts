/**
 * Constraint 1: never call `tools/call`.
 *
 * Four layers, tested weakest-last, because the honest ranking matters more than the count.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client';
import { GatedTransport, ALLOWED_OUTBOUND_METHODS } from '../../src/mcp/gated-transport.js';
import { ProbeClient } from '../../src/mcp/probe-client.js';
import { ForbiddenMethodError } from '../../src/net/errors.js';
import { assertNoForbiddenMethods, FixtureServer } from '../fixtures/server.js';
import { makeGate, makeTicket } from '../helpers/harness.js';

describe('constraint 1: no tool invocation', () => {
  /**
   * LAYER 1, the load-bearing one. A real server on the other end of a real socket records every
   * method it was asked for. This predicate is bytes on the wire, so it survives string
   * concatenation, method names read from variables, and anything the SDK does on its own.
   */
  describe('the fixture server is the witness', () => {
    let server: FixtureServer;

    beforeEach(() => {
      server = new FixtureServer({ kind: 'open' });
      server.start();
    });

    afterEach(async () => {
      await server.stop();
    });

    test('a full probe puts only initialize and tools/list on the wire', async () => {
      const { gate } = makeGate();
      const ticket = makeTicket(server.url, server.mcpPath);
      const client = ProbeClient.create(gate, ticket);

      await client.initialize();
      const listed = await client.listTools();
      await client.close();

      expect(listed.tools.length).toBeGreaterThan(0);
      expect(server.methods).toContain('initialize');
      expect(server.methods).toContain('tools/list');
      expect(server.methods).not.toContain('tools/call');
      assertNoForbiddenMethods(server);
    });
  });

  /**
   * LAYER 2. The transport refuses the message before the inner transport ever observes it. The spy
   * is the assertion: it is not enough that we threw, it must be that nothing was delegated.
   */
  describe('the wire shape is narrow by construction', () => {
    function spyTransport(): { transport: Transport; sent: JSONRPCMessage[] } {
      const sent: JSONRPCMessage[] = [];
      const transport: Transport = {
        start: async () => undefined,
        send: async (message: JSONRPCMessage) => {
          sent.push(message);
        },
        close: async () => undefined,
      };
      return { transport, sent };
    }

    test('a tools/call message throws and is never delegated', async () => {
      const { transport, sent } = spyTransport();
      const gated = new GatedTransport(transport);

      const attempt = gated.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'refund_payment', arguments: { amount: 100 } },
      } as JSONRPCMessage);

      await expect(attempt).rejects.toThrow(ForbiddenMethodError);
      expect(sent).toHaveLength(0);
      expect(gated.refusals).toBe(1);
    });

    test('a dynamically assembled method name is refused just the same', async () => {
      const { transport, sent } = spyTransport();
      const gated = new GatedTransport(transport);
      const assembled = ['tools', 'call'].join('/');

      await expect(
        gated.send({ jsonrpc: '2.0', id: 2, method: assembled } as JSONRPCMessage),
      ).rejects.toThrow(ForbiddenMethodError);
      expect(sent).toHaveLength(0);
    });

    test('the allowed set is exactly the methods this scanner originates', () => {
      expect([...ALLOWED_OUTBOUND_METHODS].sort()).toEqual([
        'initialize',
        'notifications/cancelled',
        'notifications/initialized',
        'tools/list',
      ]);
    });

    test('outbound responses carry no method and must still pass', async () => {
      const { transport, sent } = spyTransport();
      const gated = new GatedTransport(transport);

      // A reply to a server-initiated ping. Rejecting this would hang the connection, so the
      // no-method case is handled as its own branch rather than falling through to refusal.
      await gated.send({ jsonrpc: '2.0', id: 7, result: {} } as JSONRPCMessage);
      expect(sent).toHaveLength(1);
      expect(gated.refusals).toBe(0);
    });
  });

  /** LAYER 3. The client has no invoke path, and only one module may import the SDK client. */
  describe('the client has no invoke path', () => {
    test('ProbeClient exposes exactly initialize, listTools, close', () => {
      const names = Object.getOwnPropertyNames(ProbeClient.prototype)
        .filter((n) => n !== 'constructor')
        .sort();
      expect(names).toEqual(['close', 'initialize', 'listTools', 'transportRefusals']);
    });

    test('ProbeClient has no callTool by any name', () => {
      const surface = Object.getOwnPropertyNames(ProbeClient.prototype).join(' ');
      expect(surface).not.toContain('call');
      expect(surface).not.toContain('invoke');
      expect(surface).not.toContain('execute');
    });

    test('only probe-client.ts imports the SDK client', async () => {
      const offenders: string[] = [];
      for (const file of await sourceFiles('src')) {
        const text = await readFile(file, 'utf8');
        if (!text.includes("from '@modelcontextprotocol/client'")) continue;
        if (file.endsWith('probe-client.ts')) continue;
        // Type-only imports cannot invoke anything.
        if (/import\s+type\s*\{[^}]*\}\s*from\s*'@modelcontextprotocol\/client'/.test(text)) {
          const valueImport = /^import\s+\{/m.test(text.split('\n').filter((l) => l.includes('@modelcontextprotocol/client')).join('\n'));
          if (!valueImport) continue;
        }
        offenders.push(file);
      }
      expect(offenders).toEqual([]);
    });
  });

  /**
   * LAYER 4, the weakest. Kept as a lint and explicitly not a proof: `'tools/' + 'call'` evades it,
   * which is why layer 1 exists and why the README says so rather than implying four layers of
   * equal strength.
   */
  describe('static scan (a lint, not a proof)', () => {
    test('no source file contains a tools/call literal or a callTool member access', async () => {
      const allowed = new Set(['src/mcp/gated-transport.ts']);
      const offenders: string[] = [];

      for (const file of await sourceFiles('src')) {
        const relative = file.replace(`${process.cwd()}/`, '');
        if (allowed.has(relative)) continue;
        const text = await readFile(file, 'utf8');
        const withoutComments = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/tools\/call/.test(withoutComments) || /\.callTool\b/.test(withoutComments)) {
          offenders.push(relative);
        }
      }
      expect(offenders).toEqual([]);
    });
  });
});

async function sourceFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    // readdir order is not sorted on macOS or Linux; sort so failures are reproducible.
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.ts')) found.push(full);
    }
  }
  await walk(join(process.cwd(), root));
  return found;
}
