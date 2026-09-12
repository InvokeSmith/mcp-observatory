/**
 * Canonical JSON. The determinism guarantee starts here.
 *
 * Two runs of classify+report over the same snapshot must produce byte-identical output, or no
 * published figure can be independently regenerated, and reproducibility is the entire credibility
 * argument. `JSON.stringify` is not sufficient for this on its own — see the integer-key hazard
 * below.
 */

export class NonCanonicalValueError extends Error {
  constructor(path: string, detail: string) {
    super(`Value at ${path || '<root>'} cannot be canonically encoded: ${detail}`);
    this.name = 'NonCanonicalValueError';
  }
}

/**
 * Object keys that look like array indices are reordered by every JS engine, ahead of and
 * independently of any sort we apply:
 *
 *   JSON.stringify({ "10": 1, "2": 1, "a": 1 })  ->  {"2":1,"10":1,"a":1}
 *
 * So a wild string — a tool name, a parameter name, a hostname — must never become an object key in
 * canonical output. They go in arrays of [key, value] pairs, which preserve the order we choose.
 * This function is what enforces that at encode time rather than at review time.
 */
function isArrayIndexLike(key: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(key);
}

/** UTF-16 code-unit order. Locale-free and identical on every machine, unlike localeCompare. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function encode(value: unknown, path: string, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }

  switch (typeof value) {
    case 'boolean':
      out.push(value ? 'true' : 'false');
      return;

    case 'number': {
      if (Number.isNaN(value)) throw new NonCanonicalValueError(path, 'NaN');
      if (!Number.isFinite(value)) throw new NonCanonicalValueError(path, 'Infinity');
      // -0 stringifies as "0", losing the distinction silently. Reject rather than coerce: a -0 in
      // derived output is a bug upstream, and we would rather find it than round it away.
      if (Object.is(value, -0)) throw new NonCanonicalValueError(path, '-0');
      out.push(JSON.stringify(value));
      return;
    }

    case 'string':
      // JSON.stringify's string escaping is well-formed and deterministic (ES2019+), including for
      // lone surrogates. It is the one part of it we rely on.
      out.push(JSON.stringify(value));
      return;

    case 'undefined':
      throw new NonCanonicalValueError(path, 'undefined');

    case 'function':
      throw new NonCanonicalValueError(path, 'function');

    case 'symbol':
      throw new NonCanonicalValueError(path, 'symbol');

    case 'bigint':
      throw new NonCanonicalValueError(path, 'bigint (not representable in JSON)');
  }

  if (Array.isArray(value)) {
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      encode(value[i], `${path}[${i}]`, out);
    }
    out.push(']');
    return;
  }

  // Anything with identity or iteration-order semantics is rejected. A Map's order is its insertion
  // order, which under a concurrent probe stage is not reproducible; a Date's encoding drags in a
  // clock. Both are easy to reach for and both silently destroy determinism.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
    throw new NonCanonicalValueError(path, `non-plain object (${ctor})`);
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(byCodeUnit);

  for (const key of keys) {
    if (isArrayIndexLike(key)) {
      throw new NonCanonicalValueError(
        `${path}.${key}`,
        'array-index-like object key; engines reorder these regardless of sort order. ' +
          'Use an array of [key, value] pairs instead.',
      );
    }
  }

  out.push('{');
  let first = true;
  for (const key of keys) {
    if (!first) out.push(',');
    first = false;
    out.push(JSON.stringify(key), ':');
    encode(record[key], path ? `${path}.${key}` : key, out);
  }
  out.push('}');
}

/**
 * Encode to canonical JSON: sorted keys, no whitespace, exactly one trailing newline.
 *
 * Throws rather than coerces on anything that cannot round-trip deterministically.
 */
export function canonicalize(value: unknown): string {
  const out: string[] = [];
  encode(value, '', out);
  out.push('\n');
  return out.join('');
}

/** Convenience for the common "hash this structure" case. */
export async function canonicalHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalize(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Total order for arbitrary canonical values. Every collection we serialize sorts by an explicit key
 * and then tie-breaks with this, so that two items with equal keys still land in a fixed order
 * rather than whichever order the probe stage happened to produce.
 */
export function compareCanonical(a: unknown, b: unknown): number {
  return byCodeUnit(canonicalize(a), canonicalize(b));
}

export { byCodeUnit };
