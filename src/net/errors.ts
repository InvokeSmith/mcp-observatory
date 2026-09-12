/**
 * Refusals. Every one of these is a constraint doing its job, so they are distinct types rather than
 * a single Error with a message: a test asserting "this was refused for the right reason" should not
 * be matching on prose.
 */

export class GateRefusal extends Error {
  constructor(
    readonly code: GateRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'GateRefusal';
  }
}

export type GateRefusalCode =
  /** Constraint 5. Host is on the published opt-out list, or served a self-service opt-out. */
  | 'OPTED-OUT'
  /** Constraint 5. Our opt-out data is stale, so we cannot know. Fail closed. */
  | 'OPT-OUT-STALE'
  /** Constraint 2. This host answered with a credential challenge. The interaction is over. */
  | 'AUTH-WALL'
  /** Constraint 4. Two 429s. Permanently skipped, across runs. */
  | 'RATE-LIMIT-SKIP'
  /** Constraint 1/2. Not an exact (origin, path, method) match for the live ticket. */
  | 'OFF-TICKET'
  /** Constraint 4. This ticket's request budget is spent. */
  | 'BUDGET-EXHAUSTED'
  /** Self-protection. Target is not a public unicast HTTPS endpoint. */
  | 'INADMISSIBLE-TARGET'
  /** Self-protection. Redirect left the registrable domain, or exceeded the hop cap. */
  | 'REDIRECTED-OFFSITE'
  /** Constraint 3. Our own contact URL does not resolve yet. */
  | 'IDENTITY-UNVERIFIED';

/**
 * Thrown when anything tries to reach the network outside the gate.
 *
 * The bootstrap module poisons `globalThis.fetch` with this, so the default path fails loudly. A
 * leak that crashes is a leak you find; a leak that silently works is one you publish.
 */
export class EgressOutsideGateError extends Error {
  constructor(detail: string) {
    super(
      `Network egress attempted outside the gate: ${detail}. ` +
        'All outbound requests must go through src/net/gate.ts.',
    );
    this.name = 'EgressOutsideGateError';
  }
}

/**
 * Constraint 1. Thrown before any bytes leave when a message is not one of the shapes this scanner
 * is allowed to send.
 */
export class ForbiddenMethodError extends Error {
  constructor(readonly attempted: string) {
    super(
      `Refused to send JSON-RPC method ${JSON.stringify(attempted)}. ` +
        'This scanner sends only initialize and tools/list. It never invokes a tool.',
    );
    this.name = 'ForbiddenMethodError';
  }
}
