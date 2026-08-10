# REPRODUCTION — all three defects, live, before any fix

Environment: this worktree's own server binary
(`src-app/target/debug/ziee`, built from `origin/main` @ `c7456cec6`), booted with
`CONFIG_FILE=config/dev.yaml` on `127.0.0.1:3097` with its own embedded Postgres
on `:54397`. Fresh database, admin created via `POST /api/app/setup/admin`.

```
ziee backend server started successfully on 127.0.0.1:3097
{"status":"ok"}
```

---

## Defect 1 — installable engine versions are undiscoverable

### 1a — the installed list is empty on a fresh install (so it teaches nothing)

```
$ curl -H "Authorization: Bearer $T" .../api/local-runtime/versions
{"versions":[]}
HTTP=200
```

### 1b — the noun a caller reaches for is shadowed by the UUID route

```
$ curl -H "Authorization: Bearer $T" .../api/local-runtime/versions/available
Invalid URL: Cannot parse `version_id` with value `available`: UUID parsing failed: invalid character: found `v` at 1
HTTP=400
```

Confirms the report exactly: `/versions/available` is matched by
`/local-runtime/versions/{version_id}` (`llm_local_runtime/routes.rs:80`).

### 1c — `version` is mandatory, and nothing supplies it

```
$ curl -X POST -d '{"engine":"llamacpp"}' .../api/local-runtime/versions/download
Failed to deserialize the JSON body into the target type: missing field `version` at line 1 column 21
HTTP=422
```

### 1d — the reported guess (an UPSTREAM `ggml-org/llama.cpp` tag) fails with accurate-but-useless advice

```
$ curl -X POST -d '{"engine":"llamacpp","version":"b10344","platform":"linux","arch":"x86_64","backend":"cpu"}' \
    .../api/local-runtime/versions/download        →  HTTP=200 (task accepted)

$ curl .../api/local-runtime/versions/downloads/llamacpp@b10344@cpu
{
    "status": "failed",
    "error": "Binary not found or not executable: engine binary not published for b10344 linux/x86_64/cpu
              (llama-server-linux-x86_64-cpu.tar.gz): Network error: Failed to access file: HTTP 404 Not Found.
              If the release was just created, its CI build may still be in progress — retry later."
}
```

Note the advice is actively wrong for this case: `b10344` is an upstream tag that
will *never* exist on the fork, so "retry later" can only ever waste the caller's
time. Nothing names the valid set.

### 1e — a discovery endpoint DOES exist, at a name nobody would guess

`GET /api/local-runtime/versions/{engine}/check-updates` works and returns the
real catalogue:

```
{"engine":"llamacpp","platform":"linux","arch":"x86_64","versions":[
  {"version":"v0.0.3-alpha","installed":false,"binary_ready":true,
   "available_backends":["cpu","cuda12.9","cuda13.2","rocm5.7","rocm6.1"],
   "recommended_backend":"cpu","size_bytes":12928771,"published_at":"2026-05-30T15:53:54Z"},
  {"version":"v0.0.2-alpha", ...}, {"version":"v0.0.1-alpha", ...}]}
HTTP=200
```

**This partially disproves the report's literal framing** ("no discovery
endpoint") and sharpens it: the capability exists, but it is named for an
*update* verb, is unreachable from the installed-versions listing, and answers
the obvious noun with a UUID parse error. It also reports only host-scoped
backends — never the `platform`/`arch` the download endpoint demands.

### 1f — the mechanism behind "zero installs in days": one GitHub call per request, uncached

Measured against GitHub's own counter (`/rate_limit` is itself exempt from the
budget, so the delta is purely ziee's traffic):

```
github core.used BEFORE = 24
   ... 5 × GET /local-runtime/versions/{engine}/check-updates ...
github core.used AFTER 5 discovery calls = 29
DELTA = 5
```

**Exactly one upstream GitHub API request per discovery call, zero caching.** The
unauthenticated budget is 60/hr/IP and `GITHUB_TOKEN` is not honoured on this
path, so a rig whose UI mounts this card repeatedly exhausts the budget
continuously; the handler then maps the failure to a 500 and the card renders an
error with **no version rows and therefore no Install button** — which is why the
rig recorded not one failed install attempt but no attempt at all.

Observed budget state on this shared box during the session: `limit: 60`,
`remaining: 47`, i.e. already partly consumed by other tenants.

---

## Defect 2 — a completed download renders as a stuck 90% bar

A genuine Hugging Face pull of `Qwen/Qwen2.5-0.5B-Instruct-GGUF` using the valid
`HUGGINGFACE_API_KEY` from `tests/.env.test` (sourced with `set -a`; never printed).

Polled to terminal:

```
status=downloading phase=downloading 20/100
status=downloading phase=downloading 20/100
status=completed   phase=committing  90/100      <-- terminal
```

Full record from `GET /api/llm-models/downloads/{id}`:

```json
{
    "id": "23553681-19d6-4395-9b78-fed91bafccf5",
    "status": "completed",
    "progress_data": {
        "phase": "committing",
        "current": 90,
        "total": 100,
        "message": "Creating model from downloaded files...",
        "speed_bps": 0,
        "eta_seconds": 0
    },
    "error_message": null,
    "completed_at": "2026-08-10T20:33:46.579758Z",
    "model_id": "f0280693-038a-44be-94bd-b6105ca2d5b6"
}
```

The download genuinely succeeded — `model_id` is set, `error_message` is null,
and the file is really on disk:

```
491400032  .../app-data/models/18abd00d-.../f0280693-.../qwen2.5-0.5b-instruct-q4_k_m.gguf
```

469 MB written, `status: completed`, progress frozen at **90/100**. Any UI
binding a bar to `current/total` shows 90% forever on success — and four
frontend sites do exactly that.

---

## Defect 3 — repository health passes URLs that cannot serve models

Three rows created through the public API, mirroring the rig's explorer-fabricated
rows, then probed via `POST /api/llm-repositories/{id}/test`:

```
--- Ziee AI Models   https://api.github.com        --> {"success":true,"message":"Connection to Ziee AI Models successful"} HTTP=200
--- TestRepo88       https://huggingface.co/custom --> {"success":true,"message":"Connection to TestRepo88 successful"}     HTTP=200
--- TestRepo         http://127.0.0.1:1520/models  --> {"success":true,"message":"Connection to TestRepo successful"}       HTTP=200
```

Stored state afterwards:

```
  untested  enabled=True   GitHub             https://github.com
  untested  enabled=True   Hugging Face Hub   https://huggingface.co
   healthy  enabled=True   TestRepo           http://127.0.0.1:1520/models
   healthy  enabled=True   TestRepo88         https://huggingface.co/custom
   healthy  enabled=True   Ziee AI Models     https://api.github.com
```

**Port 1520 turned out to be a real Vite dev server** (another worktree's UI),
serving its SPA fallback for `/models`:

```
$ curl -D- http://127.0.0.1:1520/models
HTTP/1.1 200 OK
Content-Type: text/html
...
<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <link rel="icon" type="image/svg+xml" href="/vite.svg"/>
```

So the reported case is reproduced literally, not approximated: ziee reports a
front-end dev server's HTML fallback as a **healthy model repository**.

Loopback was also accepted at *create* time, because `llm_repository::utils::validate_url`
selects `OutboundUrlPolicy::DEV_LOCAL` under `cfg!(debug_assertions)`.

Root cause, verbatim (`llm_repository/utils.rs`, `test_repository_connectivity`):

```rust
match req_builder.send().await {
    Ok(response) => {
        let status = response.status();
        if status == 200 {
            // Only consider HTTP 200 as successful
            Ok(())
        } else { ... }
```

The body is never read, parsed, or shape-checked.
