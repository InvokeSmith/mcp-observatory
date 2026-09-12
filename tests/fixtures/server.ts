/**
 * Fixture MCP servers, and the witness that makes constraint 1 provable.
 *
 * The strongest evidence that this scanner never invokes a tool is not a source scan — a source scan
 * cannot see `'tools/' + 'call'`, a method name read from a variable, or anything the SDK does on
 * its own. It is a server on the other end of a real socket recording every method it was asked for.
 * Its predicate is bytes on the wire, which is the thing we actually promise.
 *
 * Every fixture records what it received. `assertNoForbiddenMethods` is the assertion.
 */
import type { Server } from 'bun';

type AnyServer = Server<unknown>;

export const ALLOWED_ON_THE_WIRE: ReadonlySet<string> = new Set([
  'initialize',
  'notifications/initialized',
  'notifications/cancelled',
  'tools/list',
  'ping',
]);

export interface ReceivedRequest {
  readonly method: string;
  readonly path: string;
  readonly httpMethod: string;
  readonly userAgent: string | null;
  readonly authorization: string | null;
  readonly clientInfoName: string | null;
  readonly at: number;
}

export type FixtureKind =
  | 'open'
  | 'auth-wall'
  | 'partial'
  | 'rate-limited'
  | 'paginated'
  | 'well-known-optout'
  | 'well-known-optout-json-domain'
  | 'catch-all-200'
  | 'well-known-unreachable';

export interface FixtureOptions {
  readonly kind: FixtureKind;
  readonly tools?: readonly unknown[];
  /** For 'rate-limited': how many 429s before it would succeed. */
  readonly rateLimitCount?: number;
  /** Artificial per-request delay, for concurrency assertions. */
  readonly delayMs?: number;
}

export class FixtureServer {
  readonly received: ReceivedRequest[] = [];
  #server: AnyServer | null = null;
  #rateLimitsServed = 0;
  #concurrent = 0;
  #peakConcurrent = 0;

  constructor(private readonly options: FixtureOptions) {}

  get url(): string {
    if (this.#server === null) throw new Error('fixture not started');
    return `http://127.0.0.1:${this.#server.port}`;
  }

  get mcpPath(): string {
    return '/mcp';
  }

  get peakConcurrent(): number {
    return this.#peakConcurrent;
  }

  /** Every JSON-RPC method this server was asked for, in order. */
  get methods(): readonly string[] {
    return this.received.filter((r) => r.method !== '').map((r) => r.method);
  }

  /** Every HTTP request, including the ones that carried no JSON-RPC body. */
  get httpRequestCount(): number {
    return this.received.length;
  }

  start(): void {
    this.#server = Bun.serve({
      port: 0,
      fetch: (request) => this.#handle(request),
    });
  }

  async stop(): Promise<void> {
    await this.#server?.stop(true);
    this.#server = null;
  }

  async #handle(request: Request): Promise<Response> {
    this.#concurrent += 1;
    this.#peakConcurrent = Math.max(this.#peakConcurrent, this.#concurrent);
    try {
      if (this.options.delayMs !== undefined) {
        await Bun.sleep(this.options.delayMs);
      }
      return await this.#route(request);
    } finally {
      this.#concurrent -= 1;
    }
  }

  async #route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const bodyText = request.method === 'POST' ? await request.text() : '';
    const parsed = parseJsonRpc(bodyText);

    this.received.push({
      method: parsed?.method ?? '',
      path: url.pathname,
      httpMethod: request.method,
      userAgent: request.headers.get('user-agent'),
      authorization: request.headers.get('authorization'),
      clientInfoName: clientInfoName(parsed),
      at: Date.now(),
    });

    if (url.pathname === '/.well-known/mcp-scan-optout') {
      return this.#wellKnown();
    }

    if (url.pathname !== this.mcpPath) {
      return this.options.kind === 'catch-all-200'
        ? new Response('<html><body>Not found, but cheerfully 200</body></html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          })
        : new Response('not found', { status: 404 });
    }

    switch (this.options.kind) {
      case 'auth-wall':
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'www-authenticate':
              'Bearer resource_metadata="https://auth.example.com/.well-known/oauth-protected-resource"',
          },
        });

      case 'rate-limited': {
        const budget = this.options.rateLimitCount ?? 2;
        if (this.#rateLimitsServed < budget) {
          this.#rateLimitsServed += 1;
          return new Response('slow down', {
            status: 429,
            headers: { 'retry-after': '1' },
          });
        }
        break;
      }

      case 'partial':
        if (parsed?.method === 'tools/list') {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          });
        }
        break;

      default:
        break;
    }

    if (parsed === null) return new Response('bad request', { status: 400 });
    return this.#jsonRpc(parsed);
  }

  #wellKnown(): Response {
    switch (this.options.kind) {
      case 'well-known-optout':
        return new Response('optout\n', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        });
      case 'well-known-optout-json-domain':
        return new Response(JSON.stringify({ optout: true, scope: 'domain' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      case 'catch-all-200':
        return new Response('<html><body>welcome</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      case 'well-known-unreachable':
        return new Response('upstream is sad', { status: 503 });
      default:
        return new Response('not found', { status: 404 });
    }
  }

  #jsonRpc(message: JsonRpcMessage): Response {
    if (message.method === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: `fixture-${this.options.kind}`, version: '1.0.0' },
        },
      });
    }

    if (message.method === 'tools/list') {
      const tools = this.options.tools ?? DEFAULT_TOOLS;
      if (this.options.kind === 'paginated') {
        const cursor = message.params?.['cursor'];
        if (cursor === undefined) {
          return jsonResponse({
            jsonrpc: '2.0',
            id: message.id,
            result: { tools: tools.slice(0, 1), nextCursor: 'page-2' },
          });
        }
        return jsonResponse({
          jsonrpc: '2.0',
          id: message.id,
          result: { tools: tools.slice(1) },
        });
      }
      return jsonResponse({ jsonrpc: '2.0', id: message.id, result: { tools } });
    }

    if (message.id === undefined) {
      return new Response(null, { status: 202 });
    }

    return jsonResponse({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `method not found: ${message.method}` },
    });
  }
}

/**
 * The assertion that makes constraint 1 real. Any method outside the allowed set having reached this
 * server is a failure of the whole run, not of one expectation.
 */
export function assertNoForbiddenMethods(...servers: readonly FixtureServer[]): void {
  for (const server of servers) {
    for (const method of server.methods) {
      if (!ALLOWED_ON_THE_WIRE.has(method)) {
        throw new Error(
          `CONSTRAINT 1 VIOLATED: a fixture server received JSON-RPC method ${JSON.stringify(method)}. ` +
            'This scanner sends only initialize and tools/list. It never invokes a tool.',
        );
      }
    }
  }
}

interface JsonRpcMessage {
  readonly method?: string;
  readonly id?: unknown;
  readonly params?: Record<string, unknown>;
}

function parseJsonRpc(body: string): (JsonRpcMessage & { method: string }) | null {
  if (body === '') return null;
  try {
    const parsed = JSON.parse(body) as JsonRpcMessage;
    if (typeof parsed.method !== 'string') return null;
    return parsed as JsonRpcMessage & { method: string };
  } catch {
    return null;
  }
}

function clientInfoName(message: JsonRpcMessage | null): string | null {
  const info = message?.params?.['clientInfo'];
  if (typeof info !== 'object' || info === null) return null;
  const name = (info as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export const DEFAULT_TOOLS: readonly unknown[] = [
  {
    name: 'list_invoices',
    description: 'List invoices for the authenticated account.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'refund_payment',
    description: 'Refund a payment. This creates a refund record and moves money.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: { type: 'string' },
        payment_id: { type: 'string' },
        amount: { type: 'number' },
      },
      required: ['account_id', 'payment_id'],
    },
  },
];
