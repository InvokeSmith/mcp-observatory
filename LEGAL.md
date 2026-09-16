# Legal: open questions for counsel

This document exists to be answered, not to stand as an answer. Nothing here is legal advice, and
nothing here asserts that the activity described is lawful in any particular jurisdiction. Items are
open until counsel closes them in writing and the closure is recorded here with a date.

Items 1 and 2 were narrowed by changing the design rather than by buying a broader opinion. v1
surveys only endpoints operators published in a public directory, and retains no raw captures at
all. Both narrowings cost something, and what they cost is recorded against each item.

## Status of live probing

The original standard recorded here was that **no live probing of third-party servers should begin
until items 1 and 5 are closed.** That standard is kept below rather than removed, because a document
that drops its own precondition once the precondition becomes inconvenient is worth nothing, and this
repository is public — the edit is visible either way.

What actually happened:

**2026-09-13, 02:39:55Z to 02:39:59Z. Five hosts contacted. Items 1 and 5 were open, and remain
open.**

| | |
|---|---|
| Targets attempted | 5, bounded by an explicit `--limit 5` |
| Targets discovered but not attempted | 19,099, recorded in the snapshot as `not-attempted` |
| Outcomes | 2 `open`, 2 `gated`, 1 `optout-undetermined` |
| Tool schemas collected | 5 |
| Snapshot | `440b66440eb1d766` |

The run was a bounded first exercise of the pipeline, not a survey. The candidate-limit flag it used
was added in the commit immediately preceding it, which is the clearest available evidence that the
bound was deliberate rather than incidental.

The design controls all behaved as specified: the two hosts that answered with a credential challenge
were recorded as terminal and not contacted again, the one host whose opt-out status could not be
determined was deferred rather than probed, the population was restricted to registry-published
endpoints, identity preflight passed, and no raw capture was retained.

**None of that closes items 1 or 5.** Controls functioning as designed is evidence that the design is
implemented, not evidence that the activity is lawful in any jurisdiction, and a small run is not a
different legal question from a large one — only a smaller instance of the same one. Nothing here
should be read as counsel having approved anything, because counsel has not been consulted.

What this changes going forward:

- **The full survey population has not been probed and should not be until items 1 and 5 close.**
  19,099 discovered targets remain unattempted, and that is the decision this standard now governs.
- **Five organisations are now data subjects of this project**, and everything owed to them applies
  from the date above: the opt-out guarantee in `OPTOUT.md`, and the coordinated disclosure policy in
  `DISCLOSURE.md`, whose 45-day clock runs from first contact should anything specific arise.
- **The preflight gate did not prevent this and was never meant to.** It verifies our own identity
  resolves. There is no code-level gate on the legal items, because a legal question is not the kind
  of thing a program can check — which is worth stating plainly rather than leaving someone to infer
  that a passing preflight means more than it does.

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

**Partly resolved.** `observatory@forgestack.dev` was set up on 2026-09-16 and the domain carries
5 MX records, so the opt-out and disclosure channels promised in `OPTOUT.md` and `DISCLOSURE.md` now
have somewhere to arrive. What remains under this item:

- No OpenPGP key is published. `DISCLOSURE.md` promised one before first live probing and probing
  began on 2026-09-13 without it. The document now states the true position rather than the intended
  one, and a test prevents it from promising a key that `src/config/identity.ts` does not declare.
- Whether naming a commercial publisher in the User-Agent and `clientInfo` creates exposure that
  anonymity would not remains open, and is the part that actually needs counsel.

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
| 1 | Unsolicited connections | **OPEN** — narrowed to registry-published endpoints; 5 hosts contacted 2026-09-13 while open | — | — |
| 2 | Raw retention | **CLOSED BY DESIGN** — no raw tier in v1 | — | — |
| 3 | Dataset publication | **OPEN** | — | — |
| 4 | Disclosure timeline | **CLOSED BY ADOPTION** — CERT/CC model, 45-day default | — | — |
| 5 | Identity and representations | **OPEN** — URLs and mailbox live; no PGP key; representations question unanswered | — | — |
| 6 | Publisher's interest | **OPEN** | — | — |

## Amendments

This document is versioned in git and amendments are recorded here rather than applied silently,
mirroring the discipline in `protocol/PROTOCOL.md` §9.

| Date | Change |
|---|---|
| 2026-09-16 | Contact mailbox observatory@forgestack.dev set up. PGP key still outstanding; DISCLOSURE.md corrected to state the true position. |
| 2026-09-16 | Recorded that live probing began on 2026-09-13 against 5 hosts while items 1 and 5 were open. The original standard is retained rather than relaxed. |
| 2026-09-16 | Item 4 closed by adopting the CERT/CC disclosure model and its 45-day default. |
| 2026-09-12 | Items 1 and 2 narrowed by design: registry-only population, no raw tier. |
