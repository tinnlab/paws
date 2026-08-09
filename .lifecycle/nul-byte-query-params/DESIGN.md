# Design — one guard for every free-text value that reaches Postgres as `text`

**Status:** design pass written at plan time for `fix/nul-byte-search-500`.
There was no prior design doc for this defect class; this is it. The design is
not invented — it is the codebase's OWN already-established convention, written
down and made *shared* instead of copy-pasted.

## §1 The defect

A NUL byte (`U+0000`) in the `search` query parameter returns **HTTP 500** on
`GET /api/mcp/servers`, `GET /api/projects`, and `GET /api/conversations`.

Postgres cannot store or transmit `U+0000` in a `text` value at all: the wire
protocol rejects it with `22021 invalid byte sequence for encoding "UTF8"`
(and, for a `jsonb` path, `22P05 unsupported Unicode escape sequence`).
`AppError::database_error` correctly refuses to leak the SQL error to the
client, and therefore flattens it to a generic 500 `SYSTEM_DATABASE_ERROR`.

A 500 is the wrong answer. The client sent a value the storage layer physically
cannot hold; that is a **client** error, and the server is obliged to say so.

## §2 The root cause is a MISSING SHARED GUARD, not three broken handlers

The guard already exists. It exists **three times**, as a private per-module
copy, each added by a separate past fix:

| copy | file:line | wired into |
|---|---|---|
| `reject_nul` | `modules/project/handlers.rs:168` | project name / description / instructions (create + update) |
| `reject_nul` | `modules/user/handlers/groups.rs:80` | group description (create + update) |
| `reject_nul_in_content` | `modules/chat/core/handlers/validation.rs:24` | chat message content (send + stream) |

Each copy carries a doc-comment pointing at the others ("Mirrors
`project::handlers::reject_nul`"), which is the tell: this is a known class
that has been re-fixed locally three times and never centralized.

All three are wired into the **request-BODY / write path only**. The **read
path** — the free-text *query parameters* on list endpoints — shares its own
separate copy-pasted shape:

```rust
let search = params.search.as_deref().map(str::trim).filter(|s| !s.is_empty());
```

which appears verbatim at five sites and **omits the guard entirely**. That
omission is the single shared root cause of all reported 500s.

## §3 Why three endpoints fail and seven do not

The seven "safe" endpoints are not handling NUL correctly. **They have no
`search` query parameter at all.** Axum's `Query` extractor discards query keys
that are absent from the target struct, so `?search=%00` on `/api/users` is
read by nothing and reaches no SQL. Their 200 is the 200 of an ignored
parameter, not of a validated one.

The split is therefore **implements-a-free-text-filter vs does-not**, and it is
exhaustive: every endpoint in the codebase whose query struct carries a
free-text field that reaches a SQL text bind is affected; every endpoint
without one is not. There is nothing to learn from the seven — they establish
no behaviour to be consistent with.

## §4 The behaviour to be consistent with (reject, 400, `VALIDATION_ERROR`)

The convention is set unambiguously by the three existing copies, which agree
with each other:

```rust
AppError::bad_request("VALIDATION_ERROR", format!("{field} cannot contain NUL characters"))
```

→ **HTTP 400**, error code `VALIDATION_ERROR`. **Reject, do not strip.**
Silently stripping would make `search=a\0b` mean `search=ab`, i.e. return hits
the caller did not ask for — inventing a match is worse than refusing one.

The guard is deliberately **narrow: NUL only**. `\n`, `\t` and other control
characters are storable, are legitimate inside free-form prose, and in a
*search term* simply match nothing — a 200 with an empty page is the correct
answer for them, not a 4xx. The broader control/bidi gate in the codebase
(`validate_assistant_name`, `validate_group_name`) exists for a different
reason — display spoofing of a *stored, rendered name* — which does not apply
to a transient filter term. Narrow beats broad here, and it is what the three
existing free-text copies already do.

## §5 The fix

One shared helper in the **server** crate (`common/`), not in the `sdk`
submodule:

- `common::text_guard::reject_nul(value, field) -> Result<(), AppError>` — the
  single definition of the guard and of its message.
- `common::text_guard::normalize_text_filter(raw, field) -> Result<Option<&str>, AppError>`
  — the single definition of the *query-parameter* shape: reject NUL first,
  then trim, then blank → `None`. Replaces the five copy-pasted
  `.map(str::trim).filter(|s| !s.is_empty())` sites.

The three existing private copies delegate to `reject_nul` so there is exactly
one behaviour and one message in the process, and a future fourth copy has an
obvious home.

## §6 Non-goals

- Not changing the *matching* semantics of any search (ILIKE escaping, jsonb
  content search, sort whitelisting are all untouched).
- Not broadening the guard to all control characters (§4).
- Not touching the `sdk` submodule.
- Not adding a `search` parameter to any endpoint that lacks one.
