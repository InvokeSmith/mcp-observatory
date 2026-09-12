/**
 * Stage 3. Pure: a function of (snapshot, ruleset) and nothing else. No network, no clock.
 *
 * Kept separate from `report` so the two are independently runnable, and so the classified rows can
 * be inspected on their own — the intermediate is where you look when you disagree with a number and
 * want to find out which tool and which rule produced it.
 */
import { classifyTool, type ObservedTool, type ToolClassification } from '../classify/tool.js';
import type { RuleSet } from '../classify/rules.js';
import type { SealedSnapshot } from '../store/seal.js';
import type { SnapshotLeaf } from '../store/types.js';

/** k-anonymity threshold for publishing a tool name. See LEGAL.md item 3. */
export const TOOL_NAME_K = 5;

export interface ClassifiedRow {
  readonly orgKey: string;
  /** NFC-normalized. Used for grouping and sorting, never published directly. */
  readonly toolNameKey: string;
  /** What may actually appear in output: the name, or '(suppressed)'. */
  readonly publishedName: string;
  readonly classification: ToolClassification;
}

export interface ClassifiedSnapshot {
  readonly snapshotId: string;
  readonly rulesetId: string;
  readonly rows: readonly ClassifiedRow[];
  readonly leaves: readonly SnapshotLeaf[];
}

function toObservedTool(record: SnapshotLeaf['tools'][number]): ObservedTool {
  return {
    name: record.name,
    description: record.description,
    inputSchema: record.inputSchema,
    annotations: record.annotations,
  };
}

/**
 * Constraint 6. A tool name is published only when it appears across at least k distinct
 * organizations, because a name alone can identify a company — `acme_internal_billing_refund` names
 * Acme as surely as a hostname would. This is the half of "aggregates only" that would otherwise
 * have shipped broken, since tool names arrive in the data by default.
 */
function suppressRareNames(rows: readonly ClassifiedRow[]): readonly ClassifiedRow[] {
  const orgsByName = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = orgsByName.get(row.toolNameKey) ?? new Set<string>();
    set.add(row.orgKey);
    orgsByName.set(row.toolNameKey, set);
  }
  return rows.map((row) => ({
    ...row,
    publishedName:
      (orgsByName.get(row.toolNameKey)?.size ?? 0) >= TOOL_NAME_K ? row.toolNameKey : '(suppressed)',
  }));
}

export function classifySnapshot(
  snapshot: SealedSnapshot,
  rules: RuleSet,
  leaves: readonly SnapshotLeaf[] = snapshot.leaves,
): ClassifiedSnapshot {
  const raw: ClassifiedRow[] = [];

  for (const leaf of leaves) {
    for (const tool of leaf.tools) {
      raw.push({
        orgKey: leaf.orgKey,
        // Normalized once, here. Two names that render identically sort differently otherwise, and
        // the difference would show up as a spurious diff between two runs.
        toolNameKey: tool.name.normalize('NFC'),
        publishedName: tool.name.normalize('NFC'),
        classification: classifyTool(toObservedTool(tool), rules),
      });
    }
  }

  const rows = [...suppressRareNames(raw)].sort((a, b) => {
    if (a.orgKey !== b.orgKey) return a.orgKey < b.orgKey ? -1 : 1;
    return a.toolNameKey < b.toolNameKey ? -1 : a.toolNameKey > b.toolNameKey ? 1 : 0;
  });

  return {
    snapshotId: snapshot.manifest.snapshotId,
    rulesetId: rules.rulesetId,
    rows,
    leaves,
  };
}
