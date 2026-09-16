# Coordinated disclosure policy

This policy follows the **CERT/CC Coordinated Vulnerability Disclosure** model, including its
45-day default timeline. Where we depart from it, the departure is stated in the last section rather
than left for you to notice.

Sources, both worth reading in preference to this summary of them:

- [CERT/CC Vulnerability Disclosure Policy](https://certcc.github.io/certcc_disclosure_policy/)
- [CERT Guide to Coordinated Vulnerability Disclosure](https://certcc.github.io/CERT-Guide-to-CVD/),
  whose [policy templates](https://certcc.github.io/CERT-Guide-to-CVD/reference/policy_templates/)
  this document adapts. Copyright Carnegie Mellon University; CERT is a registered trademark. The
  templates are offered to be remixed, which is what has been done here — the wording is ours and any
  error in it is ours too.

## What this survey finds, and what it does not

This scanner reads what a server **declares**. It does not test behavior, because testing would mean
invoking a tool, which the first of the project's eight constraints forbids absolutely.

So what we surface is almost always a **precondition** rather than a confirmed vulnerability, and we
will describe it that way when we contact you rather than dressing it up. If a hand audit of your
public documentation suggests a server treats a caller-supplied tenant identifier as authoritative,
that is an inference from documentation. We will say exactly how we reached it and exactly what we
did not do to verify it.

## Scope of testing: there is none

The CERT/CC reporter templates set limits on how far a finder may go — stop once a vulnerability is
demonstrated, do not access or exfiltrate data, do not establish persistence, do not pivot to other
systems, do not attempt social engineering.

We satisfy all of them vacuously, and it is worth being concrete about why. This scanner sends
`initialize` and `tools/list`, the two calls every MCP client sends, and stops at any credential
challenge. It never invokes a tool, never authenticates, never retries with guessed credentials, and
never probes past a refusal. There is no exploitation to minimise because there is no exploitation.

The complete set of bytes we send to any host is published in
[`protocol/example-requests.md`](protocol/example-requests.md), regenerated from a real probe so it
cannot drift from the code.

## What we do

1. **We contact you first, privately**, before anything specific to your service is published,
   discussed publicly, or shown to a third party.
2. **We use your stated channel** — `security.txt`, a published security address, or a documented
   disclosure programme. Failing those, a general contact address.
3. **We disclose 45 days after first contact**, following the CERT/CC default. See the timing
   section below for what that clock actually governs here.
4. **We credit you, or not, as you prefer.** CERT/CC credits reporters by default; the mirror of that
   is that if you would rather not be named in any write-up of a fix, say so and you will not be.
5. **We accept your correction.** If you tell us a classifier has mischaracterised your schema, we
   will say so and fix the rule. This is the most valuable thing you can send us: rule sets are
   version-controlled data files, so a correction that changes a rule changes the published numbers
   for everyone, not just your row.
6. **We ask for nothing.** No NDA, no contract, no bounty, no commercial conversation. CERT/CC's
   reporter templates prohibit a finder demanding any of these, and we would consider it
   disqualifying here for the additional reason in the last section.

## Timing

The CERT/CC default applies: **45 days from first contact**, whether or not a fix exists by then.
Disclosure that waits indefinitely on a vendor is not coordinated disclosure, it is a veto.

As with CERT/CC, extenuating circumstances move the date in either direction — active exploitation,
an especially serious or especially trivial issue, or one that needs a change to a published
standard. We will tell you before we publish, and we will negotiate a different date where there is
a good reason for one. Ask for an extension if you are working on it and you will generally get it.

**What the clock governs here is narrower than it looks.** You never appear in the published
statistics: aggregate output names no organisation, with or without a timeline, which is the sixth
constraint. So the 45 days does not decide whether you are in the dataset. It decides whether we may
discuss a *specific* finding about you in public — in a write-up, a talk, or a conversation with a
third party.

## What we never do

- Test a finding by invoking your tools. Not before contacting you, not after, not to confirm it, and
  not if you ask us to. That would need a separate written engagement outside this project.
- Attempt authentication, credentials, or tokens.
- Publish a vendor list, ranking, grade, or score.
- Use disclosure as a sales channel. See below.

## Where we depart from CERT/CC

- **We are not a coordinator.** CERT/CC coordinates between finders and vendors. We are a finder, and
  a narrow one: we read declarations and we do not test.
- **The clock governs discussion, not inclusion.** CERT/CC publishes a vulnerability note naming the
  affected products. We publish aggregates that name nobody, ever. The timeline therefore governs
  something smaller than it does for CERT/CC.
- **Publication is not the leverage.** For CERT/CC, the deadline exists partly to motivate a fix.
  Here there is usually nothing to fix — the finding is a precondition, and the right outcome is
  often that you explain why it is fine and we record that.
- **We have a conflict of interest, and it constrains this policy.** This survey is published by
  InvokeSmith, which sells outcome verification for the risk class being measured. A disclosure
  conversation is therefore an obvious place for a vendor to be sold to, so: the people running this
  survey will not follow up about the product, and the survey's generated output may not mention it —
  enforced by a linter over every artifact, not by good intentions. If anyone contacts you about
  InvokeSmith on the back of a disclosure from us, that is a breach of this policy and we would like
  to know.

## Contact

**observatory@forgestack.dev** for anything you would rather not raise in public, which is most of
what this policy covers.

Public alternative, if you prefer a visible record that you asked and when:
https://github.com/InvokeSmith/mcp-observatory/issues

**PGP:**

```
ACB3 3098 A000 E615 5313 C35A D6C7 5965 5BBA 418A
```

RSA-4096, expires 2028-09-15. The public key is in this repository at
[`security/observatory-pubkey.asc`](security/observatory-pubkey.asc) and on
[keys.openpgp.org](https://keys.openpgp.org/search?q=ACB33098A000E6155313C35AD6C759655BBA418A).

Verify the fingerprint against the copy in [`SECURITY.md`](SECURITY.md) rather than trusting one
file. Before this key was advertised here, a message was encrypted to it and decrypted back — an
encryption channel that has not completed a round trip is an assumption, and this project has
published two contact channels that did not work.

## If you would rather not be surveyed at all

See [`OPTOUT.md`](OPTOUT.md). Opting out is not a concession, it takes effect within 24 hours, and we
will not ask why.
