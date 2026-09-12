# mcp-observatory

A passive posture survey of publicly reachable MCP servers.

It connects to a server the way any MCP client does, calls exactly two methods — `initialize` and
`tools/list` — records what the server *declares*, and disconnects. **It never invokes a tool.**

This is a research instrument and a publication pipeline. It is not a security product, not a
vulnerability scanner, and not a lead-generation tool.

## Conflict of interest

This survey is published by **InvokeSmith**, which sells outcome verification for consequential MCP
actions — including the exact risk class this survey measures. Its flagship benchmark case, OG-001,
is "hidden cross-tenant mutation."

We are an interested party. A survey whose result happens to support its publisher's commercial
thesis deserves more scepticism than one that does not, and saying so is the beginning of the
answer rather than the whole of it. Disclosure alone only asks you to discount the result; it gives
you no way to check it. So the design removes the discretion our motive could act through, and makes
each removal checkable:

1. **Preregistration.** [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md) fixes the headline claim, the
   classifier rules, the denominators and the falsification criteria *before* any data is collected.
   Its hash is published first. `report` refuses to run if the rule sets it is given do not match the
   ones the preregistration names, so a post-hoc rule change shows up as a new, later-dated protocol
   rather than a silent edit.
2. **A sensitivity band, not a point estimate.** The headline is recomputed across plausible
   alternative rule choices and the range is published beside the figure. You can see exactly what
   tuning the rules would have bought.
3. **Our product may not appear in the findings.** No generated artifact may name InvokeSmith,
   recommend anything, or carry a call to action. This is enforced by the same linter that enforces
   the honesty rule below, not by editorial restraint.
4. **The inconvenient cuts ship too.** The share of servers correctly gated behind authentication,
   the share of write-capable tools that *do* carry guardrails, and every classifier's undetermined
   rate are emitted unconditionally. A survey that reports only the alarming cut is marketing.

None of this makes interested research unimpeachable. It converts "trust our motive" into "check our
arithmetic," which is the most that is available.

## The honesty rule

The headline claim is:

> X% of write-capable tools expose the caller-supplied-tenant precondition.

It is never:

> X% of servers allow cross-tenant writes.

A caller-supplied tenant parameter is a **precondition, not a vulnerability**. A server may well
derive authorization from the token and reject any mismatch, and most probably do. This scanner
cannot tell the difference, because telling would require calling the tool — which the first
constraint forbids. Any phrasing that elides that gap is a defect, and
[`protocol/publication-language.json`](protocol/publication-language.json) fails the build over it.

## The eight constraints

These are enforced in code and each is covered by a named test in [`tests/constraints/`](tests/constraints/).

1. **Never call `tools/call`.** Connecting and listing tools is what every MCP client does. Invoking
   someone's tool is not. This single rule is the difference between research and unauthorized
   testing.
2. **Stop at the auth wall.** On 401, 403, or any credential challenge: record the posture and move
   on. Never retry with guessed credentials, never attempt a token, never probe past a refusal.
3. **Identify yourself.** Every request carries a User-Agent naming this project and a contact URL,
   and `initialize` carries the same in `clientInfo` — which is what actually lands in an operator's
   logs.
4. **Be gentle.** One connection at a time per operator, a low global concurrency cap, exponential
   backoff on 429 and 5xx, and an immediate permanent skip for any host that returns 429 twice.
5. **Honor opt-out.** A published list, plus a self-service
   [`/.well-known/mcp-scan-optout`](protocol/MCP-SCAN-OPTOUT.md) an operator can use without asking
   us. Checked before every probe. Removal takes effect within 24 hours.
6. **Aggregates only.** Published output names no company.
7. **Retention.** Raw captures stay private with a defined window; only the derived dataset is
   published.
8. **No inference beyond observation.** The scanner reports what a schema *declares*. It never
   labels a server "vulnerable."

### How constraint 1 is actually enforced, and where the gap is

Four layers, weakest last, because the honest ranking matters more than the count:

- **The fixture server is the witness.** Every integration test runs against an in-repo MCP server
  that fails the entire run if any method outside the allowed set arrives on the wire. Its predicate
  is bytes, not source text, so it survives refactors, string concatenation and SDK internals.
- **The wire shape is narrow by construction.** The transport accepts only a small union of message
  shapes, validated at the boundary. `tools/call` is not representable.
- **The client has no invoke path.** `ProbeClient` exposes `initialize()` and `listTools()`. The SDK
  client, which does have `callTool`, is private and never exported.
- **A static scan**, kept as a lint and explicitly *not* a proof: `'tools/' + 'call'` would evade it.

The residual gap, stated plainly: *we never called `tools/call`* is a claim about our bytes. It is
not a claim about whether a given server treats `initialize` or `tools/list` as side-effecting.

## Opting out

Either mechanism works, and neither requires our permission:

- Serve `/.well-known/mcp-scan-optout` — see [the format](protocol/MCP-SCAN-OPTOUT.md).
- Or open an issue, or email the address in [`OPTOUT.md`](OPTOUT.md).

Effective within 24 hours. See [`OPTOUT.md`](OPTOUT.md) for the full process, including the honest
note that honoring a self-service opt-out costs one request to discover it.

## Running it

```bash
bun install
bun run check
bun test
```

The pipeline is four stages, each independently runnable and resumable:

```bash
bun run observatory discover --sources ct       # build a candidate list; contacts no MCP server
bun run observatory probe --run <run-id>        # two protocol calls per host; ends by sealing
bun run observatory classify --snapshot <id>    # pure; no network
bun run observatory report --snapshot <id> --ruleset <id> --optout <id>
```

Every published figure is reproducible from a named snapshot with one command. That is the whole
credibility argument: the rule sets are data files in [`rules/`](rules/), so you can disagree with a
specific rule, change it, and re-run the numbers yourself.

## Limitations

Stated in full in every generated report, before the findings rather than after them. In brief:

- **Discovery bias.** Certificate-transparency matching finds companies that dedicate an `mcp.*`
  subdomain. Companies serving MCP at a path on an existing API host are underrepresented. The
  population is "servers discoverable this way," never "all MCP servers."
- **Schema-only inference.** Everything rests on what a server declares. Declarations may understate
  or overstate real behavior.
- **Precondition, not vulnerability.** Restated above, and in full in every report.
- **Point-in-time.** Every figure belongs to a named, dated snapshot.
- **Undetermined rates.** Reported per classifier, alongside every statistic.

## Legal and disclosure

[`LEGAL.md`](LEGAL.md) lists the open questions for counsel. [`DISCLOSURE.md`](DISCLOSURE.md) is the
coordinated disclosure policy: individual findings go to the affected vendor privately first.

Licensed under Apache-2.0.
