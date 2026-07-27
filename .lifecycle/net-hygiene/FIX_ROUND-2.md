# FIX_ROUND-2 — net-hygiene

A FULL fresh blind round was re-run against the fixed diff (8 angle groups,
diff-only context, no reasoning handed over). It found **22 further findings** —
5 medium, the rest low. All confirmed ones are fixed below; the round's own
verdict on the previously-fixed items was that they hold.

## Fixed

| # | Finding (angle, severity) | Fix |
|---|---|---|
| 1 | A hung request's entry is never REMOVED from `inFlight` — `MAX_JOIN_AGE_MS` made it unjoinable but the Map grew one permanent entry per distinct hung read (concurrency, MEDIUM) | `coalesce` now EVICTS a non-joinable entry, via a shared `isJoinable()` predicate, instead of only declining to join it. |
| 2 | `isMeFresh()` can report true while the store no longer holds that identity: `endSession()` clears `user`/`permissions` with NO http call, and desktop `auto_login` / the tunnel's `applySession` seed a session over Tauri IPC — neither bumps the epoch (state-management, MEDIUM) | New `invalidateMeFreshness()`, called from `endSession()` and `setAuthFromAutoLogin()`. This is the third bump site — the one the transport structurally cannot see. Pinned by a new acceptance case. |
| 3 | `refreshCurrentUser` silently changed contract from "always fetches" to "may resolve without a round-trip", with no opt-out, in a file shared by ui + desktop/ui (api-contract, MEDIUM) | Added `refreshCurrentUser({ force: true })`, documented on the interface. `force` beats BOTH the in-flight join and the freshness skip; covered by a test. |
| 4 | No per-call bypass for GET coalescing in a transport shared by three apps — a one-shot/nonce/side-effecting GET had no way to decline (api-contract, LOW but structural) | Added `callbacks.noCoalesce`. |
| 5 | TEST-12 was TAUTOLOGICAL: `expect(displayName).toHaveValue(renamed)` is satisfied by the value the test itself typed, so it passed before any refetch resolved and could never observe a coalesced pre-mutation `/me` (tests-quality, MEDIUM) | The spec now `waitForResponse`s the post-save `GET /api/auth/me` BEFORE asserting, so it observes what the refetch actually returned. |
| 6 | TEST-12's `finally` could throw and REPLACE the original assertion error, masking why the test went red (error-handling, MEDIUM) | The restore is wrapped in its own try/catch that logs a diagnostic instead of throwing. |
| 7 | TEST-11's `toBe(1)` is coupled to the 3 s freshness window, so a slow box makes CORRECT behaviour fail (tests-quality, MEDIUM) | The assertion is now conditioned on the OBSERVED gap between the two `/me` calls: a second call inside the window is a real failure with a precise message; outside it, it is legitimate. |
| 8 | `loadContext.nochange.test.ts` asserted on formatting-coupled regexes plus a three-name denylist, so a reintroduction under any other identifier passed while a reformat turned it red (tests-quality, MEDIUM) | Rewritten to assert the `isAuthenticated:` VALUE EXPRESSION (whitespace-collapsed) equals `!!auth.isAuthenticated` — any added term fails whatever it is called — plus a check that no persisted field (`token`/`expiresAt`/`expiresIn`) is read at all, and a whitespace-tolerant structural check on `can()`. |
| 9 | The three new store decision paths had NO passing unit coverage (the only store spec is pre-existing-red under both runners) (tests-quality, MEDIUM) | The two decisions were extracted as pure predicates — `canJoinMeRefresh()` and `shouldSkipMeFetch()` — and the store now calls them. Three new cases cover the older-epoch join refusal, `force` beating both paths, and the out-of-band identity disarm. |
| 10 | Clearing the memo on ANY resolve rejection turns a deterministic factory bug into an unbounded retry loop for a component that dispatches from a render/effect (error-handling, LOW) | `MAX_RESOLVE_RETRIES = 1`: one retry covers the transient chunk blip, the second failure is memoized so the action fails fast. Both behaviours tested. |
| 11 | `import.meta.env.DEV` was still read directly in the HMR branch, so the stated "must never throw under node" hazard was only half-closed (correctness, LOW) | Uses `isDev()` there too. |
| 12 | The HMR comment implied replacement still works for most stores, when `registerLazyStore` routes nearly ALL of them through `registerStore` (correctness, LOW) | Comment corrected to state the real scope and why the trade is intended. |
| 13 | The "STAYS async" comment cited a `FormData` hazard the same diff had guarded, while `performCall` still did the UNGUARDED `instanceof` (correctness, LOW) | `performCall` uses the guarded `isFormData()`; the comment no longer cites the guarded case. |
| 14 | The origin-in-key rationale was FALSE — both `getBaseURL` implementations memoize the resolved base URL for the page's lifetime, so it cannot change mid-session; the extra `await` bought nothing (correctness, LOW) | Verified in `getBaseURL.ts` (`baseUrl ??= …`), removed from the key, comment corrected. Measurably better: the shell's first data request on `/` went 438 ms → 75 ms once the extra resolver hop left the critical path. |
| 15 | `MAX_JOIN_AGE_MS`'s "sized well above the worst case (~6 s retry ladder)" claim is unsupported — the six `fetch()` attempts are untimed (correctness, LOW) | Comment rewritten to state it is a judgement, that overshoot only costs a MISSED join (the safe direction), and to name the in-window hang exposure as KNOWN and UNFIXED with the reason (a transport-wide fetch timeout is out of this feature's scope). |
| 16 | `inflightKey`'s doc claimed a 32-bit fingerprint means user B can "never" get user A's response (security, LOW) | Doc softened to a strong practical separation, and the key-time-vs-send-time token read is now stated. |
| 17 | The moved permissions stub's doc claimed relocation "removes that reachability entirely" — it narrows it from three packages to one app (security, LOW) | Doc corrected. Its dead `setAuthView` / `evaluatePermission` exports (no consumer, and the latter had the wrong arity) were removed, shrinking the always-allow surface to the one symbol actually needed. |
| 18 | `lazy-dispatch.test.ts` maintained a `pastGuard` counter no test asserted (tests-quality, LOW) | Now asserted — it is what proves the action's own guard becomes reachable. |
| 19 | `syncBackoff.test.ts`'s comment claimed escalation was demonstrated when no test drives `connectLoop`'s doubling (tests-quality, LOW) | Comment corrected to say what IS asserted (the 429 path never lowers what the loop reached, which is what makes escalation work) and where the doubling actually lives. |

## Declined, with rationale

- **A joiner arriving inside the window of a hung request inherits that hang.**
  Real. The correct fix is a fetch/connect timeout on the transport, which would
  change behaviour for every request in three applications — far beyond this
  feature. Recorded verbatim in `inflight.ts` as KNOWN and UNFIXED, with the
  reason, rather than quietly left undocumented.
- **`registerStore` ordering** — if a module's `registerModule` runs before the
  store file's `registerLazyStore`, the registry keeps its own proxy. Pre-existing
  (`registerStore` already early-returned on a taken name before this branch);
  fixing it means changing which proxy wins for stores this diff does not touch.
  Out of scope, recorded.

**New confirmed findings:** 0
