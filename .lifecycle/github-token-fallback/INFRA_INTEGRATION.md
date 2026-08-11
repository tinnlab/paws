# Phase-5 mandatory walks — UX / infrastructure / entity-lifecycle

Authored DURING implementation, item by item.

## 1. User-experience walk — how a real operator meets this

**Who hits it.** An admin who set `GITHUB_TOKEN` on the server process — most
often to escape the 60/hr anonymous limit on a shared egress IP — and got it
wrong: a placeholder copied from an example, a typo, or a PAT that has since
expired or been revoked. Nothing tells them. There is no "test this credential"
affordance anywhere, and none is being added: the credential is a process env
var, not a stored setting, so there is no form to validate on save.

**Before.** They open Settings → Local Runtimes. The Available-versions card
shows *"Couldn't reach the upstream release feed, so the installable versions
are unknown"* with `Failed to list releases: HTTP 401 Unauthorized`. Everything
about that sentence points at GitHub. It is false — GitHub was fine — and the
thing that WOULD have worked (unsetting the token) is the last thing they'd try,
because the token is what they added to make things *better*. There is no
install path from here.

**After.** The list renders normally, with sizes and Install buttons, plus one
quiet line: *"GitHub refused the configured GITHUB_TOKEN, so releases were
fetched anonymously (a lower rate limit). Check or unset the token."* The
primary job (install an engine) is unblocked immediately; the secondary job (fix
my credential) is now discoverable and states both the cause and the cost.

**Deliberately NOT an error state.** Nothing is broken in the rescued case, so
an `ErrorState` (destructive tokens, a Retry button) would overstate it and
train operators to ignore the card. It is a `Text type="secondary"` line, the
same weight as the existing stale-cache notice — which is the closest sibling
and the precedent it mirrors.

**Where it renders.** Above the conditional block, so it appears in every
branch: with rows, with stale rows, and with the unreachable state. A rejected
credential is equally true in all three, and burying it inside the rows branch
would hide it in exactly the worst case (rejected AND the anonymous retry also
failed → empty list, and the credential is the only actionable fact left).

**Not shown when it doesn't apply.** `used` and `absent` render nothing.
`absent` in particular must stay silent: "you have no GITHUB_TOKEN" is not a
problem, it is the default, and nagging about it would be noise on every
install-free deployment. Pinned by the negative-control component test.

## 2. Infrastructure-integration walk — every subsystem this touches

| subsystem | does it constrain this change? |
|---|---|
| **Release cache** (`release_cache.rs`) | YES — the catalogue is served from a process-lifetime TTL cache, so a naive implementation reports the credential verdict only on the first read and `absent` thereafter. Handled: the verdict is stored on the `Entry` and echoed on both cache-serving paths, and the retain-on-failure path reports the FAILED refresh's verdict (a token revoked since caching must surface NOW). Pinned by TEST-7. |
| **Retry/backoff loop** | YES — the anonymous re-issue must not consume a transient attempt (a rejection is not transient) and must never run twice (60/hr/IP). Implemented as a separate `ANONYMOUS_RETRY_LIMIT` one-shot; the 3-attempt budget and its 500/1000 ms delays are byte-identical to before. Pinned by the request counts in TEST-3/4/5. |
| **Two discovery endpoints** | YES — `check-updates` builds its response in `handlers.rs`, `/versions/available` in `binary_manager.rs`. They are separate code; an omission in either leaves one surface mute. Both populated; TEST-6 asserts both. |
| **OpenAPI + generated TS** | YES — a `JsonSchema` response field means `just openapi-regen` for BOTH `ui/` and `desktop/ui/`, or `openapi::emit_ts::tests::types_ts_parity` fails. Done. |
| **Desktop UI** | NO override exists — `src-app/desktop/ui/src/modules/` has no `llm-local-runtime`; desktop consumes `src-app/ui`'s module through the loader. Only its generated `openapi.json`/`types.ts` change (regenerated). R2-3 checked, nothing hand-written to mirror. |
| **testid registry** (`sdk/packages/kit/src/testIds.generated.ts`) | YES — a new `data-testid` must be regenerated into the shared registry or `check:testid-registry` fails. Regenerated: exactly ONE id added (1790 → 1791), no phantom harvest. |
| **Gallery / state-matrix** | YES — a new conditional render state needs a gallery cell or `check:state-matrix` fails. Added `seeded-s3-available-versions-credential-rejected`. |
| **Permissions** | NO change — both endpoints keep `RequirePermissions<(RuntimeVersionRead,)>`, unchanged. No new permission ⇒ A9/A10 do not apply. |
| **Sync / EventBus** | NO change — discovery is a pull-only read (there is no `RuntimeCatalog` sync entity today); nothing mutates, so nothing to publish. |
| **Secrets handling** | YES, and it is a hard constraint — the token must not reach a log, an error string, or a response. The value is read once per call and used at exactly one line; the classifier is structurally unable to see it; the reason note names the VARIABLE only. Asserted by TEST-8 and by TEST-6's "no reason string may ever carry a credential value". |
| **`voice` / `code_sandbox` / `server_update`** | Same GitHub surface, deliberately untouched — see SURVEY.md S-1..S-3 and DEC-9. |

## 3. Entity-lifecycle walk

The only entity here is the **cached catalogue Entry**, and the only "identity"
is the process-level `GITHUB_TOKEN`. Neither is user-created, so the usual
add/remove/delete/access-loss matrix reduces to state transitions of the
credential:

| transition | what happens | covered by |
|---|---|---|
| **added** (operator sets a valid token) | next refresh authenticates; `used`; one request | TEST-3 |
| **added, invalid** | next refresh 401s, re-issues anonymously; `rejected`; list still renders | TEST-4, TEST-9 (e2e) |
| **removed** (operator unsets it) | next refresh is anonymous by design; `absent`; no notice | TEST-6 (b), TEST-2 |
| **revoked mid-life** (was valid, now refused, entry already cached) | the refresh fails; retain-on-failure keeps the rows AND reports `rejected` — the stored `used` must not mask it | TEST-7 (path 2) |
| **quota exhausted** (still valid) | no anonymous retry; `used`; reason names the 403 and does NOT blame the token | TEST-5 |
| **read again within the TTL** | no upstream call; the stored verdict is echoed, so the notice does not flicker | TEST-7 (path 1) |

The "removed" and "revoked" rows are the two that a handler-reading review would
get wrong, and both are proven by running, not by inspection: the first because
the test harness inherits a developer's sourced `.env.test` (so the
no-credential case must explicitly blank `GITHUB_TOKEN`, or the positive control
silently becomes a has-credential case — a real trap, handled in `setup()`), the
second because the failing-refresh path receives its verdict from the fetch
rather than from the cache.
