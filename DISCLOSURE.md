# Coordinated disclosure policy

This survey publishes aggregates. It names no organization. But the process can surface something
specific about a specific vendor — most likely during the hand audit described in
[`protocol/PROTOCOL.md`](protocol/PROTOCOL.md) §7 — and this policy governs what happens then.

## What we do and do not find

This scanner reads declarations. It does not test behavior, because doing so would require invoking
a tool, which constraint 1 forbids. So what it surfaces is almost always a **precondition**, not a
confirmed vulnerability, and we will describe it that way when we contact you rather than dressing
it up.

If a hand audit of public documentation suggests a server treats a caller-supplied tenant identifier
as authoritative, that is a documentation-derived concern. We will say exactly how we reached it and
what we did not do to verify it.

## What we do

1. **We contact you first, privately.** Before anything specific to your service is published,
   discussed publicly, or shown to a third party.
2. **We use your stated channel** — `security.txt`, a published security address, or a documented
   disclosure programme. Failing those, a general contact address.
3. **We give you 90 days** from first contact before any publication that could identify you, and we
   will extend that on request if you are working on it.
4. **We accept your correction.** If you tell us the scanner's inference is wrong, we will say so and
   fix the classifier. This is the most valuable thing you can send us, and a correction that changes
   a rule changes the published numbers for everyone.
5. **We never publish your name in aggregate output**, with or without a disclosure timeline. The
   90-day clock governs whether we may discuss a specific finding with you in public, not whether you
   appear in the statistics. You do not.

## What we do not do

- We do not test the finding by invoking your tools, before or after contacting you. Not even to
  confirm it. Not even if you ask us to — that would need a separate, written engagement outside this
  project.
- We do not attempt authentication, credentials, or tokens.
- We do not publish a vendor list, ranking, grade, or score.
- We do not use disclosure as sales contact. The people who run this survey will not follow up about
  the publisher's product, and the survey's own output may not mention it.

## Contact

Open an issue: https://github.com/InvokeSmith/mcp-observatory/issues

For something you would rather not raise in public, a private channel and a PGP key will be
published before any live probing begins. Until then there is deliberately no email address here: an
address that does not receive mail is worse than none, because you would believe you had reached us.

## If you would rather not be surveyed at all

See [`OPTOUT.md`](OPTOUT.md). Opting out is not a concession and we will not ask why.
