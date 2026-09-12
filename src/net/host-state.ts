/**
 * Durable, cross-run host state.
 *
 * This lives outside any single run directory on purpose. A host that returned 429 twice last
 * Tuesday must still be skipped today; if the counter reset every run, constraint 4 would be
 * satisfied within a run and violated across them, which is the version the operator actually
 * experiences.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type HostTerminal =
  /** Constraint 2. Answered with a credential challenge. Never contacted again this snapshot. */
  | 'auth-wall'
  /** Constraint 4. Two 429s. Permanently skipped. */
  | 'rate-limit-skip'
  /** Constraint 5. Served a self-service opt-out. */
  | 'opted-out'
  /** Self-protection. Redirected off its registrable domain. */
  | 'redirected-offsite';

export interface HostRecord {
  readonly host: string;
  readonly rateLimitHits: number;
  readonly terminal: HostTerminal | null;
  readonly updatedAt: number;
}

type HostEvent =
  | { readonly t: 'rate-limit'; readonly host: string; readonly at: number }
  | { readonly t: 'terminal'; readonly host: string; readonly terminal: HostTerminal; readonly at: number };

/** Two 429s and we stop, permanently. Not a backoff — a skip. */
export const RATE_LIMIT_SKIP_THRESHOLD = 2;

export class HostState {
  readonly #records = new Map<string, HostRecord>();

  constructor(private readonly logPath: string | null = null) {}

  /**
   * Rebuild from the append-only event log. A trailing partial line is discarded: a crash mid-write
   * leaves one, and parsing it as truth would be worse than losing one event.
   */
  static async load(logPath: string): Promise<HostState> {
    const state = new HostState(logPath);
    let text: string;
    try {
      text = await readFile(logPath, 'utf8');
    } catch {
      return state;
    }
    const lines = text.split('\n');
    const complete = text.endsWith('\n') ? lines.slice(0, -1) : lines.slice(0, -1);
    for (const line of complete) {
      if (line.trim() === '') continue;
      let event: HostEvent;
      try {
        event = JSON.parse(line) as HostEvent;
      } catch {
        continue;
      }
      state.#apply(event);
    }
    return state;
  }

  #apply(event: HostEvent): void {
    const current = this.#records.get(event.host) ?? {
      host: event.host,
      rateLimitHits: 0,
      terminal: null,
      updatedAt: 0,
    };

    if (event.t === 'rate-limit') {
      const hits = current.rateLimitHits + 1;
      this.#records.set(event.host, {
        host: event.host,
        rateLimitHits: hits,
        terminal: hits >= RATE_LIMIT_SKIP_THRESHOLD ? 'rate-limit-skip' : current.terminal,
        updatedAt: event.at,
      });
      return;
    }

    this.#records.set(event.host, {
      host: event.host,
      rateLimitHits: current.rateLimitHits,
      // First terminal wins. A host that hit the auth wall and later times out is still recorded as
      // having refused us, which is the fact that matters.
      terminal: current.terminal ?? event.terminal,
      updatedAt: event.at,
    });
  }

  async #record(event: HostEvent): Promise<void> {
    this.#apply(event);
    if (this.logPath === null) return;
    await mkdir(dirname(this.logPath), { recursive: true });
    await appendFile(this.logPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  get(host: string): HostRecord | undefined {
    return this.#records.get(host.toLowerCase());
  }

  /** The question the gate asks before every request. */
  terminalFor(host: string): HostTerminal | null {
    return this.#records.get(host.toLowerCase())?.terminal ?? null;
  }

  async noteRateLimit(host: string, at: number): Promise<void> {
    await this.#record({ t: 'rate-limit', host: host.toLowerCase(), at });
  }

  async noteTerminal(host: string, terminal: HostTerminal, at: number): Promise<void> {
    await this.#record({ t: 'terminal', host: host.toLowerCase(), terminal, at });
  }

  hosts(): readonly HostRecord[] {
    return [...this.#records.values()].sort((a, b) => (a.host < b.host ? -1 : a.host > b.host ? 1 : 0));
  }
}
