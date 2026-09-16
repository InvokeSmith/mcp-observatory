# Security

## Reporting a vulnerability in this tool

Email **observatory@forgestack.dev**, encrypted if the finding warrants it:

```
ACB3 3098 A000 E615 5313 C35A D6C7 5965 5BBA 418A
```

RSA-4096, expires 2028-09-15. Public key: [`security/observatory-pubkey.asc`](security/observatory-pubkey.asc).

Public alternative, if you prefer a visible record: https://github.com/InvokeSmith/mcp-observatory/issues

We care most about a specific class of bug here: **anything that would cause this scanner to contact
a server it should not, or to send a request it should not.** That includes

- any path by which a `tools/call` could reach the wire,
- any way to bypass the egress gate,
- any way an opted-out host could be contacted,
- any way the scanner could continue past an authentication challenge,
- any way raw captures could reach published output.

Those are the eight constraints in the README, and a break in any of them is the most serious defect
this project can have. Each is covered by a named test in `tests/constraints/`; a report that comes
with a failing test case is the ideal form.

## If you operate a server we surveyed

Two separate things, both fine to raise:

- **You would rather not be surveyed.** See [`OPTOUT.md`](OPTOUT.md). No justification needed.
- **You believe we surveyed you incorrectly**, or that a classifier mischaracterises your schema. See
  [`DISCLOSURE.md`](DISCLOSURE.md). Corrections that change a rule change the published numbers for
  everyone, so they are genuinely valuable to us.

## Publishing or rotating our key

`scripts/setup-pgp-key.sh` walks through generating, publishing and round-trip
testing the OpenPGP key for the contact address. It exists because the key's
passphrase is a step no agent should take, and because the key expires every two
years, so rotation follows the same path rather than being rediscovered.

## Scope

This repository is a research instrument. It has no deployed service, holds no user accounts, and
processes no customer data. Its sensitive asset is the private raw capture tier described in
constraint 7.
