/**
 * Loading and hashing the rule sets.
 *
 * The rules are data files rather than code so that a reader who disagrees with one specific verb
 * can change that verb and regenerate every number. That is the whole reproducibility argument, so
 * the ruleset hash travels with every report: a figure is only meaningful as a (snapshot, ruleset)
 * pair.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalHash } from '../canon/json.js';

export interface WriteVerbRules {
  readonly version: string;
  readonly verbs: readonly string[];
  readonly readVerbs: readonly string[];
}

export interface DescriptionVerbRules {
  readonly version: string;
  readonly phrases: readonly string[];
}

export interface TenantParamRules {
  readonly version: string;
  readonly strict: readonly string[];
  readonly ambiguous: readonly string[];
}

export interface GuardrailRules {
  readonly version: string;
  readonly idempotency: readonly string[];
  readonly confirmation: readonly string[];
  readonly dryRun: readonly string[];
}

export interface OpenEndedRules {
  readonly version: string;
  readonly byName: Readonly<Record<string, readonly string[]>>;
  readonly byDescription: readonly string[];
}

/**
 * Classifier choices a registered variant may change.
 *
 * These exist so the sensitivity analysis can ask "what would a different reasonable reading have
 * produced?" without a second copy of the classifier. The defaults are the registered rules; every
 * deviation is named in `rules/variants.json` and appears in the published band.
 */
export interface ClassifierBehavior {
  /**
   * Where a server's own `readOnlyHint` / `destructiveHint` sits in the evidence order.
   * `first` is registered. `ignore` tests how much rests on self-report, which the MCP
   * specification itself says clients should treat as untrusted.
   */
  readonly annotationPrecedence: 'first' | 'last' | 'ignore';
  /** Whether mutation language in a description may decide. The weakest of the three signals. */
  readonly useDescriptionSignal: boolean;
  /** Which tenant-parameter list the headline classifier uses. */
  readonly tenantMode: 'strict' | 'inclusive';
}

export const REGISTERED_BEHAVIOR: ClassifierBehavior = Object.freeze({
  annotationPrecedence: 'first',
  useDescriptionSignal: true,
  tenantMode: 'strict',
});

export interface RuleSet {
  readonly writeVerbs: WriteVerbRules;
  readonly descriptionVerbs: DescriptionVerbRules;
  readonly tenantParams: TenantParamRules;
  readonly guardrails: GuardrailRules;
  readonly openEnded: OpenEndedRules;
  readonly behavior: ClassifierBehavior;
  /** Content address of every rule file together. Named in every report. */
  readonly rulesetId: string;
}

export interface VariantChanges {
  readonly tenantMode?: 'strict' | 'inclusive';
  readonly annotationPrecedence?: 'first' | 'last' | 'ignore';
  readonly useDescriptionSignal?: boolean;
  readonly dropWriteVerbs?: readonly string[];
  readonly replaceWriteVerbs?: readonly string[];
}

export interface RuleVariant {
  readonly id: string;
  readonly label: string;
  readonly rationale: string;
  readonly changes: VariantChanges;
}

export interface VariantRules {
  readonly version: string;
  readonly variants: readonly RuleVariant[];
}

export async function loadVariants(dir = 'rules'): Promise<VariantRules> {
  return JSON.parse(await readFile(join(dir, 'variants.json'), 'utf8')) as VariantRules;
}

/**
 * Derive a variant rule set from the registered one.
 *
 * Pure, and the `rulesetId` is recomputed so a figure can never be attributed to the registered
 * rules when it was produced by a deviation from them.
 */
export function applyVariant(base: RuleSet, variant: RuleVariant): RuleSet {
  const c = variant.changes;

  let verbs = base.writeVerbs.verbs;
  if (c.replaceWriteVerbs !== undefined) {
    verbs = c.replaceWriteVerbs;
  } else if (c.dropWriteVerbs !== undefined) {
    const dropped = new Set(c.dropWriteVerbs);
    verbs = verbs.filter((verb) => !dropped.has(verb));
  }

  return {
    ...base,
    writeVerbs: { ...base.writeVerbs, verbs },
    behavior: {
      annotationPrecedence: c.annotationPrecedence ?? base.behavior.annotationPrecedence,
      useDescriptionSignal: c.useDescriptionSignal ?? base.behavior.useDescriptionSignal,
      tenantMode: c.tenantMode ?? base.behavior.tenantMode,
    },
    rulesetId: `${base.rulesetId}+${variant.id}`,
  };
}

export async function loadRuleSet(dir = 'rules'): Promise<RuleSet> {
  const read = async <T>(name: string): Promise<T> =>
    JSON.parse(await readFile(join(dir, name), 'utf8')) as T;

  const writeVerbs = await read<WriteVerbRules>('write-verbs.json');
  const descriptionVerbs = await read<DescriptionVerbRules>('mutation-description-verbs.json');
  const tenantParams = await read<TenantParamRules>('tenant-params.json');
  const guardrails = await read<GuardrailRules>('guardrail-params.json');
  const openEnded = await read<OpenEndedRules>('open-ended-params.json');

  const rulesetId = await canonicalHash({
    writeVerbs: { version: writeVerbs.version, verbs: [...writeVerbs.verbs].sort(), readVerbs: [...writeVerbs.readVerbs].sort() },
    descriptionVerbs: { version: descriptionVerbs.version, phrases: [...descriptionVerbs.phrases].sort() },
    tenantParams: { version: tenantParams.version, strict: [...tenantParams.strict].sort(), ambiguous: [...tenantParams.ambiguous].sort() },
    guardrails: {
      version: guardrails.version,
      idempotency: [...guardrails.idempotency].sort(),
      confirmation: [...guardrails.confirmation].sort(),
      dryRun: [...guardrails.dryRun].sort(),
    },
    openEnded: {
      version: openEnded.version,
      byName: Object.fromEntries(Object.entries(openEnded.byName).map(([k, v]) => [k, [...v].sort()])),
      byDescription: [...openEnded.byDescription].sort(),
    },
  });

  return {
    writeVerbs,
    descriptionVerbs,
    tenantParams,
    guardrails,
    openEnded,
    behavior: REGISTERED_BEHAVIOR,
    rulesetId,
  };
}
