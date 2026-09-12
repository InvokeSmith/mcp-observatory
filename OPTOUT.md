# Opting out

Two mechanisms. Either is sufficient, and neither requires our permission or our agreement.

## 1. Self-service, from your own server

Serve a document at:

```
/.well-known/mcp-scan-optout
```

The format is specified in [`protocol/MCP-SCAN-OPTOUT.md`](protocol/MCP-SCAN-OPTOUT.md). The minimum
viable version is a file containing the single word `optout` served as `text/plain`.

We check this before every probe. If it says opt out, we record that fact and make **zero** MCP
calls to that server.

### The honest note

You cannot ask permission without making contact. Honoring a self-service opt-out costs exactly one
unauthenticated GET to a static path, in order to learn that a server wants none. That is strictly
less contact than probing would be, but it is not zero, and we would rather say so here than have
you discover it in your logs.

If you want *no* contact at all, use mechanism 2 — the published list is checked first, and a host on
it is never contacted by any stage.

## 2. The published list

`optout.txt` in this repository. Entries are one host or registrable domain per line. A registrable
domain entry covers every subdomain.

To be added, open an issue: https://github.com/InvokeSmith/mcp-observatory/issues

We do not ask you to justify the request, and we do not ask who you are. An issue saying only a
domain name is a complete request.

**On the absence of an email address.** There is deliberately no contact email here yet. Publishing
one before a mailbox exists and is monitored would be worse than publishing none: you would write to
it, believe you had opted out, and not have. A monitored address will be added before any live
probing begins, and the scanner checks that the domain accepts mail at all before it will run.

## Timing

Removal takes effect **within 24 hours**. This is mechanical rather than aspirational: the scanner
refuses to probe at all if its copy of the opt-out data is more than 24 hours old, so a stale list
halts the run instead of silently scanning someone who has opted out.

## What "opted out" means

- No connection of any kind from any stage, for list entries.
- No MCP protocol call, for self-service entries (the one well-known GET above having already
  happened).
- Exclusion from every published dataset and statistic. Because the opt-out list is an input to
  report generation rather than ambient state, a host that opts out *after* being probed still
  disappears from the next published output.

## Verifying your entry

`optout.txt` is public and version-controlled. You can confirm your entry is present, and see when it
was added, without taking our word for it.
