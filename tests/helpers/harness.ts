/**
 * Shared setup for constraint tests. Fixtures run on loopback, which production admission policy
 * refuses, so `allowLoopback` is an explicit opt-in here and nowhere else.
 */
import { Gate, type GateOptions } from '../../src/net/gate.js';
import { HostState } from '../../src/net/host-state.js';
import { parseOptOutList, type OptOutList } from '../../src/net/optout.js';
import { PolitenessQueue } from '../../src/net/politeness.js';
import { TargetTicket, type TicketPurpose } from '../../src/net/ticket.js';

export function freshOptOutList(entries: readonly string[] = []): OptOutList {
  return parseOptOutList(entries.join('\n'), Date.now());
}

export interface HarnessOptions {
  readonly optOut?: readonly string[];
  readonly optOutList?: OptOutList;
  readonly hostState?: HostState;
  readonly queue?: PolitenessQueue;
  readonly identityVerified?: boolean;
}

export function makeGate(options: HarnessOptions = {}): { gate: Gate; hostState: HostState; queue: PolitenessQueue } {
  const hostState = options.hostState ?? new HostState(null);
  const queue = options.queue ?? new PolitenessQueue();
  const gateOptions: GateOptions = {
    hostState,
    optOutList: options.optOutList ?? freshOptOutList(options.optOut ?? []),
    queue,
    admission: { allowLoopback: true, allowHttp: true },
    identityVerified: options.identityVerified ?? true,
    // Tests must not actually wait out a backoff.
    sleep: async () => undefined,
  };
  return { gate: new Gate(gateOptions), hostState, queue };
}

export function makeTicket(
  baseUrl: string,
  path: string,
  purpose: TicketPurpose = 'mcp-probe',
  methods: readonly string[] = ['POST', 'GET', 'DELETE'],
  maxRequests = 8,
): TargetTicket {
  const url = new URL(baseUrl);
  return new TargetTicket(
    `test:${url.host}${path}`,
    url.origin,
    path,
    purpose,
    new Set(methods),
    maxRequests,
  );
}
