/**
 * Constraint 5. Two opt-out mechanisms, checked in this order:
 *
 *   1. The published list (`optout.txt`) — costs zero contact, so it is checked first.
 *   2. `/.well-known/mcp-scan-optout` on the server itself — costs one GET to discover.
 *
 * The second exists because an opt-out that requires registering with the scanner is a weak
 * opt-out. The honest cost of honoring it is documented in OPTOUT.md rather than buried: you cannot
 * ask permission without making contact.
 */
import { getDomain } from 'tldts';

export type OptOutScope = 'host' | 'domain';

export type OptOutDecision =
  | { readonly kind: 'opted-out'; readonly source: 'list' | 'well-known'; readonly scope: OptOutScope }
  | { readonly kind: 'clear' }
  /**
   * Neither opted out nor cleared. A timeout, 5xx, DNS failure or unparseable body means we do not
   * know what the operator wants, and a flaky server is not consent. Deferred targets are neither
   * probed nor counted as opted out, and the deferred count is published so the sample's
   * incompleteness stays visible.
   */
  | { readonly kind: 'undetermined'; readonly reason: string };

/** Max age of our opt-out data before the scanner refuses to probe at all. Constraint 5's 24h SLA. */
export const OPT_OUT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface OptOutList {
  /** Lowercased hosts and registrable domains, from optout.txt. */
  readonly entries: ReadonlySet<string>;
  /** When this list was read. Used for the staleness check. */
  readonly fetchedAt: number;
}

export function parseOptOutList(text: string, fetchedAt: number): OptOutList {
  const entries = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    entries.add(line.toLowerCase());
  }
  return { entries, fetchedAt };
}

/**
 * Registrable domain under ICANN suffixes only, e.g. `eu.mcp.example.co.uk` -> `example.co.uk`.
 * Offline; no network.
 *
 * This is the BROAD reading, and it is the right one for opt-out matching and for rate limiting:
 * `alice.workers.dev` collapses to `workers.dev`, so one opt-out entry covers more hosts and one
 * politeness slot covers more traffic. Both errors run in the safe direction — we contact fewer
 * people than we might have been entitled to.
 *
 * It is the WRONG reading for counting organizations. See {@link organizationDomain}.
 */
export function registrableDomain(host: string): string | null {
  return getDomain(host);
}

/**
 * The precise reading, for deciding what counts as one organization.
 *
 * The Public Suffix List has a private section in which platforms register themselves precisely so
 * that their tenants are treated as separate sites — `workers.dev`, `vercel.app`, `github.io`.
 * `tldts` ignores that section by default, which is why a first version of this code collapsed 427
 * unrelated Cloudflare Workers tenants into a single "organization" and would have counted them as
 * one data point.
 *
 * The asymmetry with {@link registrableDomain} is deliberate: when deciding whom to contact, err
 * broad and contact fewer people; when counting, count precisely.
 *
 * `sharedPlatforms` supplements the PSL for platforms that have not registered there — see
 * `rules/shared-platforms.json`. Every entry in that file is a candidate PSL submission.
 */
export function organizationDomain(
  host: string,
  sharedPlatforms: ReadonlySet<string> = new Set(),
): string | null {
  const lower = host.toLowerCase();

  // A platform the PSL does not know about: keep the full host, since each name is a tenant.
  const icann = getDomain(lower);
  if (icann !== null && sharedPlatforms.has(icann)) return lower;

  const precise = getDomain(lower, { allowPrivateDomains: true });
  if (precise !== null) return precise;

  return icann;
}

/**
 * A list entry matches the host itself or any of its parent registrable domains, so one
 * `example.com` entry covers every subdomain without the operator enumerating them.
 */
export function isOnList(list: OptOutList, host: string): boolean {
  const lower = host.toLowerCase();
  if (list.entries.has(lower)) return true;
  const domain = registrableDomain(lower);
  return domain !== null && list.entries.has(domain);
}

export function isListStale(list: OptOutList, now: number): boolean {
  return now - list.fetchedAt > OPT_OUT_MAX_AGE_MS;
}

/**
 * Interpret a `/.well-known/mcp-scan-optout` response.
 *
 * The content-type requirement is load-bearing rather than fussy. A great many hosts answer 200 with
 * an HTML page for every unknown path; treating any 200 as an opt-out would silently drop a large,
 * non-random slice of the population out of the sample — harming the survey without any operator
 * intending it. So an HTML catch-all is explicitly *not* an opt-out.
 */
export function interpretWellKnown(
  status: number,
  contentType: string | null,
  body: string,
): OptOutDecision {
  if (status === 404 || status === 410) return { kind: 'clear' };

  if (status !== 200) {
    return { kind: 'undetermined', reason: `HTTP ${status}` };
  }

  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

  if (type === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return { kind: 'undetermined', reason: 'declared JSON but did not parse' };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { kind: 'undetermined', reason: 'JSON body was not an object' };
    }
    const doc = parsed as { optout?: unknown; scope?: unknown };
    if (doc.optout === false) {
      // An explicit opt-in. Treated as "no preference expressed" rather than as permission, since
      // this survey does not rely on anyone's permission to read a public declaration.
      return { kind: 'clear' };
    }
    if (doc.optout !== true) {
      return { kind: 'undetermined', reason: 'JSON body had no boolean "optout" field' };
    }
    const scope: OptOutScope = doc.scope === 'domain' ? 'domain' : 'host';
    return { kind: 'opted-out', source: 'well-known', scope };
  }

  if (type === 'text/plain') {
    if (body.trim().toLowerCase() === 'optout') {
      return { kind: 'opted-out', source: 'well-known', scope: 'host' };
    }
    return { kind: 'undetermined', reason: 'text/plain body was not exactly "optout"' };
  }

  return {
    kind: 'undetermined',
    reason: `content-type ${type || '(absent)'} is not application/json or text/plain; ` +
      'a catch-all 200 is not an opt-out',
  };
}
