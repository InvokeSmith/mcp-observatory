/**
 * Stage 4. Pure, and a function of THREE inputs, not two.
 *
 * The third input is the opt-out snapshot, and it is not an oversight in the brief's framing — it
 * follows from constraint 5. A 24-hour removal SLA means a host that opts out *after* being probed
 * must disappear from what we publish, so the opt-out list cannot be ambient state read at
 * publication time; it has to be a named, content-addressed input. `report(snapshot, ruleset,
 * optout)` is deterministic in all three, and its output path names all three.
 */
import { canonicalize } from '../canon/json.js';
import { toCsv } from '../canon/csv.js';
import { classifySnapshot, type ClassifiedRow } from './classify.js';
import type { RuleSet } from '../classify/rules.js';
import { renderRate, wilson, type Proportion } from '../stats/wilson.js';
import { computeSensitivity, type SensitivityBand } from '../stats/sensitivity.js';
import type { RuleVariant } from '../classify/rules.js';
import type { SealedSnapshot, } from '../store/seal.js';
import type { AuthPosture, SnapshotLeaf } from '../store/types.js';
import { isOnList, type OptOutList } from '../net/optout.js';
import type { Determination, Trit } from '../classify/types.js';

export interface ReportInputs {
  readonly snapshot: SealedSnapshot;
  readonly rules: RuleSet;
  readonly optOut: OptOutList;
  readonly optOutId: string;
  readonly protocolVersion: string;
  /**
   * Registered rule variants. Required rather than optional: protocol/PROTOCOL.md section 6
   * promises the headline is published as a range, so a report generated without them would be a
   * report that breaks the preregistration.
   */
  readonly variants: readonly RuleVariant[];
}

export interface Statistic {
  readonly id: string;
  readonly label: string;
  readonly proportion: Proportion;
}

export interface ReportArtifacts {
  readonly 'report.md': string;
  readonly 'stats.json': string;
  readonly 'tools.csv': string;
  readonly 'tools.json': string;
}

const TOOL_COLUMNS = [
  'org_key',
  'tool_name',
  'write_capable',
  'write_decided_by',
  'tenant_param_strict',
  'tenant_param_inclusive',
  'annotation_mismatch',
  'guardrail_present',
  'open_ended_surface',
  'schema_hygiene',
] as const;

function tally(values: readonly Determination[]): Proportion {
  const yes = values.filter((d) => d.value === 'yes').length;
  const no = values.filter((d) => d.value === 'no').length;
  const undetermined = values.filter((d) => d.value === 'undetermined').length;
  return wilson(yes, yes + no, undetermined);
}

function countBy<T extends string>(values: readonly T[]): readonly (readonly [T, number])[] {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

export function buildReport(inputs: ReportInputs): ReportArtifacts {
  const { snapshot, rules, optOut, optOutId, protocolVersion, variants } = inputs;

  if (variants.length === 0) {
    throw new Error(
      'refusing to build a report with no registered rule variants: the preregistration promises ' +
        'the headline as a range, and a point estimate alone would break it',
    );
  }

  // Opt-out applied at publication time, which is what makes the 24-hour SLA real for a host that
  // opted out after it was probed.
  const leaves = snapshot.leaves.filter((leaf) => !isOnList(optOut, leaf.orgKey));

  const classified = classifySnapshot(snapshot, rules, leaves);
  const rows: readonly ClassifiedRow[] = classified.rows;

  const writeCapable = rows.filter((r) => r.classification.writeCapable.value === 'yes');

  const statistics: readonly Statistic[] = [
    {
      id: 'write-capable',
      label: 'Tools classified write-capable',
      proportion: tally(rows.map((r) => r.classification.writeCapable)),
    },
    {
      id: 'tenant-param-strict',
      label: 'Write-capable tools declaring a caller-supplied tenant selector (strict rule set)',
      proportion: tally(writeCapable.map((r) => r.classification.tenantParamStrict)),
    },
    {
      id: 'tenant-param-inclusive',
      label: 'Write-capable tools declaring a caller-supplied tenant selector (inclusive rule set)',
      proportion: tally(writeCapable.map((r) => r.classification.tenantParamInclusive)),
    },
    {
      id: 'annotation-mismatch',
      label: 'Tools declaring readOnlyHint: true whose name or description implies mutation',
      proportion: tally(rows.map((r) => r.classification.annotationMismatch)),
    },
    {
      // Registered counter-measure: this figure cuts against the publisher's thesis and is emitted
      // unconditionally. See protocol/PROTOCOL.md section 4.
      id: 'guardrail-present',
      label: 'Write-capable tools that DO declare an idempotency, confirmation or dry-run parameter',
      proportion: tally(writeCapable.map((r) => r.classification.guardrailPresent)),
    },
    {
      id: 'open-ended-surface',
      label: 'Tools declaring an open-ended argument surface',
      proportion: tally(rows.map((r) => r.classification.openEndedSurface)),
    },
    {
      id: 'schema-hygiene',
      label: 'Tools whose input schema constrains additionalProperties and declares a type',
      proportion: tally(rows.map((r) => r.classification.schemaHygiene)),
    },
  ];

  const postures = countBy(leaves.map((l) => l.posture));

  // Discovered is not surveyed. A snapshot records every discovered target, including the ones never
  // contacted, so that a partial run stays distinguishable from a complete one — which means the
  // leaf count is a discovery figure and reporting it as a survey size would overstate the work by
  // however many targets were never attempted.
  const notAttempted = leaves.filter(
    (l) => l.posture === 'not-attempted' || l.posture === 'abandoned-after-crash',
  ).length;
  const attempted = leaves.length - notAttempted;
  const gated = leaves.filter((l) => l.posture === 'gated' || l.posture === 'partial').length;
  const reachable = leaves.filter(
    (l) => l.posture === 'open' || l.posture === 'gated' || l.posture === 'partial',
  ).length;

  const sensitivity = computeSensitivity(snapshot, rules, variants, leaves);

  const stats = {
    snapshotId: snapshot.manifest.snapshotId,
    rulesetId: rules.rulesetId,
    optOutId,
    protocolVersion,
    organizationsDiscovered: leaves.length,
    organizationsAttempted: attempted,
    tools: rows.length,
    postureCounts: postures,
    authGated: wilson(gated, reachable, leaves.length - reachable),
    statistics: statistics.map((s) => ({ id: s.id, label: s.label, ...s.proportion })),
    sensitivity: {
      mostInfluential: sensitivity.mostInfluential,
      variants: sensitivity.variants.map((v) => ({
        id: v.id,
        label: v.label,
        rationale: v.rationale,
        ...v.proportion,
      })),
    },
  };

  const csvRows = rows.map((row) => [
    row.orgKey,
    row.publishedName,
    row.classification.writeCapable.value,
    row.classification.writeCapable.decidedBy ?? 'none',
    row.classification.tenantParamStrict.value,
    row.classification.tenantParamInclusive.value,
    row.classification.annotationMismatch.value,
    row.classification.guardrailPresent.value,
    row.classification.openEndedSurface.value,
    row.classification.schemaHygiene.value,
  ]);

  return {
    'report.md': renderMarkdown(stats, statistics, sensitivity),
    'stats.json': canonicalize(stats),
    'tools.csv': toCsv([...TOOL_COLUMNS], csvRows),
    'tools.json': canonicalize(
      rows.map((row) => ({
        orgKey: row.orgKey,
        toolName: row.publishedName,
        writeCapable: row.classification.writeCapable.value,
        writeDecidedBy: row.classification.writeCapable.decidedBy ?? 'none',
        tenantParamStrict: row.classification.tenantParamStrict.value,
        tenantParamInclusive: row.classification.tenantParamInclusive.value,
        annotationMismatch: row.classification.annotationMismatch.value,
        guardrailPresent: row.classification.guardrailPresent.value,
        openEndedSurface: row.classification.openEndedSurface.value,
        schemaHygiene: row.classification.schemaHygiene.value,
      })),
    ),
  };
}

function figure(p: Proportion): string {
  if (p.denominator === 0) return `no decided cases (undetermined = ${p.undetermined})`;
  return (
    `${renderRate(p.numerator, p.denominator)}% ` +
    `(${p.numerator}/${p.denominator}, n = ${p.denominator}, ` +
    `undetermined = ${p.undetermined}, 95% CI [${renderRate(p.ciLow, 1)}%, ${renderRate(p.ciHigh, 1)}%])`
  );
}

function renderMarkdown(
  stats: { snapshotId: string; rulesetId: string; optOutId: string; protocolVersion: string; organizationsDiscovered: number; organizationsAttempted: number; tools: number; postureCounts: readonly (readonly [AuthPosture, number])[] },
  statistics: readonly Statistic[],
  sensitivity: SensitivityBand,
): string {
  const headline = statistics.find((s) => s.id === 'tenant-param-strict');

  // Limitations before findings, enforced by the linter. The section order is the argument: a reader
  // who stops after the first heading should have read the caveats, not the number.
  return `# MCP posture survey — snapshot \`${stats.snapshotId.slice(0, 12)}\`

Generated under protocol version ${stats.protocolVersion}, ruleset \`${stats.rulesetId.slice(0, 12)}\`,
opt-out snapshot \`${stats.optOutId.slice(0, 12)}\`.

This survey observes what MCP servers **declare** in their tool schemas. It never invokes a tool.
The property it measures — a parameter by which a caller selects the account, tenant or workspace
acted upon — is a structural **precondition**, not a defect. A server may derive authorization from
the token and reject any mismatch, and this survey cannot distinguish the two cases, because
distinguishing them would require calling the tool.

## Limitations

- **Discovery bias.** The population is endpoints their operators published in the official MCP
  registry, so that clients would connect to them. That skews toward organizations who participate
  in registries, and it under-represents anyone serving MCP at a path on an existing API host
  without listing it. This is not "all MCP servers" and must not be described as such.
- **Schema-only inference.** Every figure rests on what a server declares. Declarations may
  understate or overstate real behavior.
- **Precondition, not a defect.** Restated above, in full, because it is the distinction on which
  everything here depends.
- **Point in time.** Snapshot \`${stats.snapshotId.slice(0, 12)}\`. Servers change.
- **Undetermined rates.** Reported beside every figure below. Where a classifier could not decide, it
  says so rather than guessing.

## Findings

Denominators count **decided** cases only. Undetermined counts are never folded in.

Contacted: **${stats.organizationsAttempted}** of ${stats.organizationsDiscovered} discovered organizations, yielding ${stats.tools} tool schemas.${
    stats.organizationsAttempted < stats.organizationsDiscovered
      ? `\n\n> **This is a partial run.** ${stats.organizationsDiscovered - stats.organizationsAttempted} discovered organizations were never contacted. Every figure below describes the ${stats.organizationsAttempted} that were, and generalising it to the discovered population would be unsupported.`
      : ''
  }

${statistics.map((s) => `- **${s.label}**: ${figure(s.proportion)}`).join('\n')}

### Posture distribution

${stats.postureCounts.map(([posture, count]) => `- \`${posture}\`: ${count}`).join('\n')}

## How much the rules decide

This survey is published by an interested party, so the obvious objection to the figure above is
that the rules were chosen to produce it. That objection cannot be evaluated against one number, so
the headline is recomputed under every rule variant registered in \`protocol/PROTOCOL.md\` before any
data was collected. The spread is the answer to "what would tuning the rules have bought?"

**Registered rules: ${figure(sensitivity.baseline.proportion)}**

Across all ${sensitivity.variants.length} registered variants the headline ranges from a low of **${renderRate(sensitivity.lowest.proportion.numerator, sensitivity.lowest.proportion.denominator)}%** (${sensitivity.lowest.label}; ${sensitivity.lowest.proportion.numerator}/${sensitivity.lowest.proportion.denominator}, n = ${sensitivity.lowest.proportion.denominator}) to a high of **${renderRate(sensitivity.highest.proportion.numerator, sensitivity.highest.proportion.denominator)}%** (${sensitivity.highest.label}; ${sensitivity.highest.proportion.numerator}/${sensitivity.highest.proportion.denominator}, n = ${sensitivity.highest.proportion.denominator}).

The single rule choice that moves it furthest from the registered reading is \`${sensitivity.mostInfluential.id}\`, at ${sensitivity.mostInfluential.deltaPoints.toFixed(1)} percentage points.

| Variant | Headline | Why it is registered |
|---|---|---|
${sensitivity.variants
  .map(
    (v) =>
      `| \`${v.id}\` | ${figure(v.proportion)} | ${v.rationale} |`,
  )
  .join('\n')}

If you think a rule choice we did not register would move the figure, add it to \`rules/variants.json\`
and re-run. That is a contribution rather than a complaint.

## Reproducing this

Every figure above regenerates from the named snapshot and rule sets:

\`\`\`
observatory report --snapshot ${stats.snapshotId.slice(0, 12)} --ruleset ${stats.rulesetId.slice(0, 12)} --optout ${stats.optOutId.slice(0, 12)}
\`\`\`

The rule sets are data files. If you disagree with a specific verb or parameter name, change it and
re-run: the numbers move, and you can see by how much.
${headline === undefined ? '' : ''}`;
}
