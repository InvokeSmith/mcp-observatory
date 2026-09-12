/**
 * Stage 1. Build a candidate list. Contacts no MCP server.
 *
 * The only outbound traffic here is to the discovery sources themselves — certificate-transparency
 * logs and public registries — and it still goes through the gate, because "the gate is the only
 * code that reaches the network" is not a rule worth having if it has an exception for the
 * convenient case.
 *
 * The design decision that matters most is the last one: deduplicating by ORGANIZATION rather than
 * by hostname. One company with four regional endpoints is one data point, or every server-level
 * statistic is silently weighted by how many subdomains a company happens to run.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalHash } from '../canon/json.js';
import { organizationDomain } from '../net/optout.js';
import { TargetTicket } from '../net/ticket.js';
import type { Gate } from '../net/gate.js';

export type SourceId = 'ct' | 'registry' | 'path-candidate' | 'seed';

export type Confidence = 'primary' | 'lower';

export interface Candidate {
  readonly host: string;
  readonly path: string;
  readonly source: SourceId;
  readonly confidence: Confidence;
  /**
   * Did the operator publish this endpoint themselves, in a public directory, so that clients would
   * connect to it?
   *
   * This is the most consequential field in the record, and it is not a confidence score. A registry
   * listing is an operator saying "connect to this"; a hostname inferred from a certificate log is
   * us guessing. The difference is the basis on which v1 restricts its population — see LEGAL.md
   * item 1 — so it is recorded per candidate rather than assumed per source at read time.
   */
  readonly operatorPublished: boolean;
  /** Free-text note about where exactly this came from. Kept for auditability. */
  readonly provenance: string;
}

export interface Organization {
  readonly orgKey: string;
  /** Opaque and stable: a hash of the registrable domain. The derived tier never holds a hostname. */
  readonly registrableDomain: string;
  readonly candidates: readonly Candidate[];
  /** Every hostname collapsed into this organization, so the collapse can be audited. */
  readonly collapsedFrom: readonly string[];
}

export interface DiscoverManifest {
  readonly manifestHash: string;
  readonly organizations: readonly Organization[];
  /** Distinct (host, path) pairs. The real population size. */
  readonly candidateCount: number;
  /** How many of those the operator published themselves. The basis of the v1 restriction. */
  readonly operatorPublishedCount: number;
  /**
   * True when any source stopped at our page cap rather than running out. A truncated walk of a
   * name-ordered cursor is an alphabetical prefix, not a sample, and every downstream figure
   * inherits that. Carried into the report rather than noticed later.
   */
  readonly truncated: boolean;
  /** Rows before deduplication. Kept only so the ratio is visible rather than flattering. */
  readonly rawRowCount: number;
  readonly sources: readonly (readonly [SourceId, number])[];
}

/**
 * Reserved and private-use suffixes (RFC 2606, RFC 6761, RFC 8375) plus the conventional local ones.
 * Certificate logs carry plenty of these. They are never publicly reachable, so including them would
 * pad the discovered population with hosts guaranteed to record as `unreachable` — inflating the
 * denominator of every server-level statistic with entries that were never candidates at all.
 */
const NON_ROUTABLE_SUFFIXES: readonly string[] = [
  '.local', '.localhost', '.internal', '.intranet', '.private', '.corp', '.home',
  '.home.arpa', '.lan', '.test', '.example', '.invalid', '.arpa', '.onion',
];

export function isRoutableHost(host: string): boolean {
  const lower = host.toLowerCase();
  return !NON_ROUTABLE_SUFFIXES.some((suffix) => lower === suffix.slice(1) || lower.endsWith(suffix));
}

export interface SharedPlatformRules {
  readonly version: string;
  readonly platforms: readonly string[];
}

export async function loadSharedPlatforms(dir = 'rules'): Promise<SharedPlatformRules> {
  return JSON.parse(await readFile(join(dir, 'shared-platforms.json'), 'utf8')) as SharedPlatformRules;
}

/** Certificate transparency. The primary source, and free. */
export async function discoverFromCertificateTransparency(
  gate: Gate,
  patterns: readonly string[] = ['mcp.%', '%-mcp.%', 'mcp-%'],
): Promise<readonly Candidate[]> {
  const candidates: Candidate[] = [];

  for (const pattern of patterns) {
    const url = `https://crt.sh/?q=${encodeURIComponent(pattern)}&output=json`;
    const ticket = new TargetTicket(
      `discover:crt.sh:${pattern}`,
      'https://crt.sh',
      '/',
      'http-metadata',
      new Set(['GET']),
      2,
    );

    let rows: readonly { name_value?: string }[];
    try {
      const response = await gate.fetch(ticket, url, { method: 'GET' });
      if (!response.ok) continue;
      rows = (await response.json()) as readonly { name_value?: string }[];
    } catch {
      // A discovery source being down is a smaller problem than a discovery source being trusted
      // blindly. Skip it; the manifest records which sources contributed.
      continue;
    }

    for (const row of rows) {
      for (const raw of (row.name_value ?? '').split('\n')) {
        const host = raw.trim().toLowerCase();
        if (host === '' || host.startsWith('*.')) continue;
        if (!/^[a-z0-9.-]+$/.test(host)) continue;
        candidates.push({
          host,
          path: '/mcp',
          source: 'ct',
          confidence: 'primary',
          // A certificate log tells us a name exists. It does not tell us the operator wanted
          // anyone to connect, and the path is our guess rather than their declaration.
          operatorPublished: false,
          provenance: `crt.sh q=${pattern}`,
        });
      }
    }
  }

  return candidates;
}

interface RegistryEntry {
  readonly server?: {
    readonly name?: string;
    readonly version?: string;
    readonly remotes?: readonly { readonly type?: string; readonly url?: string }[];
  };
  readonly _meta?: Readonly<Record<string, { readonly status?: string; readonly isLatest?: boolean }>>;
}

const REGISTRY_META_KEY = 'io.modelcontextprotocol.registry/official';

/** Remote transports we can actually speak. A stdio package is not a reachable endpoint. */
const REACHABLE_REMOTE_TYPES = new Set(['streamable-http', 'sse']);

/**
 * The official MCP registry.
 *
 * This is the v1 population, and the reason is not coverage — it is narrower than certificate
 * transparency, not wider. It is that a registry entry is the operator publishing an endpoint in a
 * public directory precisely so that clients will connect to it. That makes connecting a much
 * easier question than connecting to a hostname we inferred from a certificate, which is why
 * LEGAL.md item 1 shrinks so much when the population is restricted this way.
 *
 * The cost is a real skew toward organizations that participate in registries, which is a discovery
 * bias like any other and is declared as one.
 */
export interface SourceResult {
  readonly candidates: readonly Candidate[];
  /**
   * True when we stopped because of our own page cap rather than because the source ran out.
   *
   * This must never be silent. The registry cursor is ordered by server name, so a run that stops
   * early does not return a sample — it returns an alphabetical prefix. A first version of this code
   * capped at 50 pages against a registry of more than 20,000 entries and reported the result as a
   * population, which is precisely the kind of artifact this project exists to catch.
   */
  readonly truncated: boolean;
  readonly pagesFetched: number;
}

export async function discoverFromRegistry(
  gate: Gate,
  baseUrl = 'https://registry.modelcontextprotocol.io',
  maxPages = 2000,
): Promise<SourceResult> {
  const candidates: Candidate[] = [];
  const origin = new URL(baseUrl).origin;

  const ticket = new TargetTicket(
    'discover:mcp-registry',
    origin,
    '/v0/servers',
    'http-metadata',
    new Set(['GET']),
    maxPages + 2,
  );


  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;

  for (;;) {
    const url = new URL('/v0/servers', origin);
    url.searchParams.set('limit', '100');
    if (cursor !== undefined) url.searchParams.set('cursor', cursor);

    let payload: {
      servers?: readonly RegistryEntry[];
      metadata?: { nextCursor?: string };
    };
    try {
      const response = await gate.fetch(ticket, url.href, { method: 'GET' });
      if (!response.ok) {
        // Stopping short because the source failed is also an incomplete walk, not a complete one.
        truncated = true;
        break;
      }
      payload = (await response.json()) as typeof payload;
    } catch {
      truncated = true;
      break;
    }

    pages += 1;

    for (const entry of payload.servers ?? []) {
      const meta = entry._meta?.[REGISTRY_META_KEY];

      // The registry keeps every published version. Without these two filters the same server
      // arrives once per release, and a prolific publisher silently outweighs everyone else.
      if (meta?.isLatest !== true) continue;
      if (meta.status !== 'active') continue;

      for (const remote of entry.server?.remotes ?? []) {
        if (remote.type === undefined || !REACHABLE_REMOTE_TYPES.has(remote.type)) continue;
        if (remote.url === undefined) continue;

        let parsed: URL;
        try {
          parsed = new URL(remote.url);
        } catch {
          continue;
        }
        if (parsed.protocol !== 'https:') continue;

        candidates.push({
          host: parsed.hostname.toLowerCase(),
          // The operator's own path, not one we guessed.
          path: parsed.pathname === '' ? '/' : parsed.pathname,
          source: 'registry',
          confidence: 'primary',
          operatorPublished: true,
          provenance: `mcp-registry ${entry.server?.name ?? 'unknown'}@${entry.server?.version ?? '?'} (${remote.type})`,
        });
      }
    }

    const next = payload.metadata?.nextCursor;
    if (next === undefined) break;
    // A cursor we have already followed is a loop, not a page.
    if (seenCursors.has(next)) break;
    if (pages >= maxPages) {
      truncated = true;
      break;
    }
    seenCursors.add(next);
    cursor = next;
  }

  return { candidates, truncated, pagesFetched: pages };
}

/**
 * For domains already known to serve APIs. Lower confidence and marked as such, because a candidate
 * generated by guessing a path is a guess, and the report says which figures rest on guesses.
 */
export function pathCandidates(domains: readonly string[]): readonly Candidate[] {
  const paths = ['/mcp', '/api/mcp', '/sse'];
  return domains.flatMap((domain) =>
    paths.map((path) => ({
      host: domain,
      path,
      source: 'path-candidate' as const,
      confidence: 'lower' as const,
      operatorPublished: false,
      provenance: `generated path candidate for ${domain}`,
    })),
  );
}

/**
 * Collapse hostnames to organizations.
 *
 * `eu.mcp.acme.com` and `us.mcp.acme.com` are Acme, once. The org key is a hash rather than the
 * domain so that the derived tier — which is published — never carries a hostname at all.
 */
export async function collapseToOrganizations(
  candidates: readonly Candidate[],
  sharedPlatforms: readonly string[] = [],
): Promise<readonly Organization[]> {
  const shared = new Set(sharedPlatforms.map((p) => p.toLowerCase()));
  const byDomain = new Map<string, Candidate[]>();

  for (const candidate of candidates) {
    if (!isRoutableHost(candidate.host)) continue;

    // The precise reading. On a shared platform the collapse otherwise runs the wrong way: hundreds
    // of unrelated tenants under one suffix become one data point, silently discarding the rest.
    const key = organizationDomain(candidate.host, shared);

    // No domain at all means no public suffix: a bare internal name like `mcp`, which certificate
    // logs are full of. Not reachable, and not an organization.
    if (key === null) continue;

    const list = byDomain.get(key) ?? [];
    list.push(candidate);
    byDomain.set(key, list);
  }

  const organizations = await Promise.all(
    [...byDomain.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(async ([domain, list]) => {
        const sorted = [...list].sort((a, b) =>
          a.host !== b.host
            ? a.host < b.host
              ? -1
              : 1
            : a.path < b.path
              ? -1
              : a.path > b.path
                ? 1
                : 0,
        );
        const hosts = [...new Set(sorted.map((c) => c.host))].sort();
        return {
          orgKey: (await canonicalHash({ registrableDomain: domain })).slice(0, 16),
          registrableDomain: domain,
          candidates: sorted,
          collapsedFrom: hosts,
        };
      }),
  );

  return organizations;
}

/**
 * Certificate logs return one row per certificate, so the same hostname arrives many times over —
 * in the first live run, 2,839 rows were 142 distinct hosts. Counting rows would overstate the
 * population by a factor of twenty.
 */
/**
 * v1's population restriction. See LEGAL.md item 1.
 */
export function onlyOperatorPublished(candidates: readonly Candidate[]): readonly Candidate[] {
  return candidates.filter((candidate) => candidate.operatorPublished);
}

export function deduplicate(candidates: readonly Candidate[]): readonly Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = `${candidate.host}|${candidate.path}`;
    const existing = seen.get(key);
    // Keep the highest-confidence provenance for a host we saw from several sources.
    if (existing === undefined || (existing.confidence === 'lower' && candidate.confidence === 'primary')) {
      seen.set(key, candidate);
    }
  }
  return [...seen.values()];
}

export async function buildDiscoverManifest(
  candidates: readonly Candidate[],
  sharedPlatforms: readonly string[] = [],
  truncated = false,
): Promise<DiscoverManifest> {
  const deduped = deduplicate(candidates);
  const organizations = await collapseToOrganizations(deduped, sharedPlatforms);

  const sourceCounts = new Map<SourceId, number>();
  for (const candidate of deduped) {
    sourceCounts.set(candidate.source, (sourceCounts.get(candidate.source) ?? 0) + 1);
  }

  const manifestHash = await canonicalHash(
    organizations.map((org) => [
      org.orgKey,
      org.candidates.map((c) => [c.host, c.path, c.source] as const),
    ]),
  );

  return {
    manifestHash,
    organizations,
    candidateCount: deduped.length,
    operatorPublishedCount: deduped.filter((c) => c.operatorPublished).length,
    truncated,
    rawRowCount: candidates.length,
    sources: [...sourceCounts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  };
}
