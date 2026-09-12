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

export interface RuleSet {
  readonly writeVerbs: WriteVerbRules;
  readonly descriptionVerbs: DescriptionVerbRules;
  readonly tenantParams: TenantParamRules;
  readonly guardrails: GuardrailRules;
  readonly openEnded: OpenEndedRules;
  /** Content address of every rule file together. Named in every report. */
  readonly rulesetId: string;
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

  return { writeVerbs, descriptionVerbs, tenantParams, guardrails, openEnded, rulesetId };
}
