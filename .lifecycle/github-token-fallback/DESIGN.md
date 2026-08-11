# Design — GitHub credential rejection must degrade to anonymous, visibly

Status: authored 2026-08-10 as the upstream design for the
`fix/github-token-fallback` branch. There was no prior design doc for this
behaviour; per the feature-lifecycle rule ("if there is genuinely no prior
design doc, WRITE one first and name it"), this is it. It is derived from a
hand-reproduced defect report against a live server.

## §1 The defect

`github_token()` in
`src-app/server/src/modules/llm_local_runtime/engine/download.rs` reads
`GITHUB_TOKEN`, trims it, and filters only the EMPTY string. Any non-empty value
— a placeholder, a typo, an expired PAT — is therefore forwarded to GitHub as a
real credential by `github_get_with_retry`, and there is **no fallback to an
anonymous request on an auth rejection**.

Measured on this box against the fork the engine downloader actually targets
(`ziee-ai/llama.cpp`):

```
anonymous  GET api.github.com/repos/ziee-ai/llama.cpp/releases  -> 200
+ Authorization: Bearer <placeholder from tests/.env.test>       -> 401 Bad credentials
anonymous rate budget at time of measurement: limit=60 remaining=41
```

GitHub is fully reachable. So a bad credential turns a **working** anonymous
path into a hard 401.

## §2 Consequence for a real operator

Paste an expired or mistyped token and the engine version list goes empty, while
the degraded-state UI blames GitHub rather than the credential. The user has no
way to tell "GitHub is down" from "your token is wrong" — and the working
anonymous path they'd have had with **no** token at all is now unreachable.

An invalid token failing *worse than no token at all* is the inversion this
design removes.

## §3 What "fixed" means (the non-negotiables)

1. An auth rejection (401, and `403`-bad-credentials as distinct from
   `403`-rate-limit — they are different and the distinction matters) must
   **fall back to an anonymous request** rather than failing the discovery.
2. The user must be able to tell the two cases apart. The existing degradation
   surface already carries `source` (`live|cache|unavailable`) and
   `unavailable_reason` — **extend that vocabulary** rather than inventing a
   parallel mechanism, so an invalid credential reports as an invalid
   credential.
3. **Do not simply validate the token's shape** (e.g. rejecting anything not
   matching `ghp_…`). GitHub has several valid token formats and adds more; a
   shape check would reject valid credentials and would not catch an expired
   one. Fall back on the **response**, not on the string.
4. A valid-token request must still be **authenticated** — never silently
   downgraded to anonymous, which would quietly cut an operator's rate limit
   from 5000/hr to 60/hr.

## §4 Classifying the response — headers, not prose

GitHub's REST API documents the `x-ratelimit-*` response headers as the
rate-limit contract; the JSON body's `message` prose is not a contract and is
exactly the kind of string-matching §3.3 forbids for tokens. So the classifier
reads **status + headers only**, and never the body:

| observed | classification | action |
|---|---|---|
| `401` | auth rejection | retry once, anonymously |
| `403` with `x-ratelimit-remaining: 0` | primary rate limit | no anonymous retry |
| `403` with `retry-after` present | secondary rate limit | no anonymous retry |
| `403` otherwise (revoked / lacks scope / SAML) | auth rejection | retry once, anonymously |
| any other status | not credential-related | unchanged |

Reading headers (rather than the body) also keeps the `reqwest::Response`
un-consumed, so the existing success and error paths are untouched.

**Why a rate limit must NOT fall back.** The two buckets are different (token =
per-account, anonymous = per-IP), so an anonymous retry might succeed — but it
would spend the box's scarce 60/hr IP budget to paper over an operator problem
that has a correct remedy (wait, or raise the quota), and it would mask the
`403` the operator needs to see. Auth rejection is different in kind: there is
no waiting that fixes it, and the anonymous path is the one the operator had
before they pasted the bad token.

**Retry exactly once.** The anonymous retry is a distinct request, not an extra
attempt of the existing transient-failure backoff loop: a credential rejection
is not transient, so retrying it with the same credential is pure waste, and
retrying anonymously more than once would double-spend the anonymous budget.

## §5 The vocabulary extension

`source` keeps its meaning exactly (`live|cache|unavailable` describes the
CATALOGUE's provenance). Credential health is an orthogonal axis — an
anonymous-rescued read is genuinely `live`, and overloading `source` or setting
`unavailable_reason` on a successful read would make the UI render "couldn't
reach GitHub" while it is happily listing versions.

So the same degradation struct gains one field:

```
credential_status: "absent" | "used" | "rejected"
```

- `absent` — no `GITHUB_TOKEN` was configured; the request was anonymous by
  design. (Not a problem; the operator simply has the 60/hr budget.)
- `used` — a token was configured and GitHub accepted it. The operator has the
  5000/hr budget. This is the state INV-4 protects.
- `rejected` — a token was configured and GitHub rejected it; the request was
  re-issued anonymously. **This is the state that was previously indescribable**
  and it is reportable whether the fallback then succeeded (`source: live`) or
  not (`source: unavailable`).

It rides on the same `Catalog` → `AvailableUpdatesResponse` /
`InstallableEngine` path the other three provenance fields already take, so it
is one vocabulary, not a parallel mechanism. It is cached alongside the
catalogue so a cache hit reports the credential state of the fetch that produced
it, rather than silently reverting to `absent`.

When a rejection is observed the reason string additionally names the
credential, so an operator reading only `unavailable_reason` still learns the
truth: `GitHub rejected the configured GITHUB_TOKEN (HTTP 401); …`.

**Never log or serialize the token value itself** — only its status.

## §6 Scope

This design covers the **runtime** engine-discovery path in
`llm_local_runtime/engine/download.rs` only. Other GitHub callers
(`code_sandbox`'s version manager, `hub_manager`, `server_update/checker.rs`,
and the build helpers) are surveyed and reported, not changed — see
`SURVEY.md`. A shared helper may be the right eventual shape; broadening this
change without saying so first is out of scope.
