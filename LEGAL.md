# Legal: open questions for counsel

This document exists to be answered, not to stand as an answer. Nothing here is legal advice, and
nothing here asserts that the activity described is lawful in any particular jurisdiction. Items are
open until counsel closes them in writing and the closure is recorded here with a date.

**No live probing of third-party servers should begin until items 1 and 5 are closed.** Stage 1
(`discover`) contacts no MCP server and is a separate question.

Items 1 and 2 were narrowed by changing the design rather than by buying a broader opinion. v1
surveys only endpoints operators published in a public directory, and retains no raw captures at
all. Both narrowings cost something, and what they cost is recorded against each item.

## 1. Lawfulness of unsolicited connections

**Narrowed.** v1 surveys the official MCP registry: endpoints whose operators published them in a
public directory so that MCP clients would connect to them. The question is therefore not "may we
scan arbitrary internet hosts" but the much smaller one:

> May we connect, as an ordinary MCP client, to an endpoint its operator listed in a public registry
> for the purpose of clients connecting to it, sending only the two calls every client sends and
> stopping at any credential challenge?

Certificate-transparency discovery stays implemented and is off by default; `--all-candidates`
restores it, and with it the broader question below, which should be answered first. The cost of the
restriction is a real skew toward registry-participating organizations, declared as a discovery bias
in every report.

The broader question, retained for when it is needed:

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

**Largely closed by design: v1 retains nothing.** There is no raw tier. A capture holds a byte count
rather than a body, `Set-Cookie` is never recorded, and everything lives in memory for one probe and
dies with the process. Nothing writes a response body to disk, and a test asserts it.

That removes the questions that made this expensive: the defensibility of a 90-day window, the lawful
basis for storing incidental personal data found in tool descriptions, the sufficiency of
scrub-on-ingest, and the breach exposure of a private raw tier. It was cheaper to stop needing the
answers than to buy them.

The cost: a classifier correction cannot be re-derived against old raw data, so it applies only to
future snapshots. Reintroducing a raw tier reopens every question above.

What remains, and is much smaller:

- Does transient in-memory processing of incidental personal data during a probe create any
  obligation, given that nothing is stored and nothing is published?
- Does the derived tier -- tool names and schema shapes, descriptions never retained -- count as
  personal data in any target jurisdiction? Overlaps item 3.

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

**Closed by adoption.** `DISCLOSURE.md` follows the CERT/CC Coordinated Vulnerability Disclosure
model and its 45-day default, rather than a bespoke policy of our own. That was the cheapest
available answer and also the better one: nobody has to evaluate a policy they already recognise,
and the CERT/CC reporter templates are explicitly offered to be adapted.

The departures are enumerated in `DISCLOSURE.md` itself rather than left implicit — chiefly that the
clock governs whether a *specific* finding may be discussed publicly, not whether an organisation
appears in the published statistics, since aggregate output names nobody either way.

Residual questions, much smaller than the original:

- Is 45 days appropriate given that this survey reports preconditions rather than confirmed
  vulnerabilities? CERT/CC's rationale is partly to motivate a fix; here there is often nothing to
  fix, so the deadline may be doing less work than it appears to.
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
| 1 | Unsolicited connections | **OPEN** — narrowed to registry-published endpoints | — | — |
| 2 | Raw retention | **CLOSED BY DESIGN** — no raw tier in v1 | — | — |
| 3 | Dataset publication | **OPEN** | — | — |
| 4 | Disclosure timeline | **CLOSED BY ADOPTION** — CERT/CC model, 45-day default | — | — |
| 5 | Identity and representations | **OPEN** | — | — |
| 6 | Publisher's interest | **OPEN** | — | — |
