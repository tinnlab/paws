# Per-item walks (phase 5)

## User-experience walk

Who hits this, and what do they now see?

- **A UI client.** No ziee UI sends a NUL — the affected surfaces are search
  boxes bound to text inputs. So the practical user-visible change is **nil**,
  by design: every valid term normalizes identically (DEC-5).
- **A scripted/API caller** (the population that actually hit this) now gets
  `400 {"error_code":"VALIDATION_ERROR","error":"search cannot contain NUL
  characters"}` instead of `500 {"error_code":"SYSTEM_DATABASE_ERROR"}`. The
  message names the parameter, so the caller can fix it without a support round
  trip. This is the entire UX delta and it is strictly a gain.
- **An operator.** A 500 pages someone and burns a `trace_id` lookup to
  discover the server did nothing wrong. Those log lines stop.

## Infrastructure-integration walk

Subsystems each changed handler touches, and whether each has a constraint:

| subsystem | touched? | constraint handled |
|---|---|---|
| **Permissions** | yes, all 9 routes | The guard runs INSIDE the handler, i.e. AFTER `RequirePermissions` has already resolved. So an unpermitted caller still gets 403, never a 400 — validation cannot be used to probe an endpoint's existence. Asserted for `/mcp/system-servers` (both URLs 403 for a non-admin), `/mcp/servers`, `/mcp/tool-calls`, `/background/runs`, `/local-runtime/versions`. |
| **Ownership scoping** | yes | `/conversations/{id}/messages/search` resolves the conversation owner-scoped BEFORE reading `q`, so a foreign id 404s regardless of the term. Asserted in TEST-19 leg (c) — the guard must not reorder ahead of the ownership check, and it does not. |
| **OpenAPI / api-client** | no | No `JsonSchema` type changed shape (DEC-9). `MessageSearchQuery::trimmed_term` is a method, not a serialized field. Verified by regenerating and diffing (phase 8). |
| **Sync (SSE)** | no | These are all read endpoints; none publishes. |
| **Chat pipeline / streaming** | indirectly | `reject_nul_in_content` (send + stream) now delegates to the shared guard. Same status, same code, same message text — its pre-existing unit tests pass unmodified, which is the control. |
| **MCP tool-call path** | no | `/mcp/tool-calls` is the REST *history* reader; the recording chokepoint in `McpSession::call_tool` is untouched. |
| **Workflow runner** | no | `/background/runs` reads `workflow_runs` via `list_background_runs_for_user`; the runner itself is untouched, and the guard is on the read filter only. |
| **Local-runtime engine lifecycle** | no | Only the `engine` LIST filter is guarded. `is_valid_backend`/`is_valid_release_tag` (other fields, download path) are untouched. |
| **Rate limiter / CORS / auth middleware** | no | Guard is below all of them. |

### Entity-lifecycle walk

The changed code holds **no entity**: `normalize_text_filter` is a pure function
over a borrowed `&str` and returns a borrow of its input. There is no cached
state, no snapshot taken at one time and read at another, nothing to invalidate
on add/remove/delete/access-loss. The stale-snapshot failure class (FB-8) is
structurally absent here, which is worth stating explicitly rather than leaving
as an unexamined "N/A": the fix deliberately did NOT introduce a per-request
"validated params" struct that could go stale against the raw query string.

### One ordering constraint, found by walking rather than assuming

`/conversations?search` applies `escape_like` to the term before binding.
Escaping does not remove a NUL (`\0` is not one of `\`, `%`, `_`), so a guard
placed AFTER the escape would still bind `U+0000` and still 500. The guard
therefore runs first. This is the single place in the diff where order is
load-bearing, and it is pinned by an executable test rather than a comment
(TEST-9 leg (b): `?search=%5C%00` — backslash + NUL — must also be 400).
