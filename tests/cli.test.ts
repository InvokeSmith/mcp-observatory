import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SnapshotLeaf, SnapshotManifest } from '../src/store/types.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function runCli(args: readonly string[]) {
  const dataDir = await mkdtemp(join(tmpdir(), 'observatory-cli-'));
  directories.push(dataDir);
  const manifest = {
    manifestHash: 'cli-fixture-discovery',
    organizations: [
      {
        orgKey: 'org-a',
        candidates: ['one', 'two'].map((name) => ({ host: `${name}.example.com`, path: '/mcp' })),
      },
      {
        orgKey: 'org-b',
        candidates: ['three', 'four', 'five', 'six'].map((name) => ({ host: `${name}.example.com`, path: '/mcp' })),
      },
    ],
  };
  const manifestText = JSON.stringify(manifest);
  const manifestPath = join(dataDir, 'discover', 'manifest.json');
  await mkdir(join(dataDir, 'discover'));
  await writeFile(manifestPath, manifestText);

  const proc = Bun.spawn([
    process.execPath, '--preload', './tests/support/cli-network.ts', './src/cli.ts',
    ...args, '--data', dataDir,
  ], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  const requests = stdout.split('\n')
    .filter((line) => line.startsWith('fixture-request '))
    .map((line) => new URL(line.slice('fixture-request '.length)));
  return { dataDir, manifestPath, manifestText, stdout, stderr, code, requests };
}

async function readSnapshot(dataDir: string) {
  const snapshotsDir = join(dataDir, 'snapshots');
  const ids = await readdir(snapshotsDir);
  expect(ids).toHaveLength(1);
  const dir = join(snapshotsDir, ids[0]!);
  return {
    manifest: JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as SnapshotManifest,
    leaves: JSON.parse(await readFile(join(dir, 'leaves.json'), 'utf8')) as SnapshotLeaf[],
  };
}

describe('probe CLI limits', () => {
  test('--limit 5 contacts only the first five candidates, retaining the rest as not-attempted', async () => {
    const result = await runCli(['probe', '--limit', '5']);
    expect(result.code, result.stderr).toBe(0);
    const contactedHosts = [...new Set(result.requests
      .filter((url) => url.hostname.endsWith('.example.com'))
      .map((url) => url.hostname))];
    expect(contactedHosts).toEqual([
      'one.example.com', 'two.example.com', 'three.example.com', 'four.example.com', 'five.example.com',
    ]);

    const snapshot = await readSnapshot(result.dataDir);
    expect(snapshot.manifest.discoverManifestHash).toBe('cli-fixture-discovery');
    expect(snapshot.manifest.leafCount).toBe(6);
    expect(snapshot.manifest.postureCounts).toEqual([['gated', 5], ['not-attempted', 1]]);
    expect(snapshot.leaves.find((leaf) => leaf.targetId === 'org-b:six.example.com/mcp')).toMatchObject({
      posture: 'not-attempted', tools: [], protocolVersion: null, serverName: null,
    });
    expect(await readFile(result.manifestPath, 'utf8')).toBe(result.manifestText);
  });

  test.each([
    { label: 'zero', args: ['--limit', '0'], contacted: 0, postures: [['not-attempted', 6]] },
    { label: 'one', args: ['--limit', '1'], contacted: 1, postures: [['gated', 1], ['not-attempted', 5]] },
    { label: 'omitted', args: [], contacted: 6, postures: [['gated', 6]] },
    { label: 'larger than the manifest', args: ['--limit', '20'], contacted: 6, postures: [['gated', 6]] },
  ])('handles a $label limit without losing discovered candidates', async ({ args, contacted, postures }) => {
    const result = await runCli(['probe', ...args]);
    expect(result.code, result.stderr).toBe(0);
    const contactedHosts = new Set(result.requests
      .filter((url) => url.hostname.endsWith('.example.com'))
      .map((url) => url.hostname));
    expect(contactedHosts.size).toBe(contacted);
    const snapshot = await readSnapshot(result.dataDir);
    expect(snapshot.manifest.leafCount).toBe(6);
    expect(snapshot.manifest.postureCounts).toEqual(postures);
  });
});

describe.each(['discover', 'probe'])('%s limit validation', (command) => {
  test.each(['-1', '1.5', 'NaN', 'Infinity', 'nope', '', '9007199254740992', '1e2', '0x5'])(
    'rejects invalid limit %j before contacting any host', async (limit) => {
      const result = await runCli([command, `--limit=${limit}`]);
      expect(result.code, result.stderr).toBe(2);
      expect(result.stderr).toContain('--limit must be a non-negative safe integer');
      expect(result.requests).toEqual([]);
      expect(await readdir(result.dataDir)).toEqual(['discover']);
      expect(await readFile(result.manifestPath, 'utf8')).toBe(result.manifestText);
    },
  );
});
