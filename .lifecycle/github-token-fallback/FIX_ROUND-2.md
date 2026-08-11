# FIX_ROUND-2

Two fresh blind angles over the round-1 diff: **design-conformance** (against
DESIGN.md's invariants, not the plan) and **security + concurrency/resource**.
11 findings, and the loop's most valuable output so far.

Capture-recapture: n1 = 8, n2 = 9, m = 3 (the `Used`-on-any-response finding,
the `ANONYMOUS_RETRY_LIMIT` semantics, and the dead `headers()` helper were each
reported by BOTH angles) → Chapman N̂ = (9 × 10)/4 − 1 = **21.5**; observed 11
⇒ ~10 estimated remaining. Overlap tripled versus round 1 (m: 1 → 3), i.e. the
angles are starting to saturate. Profile is decaying (20 → 11 confirmed).

## The corroborated finding (both angles, independently)

**`Used` was being claimed for responses that proved nothing.** The promotion
guard was `result.is_ok()` — transport-level. A 403, a 404, or a persistent 5xx
is still `Ok(Response)`, so a token that GitHub never accepted was reported as
`used` = "GitHub accepted it, 5000/hour". Round 1 added `Unverified` to kill
exactly this unfounded claim and then fixed it only at the transport layer,
leaving the HTTP layer wrong. The security angle drew the sharpest version: a
**revoked or SAML-blocked token answers 403**, which this same round had
deliberately excluded from the fallback — so that operator got an empty version
catalogue *and* a UI asserting their token was fine. The original defect, with
the blame inverted.

Fixed: `Used` now requires `status().is_success()`. Anything answered but not
successful stays `Unverified` — we asked, and we still do not know.

## `X-GitHub-SSO` — the 403 that *can* identify itself

Round 1's justification for "no 403 ever falls back" contained a factual error,
caught by the design-conformance angle: it claimed the body's prose is the only
discriminator for a 403. It is not. GitHub answers `403` + **`X-GitHub-SSO`**
when a PAT has not been authorized for a SAML-SSO-enforced organization — a
documented header contract, exactly as contractual as `x-ratelimit-*`, and
unambiguously a credential problem no waiting fixes. `ziee-ai` is an
organization, so this is a real operator, and round 1 had left them with the
original inversion intact.

So the rule is now: **401, plus `403` + `X-GitHub-SSO`, and no other 403.** That
is the distinction the brief asked for, drawn where the evidence actually
supports drawing it. DESIGN §3.1/§4 amended together this time (round 1 rewrote
§4 and left §3.1 contradicting it — also caught by this angle).

## Security

- **The credential is no longer sent to an arbitrary host.** `Authorization`
  went to whatever `api_base_url()` resolved to, and `LLM_RUNTIME_API_MIRROR`
  sets that arbitrarily in debug builds — so any dev/CI process holding a REAL
  `GITHUB_TOKEN` plus a mirror would transmit it in cleartext.
  `cfg!(debug_assertions)` gates whether the mirror is *read*, not where it
  *points*. `credential_target_is_trusted` now allows real GitHub, or (debug
  only) a LOOPBACK mirror — which is the test seam and cannot exfiltrate.
  A non-loopback mirror still works; it simply gets anonymous requests.
- **The deleted leak assertion is restored.** Round 1's rewrite silently dropped
  the "the note never contains `Bearer`/`ghp_`" check while keeping the doc
  comment that claims it.
- **The retry bound is now semantically exact.** Both angles noted that
  `authenticated = anonymous_retries < ANONYMOUS_RETRY_LIMIT` means "the budget
  is not exhausted", not "the credential has not been refused" — identical only
  at limit 1, and at 2 the loop would *re-present an already-rejected token*.
  Replaced by a `credential_refused` boolean: one proposition, no drift, and
  deleting it produces an infinite loop that TEST-14 catches.
- Dead `headers()` test helper: now live again (the SSO case needs it).

## What running the tests found that no audit did

Both of these were invisible to every static angle and only appeared by driving
the real stack — and both are causes of the reported failing spec.

**1. React error #321 — a hook call inside an async action.**
`checkForUpdates.ts` read `RuntimeVersion.versions`, a *reactive* store-proxy
read, after its `await`. A proxy field read IS a hook, so React threw; the
action's own `catch` swallowed it into `state.error`; the card rendered
**"Couldn't load available versions — couldn't reach the upstream release
feed"** on top of a catalogue the server had returned perfectly (`versions=3,
credential_status=rejected, unavailable_reason=none`). A SECOND, entirely
independent defect wearing the same misleading costume as the first: blame
GitHub for something that is not GitHub. It was undiscoverable while the 401
kept the catalogue empty. Fixed with `.$`, the sole hook-free snapshot escape.

It was only diagnosable because the failure path was made to reveal the card's
own hidden text — the message lived behind `ErrorState`'s collapsed "Details"
disclosure, invisible in a Playwright trace. That reveal is now a permanent part
of the spec.

A repo-wide AST sweep found **zero** other instances of this bug class. Notably
the existing `scripts/lint-hooks.mjs` H2 rule does NOT cover it: by its own
documentation it only fires on *conditionally-evaluated* reads, and this one was
unconditional inside an async action. Reported as a guardrail gap, not fixed
here (it is a lint change, not this feature).

**2. The TTL spec was certifying its own race.** It clicked Save without
awaiting and immediately reloaded, which ABORTED the PUT in flight (observed:
status `-1`, request body correct). Its "the stored value is NOT replaced"
assertion therefore passed *because the save never landed*. With the save
awaited, the truth appears: the control CLAMPS a below-floor value to the 60s
minimum and the server accepts 60 — so the value IS replaced, and the "refusal"
is a silent clamp. The spec now awaits the save, asserts what was actually sent,
and asserts the clamped floor persists. It went from flaky (1 of 2 in isolation)
to 2-for-2 green, alongside a stable 5-for-5 on the discovery spec.

## Rejected

- **Explicit redirect policy on the bearer-carrying client** (low). Verified not
  exploitable: reqwest strips `AUTHORIZATION` on a host/port change. Setting a
  policy here risks the release-asset download, which *requires* following
  `github.com` → `objects.githubusercontent.com`. Recorded, not changed.
- **`unverified` has no dedicated UI surface** (low). Consistent with `absent`
  and `used`, which have none either; only `rejected` is actionable by the
  operator. Not a §5 violation.

**New confirmed findings:** 11
