/**
 * Conflict-of-interest control 2, and the reason it exists.
 *
 * This survey is published by a company that sells into the risk class it measures. The obvious
 * objection to any number it publishes is that the rules were chosen to produce that number, and a
 * reader cannot evaluate that objection against a single figure. They can evaluate it against a
 * band: recompute the headline under every registered alternative reading and publish the range.
 *
 * If the figure barely moves, rule choice was not doing the work. If it moves a lot, the reader
 * learns that too and should discount accordingly. Both outcomes are more informative than a point
 * estimate, which is why this ships whichever way it comes out — and why the variants were
 * registered in protocol/PROTOCOL.md before any data existed.
 */
import { applyVariant, type RuleSet, type RuleVariant } from '../classify/rules.js';
import { classifySnapshot } from '../stages/classify.js';
import { wilson, type Proportion } from './wilson.js';
import type { SealedSnapshot } from '../store/seal.js';
import type { SnapshotLeaf } from '../store/types.js';

export interface VariantResult {
  readonly id: string;
  readonly label: string;
  readonly rationale: string;
  readonly proportion: Proportion;
}

export interface SensitivityBand {
  /** The registered rules. The point estimate a reader would otherwise see alone. */
  readonly baseline: VariantResult;
  /** Every registered variant, baseline included, in a fixed order. */
  readonly variants: readonly VariantResult[];
  /** Lowest and highest numerator/denominator ratio across variants, as integer pairs. */
  readonly lowest: VariantResult;
  readonly highest: VariantResult;
  /** Which variant moved the figure furthest from baseline, and by how many points. */
  readonly mostInfluential: { readonly id: string; readonly deltaPoints: number };
}

/** Ratio as a rounded percentage point, from integers, for comparison only. */
function points(p: Proportion): number {
  return p.denominator === 0 ? 0 : (p.numerator / p.denominator) * 100;
}

/**
 * Recompute the headline — the share of write-capable tools declaring a caller-supplied tenant
 * selector — under each registered variant.
 */
export function computeSensitivity(
  snapshot: SealedSnapshot,
  baseRules: RuleSet,
  variants: readonly RuleVariant[],
  leaves: readonly SnapshotLeaf[] = snapshot.leaves,
): SensitivityBand {
  const results: VariantResult[] = [];

  // Sorted by id so the published order never depends on the order the file happened to list them.
  const ordered = [...variants].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const variant of ordered) {
    const rules = applyVariant(baseRules, variant);
    const classified = classifySnapshot(snapshot, rules, leaves);

    const writeCapable = classified.rows.filter(
      (row) => row.classification.writeCapable.value === 'yes',
    );
    const headline = writeCapable.map((row) => row.classification.tenantParamHeadline);

    const yes = headline.filter((d) => d.value === 'yes').length;
    const no = headline.filter((d) => d.value === 'no').length;
    const undetermined = headline.filter((d) => d.value === 'undetermined').length;

    results.push({
      id: variant.id,
      label: variant.label,
      rationale: variant.rationale,
      proportion: wilson(yes, yes + no, undetermined),
    });
  }

  const baseline = results.find((r) => r.id === 'baseline') ?? results[0];
  if (baseline === undefined) {
    throw new Error('sensitivity analysis requires at least one registered variant');
  }

  const byValue = [...results].sort((a, b) => {
    const delta = points(a.proportion) - points(b.proportion);
    // Tie-break on id so two variants that agree still order deterministically.
    return delta !== 0 ? delta : a.id < b.id ? -1 : 1;
  });

  const lowest = byValue[0] ?? baseline;
  const highest = byValue[byValue.length - 1] ?? baseline;

  const influential = [...results]
    .filter((r) => r.id !== baseline.id)
    .map((r) => ({ id: r.id, deltaPoints: Math.abs(points(r.proportion) - points(baseline.proportion)) }))
    .sort((a, b) => (b.deltaPoints !== a.deltaPoints ? b.deltaPoints - a.deltaPoints : a.id < b.id ? -1 : 1));

  return {
    baseline,
    variants: results,
    lowest,
    highest,
    mostInfluential: influential[0] ?? { id: baseline.id, deltaPoints: 0 },
  };
}
