#!/usr/bin/env bun
/**
 * Generates the report artifacts and prints one sha256 over all of them.
 *
 * Run as a subprocess by the determinism test, twice, under different TZ and LANG. An in-process
 * double-run would share module state and miss exactly the class of bug this is for.
 */
import { loadRuleSet } from '../../src/classify/rules.js';
import { buildReport } from '../../src/stages/report.js';
import { parseOptOutList } from '../../src/net/optout.js';
import { buildTestSnapshot } from '../helpers/snapshot.js';
import { canonicalize } from '../../src/canon/json.js';

const snapshot = await buildTestSnapshot();
const rules = await loadRuleSet();

const artifacts = buildReport({
  snapshot,
  rules,
  // A fixed timestamp: the opt-out list's freshness is a runtime policy, not part of the output.
  optOut: parseOptOutList('', 0),
  optOutId: 'deterministic-optout',
  protocolVersion: '0.1.0',
});

const digest = new Bun.CryptoHasher('sha256');
// Sorted, so the hash does not depend on Object.entries order.
for (const name of Object.keys(artifacts).sort()) {
  digest.update(name);
  digest.update(artifacts[name as keyof typeof artifacts]);
}

process.stdout.write(
  canonicalize({
    digest: digest.digest('hex'),
    snapshotId: snapshot.manifest.snapshotId,
    rulesetId: rules.rulesetId,
  }),
);
