# `/.well-known/mcp-scan-optout`

A machine-readable way for an MCP server operator to decline automated posture surveys, exercised
from their own server without registering with anyone.

This document specifies the format that `mcp-observatory` honors. It is offered for reuse: an
opt-out mechanism controlled by the scanner is a weak opt-out, and the mechanism is only worth
anything if more than one scanner respects it.

Status: **proposed**. Version `0.1`.

## Location

```
GET https://<host>/.well-known/mcp-scan-optout
```

Requested unauthenticated, with no cookies, at the origin of the MCP endpoint under consideration.

## Responses

| Status | Meaning |
|---|---|
| `200` with a valid document (below) | The operator declines scanning. |
| `404`, `410` | No preference expressed. |
| anything else, or an unparseable body | Undetermined — see *Ambiguity* below. |

## The document

Either JSON:

```json
{
  "optout": true,
  "scope": "domain",
  "contact": "security@example.com",
  "updated": "2026-09-12"
}
```

served as `application/json`, or plain text:

```
optout
```

served as `text/plain`.

| Field | Required | Meaning |
|---|---|---|
| `optout` | yes | `true` to decline. `false` is a valid, explicit opt-*in* and is treated as "no preference expressed." |
| `scope` | no | `"host"` (default) or `"domain"`. `"domain"` applies to the whole registrable domain, so one file covers every subdomain. |
| `contact` | no | Where to reach the operator. Never published. |
| `updated` | no | ISO date the preference last changed. Informational. |

The plain-text form is equivalent to `{"optout": true, "scope": "host"}`.

## Content type is required, deliberately

A great many hosts answer `200` with an HTML page for *every* unknown path. If a scanner treated any
`200` as an opt-out, those hosts would be silently excluded — a large, non-random slice of the
population quietly removed from the sample, harming the survey without any operator intending it.

So a valid document requires **both** a `application/json` or `text/plain` content type **and** a
body that parses as above. An HTML catch-all is not an opt-out. If you intend to opt out, serve one
of the two forms above; a scanner cannot honor an intention it cannot distinguish from a 404 page.

## Ambiguity is not consent

A timeout, a 5xx, a DNS failure or an unparseable body is recorded as **undetermined**. An
implementation honoring this spec should treat undetermined as a reason to defer — neither scanning
nor concluding that the operator declined — and retry later. A flaky server is not consent.

`mcp-observatory` defers, and reports the deferred count in its published denominators so that the
sample's incompleteness is visible rather than hidden.

## Caching

Responses may be cached for at most **24 hours**, so that a newly published opt-out takes effect
within a day.

## What it does not do

This is a request to be left alone by cooperating scanners. It is not an access control, it is not
enforced by anything, and it should not be relied on as a security boundary. Its only power is that
implementations choose to honor it.
