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
 * Null rather than a plausible-looking address on purpose. An opt-out channel that does not receive
 * mail is worse than no channel at all: an operator who writes to it believes they have opted out
 * and has not. Until a real mailbox exists, the documented channel is the issue tracker, which
 * demonstrably works and which anyone can verify from outside.
 *
 * Setting this makes preflight check that the domain accepts mail at all.
 */
export const CONTACT_EMAIL: string | null = null;

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
