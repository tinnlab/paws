# Design source — verbatim excerpt

Upstream: `/data/pbya/ziee/tmp/live-ui-247/TRIAGE-vs-9363976a2.md` (24/7 live-UI audit
rig triage against `origin/feat/agent-core` @ `9363976a2`, dated 2026-07-28),
**§4 "STILL-PRESENT items — ranked, with fix surface", Rank 1 and Rank 2.**

The triage doc lives outside the repo (machine-local rig output), so the two
governing sections are copied here VERBATIM and committed on the branch — this
file is what `PLAN.md`'s `## Design source` names, and what the invariants are
lifted from.

---

### Rank 1 — `ChatExtensions` swallows a request-field failure and sends anyway (MEDIUM-HIGH)

Any failure in a `composeRequestFields` contributor is caught, logged to the console and the send
**proceeds with a structurally invalid body**. The user gets a raw 422 and no actionable feedback.

```ts
// src-app/ui/src/modules/chat/core/extensions/registry.tsx:1011-1016
} catch (error) {
  console.error(`[ChatExtensions] Error in ${extension.name}.composeRequestFields:`, error)
}                                   // no rethrow, no flag, no partial-failure signal
return fields                       // :1017 — silently missing that contributor's keys
```

Three independent gaps compound it:
* `sendMessage.ts:180-184` spreads the result into the POST behind `as any`, erasing the TS
  requirement; there is no `model_id` presence check anywhere between `:85` and `:184`.
* `sdk/packages/framework/src/lazy-dispatch.ts:56` sets `MAX_RESOLVE_RETRIES = 1`, so the **second**
  rejection is memoized **permanently for the session** — one transient blip bricks that lazy action
  until reload, and every subsequent send silently 422s.
* Repo-wide grep for `preloadError` returns **zero hits**: no `vite:preloadError` listener, no
  import-retry, no "new version available, reloading" recovery. The only code that recognises the
  string is render-time (`StreamdownErrorBoundary.tsx:37`, `file/viewers/markdown/body.tsx:101`),
  unreachable from the send path.

This is not merely a rig curiosity: **any deploy while a tab is open**, or any transient network
event, reproduces it in production.

*Fix would touch:* `chat/core/extensions/registry.tsx` (return a partial-failure signal, or rethrow
for contributors marked required), `chat/core/stores/chat/actions/sendMessage.ts` (abort with a
user-visible error instead of `as any`), and `sdk/packages/framework/src/lazy-dispatch.ts` +
app entry (a `vite:preloadError` reload handler).
*Severity re-assessment:* **MEDIUM-HIGH** — rare trigger, but the failure is silent, permanent for
the session, and lands on the app's primary action.

### Rank 2 — no dynamic-import failure recovery anywhere (MEDIUM)

The generalisation of Rank 1's third bullet. The app code-splits to **one chunk per store action**
(`vite.config.ts:183` → `assets/[name]-[hash].js`), so a single bad moment can fail dozens of
chunks — the burst produced 16 distinct ones. With no `vite:preloadError` handling and a 1-retry
memoization cap, the tab degrades silently and permanently rather than reloading.
*Fix would touch:* app entry (`main.tsx`) + `sdk/packages/framework/src/lazy-dispatch.ts`.
*Severity:* **MEDIUM** — affects every lazy surface, not just chat.

---

## Scope handed to this branch (verbatim, from the orchestrator brief)

> - **Rank 1**: a failing required contributor must not produce a silent invalid
>   send. Surface a user-visible, actionable error instead of a raw 422 — and/or
>   make the failure recoverable. Decide deliberately between "abort with a clear
>   message" and "retry the import then abort", and record the decision.
> - **Rank 2**: add dynamic-import failure recovery (`vite:preloadError` handling
>   and/or a retry in `lazy-dispatch.ts`) so a transient blip doesn't permanently
>   brick a lazy action for the session.
