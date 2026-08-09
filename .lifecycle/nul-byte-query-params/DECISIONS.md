# DECISIONS — resolved up front

### DEC-1: Reject or strip the NUL?
**Resolution:** Reject.
**Basis:** convention — all three pre-existing in-tree copies of this guard
reject (`project/handlers.rs:168`, `user/handlers/groups.rs:80`,
`chat/core/handlers/validation.rs:24`). The seven endpoints that returned 200
establish nothing, because they have no free-text query parameter at all
(DESIGN §3) — their 200 is an ignored parameter, not a stripped one. Stripping
would additionally violate INV-2: `search=a\0b` would silently become
`search=ab` and return hits the caller never asked for.

### DEC-2: Which status code?
**Resolution:** **400** with error code `VALIDATION_ERROR`, message
`"{field} cannot contain NUL characters"`.
**Basis:** convention — `AppError::bad_request("VALIDATION_ERROR", …)` is what
all three existing copies emit, byte-identically, and their unit tests assert
`status_code() == 400` + `error_code() == "VALIDATION_ERROR"`
(`validation.rs:71-73`, `groups.rs:621-625`). No new status, no new error code,
no new message shape is introduced. 422 was NOT chosen: in this codebase 422
means "a semantically valid request that hits a resource cap" (the projects
100-file cap), not "a malformed parameter value".

### DEC-3: How wide is the guard — NUL only, or all control characters?
**Resolution:** **NUL only.**
**Basis:** convention + correctness. The codebase has two distinct, deliberate
gates: a BROAD control/bidi gate for stored *display names*
(`validate_assistant_name`, `validate_group_name` — rationale is display
spoofing) and a NARROW NUL-only gate for free-form *prose*
(`reject_nul`, `reject_nul_in_content` — rationale, quoted from
`project/handlers.rs:164-166`: "`\n`/`\t` are legitimate in `instructions` and
`description`, so ONLY the byte Postgres physically cannot store is rejected").
A transient filter term is prose, not a stored rendered name — it is never
displayed back as an identity — so the narrow gate is the matching precedent.
Broadening would also turn today's correct `200 + empty page` for a `\n`-
bearing term into a 4xx, which is a behaviour regression, not a fix.

### DEC-4: Where does the shared helper live?
**Resolution:** `src-app/server/src/common/text_guard.rs`.
**Basis:** convention + constraint. `common/` already hosts exactly this kind of
small shared server-side helper (`tokens.rs`, `tool_args.rs`, `secret.rs`), and
`crate::common::AppError` is the import all three existing copies already use.
`sdk/crates/ziee-core` (where `AppError` itself lives) is the more "natural"
home but is a submodule this work is forbidden to touch — recorded so the
constraint is visible rather than looking like an arbitrary placement.

### DEC-5: Does the fix change any success-path behaviour?
**Resolution:** No. `normalize_text_filter` reproduces the replaced
normalization exactly: reject on the RAW value, then `trim()`, then
blank/whitespace → `None`. Every valid input maps to the same `Option<&str>` as
today.
**Basis:** codebase — the five replaced sites are literally identical
(`.as_deref().map(str::trim).filter(|s| !s.is_empty())`), so there is one
behaviour to reproduce, not five. Pinned by TEST-2 (unit) and TEST-14 (the
pre-existing project search suite kept unmodified as the regression control).

### DEC-6: `agent-kit` is a shared submodule — is documenting the rule there safe?
**Resolution:** Yes, and it is the right place: `agent-kit/docs/CODING_GUIDELINES.md`
§4 (DB correctness) is where this repo's DB-correctness rules live, and the rule
is framework-general. The edit is documentation-only and append-shaped, so it
cannot break a consumer. The rules forbid touching `sdk`, not `agent-kit`.
**Basis:** user constraint (explicit: "Do NOT touch the `sdk` submodule" — silent
on agent-kit) + codebase (CODING_GUIDELINES.md §4 is the established home for
"every user-facing list method takes page/per_page, clamped" and siblings).
**Fallback:** if the submodule proves unwritable in this worktree, the rule
lands in the repo-root `CLAUDE.md` instead. This is recorded so the fallback is
a decided path, not an improvised one.

### DEC-7: `background/runs?status` and `?kind` are documented as fixed
vocabularies but unvalidated. Tighten them into enums while we're here?
**Resolution:** **No** — apply the NUL guard only.
**Basis:** scope discipline. Tightening to an enum changes WHICH values 400
(today `?status=bogus` returns `200` with an empty page), which is a separate
behaviour change with its own client-visible blast radius and its own tests. It
is a real finding and is reported, but folding it into a 500→400 fix would make
one diff two changes. Same reasoning as the LIKE-escaping asymmetry recorded in
PLAN's non-goals.

### DEC-8: Is this an operational tunable needing an admin settings row?
**Resolution:** No. The mandatory configurable-settings check applies to limits,
retention, quotas, toggles and thresholds. This feature introduces none — it
adds a correctness guard with no tunable, no constant, and no threshold. There
is nothing an operator could sensibly configure ("allow NUL bytes through to
Postgres" is not a setting; Postgres would still refuse them).
**Basis:** convention — the settings rule exists so tunables aren't shipped as
magic numbers; a boolean-valued correctness invariant has no magic number.

### DEC-9: Does the fix need an OpenAPI regen?
**Resolution:** No, and it is verified rather than asserted — the regen is run
at phase 8 and the diff confirmed empty in BOTH `src-app/ui/` and
`src-app/desktop/ui/`.
**Basis:** codebase — no `#[derive(JsonSchema)]` type gains, loses or retypes a
field; only handler bodies and one `pub` method's return type
(`MessageSearchQuery::trimmed_term`, which is not part of any serialized
schema) change.

### DEC-10: `MessageSearchQuery::trimmed_term()` is `pub`. Change its signature,
or guard at the handler?
**Resolution:** Change the method to return `Result<Option<&str>, AppError>`.
**Basis:** codebase — the method IS the normalization boundary for that
endpoint (it is where trim+blank→None lives), so guarding anywhere else would
re-create the very split this fix exists to remove. Its only caller in the tree
is `chat/core/handlers/messages.rs:113`; a missed caller is a compile error, not
a silent pass, so `cargo check -p ziee --tests` is a sufficient safety net.

### DEC-11: Do the six `[acceptance]`-adjacent invariants need an e2e tier?
**Resolution:** No. This diff touches zero frontend paths (BASE.md), so the
frontend gates do not apply and integration is the top tier. The invariants are
about HTTP status codes, which the integration tier asserts directly and an e2e
could only assert less precisely.
**Basis:** convention — the phase-3 gate computes touched areas from the diff;
`src-app/ui/**` and `src-app/desktop/ui/**` are untouched.
