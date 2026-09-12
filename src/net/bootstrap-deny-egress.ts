/**
 * Fail-closed egress default. Import this before anything that might make a request.
 *
 * The gate injects its own fetch into the MCP SDK transports, which the SDK threads through every
 * HTTP path it has. That makes the gate the *intended* route. This module makes it the *only* route,
 * by poisoning the unintended one: anything reaching for `globalThis.fetch` — a dependency we did
 * not audit, an SDK code path we did not anticipate, a future edit that forgets — throws instead of
 * quietly opening a socket.
 *
 * The distinction matters. Injecting a fetch makes the good path good. Poisoning the default makes
 * the bad path *loud*, which is the only way you find out about it.
 */
import { EgressOutsideGateError } from './errors.js';

/** The one real fetch reference in the process. The gate gets it; nothing else does. */
const realFetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis);

let armed = false;

export function realFetchRef(): typeof globalThis.fetch {
  return realFetch;
}

export function armEgressDenial(): void {
  if (armed) return;
  armed = true;
  const denied = (input: RequestInfo | URL): never => {
    const target = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    throw new EgressOutsideGateError(`globalThis.fetch(${target})`);
  };
  denied.preconnect = (input: RequestInfo | URL): never => denied(input);
  globalThis.fetch = denied as unknown as typeof globalThis.fetch;
}

/** Test-only. Restores the real fetch so a fixture harness can serve over loopback. */
export function disarmEgressDenial(): void {
  if (!armed) return;
  armed = false;
  globalThis.fetch = realFetch;
}

export function isEgressDenialArmed(): boolean {
  return armed;
}
