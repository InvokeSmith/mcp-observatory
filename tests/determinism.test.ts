/**
 * Two runs over the same snapshot must produce byte-identical output, or no published figure can be
 * independently regenerated and the whole reproducibility argument is decoration.
 *
 * The runs happen in separate processes under a hostile locale and timezone. `tr_TR` in particular
 * is not paranoia: `'I'.toLowerCase()` differs there, and tool-name normalization is exactly the
 * kind of code that reaches for case folding.
 */
import { describe, expect, test } from 'bun:test';
import { canonicalize, canonicalHash, compareCanonical, NonCanonicalValueError } from '../src/canon/json.js';
import { toCsv } from '../src/canon/csv.js';

async function generateIn(env: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(['bun', 'run', 'tests/support/generate-report.ts'], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`generator exited ${code}: ${err}`);
  return out;
}

describe('determinism', () => {
  test('two processes under different TZ and LANG produce identical bytes', async () => {
    const [a, b] = await Promise.all([
      generateIn({ TZ: 'UTC', LANG: 'C', LC_ALL: 'C' }),
      generateIn({ TZ: 'Pacific/Kiritimati', LANG: 'tr_TR.UTF-8', LC_ALL: 'tr_TR.UTF-8' }),
    ]);
    expect(a).toBe(b);
  }, 30_000);

  test('the same snapshot always seals to the same id', async () => {
    const a = await generateIn({ TZ: 'UTC' });
    const b = await generateIn({ TZ: 'Asia/Kolkata' });
    expect(JSON.parse(a).snapshotId).toBe(JSON.parse(b).snapshotId);
  }, 30_000);
});

describe('canonical json', () => {
  test('key order in the input does not affect the output', () => {
    expect(canonicalize({ b: 1, a: 2, c: 3 })).toBe(canonicalize({ c: 3, a: 2, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}\n');
  });

  test('encoding is idempotent through a parse round trip', () => {
    const value = { z: [3, 2, 1], a: { nested: true }, m: 'x' };
    const once = canonicalize(value);
    expect(canonicalize(JSON.parse(once))).toBe(once);
  });

  /**
   * The hazard that would have shipped silently. Engines sort array-index-like object keys ahead of
   * everything else, regardless of any sort we apply, so a tool named "2024" would jump position and
   * two otherwise identical runs would differ.
   */
  test('array-index-like object keys are refused, not quietly reordered', () => {
    expect(JSON.stringify({ '10': 1, '2': 1, a: 1 })).toBe('{"2":1,"10":1,"a":1}');
    expect(() => canonicalize({ '10': 1, '2': 1 })).toThrow(NonCanonicalValueError);
    // The supported shape: pairs in an array, whose order we control.
    expect(canonicalize([['10', 1], ['2', 1]])).toBe('[["10",1],["2",1]]\n');
  });

  test('values that cannot round-trip are refused rather than coerced', () => {
    expect(() => canonicalize({ x: Number.NaN })).toThrow(NonCanonicalValueError);
    expect(() => canonicalize({ x: Infinity })).toThrow(NonCanonicalValueError);
    expect(() => canonicalize({ x: -0 })).toThrow(NonCanonicalValueError);
    expect(() => canonicalize({ x: undefined })).toThrow(NonCanonicalValueError);
    expect(() => canonicalize({ x: new Date(0) })).toThrow(NonCanonicalValueError);
    expect(() => canonicalize({ x: new Map() })).toThrow(NonCanonicalValueError);
    expect(() => canonicalize({ x: new Set() })).toThrow(NonCanonicalValueError);
  });

  test('sorting is by code unit, not by locale', () => {
    // localeCompare would order these differently under some locales; code-unit order is fixed.
    const encoded = canonicalize({ Z: 1, a: 2, A: 3 });
    expect(encoded).toBe('{"A":3,"Z":1,"a":2}\n');
  });

  test('hashes are stable and order-independent', async () => {
    const a = await canonicalHash({ x: 1, y: [1, 2] });
    const b = await canonicalHash({ y: [1, 2], x: 1 });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  test('compareCanonical gives a total order for tie-breaking', () => {
    const items = [{ b: 1 }, { a: 1 }, { a: 0 }];
    const sorted = [...items].sort(compareCanonical);
    expect(canonicalize(sorted)).toBe(canonicalize([{ a: 0 }, { a: 1 }, { b: 1 }]));
  });
});

describe('canonical csv', () => {
  test('every field is quoted unconditionally, removing a data-dependent branch', () => {
    expect(toCsv(['a', 'b'], [['1', '2']])).toBe('"a","b"\n"1","2"\n');
  });

  test('embedded quotes, commas and newlines survive', () => {
    expect(toCsv(['x'], [['he said "hi", then left\nand returned']])).toBe(
      '"x"\n"he said ""hi"", then left\nand returned"\n',
    );
  });

  test('a row of the wrong width is an error, not a silently ragged file', () => {
    expect(() => toCsv(['a', 'b'], [['1']])).toThrow();
  });

  test('line endings are LF regardless of platform', () => {
    expect(toCsv(['a'], [['1']])).not.toContain('\r');
  });
});
