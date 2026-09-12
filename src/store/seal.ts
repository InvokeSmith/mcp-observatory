/**
 * Sealing turns a growing run directory into an immutable, content-addressed snapshot.
 *
 * You cannot content-address a set that is still arriving, so sealing is an explicit step rather
 * than something `probe` does incidentally. Two properties matter:
 *
 *  - **Incompleteness is inside the hash.** Every discovered target gets a leaf, including
 *    `not-attempted` and `abandoned-after-crash`. Without that, a run that crashed halfway produces
 *    a snapshot id indistinguishable from a complete one over a smaller target set, and six months
 *    later nobody can tell which they are looking at.
 *  - **Timestamps are outside it.** See store/types.ts.
 */
import { canonicalHash, canonicalize } from '../canon/json.js';
import type { AuthPosture, SnapshotLeaf, SnapshotManifest } from './types.js';

export const SCHEMA_VERSION = '0.1.0';
export const SEAL_POLICY_VERSION = '0.1.0';

export interface SealInput {
  readonly discoverManifestHash: string;
  readonly leaves: readonly SnapshotLeaf[];
}

export interface SealedSnapshot {
  readonly manifest: SnapshotManifest;
  /** Sorted by targetId. The published order, and the hashed order. */
  readonly leaves: readonly SnapshotLeaf[];
}

async function leafHash(leaf: SnapshotLeaf): Promise<readonly [string, string]> {
  return [leaf.targetId, await canonicalHash(leaf)] as const;
}

export async function seal(input: SealInput): Promise<SealedSnapshot> {
  // targetId is itself a content address of the target descriptor, so sorting by it gives a total
  // order that does not depend on the order probes happened to finish in.
  const leaves = [...input.leaves].sort((a, b) =>
    a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0,
  );

  const duplicate = leaves.find((leaf, index) => index > 0 && leaves[index - 1]?.targetId === leaf.targetId);
  if (duplicate !== undefined) {
    throw new Error(`duplicate targetId in seal input: ${duplicate.targetId}`);
  }

  const merkleLeaves = await Promise.all(leaves.map(leafHash));

  const header = {
    schemaVersion: SCHEMA_VERSION,
    sealPolicyVersion: SEAL_POLICY_VERSION,
    discoverManifestHash: input.discoverManifestHash,
  };

  // Array of pairs, never an object keyed by targetId: engines reorder integer-like object keys
  // regardless of any sort we apply. See canon/json.ts.
  const snapshotId = await canonicalHash({ header, leaves: merkleLeaves });

  const postureCounts = countPostures(leaves);

  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      sealPolicyVersion: SEAL_POLICY_VERSION,
      discoverManifestHash: input.discoverManifestHash,
      snapshotId,
      leafCount: leaves.length,
      postureCounts,
    },
    leaves,
  };
}

function countPostures(leaves: readonly SnapshotLeaf[]): readonly (readonly [AuthPosture, number])[] {
  const counts = new Map<AuthPosture, number>();
  for (const leaf of leaves) {
    counts.set(leaf.posture, (counts.get(leaf.posture) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function serializeSnapshot(snapshot: SealedSnapshot): string {
  return canonicalize({ manifest: snapshot.manifest, leaves: snapshot.leaves });
}
