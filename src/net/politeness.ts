/**
 * Constraint 4. One request in flight per operator, plus a global cap.
 *
 * The unit is the *operator*, not the hostname. Three thousand subdomains behind one CDN, or fifty
 * targets on one `*.railway.app` origin, would each sit politely at one connection while the
 * operator absorbed fifty at once. Keying on the registrable domain is what makes the promise mean
 * what an operator would assume it means.
 *
 * Work is sharded by operator key so that at most one task per operator is ever *runnable*. That
 * also removes a deadlock: acquiring a per-host lock and then a global semaphore lets N tasks hold
 * every semaphore slot while waiting on locks held by tasks queued behind the semaphore.
 */
import { registrableDomain } from './optout.js';

export const DEFAULT_GLOBAL_CONCURRENCY = 4;

/** The politeness unit: registrable domain where we can determine one, else the bare host. */
export function operatorKey(host: string): string {
  const lower = host.toLowerCase();
  return registrableDomain(lower) ?? lower;
}

type Task<T> = () => Promise<T>;

export class PolitenessQueue {
  readonly #perOperator = new Map<string, Promise<unknown>>();
  #active = 0;
  readonly #waiting: Array<() => void> = [];

  #peakByOperator = new Map<string, number>();
  #inFlightByOperator = new Map<string, number>();

  constructor(private readonly globalConcurrency: number = DEFAULT_GLOBAL_CONCURRENCY) {}

  async #acquireGlobal(): Promise<void> {
    if (this.#active < this.globalConcurrency) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve));
    this.#active += 1;
  }

  #releaseGlobal(): void {
    this.#active -= 1;
    const next = this.#waiting.shift();
    if (next) next();
  }

  /**
   * Run `task` when this operator has nothing else in flight and a global slot is free.
   *
   * Chaining on the operator's tail promise is what serialises per operator; the global semaphore is
   * acquired inside that chain, so a task never holds one while waiting for the other.
   */
  run<T>(host: string, task: Task<T>): Promise<T> {
    const key = operatorKey(host);
    const previous = this.#perOperator.get(key) ?? Promise.resolve();

    const result = previous.then(async () => {
      await this.#acquireGlobal();
      const inFlight = (this.#inFlightByOperator.get(key) ?? 0) + 1;
      this.#inFlightByOperator.set(key, inFlight);
      this.#peakByOperator.set(key, Math.max(this.#peakByOperator.get(key) ?? 0, inFlight));
      try {
        return await task();
      } finally {
        this.#inFlightByOperator.set(key, (this.#inFlightByOperator.get(key) ?? 1) - 1);
        this.#releaseGlobal();
      }
    });

    // Keep the chain alive on failure: a rejected tail would reject every task queued behind it.
    this.#perOperator.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }

  /** Test observability for constraint 4: the most we ever had in flight against one operator. */
  peakInFlight(host: string): number {
    return this.#peakByOperator.get(operatorKey(host)) ?? 0;
  }
}

/** Exponential backoff with full jitter, for 429 and 5xx. */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** attempt, 30_000);
  return Math.floor(base * random());
}
