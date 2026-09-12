/**
 * What a probe records, and what gets sealed.
 *
 * The split between a leaf (hashed, published) and observability (unhashed, private) is deliberate:
 * a snapshot answers *what a server declared*, not *when we asked*. Hashing timestamps would mean no
 * two runs are ever byte-comparable, which would destroy the ability to say "nothing changed since
 * last month" — which is most of what a repeated survey is for.
 */

export type AuthPosture =
  /** Tools listed without credentials. */
  | 'open'
  /** Listing requires auth. */
  | 'gated'
  /** initialize succeeded, listing refused. */
  | 'partial'
  | 'unreachable'
  /** Declined via the published list or the self-service well-known. */
  | 'opted-out'
  /** Opt-out status could not be determined. A flaky server is not consent. */
  | 'optout-undetermined'
  /** Discovered but not reached in this run. Present so incompleteness is in the hash. */
  | 'not-attempted'
  /** An attempt started and never finished. A crash counts as an attempt. */
  | 'abandoned-after-crash';

export interface ObservedToolRecord {
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: Readonly<Record<string, unknown>> | null;
  readonly annotations: Readonly<Record<string, unknown>> | null;
}

export interface HttpMetadata {
  readonly wwwAuthenticate: string | null;
  readonly corsAllowOrigin: string | null;
  readonly hasRateLimitHeaders: boolean;
  readonly server: string | null;
  readonly cdn: string | null;
}

/** One target's contribution to the snapshot. Hashed. No timestamps. */
export interface SnapshotLeaf {
  readonly targetId: string;
  /** Opaque organization key. Never a hostname. Constraint 6. */
  readonly orgKey: string;
  readonly posture: AuthPosture;
  readonly protocolVersion: string | null;
  readonly serverName: string | null;
  readonly serverVersion: string | null;
  readonly tools: readonly ObservedToolRecord[];
  readonly toolsTruncated: boolean;
  readonly http: HttpMetadata;
}

/** The unhashed sidecar. Private, deletable, never published. */
export interface Observability {
  readonly targetId: string;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly requestCount: number;
  readonly error: string | null;
}

export interface SnapshotManifest {
  readonly schemaVersion: string;
  readonly sealPolicyVersion: string;
  readonly discoverManifestHash: string;
  readonly snapshotId: string;
  readonly leafCount: number;
  readonly postureCounts: readonly (readonly [AuthPosture, number])[];
}
