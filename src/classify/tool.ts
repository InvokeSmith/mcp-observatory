/**
 * The classifiers. Each returns a Determination that names the signal that decided it.
 */
import {
  determined,
  firstSentence,
  normalizeParamName,
  tokenize,
  UNDETERMINED,
  type Determination,
} from './types.js';
import type { RuleSet } from './rules.js';

export interface ObservedTool {
  readonly name: string;
  readonly description: string | null;
  readonly inputSchema: Readonly<Record<string, unknown>> | null;
  readonly annotations: Readonly<Record<string, unknown>> | null;
}

export interface ToolClassification {
  readonly writeCapable: Determination;
  readonly tenantParamStrict: Determination;
  readonly tenantParamInclusive: Determination;
  readonly annotationMismatch: Determination;
  readonly guardrailPresent: Determination;
  readonly openEndedSurface: Determination;
  readonly schemaHygiene: Determination;
}

interface SchemaProperty {
  readonly name: string;
  readonly normalized: string;
  readonly schema: Record<string, unknown>;
}

function properties(tool: ObservedTool): readonly SchemaProperty[] {
  const props = tool.inputSchema?.['properties'];
  if (typeof props !== 'object' || props === null) return [];
  return Object.entries(props as Record<string, unknown>)
    .map(([name, schema]) => ({
      name,
      normalized: normalizeParamName(name),
      schema: (typeof schema === 'object' && schema !== null ? schema : {}) as Record<string, unknown>,
    }))
    // Sorted so that "which parameter decided this" is reproducible rather than
    // dependent on the server's key order.
    .sort((a, b) => (a.normalized < b.normalized ? -1 : a.normalized > b.normalized ? 1 : 0));
}

/**
 * Write capability, in strict signal precedence: annotation, then name, then description.
 *
 * A substantial undetermined share is expected and is reported rather than resolved. The temptation
 * is to guess from the description when the name is neutral; the reason not to is that guessing is
 * exactly what would make the headline denominator unfalsifiable.
 */
export function classifyWriteCapability(tool: ObservedTool, rules: RuleSet): Determination {
  const readOnly = tool.annotations?.['readOnlyHint'];
  const destructive = tool.annotations?.['destructiveHint'];

  if (readOnly === true) return determined('no', 'annotation', 'readOnlyHint: true');
  if (readOnly === false) return determined('yes', 'annotation', 'readOnlyHint: false');
  if (destructive === true) return determined('yes', 'annotation', 'destructiveHint: true');

  const tokens = tokenize(tool.name);
  const writeVerb = rules.writeVerbs.verbs.find((verb) => tokens.includes(verb));
  if (writeVerb !== undefined) return determined('yes', 'name', `name contains "${writeVerb}"`);

  const readVerb = rules.writeVerbs.readVerbs.find((verb) => tokens.includes(verb));
  if (readVerb !== undefined) return determined('no', 'name', `name contains "${readVerb}"`);

  if (tool.description !== null && tool.description.trim() !== '') {
    const opening = firstSentence(tool.description).toLowerCase();
    const phrase = rules.descriptionVerbs.phrases.find((p) => opening.includes(p));
    if (phrase !== undefined) {
      return determined('yes', 'description', `first sentence contains "${phrase}"`);
    }
  }

  return UNDETERMINED;
}

/**
 * The headline classifier. Runs over write-capable tools only.
 *
 * Reported as two figures because `user_id` and `project_id` are genuinely ambiguous — often
 * intra-tenant rather than tenant-selecting. Publishing only the inclusive count would overstate the
 * finding; publishing only the strict count would understate it.
 */
export function classifyTenantParam(
  tool: ObservedTool,
  rules: RuleSet,
  mode: 'strict' | 'inclusive',
): Determination {
  const props = properties(tool);
  if (props.length === 0) {
    return tool.inputSchema === null
      ? determined('undetermined', null, 'no input schema declared')
      : determined('no', 'schema', 'schema declares no properties');
  }

  const names =
    mode === 'strict'
      ? rules.tenantParams.strict
      : [...rules.tenantParams.strict, ...rules.tenantParams.ambiguous];

  const hit = props.find((prop) => names.includes(prop.normalized));
  if (hit !== undefined) {
    return determined('yes', 'schema', `parameter "${hit.normalized}"`);
  }

  return determined('no', 'schema', `${props.length} parameters, none tenant-selecting`);
}

/**
 * `readOnlyHint: true` on a tool whose name says otherwise. Highly shareable and hard to argue with,
 * because both halves of the contradiction come from the server itself.
 */
export function classifyAnnotationMismatch(tool: ObservedTool, rules: RuleSet): Determination {
  if (tool.annotations?.['readOnlyHint'] !== true) {
    return determined('no', 'absent', 'no readOnlyHint: true to contradict');
  }

  const tokens = tokenize(tool.name);
  const verb = rules.writeVerbs.verbs.find((v) => tokens.includes(v));
  if (verb !== undefined) {
    return determined('yes', 'name', `readOnlyHint: true but name contains "${verb}"`);
  }

  if (tool.description !== null) {
    const opening = firstSentence(tool.description).toLowerCase();
    const phrase = rules.descriptionVerbs.phrases.find((p) => opening.includes(p));
    if (phrase !== undefined) {
      return determined('yes', 'description', `readOnlyHint: true but description says "${phrase}"`);
    }
  }

  return determined('no', 'annotation', 'readOnlyHint: true, consistent with name');
}

/**
 * A registered counter-measure: this is the figure that cuts AGAINST the publisher's thesis, so it
 * is computed and emitted unconditionally rather than on a flag.
 */
export function classifyGuardrail(tool: ObservedTool, rules: RuleSet): Determination {
  const props = properties(tool);
  if (props.length === 0 && tool.inputSchema === null) {
    return determined('undetermined', null, 'no input schema declared');
  }

  const all = [
    ...rules.guardrails.idempotency,
    ...rules.guardrails.confirmation,
    ...rules.guardrails.dryRun,
  ];
  const hit = props.find((prop) => all.includes(prop.normalized));
  if (hit !== undefined) return determined('yes', 'schema', `parameter "${hit.normalized}"`);

  // Absence of a declared guardrail is not proof of a missing one: a server may confirm out of band
  // or be idempotent server-side without saying so. Hence 'no' meaning "none declared".
  return determined('no', 'schema', 'no idempotency, confirmation or dry-run parameter declared');
}

export function classifyOpenEndedSurface(tool: ObservedTool, rules: RuleSet): Determination {
  const props = properties(tool);
  if (props.length === 0) {
    return tool.inputSchema === null
      ? determined('undetermined', null, 'no input schema declared')
      : determined('no', 'schema', 'schema declares no properties');
  }

  for (const [category, names] of Object.entries(rules.openEnded.byName)) {
    const hit = props.find((prop) => names.includes(prop.normalized));
    if (hit !== undefined) {
      return determined('yes', 'schema', `${category} parameter "${hit.normalized}"`);
    }
  }

  const unconstrained = props.find((prop) => {
    if (prop.schema['type'] !== 'string') return false;
    return (
      prop.schema['enum'] === undefined &&
      prop.schema['pattern'] === undefined &&
      prop.schema['maxLength'] === undefined &&
      prop.schema['format'] === undefined
    );
  });

  if (unconstrained !== undefined) {
    return determined(
      'yes',
      'schema',
      `unconstrained string parameter "${unconstrained.normalized}"`,
    );
  }

  return determined('no', 'schema', 'all parameters constrained');
}

export function classifySchemaHygiene(tool: ObservedTool): Determination {
  if (tool.inputSchema === null) {
    return determined('no', 'absent', 'no input schema declared');
  }
  const additional = tool.inputSchema['additionalProperties'];
  if (additional === undefined) {
    return determined('no', 'schema', 'additionalProperties unset');
  }
  if (additional === true) {
    return determined('no', 'schema', 'additionalProperties: true');
  }
  if (tool.inputSchema['type'] === undefined) {
    return determined('no', 'schema', 'no declared type');
  }
  return determined('yes', 'schema', 'additionalProperties constrained and type declared');
}

export function classifyTool(tool: ObservedTool, rules: RuleSet): ToolClassification {
  const writeCapable = classifyWriteCapability(tool, rules);
  const applicable = writeCapable.value === 'yes';

  // The tenant classifier is only meaningful over write-capable tools. Running it over reads would
  // pad the numerator's denominator with tools where the question does not arise.
  const notApplicable = determined(
    'undetermined',
    null,
    'not applicable: tool is not classified write-capable',
  );

  return {
    writeCapable,
    tenantParamStrict: applicable ? classifyTenantParam(tool, rules, 'strict') : notApplicable,
    tenantParamInclusive: applicable ? classifyTenantParam(tool, rules, 'inclusive') : notApplicable,
    annotationMismatch: classifyAnnotationMismatch(tool, rules),
    guardrailPresent: applicable ? classifyGuardrail(tool, rules) : notApplicable,
    openEndedSurface: classifyOpenEndedSurface(tool, rules),
    schemaHygiene: classifySchemaHygiene(tool),
  };
}
