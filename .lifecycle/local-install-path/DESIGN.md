# Design — the local-model / local-runtime install path

## Why one document for three defects

Three defects were found by driving ziee's install path **by hand against a live
server**. None came from a test. They are not three unrelated bugs; they share a
root shape:

> The install path's **discovery**, **progress** and **validation** surfaces were
> each built, each unit-tested against a mock, and **never exercised end to end
> by a real caller**. Every one of them is wrong in a way that only a human
> walking the path could see, and right in a way that a mock-driven test happily
> certifies.

Concretely, each surface has a test that passes *because it asserts the
implementation's behaviour rather than the promise the surface makes*:

| surface | what the test asserts | what the user needs |
|---|---|---|
| discovery | `check-updates` returns 200 against a **mock** release server | a real caller can find out what `version` to pass |
| progress | the download **reaches** `status: completed` | the progress bar **reads** 100% when it does |
| validation | the probe returns `healthy` when the mock returns `200 "{}"` | `healthy` means the URL can actually serve models |

So the fix is one coherent change to the install path, not three patches.

## §1 — Discovery (defect 1, the important one)

`POST /api/local-runtime/versions/download` **requires** all five of
`{engine, version, platform, arch, backend}`. Nothing tells a caller what to pass:

- `GET /api/local-runtime/versions` lists only what is **already installed**
  (`{"versions":[]}` on a fresh install).
- `GET /api/local-runtime/versions/available` returns **400** — the router parses
  `available` as a `{version_id}` UUID.
- A discovery endpoint *does* exist, at `GET /api/local-runtime/versions/{engine}/check-updates`,
  and the UI's `AvailableVersionsCard` calls it — but it is named for an
  *update* verb, it is not reachable from the installed-versions listing, and a
  caller who guesses the obvious noun gets a UUID parse error.

The engine binaries come from ziee's own forks (`ziee-ai/llama.cpp`,
`ziee-ai/mistral.rs`), so the set of valid versions is knowable and small.

**Why this matters most.** On a rig running continuously for days, with a
vision-driven explorer clicking every affordance it could see, **zero** engine
versions were ever installed and `downloads` was empty. Not one *failed*
attempt — **no attempt at all**. Two mechanisms produce that:

1. **The discovery call is uncached and unauthenticated.** Every mount of the
   runtime settings page issues one `GET /repos/{repo}/releases` to GitHub.
   Unauthenticated GitHub allows **60 requests/hour/IP**, and `GITHUB_TOKEN` is
   honoured at *build* time (`build_helper/hub_seed.rs`) but **not** by the
   runtime path. A rig on a shared IP exhausts that budget continuously.
2. **When that call fails the surface offers nothing to click.** The handler
   maps any failure to a 500; the card renders an error state with no version
   rows, so there is no Install button, so no attempt is ever made.

A capability nobody can discover is a capability nobody exercises, and it stays
untested forever.

### Non-negotiables

- **INV-1**: A caller who has installed nothing can obtain, from the API alone, the exact set of installable `(version, platform, arch, backend)` combinations — without reading source, guessing a tag, or knowing an endpoint named for a different verb.
- **INV-2**: Discovery must not cost a GitHub API call per page load, and when the upstream release feed is unreachable or rate-limited the response must say so explicitly — never present an empty list that reads as "no versions exist".

### Shape

- A discovery endpoint at the noun a caller actually reaches for, listing the
  variants each release **actually publishes**, so a caller picks a valid
  combination rather than guessing one.
- A process-lifetime TTL cache in front of the GitHub call, so page loads are
  free and the budget is spent once per TTL per engine.
- `GITHUB_TOKEN` honoured at runtime (60/hr → 5000/hr).
- An explicit degradation vocabulary on the response (`source` = live / cache /
  unavailable, plus `checked_at` and a reason) so an air-gapped or rate-limited
  box degrades to something **honest**: stale-but-labelled data, or a stated
  reason — never a bare empty list.
- The download-path 404 ("engine binary not published for `<tag>`") points the
  caller at the discovery endpoint.

## §2 — Progress (defect 2)

`GET /api/llm-models/downloads/{id}` for a **successfully completed** download
returns `status: "completed"` while `progress_data` is still
`{"phase":"committing","current":90,"total":100}`. Any UI binding a bar to
`current/total` shows 90% forever on success.

The cause is a single omission: in `llm_model/repository.rs`, the terminal
`update_download_status` write sets `status`, `error_message`, `model_id` and
`completed_at` — but **not** `progress_data`, which is therefore left at
whatever the last progress tick wrote (`committing`, 90/100). The last progress
tick on the happy path is the "Creating model from downloaded files…" write; no
later write ever reports 100%.

### Non-negotiable

- **INV-3**: A download's reported progress must never contradict its reported status — a download reported `completed` reports 100% complete.

### Shape

Reconcile progress in the same terminal write, at the repository chokepoint, so
every caller inherits it (the model-download path, the hub download wrapper, and
any future caller) rather than each UI patching the symptom client-side.
A failed or cancelled download **freezes** its progress where it stopped — that
is honest and must not be fabricated up to 100%.

## §3 — Validation (defect 3)

`POST /api/llm-repositories/{id}/test` marks repositories `healthy` that plainly
cannot serve models. Observed on the rig: `https://api.github.com`,
`https://huggingface.co/custom`, and `http://127.0.0.1:1520/models` — the rig's
own UI dev-server port — all `healthy`.

The probe issues one `GET` and asserts only `status == 200`. The response body
is never read, never parsed, never shape-checked; no model-registry path is
appended; nothing about model-serving capability is verified. Any web server
that answers 200 passes — which is exactly why a Vite dev server's SPA fallback
passes.

The function's own doc-comment already concedes that it does not exercise the
git-clone path a real download uses. That concession justifies *not testing the
clone*. It does not justify reporting the word **healthy** for "something
answered 200": a green health result that a web server passes is worse than no
result, because it converts *unverified* into *verified*.

A failing probe **auto-disables** an enabled repository, so the outcome is
load-bearing in both directions — which means the fix may not simply widen
"unhealthy" to swallow every host we cannot classify, or it will disable working
custom deployments.

### Non-negotiable

- **INV-4**: A repository is reported `healthy` only when a model-serving capability was positively confirmed. Reachability alone is never `healthy`, and a repository whose capability could not be confirmed is never auto-disabled.

### Shape

- Probe what the repository is actually **for**: derive the repository kind from
  its **host** (the same way the download path already does) and assert a
  model-registry capability — that the response parses and carries the shape a
  model listing has — not merely that a socket answered.
- Introduce a third outcome for "reachable, but capability not confirmed for
  this URL shape", so an unclassifiable custom host is reported honestly and is
  **not** auto-disabled.
- Host matching must be a real host-suffix match, not a substring test: the
  current `url.contains("huggingface.co")` sends the Hugging Face bearer token to
  any URL containing that string as a path segment.
