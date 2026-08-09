# FIX_ROUND-1

Three blind angles on `git diff origin/main...HEAD`: **design-conformance**
(required), **tests-quality**, **api-contract + correctness**. 20 findings
recorded in `LEDGER.jsonl`. Every one is addressed below — none dismissed
silently.

## The round's headline: the fix shipped a regression, and the audit caught it

**FIX-1 (high, corroborated ×2, oracle-confirmed).** Four of the twelve call
sites had their success-path behaviour silently changed. `normalize_text_filter`
trims and maps blank → `None`; that is correct at the five sites whose
pre-existing code already did exactly that, and WRONG at the four that bound the
value raw:

| param | `?p=` before | `?p=` after the first cut |
|---|---|---|
| `local-runtime/versions?engine` | `WHERE engine = ''` → 0 rows | **no filter → every version of every engine** |
| `background/runs?status` | `status = ''` → 0 rows | **no filter → every run the caller owns** |
| `background/runs?kind` | `job_kind = ''` → 0 rows | **no filter** |
| `mcp/tool-calls?tool_use_id` | `tool_use_id = ''` → 0 rows | **no filter → the caller's whole history** |

A filter the client explicitly sent was being discarded, and the endpoint
answered with a strict superset — the same "never turn a term the caller cannot
have meant into one that returns hits" hazard INV-2 names, in a different dress.
Not a cross-user leak (`user_id = $1` is unconditional at all four), but a real
contract regression. DEC-5 and the module doc both asserted the opposite, and
the new test suite could not see it: every benign value in the sweep table was
non-empty, and `assert_benign_value_is_accepted` only checked `status == 200`.

**Fix:** a second entry point, `common::text_guard::guard_raw`, which adds the
NUL rejection and NOTHING else. The four raw-binding sites use it; the five that
already trimmed keep `normalize_text_filter`. The distinction is now documented
at the top of the module, unit-tested
(`the_two_entry_points_differ_on_blank_and_that_is_the_point`,
`guard_raw_returns_valid_input_byte_for_byte_unchanged`), and pinned by three new
integration tests that assert `?p=` still returns **0 rows** rather than the
unfiltered list.

## Every other finding

**FIX-2 — the guard's own doc overclaimed, and the body path really was
unguarded (high, oracle-confirmed).** `text_guard.rs` said "request BODY *or*
QUERY PARAMETER". A live probe against the running server proved otherwise:
`POST /assistants {description|instructions}`, `POST /conversations {title}`,
`POST /knowledge-bases {description}` and `POST /memories {content}` all still
returned **500** on a NUL — same Postgres error, same root cause, a class member
the query-param framing had hidden. All four are now guarded, and the measured
before-table is in `REPRO_PRE_FIX.txt`. (`/projects`, `/groups`, `/workflows`
name+description were already guarded and returned 400 — recorded as negative
space.)

**FIX-3 — TEST-6 could not detect the drift it claimed to (high, ×2).** It
compared `status_code` + `error_code`, which is exactly what all three
PRE-EXISTING private copies already produced; the test would have passed against
the duplication it exists to forbid, and never compared the message. Replaced
with a **message-format** contract (`{field} cannot contain NUL characters`)
asserted for four field names, plus a per-module assertion in each wrapper's own
test file. That also removes the layering inversion (a test in `common/`
importing three feature modules) and lets `project::handlers::reject_nul` go back
to private — it had been widened to `pub(crate)` purely for test reach.

**FIX-4 — a claimed "ordering proof" that cannot fail (high, ×2).** Leg (b) of
TEST-9 billed `?search=%5C%00` as proving the guard runs before `escape_like`.
It does not: `escape_like` only rewrites `\ % _`, so both orderings reject the
same input set and **no query string can distinguish them**. ITEM-4's CONCERN was
therefore vacuous. The claim is **withdrawn** in the plan, in TESTS.md and in the
test comment, rather than left as a test that passes for a reason that is not
true. The input is kept as an extra shape, honestly labelled.

**FIX-5 — an always-true assertion (medium).** In
`nul_is_rejected_never_silently_stripped`, `assert!(out.is_err())` makes
`out.ok().flatten()` necessarily `None`, so the following `assert_ne!` was
unfalsifiable. Rewritten as a `match` that fails explicitly on any `Ok`, naming
the stripped form when that is what came back — which is what actually
distinguishes "rejected" from "silently rewritten". Extended to `guard_raw`.

**FIX-6 — vacuous / weak happy-path legs (high + medium).** The rejection legs
were sound (they assert `!= 500`, `== 400` **and** `error_code`), but several
happy-path counterparts proved only that a page was well-formed on empty data —
satisfied identically by an endpoint ignoring the parameter, which is exactly
what would make the paired rejection meaningless. Now discriminating:
- message search seeds TWO real messages (one matching) and asserts
  `total == 1` plus the snippet carries the hit;
- `/conversations?search` seeds a second, non-matching conversation;
- `/memories?search` and `?kind` seed a second row of a different kind and
  assert the filter EXCLUDES it; `?source` gets a matches-neither counterpart.
- `/background/runs`, `/mcp/tool-calls`, `/local-runtime/versions` keep a
  well-formedness leg (seeding a real run / recorded tool call / installed
  engine is genuinely heavy) but their comments no longer claim more than that,
  and each gained the FIX-1 empty-value test, which IS discriminating.

**FIX-7 — an inert negative control (medium, ×2).** The narrowness control
probed `?sort` and `?status`, two parameters this diff never touched — no edit
here could make it fail. Added
`non_nul_control_characters_in_a_guarded_param_are_still_accepted`, which drives
`\n`/`\t`/ESC/DEL through three GUARDED parameters at the HTTP tier and goes red
the moment someone widens the guard to `char::is_control()`.

**FIX-8 — the OpenAPI contract (medium, ×2, oracle-confirmed).** Nine routes
gained a 400 and none declared it, while siblings in the same files
(`create_project_docs`, `get_conversation_history_docs`) do. All nine now declare
it, and BOTH workspaces were regenerated (`src-app/ui` + `src-app/desktop/ui`,
+27 lines each; `types.ts` regenerates identically since it is response-type-
keyed). **DEC-9 is superseded**: "no regen needed" was true only as a consequence
of the omission the audit found.

**FIX-9 — ITEM-9 did not ship (medium, ×2, oracle-confirmed).** The
CODING_GUIDELINES rule was an UNCOMMITTED edit inside the `agent-kit`
**submodule** — absent from every commit and from the diff, so no consumer and no
fresh clone would ever see it. Committing it there would also leave a submodule
pointer this branch is not allowed to push. Took DEC-6's recorded fallback: the
rule now lives in the repo-root `CLAUDE.md` (a file this repo actually ships),
documenting both entry points and the widening trap FIX-1 hit. The submodule is
reverted clean.

**FIX-10 — a machine-local config was committed (medium).**
`server/config/nulrepro.yaml` (absolute per-machine paths, a live-looking
`jwt.secret`) is a reproduction artifact, not part of the fix. Removed from the
repo and moved to the scratch dir.

**FIX-11 — the guard sat after code that can itself 500 (low).** In
`list_runtime_versions` the `BinaryManager` construction ran first, so a
cache-dir failure would answer 500 to a NUL request — the outcome INV-1 forbids.
The guard is now the first statement after extraction, matching every other site.

**FIX-12 — unbacked evidence claims (low, ×2).** Three test doc-comments said
"the pre-fix reproduction confirmed 500" for parameters `REPRO_PRE_FIX.txt` did
not record. The measurement HAD been taken; it simply was not saved. The full
12-row pre-fix table, the two negative controls, the body-path probe and the
byte-identical-body proof for the seven "safe" endpoints are now all in the
artifact.

**FIX-13 — the ignore-the-parameter control skipped 2 of 7 (low).** It granted
`users::read`/`groups::read` and then never probed `/users` or `/groups`. Now
probes all seven (plus `/llm-providers`).

## One finding NOT fixed, and why

**The 12-row inventory is a manifest, not a discovery mechanism** (medium, ×2).
`assert_eq!(FREE_TEXT_SQL_BOUND_PARAMS.len(), 12)` only observes the table:
adding a 13th unguarded parameter to `src/modules/**` fails nothing, because
whoever adds the parameter also edits the table. Both auditors are right, and I
am recording it as an **acknowledged limit** rather than pretending otherwise.
A real fix is a source-derived check (an `ast-grep`/CI diff rule of the kind
CODING_GUIDELINES §17 recommends: "new `Query<..>` struct with a String field →
must route through `text_guard`"), which is a lint-infrastructure change with its
own blast radius and does not belong in a 500→400 bugfix. The compensating
controls that DO exist today: the rule is written into `CLAUDE.md` with the trap
spelled out, and both auditors independently re-derived the inventory from source
and confirmed the current 12 are complete.

**New confirmed findings:** 0
