#!/usr/bin/env node
/**
 * Four stages, each independently runnable and resumable.
 *
 * The egress denial is armed first, before anything else is imported and run, so that any code path
 * reaching for `globalThis.fetch` instead of the gate crashes loudly rather than quietly working.
 */
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { armEgressDenial } from './net/bootstrap-deny-egress.js';
import { canonicalHash, canonicalize } from './canon/json.js';
import { loadRuleSet } from './classify/rules.js';
import { classifySnapshot } from './stages/classify.js';
import {
  buildDiscoverManifest,
  discoverFromCertificateTransparency,
  loadSharedPlatforms,
  type Candidate,
} from './stages/discover.js';
import { buildReport } from './stages/report.js';
import { probeTarget, type ProbeTarget } from './stages/probe.js';
import { Gate } from './net/gate.js';
import { HostState } from './net/host-state.js';
import { parseOptOutList } from './net/optout.js';
import { PolitenessQueue } from './net/politeness.js';
import { describePreflight, preflightIdentity } from './net/preflight.js';
import { seal } from './store/seal.js';
import { sweepRuns } from './store/retention.js';
import { formatViolations, lintArtifact, loadPublicationRules } from './report/lint.js';
import { CONTACT_URL, PROJECT_NAME, PROJECT_VERSION, USER_AGENT } from './config/identity.js';
import type { SnapshotLeaf } from './store/types.js';

armEgressDenial();

const HELP = `${PROJECT_NAME} ${PROJECT_VERSION}

A passive posture survey of publicly reachable MCP servers. Two protocol calls
per host — initialize and tools/list — and never a third. It does not invoke tools.

  ${USER_AGENT}
  Opt out: ${CONTACT_URL}/blob/main/OPTOUT.md

USAGE
  observatory <command> [options]

COMMANDS
  discover    Build a candidate host list. Contacts no MCP server.
  probe       Two protocol calls per host, then seal an immutable snapshot.
  classify    Apply the rule sets to a sealed snapshot. Pure; no network.
  report      Emit the derived dataset, statistics and writeup.
  preflight   Check that our own contact and opt-out URLs resolve.
  sweep       Delete raw captures past the retention window.

OPTIONS
  --data <dir>        Data root (default: data)
  --snapshot <id>     Snapshot id, for classify and report
  --sources <list>    Comma-separated discover sources (default: ct)
  --limit <n>         Cap candidates, for a first run
  --retention <days>  Retention window for sweep (default: 90)
  --skip-identity-check
                      Run discover without a resolving contact URL. Prints a loud
                      warning. Never permitted for probe: a scanner whose contact
                      URL 404s must not connect to anyone else's server.
  --help

EXAMPLES
  observatory discover --sources ct --limit 500
  observatory probe --data data
  observatory report --snapshot <id>
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      data: { type: 'string', default: 'data' },
      snapshot: { type: 'string' },
      sources: { type: 'string', default: 'ct' },
      limit: { type: 'string' },
      retention: { type: 'string', default: '90' },
      'skip-identity-check': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });

  const command = positionals[0];
  if (values.help === true || command === undefined || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  switch (command) {
    case 'preflight':
      return commandPreflight();
    case 'discover':
      return commandDiscover(values);
    case 'probe':
      return commandProbe(values);
    case 'classify':
      return commandClassify(values);
    case 'report':
      return commandReport(values);
    case 'sweep':
      return commandSweep(values);
    default:
      process.stderr.write(`unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

type Values = Record<string, string | boolean | undefined>;

async function commandPreflight(): Promise<number> {
  const result = await preflightIdentity();
  process.stdout.write(`identity preflight:\n${describePreflight(result)}\n`);
  if (!result.ok) {
    process.stderr.write(
      '\nThe contact URL in our User-Agent does not resolve. Probing is refused until it does:\n' +
        'a scanner naming a project that does not exist is worse than one with no User-Agent,\n' +
        'because an operator who tries to reach us is actively misled.\n',
    );
    return 1;
  }
  return 0;
}

async function loadOptOut(): Promise<{ list: ReturnType<typeof parseOptOutList>; id: string }> {
  const text = await readFile('optout.txt', 'utf8');
  return { list: parseOptOutList(text, Date.now()), id: await canonicalHash({ text }) };
}

async function buildGate(dataDir: string, identityVerified: boolean) {
  const hostState = await HostState.load(join(dataDir, 'state', 'hosts.ndjson'));
  const { list, id } = await loadOptOut();
  const gate = new Gate({
    hostState,
    optOutList: list,
    queue: new PolitenessQueue(),
    identityVerified,
  });
  return { gate, hostState, optOut: list, optOutId: id };
}

async function commandDiscover(values: Values): Promise<number> {
  const dataDir = String(values.data);
  const skip = values['skip-identity-check'] === true;

  const preflight = await preflightIdentity();
  if (!preflight.ok && !skip) {
    process.stderr.write(
      `identity preflight failed:\n${describePreflight(preflight)}\n\n` +
        'Pass --skip-identity-check to run discover anyway. Discover contacts no MCP server,\n' +
        'but it does send our User-Agent to the discovery sources.\n',
    );
    return 1;
  }
  if (!preflight.ok) {
    process.stderr.write(
      `WARNING: our contact URL does not resolve yet:\n${describePreflight(preflight)}\n` +
        'Proceeding because --skip-identity-check was given. This is acceptable for discover,\n' +
        'which contacts no MCP server. It is never acceptable for probe.\n\n',
    );
  }

  const { gate } = await buildGate(dataDir, true);
  const sources = String(values.sources).split(',').map((s) => s.trim());

  let candidates: readonly Candidate[] = [];
  if (sources.includes('ct')) {
    process.stderr.write('querying certificate transparency logs...\n');
    candidates = await discoverFromCertificateTransparency(gate);
  }

  if (values.limit !== undefined) {
    candidates = candidates.slice(0, Number(values.limit));
  }

  const sharedPlatforms = await loadSharedPlatforms();
  const manifest = await buildDiscoverManifest(candidates, sharedPlatforms.platforms);
  const outDir = join(dataDir, 'discover');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'manifest.json'), canonicalize(manifest), 'utf8');

  process.stdout.write(
    `discovered ${manifest.candidateCount} distinct candidates across ` +
      `${manifest.organizations.length} organizations ` +
      `(from ${manifest.rawRowCount} raw certificate rows)\n` +
      `manifest hash: ${manifest.manifestHash}\n` +
      `written to ${join(outDir, 'manifest.json')}\n` +
      `\nNo MCP server was contacted. Requests made: ${gate.captures.length} ` +
      `(all to discovery sources).\n`,
  );
  return 0;
}

async function commandProbe(values: Values): Promise<number> {
  const dataDir = String(values.data);

  // No --skip-identity-check here, by design. Discover talks to public log services; probe talks to
  // other people's servers.
  const preflight = await preflightIdentity();
  if (!preflight.ok) {
    process.stderr.write(
      `identity preflight failed, refusing to probe:\n${describePreflight(preflight)}\n`,
    );
    return 1;
  }

  const manifestPath = join(dataDir, 'discover', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    manifestHash: string;
    organizations: readonly {
      orgKey: string;
      candidates: readonly { host: string; path: string }[];
    }[];
  };

  const { gate, hostState } = await buildGate(dataDir, true);

  const targets: ProbeTarget[] = manifest.organizations.flatMap((org) =>
    org.candidates.map((candidate) => ({
      targetId: `${org.orgKey}:${candidate.host}${candidate.path}`,
      orgKey: org.orgKey,
      origin: `https://${candidate.host}`,
      path: candidate.path,
    })),
  );

  const leaves: SnapshotLeaf[] = [];
  for (const target of targets) {
    const outcome = await probeTarget(gate, hostState, target);
    leaves.push(outcome.leaf);
  }

  const snapshot = await seal({ discoverManifestHash: manifest.manifestHash, leaves });
  const outDir = join(dataDir, 'snapshots', snapshot.manifest.snapshotId);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'manifest.json'), canonicalize(snapshot.manifest), 'utf8');
  await writeFile(join(outDir, 'leaves.json'), canonicalize(snapshot.leaves), 'utf8');

  process.stdout.write(`sealed snapshot ${snapshot.manifest.snapshotId}\n`);
  return 0;
}

async function loadSnapshot(dataDir: string, snapshotId: string) {
  const dir = join(dataDir, 'snapshots', snapshotId);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const leaves = JSON.parse(await readFile(join(dir, 'leaves.json'), 'utf8')) as SnapshotLeaf[];
  return { manifest, leaves };
}

async function commandClassify(values: Values): Promise<number> {
  if (values.snapshot === undefined) {
    process.stderr.write('classify requires --snapshot <id>\n');
    return 2;
  }
  const dataDir = String(values.data);
  const snapshot = await loadSnapshot(dataDir, String(values.snapshot));
  const rules = await loadRuleSet();
  const classified = classifySnapshot(snapshot, rules, snapshot.leaves);

  const outDir = join(dataDir, 'classified', `${classified.snapshotId}.${classified.rulesetId}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'rows.json'), canonicalize(classified.rows), 'utf8');

  process.stdout.write(`classified ${classified.rows.length} tools -> ${outDir}\n`);
  return 0;
}

async function commandReport(values: Values): Promise<number> {
  if (values.snapshot === undefined) {
    process.stderr.write('report requires --snapshot <id>\n');
    return 2;
  }
  const dataDir = String(values.data);
  const snapshot = await loadSnapshot(dataDir, String(values.snapshot));
  const rules = await loadRuleSet();
  const { list, id: optOutId } = await loadOptOut();

  const artifacts = buildReport({
    snapshot,
    rules,
    optOut: list,
    optOutId,
    protocolVersion: '0.1.0',
  });

  // Constraint 8 is a build failure, not a review note. Nothing is written if it fails.
  const publicationRules = await loadPublicationRules();
  const violations = Object.entries(artifacts).flatMap(([name, content]) =>
    lintArtifact(name, content, publicationRules),
  );
  if (violations.length > 0) {
    process.stderr.write(
      `report refused: publication language violations\n${formatViolations(violations)}\n`,
    );
    return 1;
  }

  const outDir = join(
    dataDir,
    'reports',
    `${snapshot.manifest.snapshotId}.${rules.rulesetId.slice(0, 12)}.${optOutId.slice(0, 12)}`,
  );
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of Object.entries(artifacts)) {
    await writeFile(join(outDir, name), content, 'utf8');
  }

  process.stdout.write(`report written to ${outDir}\n`);
  return 0;
}

async function commandSweep(values: Values): Promise<number> {
  const dataDir = String(values.data);
  const result = await sweepRuns(
    join(dataDir, 'runs'),
    Date.now(),
    Number(values.retention),
  );
  process.stdout.write(
    `retention sweep: deleted ${result.deleted.length}, kept ${result.kept.length}\n`,
  );
  return 0;
}

process.exitCode = await main();
