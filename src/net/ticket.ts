/**
 * A ticket is permission to make a specific, bounded set of requests to one endpoint.
 *
 * The reason enforcement is ticket-scoped rather than method-scoped: a method allowlist can only say
 * "this JSON-RPC method is fine." It cannot say anything about an OAuth token exchange fired at a
 * *different origin* by SDK code we did not write, which is exactly the request constraint 2 forbids
 * and exactly the one a method check cannot see. An exact (origin, path, method) match plus a
 * request budget catches both, and keeps catching them if the SDK changes underneath us.
 */
import type { HostTerminal } from './host-state.js';

export type TicketPurpose = 'well-known-optout' | 'mcp-probe' | 'http-metadata';

export class TargetTicket {
  #spent = 0;
  #terminal: HostTerminal | null = null;

  constructor(
    readonly targetId: string,
    readonly origin: string,
    readonly path: string,
    readonly purpose: TicketPurpose,
    readonly allowedMethods: ReadonlySet<string>,
    readonly maxRequests: number,
  ) {}

  get spent(): number {
    return this.#spent;
  }

  get terminal(): HostTerminal | null {
    return this.#terminal;
  }

  get host(): string {
    return new URL(this.origin).hostname;
  }

  /**
   * Set on the response path, inside the gate, before the response is handed back to the SDK. That
   * ordering is the whole point: an SDK-internal retry after a 401 fires before our application code
   * ever sees the 401, so a terminal state recorded at the application layer would be recorded too
   * late to prevent the follow-up request constraint 2 forbids.
   */
  markTerminal(terminal: HostTerminal): void {
    this.#terminal ??= terminal;
  }

  spend(): void {
    this.#spent += 1;
  }

  /** Exact match. A `.well-known` path or an authorization-server origin fails this by construction. */
  admits(url: URL, method: string): boolean {
    return (
      url.origin === this.origin &&
      url.pathname === this.path &&
      this.allowedMethods.has(method.toUpperCase())
    );
  }

  describe(): string {
    return `${this.purpose} ticket for ${this.origin}${this.path}`;
  }
}
