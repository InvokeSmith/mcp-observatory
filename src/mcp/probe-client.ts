/**
 * The only MCP client in this program. It can do two things.
 *
 * The SDK's `Client` has `callTool`. This wrapper holds one as a private field, never exposes it,
 * and is the sole module permitted to import it (asserted by a test). Combined with
 * {@link GatedTransport}, which will not carry a `tools/call` message, and the gate, which will not
 * carry a request to an origin the ticket does not name, there is no arrangement of this code that
 * invokes someone's tool.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { InitializeResult, Tool } from '@modelcontextprotocol/client';
import { GatedTransport } from './gated-transport.js';
import { CLIENT_INFO } from '../config/identity.js';
import type { Gate } from '../net/gate.js';
import type { TargetTicket } from '../net/ticket.js';

/** Bounded so a server that keeps handing back a cursor cannot keep us asking. */
export const MAX_TOOL_PAGES = 10;

export interface ProbeResult {
  readonly initialize: InitializeResult;
  readonly tools: readonly Tool[];
  readonly pagesFetched: number;
  readonly truncated: boolean;
}

export class ProbeClient {
  readonly #client: Client;
  readonly #transport: GatedTransport;
  #connected = false;

  private constructor(client: Client, transport: GatedTransport) {
    this.#client = client;
    this.#transport = transport;
  }

  static create(gate: Gate, ticket: TargetTicket): ProbeClient {
    const inner = new StreamableHTTPClientTransport(new URL(ticket.origin + ticket.path), {
      // The SDK threads this through every HTTP path it has, including any OAuth token exchange.
      // Handing it a ticket-bound fetch is what makes the gate an invariant rather than a habit.
      fetch: gate.fetchFor(ticket),

      // No authProvider. Constraint 2 by construction: with none supplied the transport performs no
      // discovery, no token exchange and no redirect — a 401 simply throws. We still enforce the
      // auth wall in the gate, because a headline constraint should not rest on an omitted option.

      // Nothing reconnects. Reconnection is a retry loop we did not schedule and cannot see.
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 0,
        maxReconnectionDelay: 0,
        reconnectionDelayGrowFactor: 1,
      },
    });

    const transport = new GatedTransport(inner);
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    return new ProbeClient(client, transport);
  }

  /** One of exactly two protocol calls. */
  async initialize(): Promise<InitializeResult> {
    await this.#client.connect(this.#transport);
    this.#connected = true;
    const result = this.#client.getServerVersion();
    return {
      protocolVersion: this.#client.getNegotiatedProtocolVersion() ?? 'unknown',
      capabilities: this.#client.getServerCapabilities() ?? {},
      serverInfo: result ?? { name: 'unknown', version: 'unknown' },
    } as InitializeResult;
  }

  /** The other one. Paginated, capped, and never followed into a cycle. */
  async listTools(): Promise<{ tools: readonly Tool[]; pages: number; truncated: boolean }> {
    const tools: Tool[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page = await this.#client.listTools(cursor === undefined ? {} : { cursor });
      pages += 1;
      tools.push(...page.tools);

      const next = page.nextCursor;
      if (next === undefined) return { tools, pages, truncated: false };

      // A server handing back a cursor it already gave us is a loop, not a page. Stopping is the
      // polite reading and also the one that keeps us from hammering it forever.
      if (seenCursors.has(next)) return { tools, pages, truncated: true };
      seenCursors.add(next);

      if (pages >= MAX_TOOL_PAGES) return { tools, pages, truncated: true };
      cursor = next;
    }
  }

  async close(): Promise<void> {
    if (!this.#connected) return;
    await this.#client.close();
    this.#connected = false;
  }

  /** Test observability: how many messages the transport refused to carry. */
  get transportRefusals(): number {
    return this.#transport.refusals;
  }
}
