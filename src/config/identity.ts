/**
 * Who this scanner says it is.
 *
 * Constraint 3 ("identify yourself") lives here. There are two identity channels and both matter:
 * the User-Agent header, which lands in an operator's HTTP logs, and `clientInfo` in the MCP
 * `initialize` params, which lands in their MCP server logs. A scanner that sets only the first is
 * invisible to exactly the person most likely to want to know who connected.
 */

export const PROJECT_NAME = 'mcp-observatory';

export const PROJECT_VERSION = '0.1.0-alpha.1';

/** Must resolve. See {@link isPlaceholderIdentity} and the preflight check. */
export const CONTACT_URL = 'https://github.com/invokesmith/mcp-observatory';

/** The opt-out instructions an operator reads. Must resolve before any live probing. */
export const OPT_OUT_URL = 'https://github.com/invokesmith/mcp-observatory/blob/main/OPTOUT.md';

/**
 * A monitored mailbox, or null.
 *
 * Preflight checks that this address's domain has an MX record, because publishing an address on a
 * domain that accepts no mail is the failure this project already shipped once. Note what that check
 * does NOT establish: an MX record proves the domain receives mail, not that this particular
 * mailbox or alias exists, and certainly not that anyone reads it. Nothing automated can establish
 * the last part. The opt-out promise in OPTOUT.md is a commitment by a person, and the check below
 * only rules out the most embarrassing way of breaking it.
 */
export const CONTACT_EMAIL: string | null = 'observatory@forgestack.dev';

/**
 * OpenPGP fingerprint for {@link CONTACT_EMAIL}, or null when no key is published yet.
 *
 * Null rather than a plausible-looking value, for the same reason {@link CONTACT_EMAIL} was null
 * before a mailbox existed: a disclosure policy that advertises encryption it cannot accept is worse
 * than one that advertises none, because a reporter encrypts a real finding to a key nobody holds.
 *
 * Setting this makes preflight check that the published key file exists and matches, and allows
 * DISCLOSURE.md to promise a key at all — a test fails if the document promises one and this is null.
 */
export const PGP_FINGERPRINT: string | null = 'ACB33098A000E6155313C35AD6C759655BBA418A';

/** Where the ASCII-armoured public key lives in this repository, once there is one. */
export const PGP_KEY_PATH = 'security/observatory-pubkey.asc';

/** The self-service opt-out path an operator can serve without asking us. */
export const WELL_KNOWN_OPT_OUT_PATH = '/.well-known/mcp-scan-optout';

/**
 * Sent on every single request. The `+url` form is the convention large-scale internet scanners use
 * so that an operator reading a log line can get to a human in one step.
 */
export const USER_AGENT = `${PROJECT_NAME}/${PROJECT_VERSION} (+${CONTACT_URL})`;

/** Sent in MCP `initialize`. Same identity, second channel. */
export const CLIENT_INFO = Object.freeze({
  name: PROJECT_NAME,
  version: PROJECT_VERSION,
  title: `MCP Observatory (passive posture survey — ${CONTACT_URL})`,
});

/**
 * Hosts that must never be contacted are checked against the opt-out list, not against this. This is
 * the narrower question of whether our own identity is real yet: a scanner whose contact URL 404s is
 * worse than one with no User-Agent at all, because it looks like someone impersonating a research
 * project.
 */
export function isPlaceholderIdentity(): boolean {
  return (
    CONTACT_URL.includes('EXAMPLE') ||
    CONTACT_URL.includes('.invalid') ||
    CONTACT_URL.includes('example.com')
  );
}
