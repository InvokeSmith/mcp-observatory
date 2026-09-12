# mcp-observatory: preregistered survey protocol

Version `0.1.0` — **preregistration, written before any data was collected.**

Published by InvokeSmith, an interested party. See the Conflict of interest section of the README;
the controls it describes are binding on this protocol.

The purpose of registering this document first, and publishing its hash before the dataset, is to
close the main discretion an interested party has: choosing the analysis after seeing which cut
flatters the thesis. If a rule set changes after data exists, it appears as a new, later-dated
protocol with a different hash. It does not appear as an edit.

## 1. The question

Of MCP tools that appear to be write-capable, what share accept a parameter by which the *caller*
selects which account, tenant, or workspace is acted upon?

That property is a structural precondition for cross-tenant action. No figure for it has been
published. This survey produces one.

## 2. Scope and non-claims

This survey measures:

- What MCP servers discoverable by the method in §3 *declare* in their tool schemas.
- The authentication posture those servers present to an unauthenticated client.
- The share of write-capable tools declaring a caller-supplied tenant selector, under two named rule
  sets (strict and inclusive).
- The rate at which each classifier cannot decide.

This survey does **not** measure, and its output may not be read as:

- That any server permits cross-tenant writes. Determining that would require invoking a tool, which
  §5 forbids. **The measured property is a precondition, not a vulnerability.**
- That any server is insecure, misconfigured, or vulnerable.
- That servers derive authorization from a caller-supplied parameter. Most probably derive it from
  the token and reject mismatches. This survey cannot distinguish the two cases.
- Anything about MCP servers that are not publicly reachable, or that are reachable but not
  discoverable by §3.
- Anything about server behavior, only about server declarations.
- Demand for any product, including the publisher's.

## 3. Population and discovery

The population is **servers discoverable by the methods below**, which is not "all MCP servers" and
must never be described as such.

| Source | Method | Confidence |
|---|---|---|
| Certificate transparency | CT log hostnames matching `mcp.*`, `*-mcp.*`, `mcp-*.*` | primary |
| Public MCP registries | The official registry and public directories | primary |
| Path candidates | `/mcp`, `/api/mcp`, `/sse` on domains already known to serve APIs | lower |
| Published lists | Existing public datasets, provenance recorded per host | lower |

**Known discovery bias, registered in advance:** CT matching finds organizations that dedicate an
`mcp.*` subdomain. Organizations serving MCP at a path on an existing API host are systematically
underrepresented. This bias is stated in every published report.

**Unit of analysis.** Hosts are collapsed to organizations by registrable domain before any
server-level statistic is computed; the collapse is recorded per host and is auditable. One company
with four regional endpoints is one data point. Tool-level statistics use tools as the unit and say
so. Every figure names its denominator.

## 4. Measures

Every classifier is tri-state — `yes`, `no`, or `undetermined` — and records which signal decided.
The undetermined rate is published beside every statistic. A classifier that forces a binary is
producing fiction.

**Write capability**, decided in this precedence: (1) `readOnlyHint` / `destructiveHint` /
`idempotentHint` annotations where present; (2) mutation verbs in the tool name; (3) mutation verbs
in the first sentence of the description. A substantial undetermined share is expected.

**Caller-supplied tenant selector**, over write-capable tools only, reported as two figures:

- **Strict**: `account_id`, `tenant_id`, `workspace_id`, `org_id`, `organization_id`, `customer_id`,
  `owner_id`, `team_id`, `merchant_id`, `store_id`, `site_id` and their camelCase forms.
- **Inclusive**: strict, plus `user_id` and `project_id`, which may be intra-tenant rather than
  tenant-selecting.

Both are published. Neither is "the" answer.

**Secondary measures**: annotation mismatch (`readOnlyHint: true` on a tool whose name or description
implies mutation); write-capable tools lacking any idempotency key, confirmation, or dry-run
parameter; open-ended argument surface (raw SQL, arbitrary URL, file path, shell command, or
unconstrained strings with no enum, pattern, or length bound); schema hygiene; auth and exposure
posture.

**Registered counter-measures** — figures that cut against the publisher's thesis, emitted
unconditionally: the share of servers correctly gated behind authentication, and the share of
write-capable tools that *do* carry guardrails.

The exact rule lists live in [`rules/`](../rules/) as versioned data files and are hashed into every
report. Disagreement with a specific rule is a supported activity: change the file, re-run, get your
own number.

## 5. Conduct

Binding on every run:

1. `tools/call` is never sent.
2. A credential challenge ends the interaction with that host.
3. Every request identifies the project and a contact URL, in both the User-Agent and `clientInfo`.
4. One connection at a time per operator; global concurrency capped; backoff on 429 and 5xx; two 429s
   is a permanent skip.
5. The published opt-out list and `/.well-known/mcp-scan-optout` are honored, checked before contact.
6. Published output names no organization.
7. Raw captures are private and time-limited; only derived data is published.
8. No claim beyond what a schema declares.

## 6. Statistical reporting

Every figure is published as numerator, denominator, undetermined count, and a Wilson 95% confidence
interval. Bare percentages are rejected by the report linter.

Each headline figure is additionally recomputed across the registered rule variants (strict vs.
inclusive tenant list, verb-list variants, annotation-precedence variants) and the **range is
published beside the point estimate**.

## 7. What would falsify the headline

Registered in advance, with the response committed in advance.

**The hand audit.** After the survey, 20 servers exhibiting the caller-supplied-tenant precondition
are selected by a rule fixed here — every tenth server in snapshot order, starting from the first —
and their public documentation is read to determine whether tenancy is derived from the token and
mismatches rejected.

| Audit result | What it means | What we publish |
|---|---|---|
| Nearly all derive tenancy from the token and reject mismatches | The precondition is idiomatic API design, not latent risk | We say so, in the headline position. The finding becomes "this is how MCP tools are built," which is interesting architecture and not interesting risk. The survey is still published. |
| A meaningful share accept the caller's value as authoritative | The precondition sometimes is the thing it looks like | Affected vendors are contacted privately first under `DISCLOSURE.md`; only aggregates are published |
| Documentation is insufficient to tell in most cases | The question is not answerable from outside | We say that, and the headline is explicitly downgraded to a structural observation |

The audit result is published whichever way it falls. Committing to that here, before the data
exists, is the point of this document.

## 8. Required publication language

Allowed, after a qualifying result:

> Across the named snapshot, X% of tools classified write-capable (n = N, undetermined = U, 95% CI
> [lo, hi]) declare a parameter by which the caller selects the account, tenant, or workspace acted
> upon. This is a structural precondition for cross-tenant action. It is not evidence that any
> server permits one; servers may derive authorization from the token and reject mismatches, and
> this survey cannot distinguish the two cases.

Disallowed, and enforced by
[`publication-language.json`](publication-language.json) against every generated artifact:

- "X% of servers allow cross-tenant writes."
- Any description of a surveyed server as vulnerable, insecure, exposed, or at risk.
- Any per-company figure, ranking, grade, or score.
- Any naming of a surveyed organization.
- Any mention of the publisher's product, any recommendation, any call to action.
- Any bare percentage without its denominator and undetermined count.

## 9. Amendments

This protocol is versioned. Changes after data collection require a new version with a new hash and a
changelog entry stating what changed and why. The prior version stays in the repository. Reports name
the protocol version they were generated under.
