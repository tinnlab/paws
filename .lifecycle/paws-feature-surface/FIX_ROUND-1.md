# FIX_ROUND-1

Angles: **design-conformance** (required) + **correctness**. Both blind
subagents, diff-only context, `.lifecycle/` excluded, no plan and no reasoning of
mine handed over.

## What the round found

26 ledger rows. The two angles agreed on the change's real weak points and each
found things the other missed, which is the useful shape.

**The two that mattered most, both corroborated:**

1. **"Disabled" did not mean disabled.** `web_search` / `lit_search` / `js_tool`
   skipped only the `mcp_servers` upsert; their JSON-RPC endpoints stayed
   mounted, gated on `*::use` permissions the Users group HOLDS, with runtime
   settings rows defaulting enabled. So an ordinary user could still drive live
   web searches, keyless scholarly queries and arbitrary QuickJS with the switch
   off — while the comments this branch had just added claimed "query terms never
   egress". INV-3 unmet, and the design's own definition of *disable* ("does not
   serve the route") falsified. Fixed by guarding `register_routes`, with the
   settings/admin REST split out so the disable-only rows keep the admin pages
   the design leaves visible.

2. **The DEC-4 permission revokes broke a survivor.** The citations backend chat
   extension attaches its tools and a system nudge to EVERY tool-capable chat
   with no permission check, so revoking `citations::use` would have shipped
   every non-admin a chat advertising tools that 403. An INV-2 break introduced
   by a "cleanup". Fixing it properly needs a server-side kill switch for a
   UI-only item — explicitly out of scope — so all five revoke migrations were
   dropped and the design's recorded limitation stands. **DEC-4 reversed.**

**What only the design-conformance angle saw** (the reason it is a required
angle, and the reason auditing against the DESIGN rather than the plan matters):

- A surviving **"Install from Hub"** list in the onboarding MCP step. No lever
  reached it: it lives in the *surviving* onboarding module and was gated on a
  hub permission administrators hold via `*`.
- The **Playwright harness** was never updated for the four flipped defaults
  (the Rust harness was), so every e2e run booted with all four off and the
  literature / web-search sync suites silently lost their subject.
- Four **surviving specs** still driving hidden features, and **collateral loss
  of `api_key` sync coverage** — a survivor's only cross-device test, deleted
  because it happened to share a file with the assistant-template one.

**Test quality.** The audit was blunt that my e2e specs were largely hollow, and
it was right: label assertions matching strings that do not exist, project
assertions on the list page where knowledge kinds never render, route assertions
satisfied by the hidden page rendering in full, and a permission-less subject for
whom admin-gated surfaces are absent anyway. That last one is exactly why the
surviving hub surface slipped past me. All rewritten; the sweeps now run as an
ADMIN, and the project assertions were **verified falsifiable** — they failed
until I fixed an owner-scoping bug in my own fixture.

## Verification after the round

- `cargo check -p ziee --tests` clean; `tsc --noEmit` clean in `ui`.
- `paws_surface` integration: **5/5 pass**, now including 404 probes on the three
  MCP endpoints when disabled and reachability probes on the same paths when
  enabled.
- `17-paws-surface` e2e: **11/11 pass**.
- `cargo test -p ziee --lib`: 1554 pass, **4 pre-existing failures**
  (`job_kind_parses…`, `append_content_doc…`, `credential_is_withheld…`,
  `list_by_conversation…`). **Classified by running the same four on `origin/main`
  in the main clone — all four fail identically there.** None of those files is
  touched by this diff, and one is a pure-serde test with no DB and no config.
  Not regressions. Two further failures under high parallelism
  (`vector_search…`, `memory reaper`) pass at `--test-threads=2` — Category B
  contention.

## Termination assessment

Round 1 of a **HEAVY**-tier change, so one round is not sufficient on its own.

- **T1**: n1 (correctness) = 19, n2 (design-conformance) = 15, m (corroborated) =
  9 ⇒ N̂ = (20 × 16)/10 − 1 = **31**; observed 26 ⇒ ~5 remaining × promoted
  fraction. **Not below 1 — T1 does not terminate.**
- **GUARD-SUB**: not triggered. The heaviest concentration is 5 of 26 on the e2e
  specs, well under 60%, and round 1 is exempt anyway.
- **Profile**: a single round cannot show decay.

⇒ **The loop continues.** A round 2 is warranted, over THIS round's diff only.

**New confirmed findings:** 26
