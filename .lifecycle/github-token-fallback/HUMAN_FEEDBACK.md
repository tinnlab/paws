# HUMAN_FEEDBACK

No human feedback received yet — the feature has not been reviewed by the owner.
The branch is complete and every gate is green; this ledger opens for the review.

Three things the owner should look at first, because each is a decision I made
that could reasonably go the other way:

1. **`403` handling.** The brief asked me to consider `403`-bad-credentials vs
   `403`-rate-limit. I concluded headers cannot separate them in general
   (`x-ratelimit-*` rides on nearly every response; a secondary rate limit may
   carry no `retry-after`), so only `401` and `403` + the documented
   `X-GitHub-SSO` header trigger the anonymous fallback. Every other `403` does
   not. See DESIGN §4 / DEC-1.
2. **The e2e stays on real GitHub** (DEC-4) — `page.route()` mocking is
   forbidden by the repo and a backend-env seam would mean editing the shared
   harness. The hermetic proof lives at the integration tier instead. The stated
   tradeoff is that the spec can rot if GitHub is unreachable; it now fails with
   the server's own diagnosis rather than "element(s) not found".
3. **Two out-of-scope fixes I made anyway**, because the reported spec could not
   pass without the first and the second was certifying a race:
   a React #321 hook-call in `checkForUpdates`, and the TTL spec's
   click-without-await. Both are described in FIX_ROUND-2.

Two findings reported but deliberately NOT fixed (SURVEY.md S-1..S-5, and the
guardrail gap in FIX_ROUND-2): `code_sandbox::version_manager` collapses a
GitHub failure to an empty `Vec` at `debug!` level with no wire field — the same
defect class, one notch worse; and `lint-hooks.mjs` has no rule for the
reactive-read-in-async-action shape that bit us here.
