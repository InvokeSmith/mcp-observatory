/**
 * Constraint 6: aggregates only.
 *
 * The obvious half — no hostnames in the output — is easy. The half that would have shipped broken
 * is tool names: `acme_internal_billing_refund` identifies a company as surely as a hostname does,
 * and it arrives in the data by default. So a name is published only when it is common enough across
 * organizations to name nobody.
 */
import { describe, expect, test } from 'bun:test';
import { loadRuleSet } from '../../src/classify/rules.js';
import { buildReport, TOOL_NAME_K } from '../../src/stages/report.js';
import { freshOptOutList } from '../helpers/harness.js';
import { buildTestSnapshot } from '../helpers/snapshot.js';

async function artifacts() {
  const snapshot = await buildTestSnapshot();
  const rules = await loadRuleSet();
  return buildReport({
    snapshot,
    rules,
    optOut: freshOptOutList(),
    optOutId: 'test-optout',
    protocolVersion: '0.1.0',
  });
}

describe('constraint 6: aggregates only', () => {
  test('no published artifact contains a hostname or a URL to a surveyed server', async () => {
    const built = await artifacts();
    for (const [name, content] of Object.entries(built)) {
      expect(content, `${name} contains a hostname-like string`).not.toMatch(
        /\bhttps?:\/\/(?!github\.com)[a-z0-9-]+\.[a-z]{2,}/i,
      );
      expect(content, `${name} contains an mcp.* hostname`).not.toMatch(/\bmcp\.[a-z0-9-]+\.[a-z]{2,}/i);
    }
  });

  test('a tool name seen on fewer than k organizations is suppressed', async () => {
    const built = await artifacts();
    // Appears on exactly one org in the fixture. Publishing it would name that org.
    expect(built['tools.csv']).not.toContain('acme_internal_billing_refund');
    expect(built['tools.json']).not.toContain('acme_internal_billing_refund');
    expect(built['tools.csv']).toContain('(suppressed)');
  });

  test('a tool name common across at least k organizations is published', async () => {
    const built = await artifacts();
    // Present on six orgs in the fixture, which is >= k, so it names nobody.
    expect(TOOL_NAME_K).toBe(5);
    expect(built['tools.csv']).toContain('create_invoice');
  });

  test('organization keys are opaque, never names', async () => {
    const built = await artifacts();
    expect(built['tools.csv']).toMatch(/"org-\d{3}"/);
    expect(built['tools.csv']).not.toContain('acme');
  });

  test('no tool description reaches the output verbatim', async () => {
    const built = await artifacts();
    for (const content of Object.values(built)) {
      expect(content).not.toContain('Refunds a payment. This cannot be undone.');
      expect(content).not.toContain('List invoices for the authenticated account.');
    }
  });

  test('a host that opts out after being probed disappears from the next report', async () => {
    const snapshot = await buildTestSnapshot();
    const rules = await loadRuleSet();

    const before = buildReport({
      snapshot, rules,
      optOut: freshOptOutList(),
      optOutId: 'before',
      protocolVersion: '0.1.0',
    });
    const after = buildReport({
      snapshot, rules,
      // The opt-out list is an INPUT to report generation, not ambient state, which is what makes
      // the 24-hour removal SLA real for a host already in the snapshot.
      optOut: freshOptOutList(['org-100']),
      optOutId: 'after',
      protocolVersion: '0.1.0',
    });

    expect(before['tools.csv']).toContain('org-100');
    expect(after['tools.csv']).not.toContain('org-100');
  });
});
