# Legal: open questions for counsel

This document exists to be answered, not to stand as an answer. Nothing here is legal advice, and
nothing here asserts that the activity described is lawful in any particular jurisdiction. Items are
open until counsel closes them in writing and the closure is recorded here with a date.

**No live probing of third-party servers should begin until items 1, 2 and 5 are closed.** Stage 1
(`discover`) contacts no MCP server and is a separate question.

## 1. Lawfulness of unsolicited connections

An MCP `initialize` plus `tools/list` is exactly what any MCP client sends, to a service published
on the public internet, with no authentication attempted and no access control circumvented. That is
the argument. The question for counsel is where it holds and where it does not.

- United States: CFAA "without authorization," read against *Van Buren* and *hiQ v. LinkedIn*. Does
  an unauthenticated, publicly served MCP endpoint carry an implied authorization to connect?
- United Kingdom: Computer Misuse Act 1990 s.1, which turns on unauthorized *access* rather than
  damage.
- Germany: StGB §202a, and whether an endpoint with no access protection is "besonders gesichert."
- Netherlands, France, and other jurisdictions where a substantial number of targets are hosted.
- Does stopping at an authentication challenge (constraint 2) materially strengthen the position?
  Our assumption is yes, and the design depends on that assumption.
- Does honoring a published opt-out plus `/.well-known/mcp-scan-optout` (constraint 5) matter
  legally, or only ethically?

**Practical question:** should the target set be restricted by jurisdiction for the first
publication, and if so, on what basis, given that hosting location and company domicile differ?

## 2. Retention of raw captures

Raw captures hold full response bodies: tool names, descriptions, JSON Schemas, and headers. These
are commercially sensitive, and tool descriptions in the wild may contain personal data (example
values, internal contacts, employee names).

- Is a **90-day** raw retention window defensible? That is the proposed default and it is
  configurable.
- Does GDPR apply to incidental personal data in a tool description, and if so, what is the lawful
  basis — legitimate interest for security research?
- Is a scrub-on-ingest step (removing detected secrets and personal data *before* the raw capture is
  written, not before publication) sufficient, or does it need to be provably lossless in the other
  direction?
- What is the breach-notification exposure if the private raw tier were compromised?

## 3. Publication of the derived dataset

The derived tier contains no response bodies, no hostnames, and no organization names — only
classifier outputs against an organization key.

- Is the derived dataset publishable without consent from surveyed operators?
- **k-anonymity threshold.** Tool names alone can identify a company (`acme_internal_billing_refund`
  names Acme). The proposed rule is that a tool name is published only if it appears on at least
  **k = 5** distinct registrable domains, and that descriptions are never published verbatim — only
  derived features. Is k = 5 defensible? Is the derived-features carve-out sufficient?
- Does an aggregate distribution of open-ended argument surfaces constitute a targeting list, even
  though it names nobody? This is an ethical question as much as a legal one and we want both
  answers.

## 4. Coordinated disclosure

See `DISCLOSURE.md` for the policy as drafted.

- Is the proposed 90-day timeline appropriate, given that this survey reports preconditions rather
  than confirmed vulnerabilities?
- What is the obligation when the hand audit (protocol §7) turns up a server that does appear to
  accept a caller-supplied tenant as authoritative — noting that we would have concluded this from
  public documentation, not from testing it?
- Who is the recipient when a host has no security contact and no `security.txt`?

## 5. The scanner's own identity and representations

- Is "mcp-observatory, a research instrument published by InvokeSmith" the correct self-description
  in the User-Agent and `clientInfo`, and does naming the commercial publisher there create any
  exposure that anonymity would not?
- The contact URL must resolve to a monitored channel before any live probing. The code enforces
  this (preflight fails closed), but the commitment behind it is a human one.

## 6. Publisher's interest

InvokeSmith sells into the risk class this survey measures. The README discloses this and the
protocol constrains the analysis accordingly.

- Are the disclosure and the constraints sufficient, or is an independent reviewer required before
  first publication?
- Does publishing a survey that supports one's own commercial thesis create advertising-standards or
  unfair-competition exposure in any target jurisdiction, particularly the UK and Germany?

## Status

| # | Item | Status | Closed by | Date |
|---|---|---|---|---|
| 1 | Unsolicited connections | **OPEN** | — | — |
| 2 | Raw retention | **OPEN** | — | — |
| 3 | Dataset publication | **OPEN** | — | — |
| 4 | Disclosure timeline | **OPEN** | — | — |
| 5 | Identity and representations | **OPEN** | — | — |
| 6 | Publisher's interest | **OPEN** | — | — |
