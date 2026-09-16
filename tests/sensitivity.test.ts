/**
 * Conflict-of-interest control 2.
 *
 * The property under test is not "the band is computed correctly" so much as "the band cannot be
 * omitted." A vendor-published survey that quietly drops its sensitivity analysis when the analysis
 * is unflattering has broken the one promise that made the number checkable, so the report refuses
 * to build without it and the linter refuses to pass a report that lacks it.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { applyVariant, loadRuleSet, loadVariants, REGISTERED_BEHAVIOR, type RuleSet, type RuleVariant } from '../src/classify/rules.js';
import { classifyWriteCapability, type ObservedTool } from '../src/classify/tool.js';
import { computeSensitivity } from '../src/stats/sensitivity.js';
import { buildReport } from '../src/stages/report.js';
import { lintArtifact, loadPublicationRules } from '../src/report/lint.js';
import { freshOptOutList } from './helpers/harness.js';
import { buildTestSnapshot } from './helpers/snapshot.js';

let rules: RuleSet;
let variants: readonly RuleVariant[];

beforeAll(async () => {
  rules = await loadRuleSet();
  variants = (await loadVariants()).variants;
});

function tool(partial: Partial<ObservedTool> & { name: string }): ObservedTool {
  return { description: null, inputSchema: null, annotations: null, ...partial };
}

describe('registered variants', () => {
  test('a baseline variant exists and changes nothing', () => {
    const baseline = variants.find((v) => v.id === 'baseline');
    expect(baseline).toBeDefined();
    expect(baseline?.changes).toEqual({});
    expect(applyVariant(rules, baseline as RuleVariant).behavior).toEqual(REGISTERED_BEHAVIOR);
  });

  test('every variant states why it is registered', () => {
    for (const variant of variants) {
      expect(variant.rationale.length, variant.id).toBeGreaterThan(30);
      expect(variant.label.length, variant.id).toBeGreaterThan(5);
    }
  });

  test('a variant ruleset is never mistaken for the registered one', () => {
    for (const variant of variants.filter((v) => v.id !== 'baseline')) {
      const derived = applyVariant(rules, variant);
      // The id carries the deviation, so a figure can never be attributed to the registered rules
      // when a variant produced it.
      expect(derived.rulesetId, variant.id).not.toBe(rules.rulesetId);
      expect(derived.rulesetId).toContain(variant.id);
    }
  });
});

describe('the variants actually change classification', () => {
  test('annotations-ignored disregards a server self-report', () => {
    const ignored = applyVariant(rules, {
      id: 'x', label: 'x', rationale: 'x', changes: { annotationPrecedence: 'ignore' },
    });
    const t = tool({ name: 'delete_account', annotations: { readOnlyHint: true } });

    expect(classifyWriteCapability(t, rules).value).toBe('no');
    expect(classifyWriteCapability(t, ignored).value).toBe('yes');
  });

  test('annotations-last lets name evidence outrank a hint', () => {
    const last = applyVariant(rules, {
      id: 'x', label: 'x', rationale: 'x', changes: { annotationPrecedence: 'last' },
    });
    const t = tool({ name: 'delete_account', annotations: { readOnlyHint: true } });
    expect(classifyWriteCapability(t, last).value).toBe('yes');
  });

  test('no-description-signal moves a tool to undetermined, not to read-only', () => {
    const noDesc = applyVariant(rules, {
      id: 'x', label: 'x', rationale: 'x', changes: { useDescriptionSignal: false },
    });
    const t = tool({ name: 'billing_entry', description: 'Creates an invoice for a customer.' });

    expect(classifyWriteCapability(t, rules).value).toBe('yes');
    // The distinction matters: a dropped signal is missing evidence, not evidence of absence.
    expect(classifyWriteCapability(t, noDesc).value).toBe('undetermined');
  });

  test('a narrowed verb list narrows the write-capable set', () => {
    const minimal = applyVariant(rules, {
      id: 'x', label: 'x', rationale: 'x', changes: { replaceWriteVerbs: ['create'] },
    });
    expect(classifyWriteCapability(tool({ name: 'refund_payment' }), rules).value).toBe('yes');
    expect(classifyWriteCapability(tool({ name: 'refund_payment' }), minimal).value).toBe('undetermined');
    expect(classifyWriteCapability(tool({ name: 'create_invoice' }), minimal).value).toBe('yes');
  });
});

describe('the band', () => {
  test('spans every registered variant and identifies the extremes', async () => {
    const snapshot = await buildTestSnapshot();
    const band = computeSensitivity(snapshot, rules, variants);

    expect(band.variants).toHaveLength(variants.length);
    expect(band.baseline.id).toBe('baseline');

    const rate = (v: { proportion: { numerator: number; denominator: number } }) =>
      v.proportion.denominator === 0 ? 0 : v.proportion.numerator / v.proportion.denominator;

    for (const variant of band.variants) {
      expect(rate(variant)).toBeGreaterThanOrEqual(rate(band.lowest));
      expect(rate(variant)).toBeLessThanOrEqual(rate(band.highest));
    }
  });

  test('it names the rule choice that moves the figure most', async () => {
    const snapshot = await buildTestSnapshot();
    const band = computeSensitivity(snapshot, rules, variants);
    expect(band.mostInfluential.id).not.toBe('baseline');
    expect(band.mostInfluential.deltaPoints).toBeGreaterThanOrEqual(0);
  });

  test('it is deterministic, and independent of the order variants are listed in', async () => {
    const snapshot = await buildTestSnapshot();
    const forward = computeSensitivity(snapshot, rules, variants);
    const reversed = computeSensitivity(snapshot, rules, [...variants].reverse());
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

describe('the band cannot be omitted', () => {
  test('a report built with no variants is refused', async () => {
    const snapshot = await buildTestSnapshot();
    expect(() =>
      buildReport({
        snapshot,
        rules,
        optOut: freshOptOutList(),
        optOutId: 'test',
        protocolVersion: '0.1.0',
        variants: [],
      }),
    ).toThrow(/preregistration/);
  });

  test('a report.md without a band fails the publication linter', async () => {
    const publication = await loadPublicationRules();
    const withoutBand = [
      '# R', '', '## Limitations', '', 'precondition', '', '## Findings', '',
      '- **Headline**: 34.0% (34/100, n = 100, undetermined = 0, 95% CI [25.2%, 44.1%])', '',
      '## Reproducing this', '', 'observatory report', '',
    ].join('\n');

    const violations = lintArtifact('report.md', withoutBand, publication);
    expect(violations.map((v) => v.ruleId)).toContain('PUB-SENSITIVITY-BAND');
  });

  test('the real generated report carries the band, before the reproduction section', async () => {
    const snapshot = await buildTestSnapshot();
    const artifacts = buildReport({
      snapshot,
      rules,
      optOut: freshOptOutList(),
      optOutId: 'test',
      protocolVersion: '0.1.0',
      variants,
    });

    const md = artifacts['report.md'];
    expect(md).toContain('## How much the rules decide');
    expect(md).toContain('registered variants the headline ranges from');
    expect(md.indexOf('## Findings')).toBeLessThan(md.indexOf('## How much the rules decide'));
    expect(md.indexOf('## How much the rules decide')).toBeLessThan(md.indexOf('## Reproducing this'));

    // Every variant is shown, so a reader can see which choice moved what.
    for (const variant of variants) {
      expect(md, variant.id).toContain(variant.id);
    }

    const stats = JSON.parse(artifacts['stats.json']) as { sensitivity?: { variants?: unknown[] } };
    expect(stats.sensitivity?.variants).toHaveLength(variants.length);
  });
});
