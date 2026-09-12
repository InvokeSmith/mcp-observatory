/**
 * Constraint 1, at the wire boundary.
 *
 * This decorates a real MCP transport and refuses to hand it anything outside a narrow set of
 * message shapes. `tools/call` is not in the set, and there is no code path that adds it.
 *
 * The check is a shape allowlist rather than a method denylist, because a denylist is only as good
 * as the author's imagination. It also cannot simply be `ALLOWED.has(message.method)`: outbound
 * JSON-RPC *responses* carry no `method` field at all, so an allowlist keyed on `method` alone would
 * reject our reply to a server-initiated `ping` and hang the connection. Responses are handled as
 * their own branch, deliberately.
 */
import type { JSONRPCMessage, Transport, TransportSendOptions } from '@modelcontextprotocol/client';
import { ForbiddenMethodError } from '../net/errors.js';

/**
 * The complete set of JSON-RPC *methods* this scanner may originate.
 *
 * `notifications/cancelled` is here because the protocol layer emits it when a request is aborted
 * (timeout, shutdown). Omitting it would make the gate throw from inside an abort handler, which
 * surfaces as an unhandled rejection during teardown rather than as anything useful.
 */
export const ALLOWED_OUTBOUND_METHODS: ReadonlySet<string> = Object.freeze(
  new Set(['initialize', 'notifications/initialized', 'notifications/cancelled', 'tools/list']),
);

type MaybeMethod = { method?: unknown; id?: unknown; result?: unknown; error?: unknown };

/** A reply to something the server asked us. Has an id and a result/error, and never a method. */
function isOutboundResponse(message: MaybeMethod): boolean {
  return (
    message.method === undefined &&
    message.id !== undefined &&
    (message.result !== undefined || message.error !== undefined)
  );
}

export function assertSendable(message: JSONRPCMessage): void {
  const candidate = message as MaybeMethod;

  if (isOutboundResponse(candidate)) return;

  if (typeof candidate.method !== 'string') {
    throw new ForbiddenMethodError(String(candidate.method));
  }

  if (!ALLOWED_OUTBOUND_METHODS.has(candidate.method)) {
    throw new ForbiddenMethodError(candidate.method);
  }
}

export class GatedTransport implements Transport {
  #refusals = 0;

  /**
   * Mirrors the inner transport. Declared as a real optional property rather than a getter because
   * `exactOptionalPropertyTypes` distinguishes "absent" from "present and undefined", and the
   * protocol layer branches on presence.
   */
  readonly hasPerRequestStream?: boolean;

  constructor(private readonly inner: Transport) {
    if (inner.hasPerRequestStream !== undefined) {
      this.hasPerRequestStream = inner.hasPerRequestStream;
    }
  }

  /** How many times something tried to send a message this transport would not carry. */
  get refusals(): number {
    return this.#refusals;
  }

  async start(): Promise<void> {
    return this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    try {
      assertSendable(message);
    } catch (error) {
      // Counted before rethrowing, and rethrown before delegating, so the inner transport never
      // observes the message at all. The test asserts on exactly that: the spy must not fire.
      this.#refusals += 1;
      throw error;
    }
    return this.inner.send(message, options);
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  set onclose(handler: (() => void) | undefined) {
    this.inner.onclose = handler;
  }
  get onclose(): (() => void) | undefined {
    return this.inner.onclose;
  }

  set onerror(handler: ((error: Error) => void) | undefined) {
    this.inner.onerror = handler;
  }
  get onerror(): ((error: Error) => void) | undefined {
    return this.inner.onerror;
  }

  set onmessage(handler: Transport['onmessage']) {
    this.inner.onmessage = handler;
  }
  get onmessage(): Transport['onmessage'] {
    return this.inner.onmessage;
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }
}
