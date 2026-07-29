# INFRA_INTEGRATION — the three phase-5 walks

Done per item, while implementing, not after.

## 1. User-experience walk

- **ITEM-1/2/3/4** — the author opens a workflow whose `llm`/`llm_map`/`agent`
  step takes its wording from a `prompt_file:`. The builder shows
  `WORKFLOW_PROMPT_BOTH` if they have also typed something, and its copy tells
  them to clear the box. They clear it, the panel goes green, Save enables, they
  press **Run** — and BEFORE this fix the run died with `step 'llm_1' has invalid
  prompt config`, developer-speak about a state the builder had just told them to
  create. AFTER: the run reads the file. The two other cells are the YAML author's
  path: `prompt_file: ""` or a `prompt_file:` naming a directory used to be
  accepted at authoring/import time and then failed mid-run; they are now reported
  at validate time, where the author can act on them, with copy that already
  exists for those codes.
- **ITEM-5** — an author importing a workflow whose step carries
  `prompt_file: ""` used to see a blank, unexplained prompt box carrying the
  "wording comes from a file" note, while the backend reported the step
  incomplete — two surfaces disagreeing in front of them. Now the client asks for
  a prompt, which is both actionable and what the backend says.
- **ITEM-6** — anyone using a combobox in a narrow or scroll-constrained
  container: the group no longer has 5px of scrollable overflow, so no phantom
  horizontal scrollbar appears on its ancestor and the addon no longer paints
  outside the field's border.
- **ITEM-7/8** — no user surface; they are the guards that keep the above true.

## 2. Infrastructure-integration walk

Every subsystem the changed code is reached from, checked rather than assumed:

| subsystem | reached how | constraint found / handled |
|---|---|---|
| `POST /api/workflows/validate` (YAML) | `validate_collecting` | Has NO materialized bundle (a deliberately non-existent root), so `check_prompt_files` takes its documented `!bundle_present` early-continue BEFORE the new `is_file` branch. The XOR verdict is decidable without a bundle and still fires. |
| `POST /api/workflows/validate-def` (the builder's panel) | `validate_collecting` | Same; pinned by TEST-4, which asserts the XOR verdicts through the real endpoint. |
| workflow install / dev-import | `validate_for_install` → `validate_collecting` | Runs WITH the real extracted bundle, so the new `is_file` branch is live here — which is the point: an unreadable `prompt_file:` is refused at install instead of at run. |
| workflow runner → `LlmDispatcher` | `resolve_prompt` → `load_raw_prompt` | Shares the rule. |
| workflow runner → `llm_map` | `load_raw_prompt` directly (raw, per-item `render_with_bindings`) | Shares the rule; the raw-vs-rendered distinction (H4) is untouched. |
| workflow runner → `AgentDispatcher` (`agent_dispatch.rs`) | `resolve_prompt` | Shares the rule; it is the only external caller of `resolve_prompt`, whose signature is unchanged. |
| mocked runs (`/run` with `mocks`, `/test` fixtures) | — | `runner.rs::run_mock_step` short-circuits BEFORE the dispatcher, so a mocked step never evaluates a prompt at all. This is why INV-1's run half is proven at the function, not over HTTP (DEC-4). |
| builder validation copy (`validationCopy.ts`) | by CODE | No new code is emitted (`WORKFLOW_PROMPT_FILE_MISSING` is reused with a different message), so the round-6 "every code has authored copy, enforced by a backend test" invariant needs no new entry — confirmed by the copy test still passing in the scoped run. |
| hub / seed workflow bundles | `validate_collecting` | `sr_seed_workflows_parse_and_validate` and `sr_seed_bundles_are_internally_consistent` both still pass, so no shipped bundle is newly rejected by the tightened file check. |
| kit consumers of `InputGroupAddon` | direct import | `combobox.tsx` + `command.tsx` ONLY — no app-level consumer in `sdk/packages`, `src-app/ui/src` or `src-app/desktop/ui/src`. |
| permissions / sync / notifications / MCP / approvals | — | Not touched: no route, no permission, no `SyncEntity`, no emit site changes. |
| OpenAPI / generated types | — | No schema-bearing type changes; `openapi.json` and `api-client/types.ts` unchanged in both workspaces. |

**Wired-and-behaving check.** `prompt_source` has TWO production callers
(`validate.rs`'s XOR check and `dispatch.rs::load_raw_prompt`) and
`prompt_file_ref` has two (`prompt_source` and `check_prompt_files`) — all on the
real runtime path, none test-only. Nothing added here is dead.

## 3. Entity-lifecycle walk

This branch introduces no entity, no row, no cached object and no surface that
holds one. The only persisted artifact involved — a workflow definition — has an
unchanged lifecycle: the change is to how an EXISTING field pair is INTERPRETED,
identically on both the read (validate) and the use (run) side, so there is no
add/remove/mutate/access-loss path that could diverge between a local mutation
and a `sync:` echo. Explicitly checked and found not applicable rather than
skipped.
