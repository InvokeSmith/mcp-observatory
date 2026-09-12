/**
 * The only code in this program permitted to reach the network.
 *
 * Everything else — the MCP SDK included — receives `gate.fetchFor(ticket)` and can do nothing the
 * gate has not admitted. `bootstrap-deny-egress` poisons `globalThis.fetch` so the unintended route
 * throws rather than quietly working.
 *
 * Check order matters and is not arbitrary:
 *
 *   identity -> opt-out list -> opt-out freshness -> durable host state -> admission -> ticket
 *   -> budget -> politeness queue -> User-Agent -> manual redirect -> response classification
 *
 * Opt-out is checked before anything that could cause contact. Response classification happens
 * before the response is handed back to the caller, because an SDK-internal retry fires before our
 * application code ever sees the status.
 */
import { realFetchRef } from './bootstrap-deny-egress.js';
import { GateRefusal } from './errors.js';
import { HostState } from './host-state.js';
import { admitTarget, type AdmissionOptions } from './admission.js';
import { isListStale, isOnList, registrableDomain, type OptOutList } from './optout.js';
import { PolitenessQueue, backoffDelayMs } from './politeness.js';
import { USER_AGENT } from '../config/identity.js';
import type { TargetTicket } from './ticket.js';

/** One entry per request that actually left. The audit trail for every constraint. */
export interface CaptureEntry {
  readonly targetId: string;
  readonly purpose: string;
  readonly method: string;
  readonly url: string;
  readonly status: number | null;
  readonly error: string | null;
  readonly requestHeaders: ReadonlyArray<readonly [string, string]>;
  readonly responseHeaders: ReadonlyArray<readonly [string, string]>;
  readonly bodyBytes: number;
  readonly at: number;
}

export interface GateOptions {
  readonly hostState: HostState;
  readonly optOutList: OptOutList;
  readonly queue?: PolitenessQueue;
  readonly admission?: AdmissionOptions;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Constraint 3. Set once preflight has confirmed the contact URL resolves. */
  readonly identityVerified?: boolean;
  readonly maxRedirectHops?: number;
  readonly maxResponseBytes?: number;
  readonly onCapture?: (entry: CaptureEntry) => void;
}

const HOP_LIMIT_DEFAULT = 3;
const MAX_RESPONSE_BYTES_DEFAULT = 8 * 1024 * 1024;
const MAX_BACKOFF_ATTEMPTS = 3;

/** Never sent. Stripped rather than merely omitted, so a caller cannot smuggle one in. */
const FORBIDDEN_REQUEST_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

export class Gate {
  readonly #hostState: HostState;
  readonly #optOutList: OptOutList;
  readonly #queue: PolitenessQueue;
  readonly #admission: AdmissionOptions;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #identityVerified: boolean;
  readonly #maxHops: number;
  readonly #maxResponseBytes: number;
  readonly #onCapture: ((entry: CaptureEntry) => void) | undefined;
  readonly #captures: CaptureEntry[] = [];

  constructor(options: GateOptions) {
    this.#hostState = options.hostState;
    this.#optOutList = options.optOutList;
    this.#queue = options.queue ?? new PolitenessQueue();
    this.#admission = options.admission ?? {};
    this.#now = options.now ?? (() => Date.now());
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#identityVerified = options.identityVerified ?? false;
    this.#maxHops = options.maxRedirectHops ?? HOP_LIMIT_DEFAULT;
    this.#maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES_DEFAULT;
    this.#onCapture = options.onCapture;
  }

  get captures(): readonly CaptureEntry[] {
    return this.#captures;
  }

  /** Every request that left, in order. The witness for "zero follow-up requests". */
  capturesFor(targetId: string): readonly CaptureEntry[] {
    return this.#captures.filter((c) => c.targetId === targetId);
  }

  /**
   * Hand this to the MCP SDK as its `fetchFn`. It is bound to one ticket, so the SDK cannot reach
   * anywhere the ticket does not name — including an authorization server it discovered on its own.
   */
  fetchFor(ticket: TargetTicket): typeof globalThis.fetch {
    const bound = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      this.fetch(ticket, input, init);
    (bound as { preconnect?: unknown }).preconnect = () => undefined;
    return bound as unknown as typeof globalThis.fetch;
  }

  async fetch(ticket: TargetTicket, input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();

    this.#assertAdmissible(ticket, url, method);

    return this.#queue.run(url.hostname, () => this.#execute(ticket, url, method, init, 0, 0));
  }

  #assertAdmissible(ticket: TargetTicket, url: URL, method: string): void {
    if (!this.#identityVerified) {
      throw new GateRefusal(
        'IDENTITY-UNVERIFIED',
        `Refusing to contact ${url.hostname}: the contact URL in our User-Agent has not been ` +
          'confirmed to resolve. A scanner whose contact URL 404s is worse than one with no ' +
          'User-Agent at all.',
      );
    }

    const host = url.hostname.toLowerCase();

    if (isOnList(this.#optOutList, host)) {
      throw new GateRefusal('OPTED-OUT', `${host} is on the published opt-out list`);
    }

    if (isListStale(this.#optOutList, this.#now())) {
      throw new GateRefusal(
        'OPT-OUT-STALE',
        'Opt-out data is more than 24 hours old. Refusing to probe rather than risk contacting ' +
          'a host that has since opted out.',
      );
    }

    const terminal = this.#hostState.terminalFor(host);
    if (terminal !== null) {
      const code = terminal === 'auth-wall' ? 'AUTH-WALL'
        : terminal === 'rate-limit-skip' ? 'RATE-LIMIT-SKIP'
        : terminal === 'opted-out' ? 'OPTED-OUT'
        : 'REDIRECTED-OFFSITE';
      throw new GateRefusal(code, `${host} is terminal: ${terminal}`);
    }

    if (ticket.terminal !== null) {
      const code = ticket.terminal === 'auth-wall' ? 'AUTH-WALL' : 'REDIRECTED-OFFSITE';
      throw new GateRefusal(code, `${ticket.describe()} is terminal: ${ticket.terminal}`);
    }

    const verdict = admitTarget(url, this.#admission);
    if (!verdict.ok) {
      throw new GateRefusal('INADMISSIBLE-TARGET', `${url.href}: ${verdict.reason}`);
    }

    if (!ticket.admits(url, method)) {
      throw new GateRefusal(
        'OFF-TICKET',
        `${method} ${url.href} is not admitted by ${ticket.describe()}. ` +
          'This is how an OAuth discovery or token-exchange request gets refused.',
      );
    }

    if (ticket.spent >= ticket.maxRequests) {
      throw new GateRefusal(
        'BUDGET-EXHAUSTED',
        `${ticket.describe()} has spent its budget of ${ticket.maxRequests} requests`,
      );
    }
  }

  async #execute(
    ticket: TargetTicket,
    url: URL,
    method: string,
    init: RequestInit,
    hop: number,
    attempt: number,
  ): Promise<Response> {
    ticket.spend();

    const headers = this.#buildHeaders(init.headers);
    const at = this.#now();

    let response: Response;
    try {
      response = await realFetchRef()(url, {
        ...init,
        method,
        headers,
        redirect: 'manual',
      });
    } catch (error) {
      this.#capture({
        targetId: ticket.targetId,
        purpose: ticket.purpose,
        method,
        url: url.href,
        status: null,
        error: error instanceof Error ? error.message : String(error),
        requestHeaders: headerPairs(headers),
        responseHeaders: [],
        bodyBytes: 0,
        at,
      });
      throw error;
    }

    const body = await this.#readCapped(response);

    this.#capture({
      targetId: ticket.targetId,
      purpose: ticket.purpose,
      method,
      url: url.href,
      status: response.status,
      error: null,
      requestHeaders: headerPairs(headers),
      responseHeaders: headerPairs(response.headers),
      bodyBytes: body.length,
      at,
    });

    // Classify BEFORE returning. An SDK-internal retry on 401 fires before our caller sees it, so a
    // terminal recorded downstream would be recorded a request too late.
    const terminalDecision = await this.#classify(ticket, url, response);
    if (terminalDecision !== null) {
      return terminalDecision;
    }

    if (response.status >= 300 && response.status < 400) {
      return this.#followRedirect(ticket, url, method, init, response, hop);
    }

    if ((response.status === 429 || response.status >= 500) && attempt < MAX_BACKOFF_ATTEMPTS) {
      if (ticket.spent < ticket.maxRequests) {
        await this.#sleep(backoffDelayMs(attempt));
        return this.#execute(ticket, url, method, init, hop, attempt + 1);
      }
    }

    return new Response(body.buffer as ArrayBuffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  /** Returns a response to short-circuit with when the interaction must end here. */
  async #classify(ticket: TargetTicket, url: URL, response: Response): Promise<Response | null> {
    const host = url.hostname.toLowerCase();

    if (response.status === 429) {
      await this.#hostState.noteRateLimit(host, this.#now());
    }

    // Constraint 2. A credential challenge ends the interaction with this host, full stop.
    const challenged =
      response.status === 401 ||
      response.status === 403 ||
      response.status === 407 ||
      response.headers.has('www-authenticate');

    if (challenged) {
      ticket.markTerminal('auth-wall');
      await this.#hostState.noteTerminal(host, 'auth-wall', this.#now());
    }

    return null;
  }

  async #followRedirect(
    ticket: TargetTicket,
    from: URL,
    method: string,
    init: RequestInit,
    response: Response,
    hop: number,
  ): Promise<Response> {
    const location = response.headers.get('location');
    if (location === null) return response;

    if (hop + 1 > this.#maxHops) {
      ticket.markTerminal('redirected-offsite');
      throw new GateRefusal('REDIRECTED-OFFSITE', `exceeded ${this.#maxHops} redirect hops`);
    }

    const next = new URL(location, from);

    // A redirect off the registrable domain is a different operator, who never consented to
    // anything and whose opt-out status we have not checked in this context. It is a posture, not a
    // hop to follow.
    if (registrableDomain(next.hostname) !== registrableDomain(from.hostname)) {
      ticket.markTerminal('redirected-offsite');
      await this.#hostState.noteTerminal(from.hostname.toLowerCase(), 'redirected-offsite', this.#now());
      throw new GateRefusal(
        'REDIRECTED-OFFSITE',
        `${from.href} redirected to ${next.href}, off its registrable domain`,
      );
    }

    // Re-enter every check for the new URL rather than trusting the hop.
    this.#assertAdmissible(ticket, next, method);
    return this.#execute(ticket, next, method, init, hop + 1, 0);
  }

  #buildHeaders(source: HeadersInit | undefined): Headers {
    const headers = new Headers(source);
    for (const name of FORBIDDEN_REQUEST_HEADERS) {
      headers.delete(name);
    }
    // Set last, and after the delete pass, so a caller cannot override our identity. Constraint 3
    // is not a default; it is not negotiable by the code that calls us.
    headers.set('user-agent', USER_AGENT);
    return headers;
  }

  async #readCapped(response: Response): Promise<Uint8Array> {
    if (response.body === null) return new Uint8Array(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > this.#maxResponseBytes) {
        await reader.cancel();
        throw new GateRefusal(
          'INADMISSIBLE-TARGET',
          `response exceeded ${this.#maxResponseBytes} bytes`,
        );
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  #capture(entry: CaptureEntry): void {
    this.#captures.push(entry);
    this.#onCapture?.(entry);
  }
}

function headerPairs(headers: Headers): ReadonlyArray<readonly [string, string]> {
  return [...headers.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
