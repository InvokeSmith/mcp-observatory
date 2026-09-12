/**
 * The classifiers. The recurring assertion is that "undetermined" is a real answer: a tool with no
 * annotations, a neutral name and no description genuinely does not tell you whether it writes, and
 * recording that as "no" would quietly inflate the read side of every denominator.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { loadRuleSet, type RuleSet } from '../src/classify/rules.js';
import {
  classifyAnnotationMismatch,
  classifyGuardrail,
  classifyOpenEndedSurface,
  classifySchemaHygiene,
  classifyTenantParam,
  classifyTool,
  classifyWriteCapability,
  type ObservedTool,
} from '../src/classify/tool.js';
import { firstSentence, normalizeParamName, tokenize } from '../src/classify/types.js';

let rules: RuleSet;
beforeAll(async () => {
  rules = await loadRuleSet();
});

function tool(partial: Partial<ObservedTool> & { name: string }): ObservedTool {
  return {
    description: null,
    inputSchema: null,
    annotations: null,
    ...partial,
  };
}

describe('tokenisation', () => {
  test('splits every common identifier convention to the same tokens', () => {
    expect(tokenize('refundPayment')).toEqual(['refund', 'payment']);
    expect(tokenize('refund_payment')).toEqual(['refund', 'payment']);
    expect(tokenize('refund-payment')).toEqual(['refund', 'payment']);
    expect(tokenize('payments.refund')).toEqual(['payments', 'refund']);
  });

  test('parameter names normalise across conventions', () => {
    expect(normalizeParamName('accountId')).toBe('account_id');
    expect(normalizeParamName('account-id')).toBe('account_id');
    expect(normalizeParamName('account.id')).toBe('account_id');
  });

  test('only the first sentence of a description is consulted', () => {
    // Later sentences routinely describe what the caller may do next, not what the tool does.
    expect(firstSentence('Lists invoices. You can then update them.')).toBe('Lists invoices.');
  });
});

describe('write capability', () => {
  test('an annotation decides, and says so', () => {
    const readOnly = classifyWriteCapability(
      tool({ name: 'refund_payment', annotations: { readOnlyHint: true } }),
      rules,
    );
    // The annotation wins over the name. That is the declared precedence, and the mismatch is
    // reported separately rather than silently resolved here.
    expect(readOnly.value).toBe('no');
    expect(readOnly.decidedBy).toBe('annotation');
  });

  test('a name verb decides when annotations are absent', () => {
    const write = classifyWriteCapability(tool({ name: 'create_invoice' }), rules);
    expect(write.value).toBe('yes');
    expect(write.decidedBy).toBe('name');
    expect(write.evidence).toContain('create');

    const read = classifyWriteCapability(tool({ name: 'list_invoices' }), rules);
    expect(read.value).toBe('no');
    expect(read.decidedBy).toBe('name');
  });

  test('the description is the last resort', () => {
    const result = classifyWriteCapability(
      tool({ name: 'billing_entry', description: 'Creates an invoice for a customer.' }),
      rules,
    );
    expect(result.value).toBe('yes');
    expect(result.decidedBy).toBe('description');
  });

  test('a genuinely uninformative tool is undetermined, not guessed', () => {
    const result = classifyWriteCapability(tool({ name: 'handle_thing' }), rules);
    expect(result.value).toBe('undetermined');
    expect(result.decidedBy).toBeNull();
  });

  /**
   * Several write verbs are also nouns. Without leading-token precedence, `get_invoice` scans as a
   * write on its object rather than a read on its verb, and lands on the wrong side of the headline
   * denominator.
   */
  test('a noun that is also a verb does not flip a read tool', () => {
    for (const name of ['get_invoice', 'list_charges', 'fetch_credit', 'read_post']) {
      const result = classifyWriteCapability(tool({ name }), rules);
      expect(result.value, name).toBe('no');
    }
    for (const name of ['create_invoice', 'refund_payment', 'delete_account']) {
      const result = classifyWriteCapability(tool({ name }), rules);
      expect(result.value, name).toBe('yes');
    }
  });
});

describe('the headline classifier', () => {
  const writeTool = (properties: Record<string, unknown>): ObservedTool =>
    tool({ name: 'create_invoice', inputSchema: { type: 'object', properties } });

  test('a strict tenant selector is detected', () => {
    const result = classifyTenantParam(writeTool({ account_id: { type: 'string' } }), rules, 'strict');
    expect(result.value).toBe('yes');
    expect(result.evidence).toContain('account_id');
  });

  test('camelCase forms match too', () => {
    expect(classifyTenantParam(writeTool({ workspaceId: { type: 'string' } }), rules, 'strict').value).toBe('yes');
  });

  /**
   * The distinction the whole headline rests on. `user_id` may be intra-tenant, so it is excluded
   * from the strict figure and included in the inclusive one, and both are published.
   */
  test('ambiguous names count only in the inclusive figure', () => {
    const t = writeTool({ user_id: { type: 'string' } });
    expect(classifyTenantParam(t, rules, 'strict').value).toBe('no');
    expect(classifyTenantParam(t, rules, 'inclusive').value).toBe('yes');
  });

  test('a missing schema is undetermined, not "no"', () => {
    expect(classifyTenantParam(tool({ name: 'create_invoice' }), rules, 'strict').value).toBe('undetermined');
  });

  test('it is not applied to tools that are not write-capable', () => {
    const read = classifyTool(
      tool({
        name: 'list_invoices',
        inputSchema: { type: 'object', properties: { account_id: { type: 'string' } } },
      }),
      rules,
    );
    expect(read.writeCapable.value).toBe('no');
    // The question does not arise for a read tool, so counting it would pad the denominator.
    expect(read.tenantParamStrict.value).toBe('undetermined');
    expect(read.tenantParamStrict.evidence).toContain('not applicable');
  });
});

describe('secondary classifiers', () => {
  test('annotation mismatch catches a server contradicting itself', () => {
    const result = classifyAnnotationMismatch(
      tool({ name: 'delete_account', annotations: { readOnlyHint: true } }),
      rules,
    );
    expect(result.value).toBe('yes');
    expect(result.evidence).toContain('readOnlyHint');
  });

  test('guardrails are detected across all three kinds', () => {
    for (const param of ['idempotency_key', 'dry_run', 'confirm']) {
      const result = classifyGuardrail(
        tool({ name: 'x', inputSchema: { type: 'object', properties: { [param]: {} } } }),
        rules,
      );
      expect(result.value, param).toBe('yes');
    }
  });

  test('open-ended surfaces are caught by name and structurally', () => {
    expect(
      classifyOpenEndedSurface(
        tool({ name: 'x', inputSchema: { type: 'object', properties: { sql: { type: 'string' } } } }),
        rules,
      ).value,
    ).toBe('yes');

    // A string with no enum, pattern, maxLength or format accepts anything, whatever it is called.
    const structural = classifyOpenEndedSurface(
      tool({ name: 'x', inputSchema: { type: 'object', properties: { note: { type: 'string' } } } }),
      rules,
    );
    expect(structural.value).toBe('yes');
    expect(structural.evidence).toContain('unconstrained');

    const constrained = classifyOpenEndedSurface(
      tool({
        name: 'x',
        inputSchema: { type: 'object', properties: { note: { type: 'string', maxLength: 100 } } },
      }),
      rules,
    );
    expect(constrained.value).toBe('no');
  });

  test('schema hygiene requires additionalProperties to be constrained', () => {
    expect(classifySchemaHygiene(tool({ name: 'x', inputSchema: { type: 'object' } })).value).toBe('no');
    expect(
      classifySchemaHygiene(
        tool({ name: 'x', inputSchema: { type: 'object', additionalProperties: false } }),
      ).value,
    ).toBe('yes');
  });
});

describe('rule sets are data', () => {
  test('the ruleset id is a stable content address', async () => {
    const a = await loadRuleSet();
    const b = await loadRuleSet();
    expect(a.rulesetId).toBe(b.rulesetId);
    expect(a.rulesetId).toHaveLength(64);
  });

  test('every rule file carries a version', () => {
    expect(rules.writeVerbs.version).toBeTruthy();
    expect(rules.tenantParams.version).toBeTruthy();
    expect(rules.guardrails.version).toBeTruthy();
    expect(rules.openEnded.version).toBeTruthy();
    expect(rules.descriptionVerbs.version).toBeTruthy();
  });
});
