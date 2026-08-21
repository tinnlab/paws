# Ziee Desktop — running, testing, and shipping

How to run the desktop app, what is genuinely desktop-only, and how a macOS build
actually gets made. Nothing here duplicates `CLAUDE.md`; this is the "how do I
start it" doc that was missing.

## What the desktop app is

`ziee-desktop` is a **Tauri 2 shell around the entire server**. `Cargo.toml` pulls
`ziee = { path = "../../server" }` as a library dependency, so the app is the full
Axum server, an embedded PostgreSQL, and a window.

There are exactly **two Tauri commands** — `get_server_port` and `auto_login`
(`src/lib.rs::register_desktop_invoke_handler`). Everything else in the app talks
**HTTP to the embedded server**, the same way the web UI does.

The practical consequence: most "desktop bugs" are server or shared-UI bugs. Reach
for the desktop-specific machinery only when the problem is in one of the eleven
desktop-only modules — `auth`, `backend`, `host_mount`, `llm_provider`,
`magic_link`, `mcp`, `remote_access`, `settings`, `tray`, `tunnel_auth`, `updater`.

## Prerequisites

```bash
npm install                          # from the REPO ROOT — hoists both UI workspaces
cd src-app && cargo check --workspace
```

A build-time PostgreSQL with pgvector must be reachable on `127.0.0.1:54321` — the
desktop build compiles the whole server, whose SQLx macros verify queries at compile
time:

```bash
cd src-app && docker compose up -d        # the only service is postgres-build:54321
```

Concurrent worktrees are safe: build and test databases are namespaced by a stable
per-worktree key (FNV-1a of the worktree root), so two trees never clobber each
other on the shared cluster. See `CLAUDE.md` § *Per-worktree isolation*.

## Running it

### GUI (needs a display)

```bash
just desktop-dev          # == cd src-app/desktop/tauri && npx tauri dev
```

`tauri.conf.json` wires the rest: `beforeDevCommand` starts the desktop UI's Vite
server, `devUrl` is `http://localhost:1420`. The app starts its own **embedded
PostgreSQL** (`use_embedded: true`, port 54323) — no config file needed. This is
the zero-config path and the normal way to run it.

### Headless (no window)

```bash
ziee-desktop --headless --config-file <path/to/config.yaml>
```

Boots the embedded server with **all desktop-only routes mounted** and never creates
a window. Useful on a machine with no display.

> **`--headless` requires EXTERNAL PostgreSQL.** Set `postgresql.use_embedded: false`
> and point at a real database. Under embedded PG the desktop migrations never run —
> only the GUI path calls `run_desktop_migrations` — so `remote_access_settings` and
> `magic_link_tokens` don't exist and those routes 500. `src/lib.rs` says so directly:
> *"Headless against embedded is not a production path; the test harness always points
> at external postgres."*

### Bundling

```bash
just desktop-build        # == npx tauri build   → bundles for the HOST platform only
just desktop-build-debug  # unoptimized, faster
```

`beforeBuildCommand` builds **both** `src-app/ui` and `src-app/desktop/ui` first.

## Configuration

Unlike the server, the desktop app needs **no config file** — `run(config_file:
Option<String>)` defaults to embedded PostgreSQL. There is no `config/` directory
under `desktop/tauri`. Pass `--config-file` (or set `CONFIG_FILE`) only when you
need external PostgreSQL, which `--headless` does.

## How the desktop UI relates to the web UI

`src-app/desktop/ui` **reuses** `src-app/ui` through the `@/…` alias — it is not a
fork. `plugins/vite-plugin-local-override.ts` resolves in this precedence order:

1. `desktop/ui/src/<path>` — desktop-tree shadow (tier 1)
2. `ui/src/<path>.desktop.*` — co-located whole-file override (tier 2)
3. `ui/src/<path>` — the shared web implementation (tier 3)

Pick the smallest tool that fits: `<Seam>` for one element, `.desktop.tsx` for a
whole component, a tier-1 shadow for desktop-only code. Full guide:
[`ui/docs/UI_OVERRIDES.md`](ui/docs/UI_OVERRIDES.md).

Check for unintended divergence with:

```bash
just desktop-drift-check   # = identical · ≠ drifted · + desktop-only
```

A file that must differ carries a `DELIBERATE DIVERGENCE` marker; anything else
flagged `≠` should be re-synced from its `ui/src` counterpart.

> **Security (rule R2-3):** when you change logic in `src-app/ui`, diff the desktop
> counterpart. A dropped `evaluatePermission` filter once reached desktop production
> this way. Generated files (`openapi.json`, `api-client/types.ts`) are regenerated
> for both workspaces by `just openapi-regen`; the hand-written surfaces are the risk.

## Testing

```bash
just desktop-test          # rust + e2e
just desktop-test-rust     # cargo test in desktop/tauri
just desktop-test-l1       # tauri command tests
just desktop-test-l2       # release build + spawn-binary smoke
just desktop-test-l3       # tauri-driver WebDriver smoke — macOS ONLY
just desktop-test-e2e      # playwright
cd src-app/desktop/ui && npm run check     # tsc + biome + every lint/registry gate
cd src-app/desktop/ui && npm run gate:ui   # runtime-health + Layer A/axe
```

Every Rust test recipe depends on `workspace-cargo-pin-sqlx`, which keeps pgvector's
sqlx pinned to 0.8.6. Running `cargo test` directly in `desktop/tauri` skips that and
can pick up a split sqlx version.

`desktop-test-l3` targets `target/release/bundle/macos/Ziee.app` and runs only on
macOS. It uses the real user data dir (`~/Library/Application Support/com.ziee.chat/`),
so don't run it with a live session open. Details:
[`ui/tests/tauri-driver/README.md`](ui/tests/tauri-driver/README.md).

## Migrations

Desktop migrations live in `tauri/migrations/` and use a deliberate **`1e13` block**
(`10000000000005` and up) so they always apply **after** every server migration.

Server migrations use `2026…` timestamps in `server/src/modules/<module>/migrations/`.
**A new server migration must sort above the server max — not above the desktop
block.** Two independent sequences; do not take the global max as "the next number."

```bash
# next server prefix must exceed this
find src-app/server -path '*/migrations/*.sql' -printf '%f\n' | cut -d_ -f1 | sort -n | tail -1
```

After editing a migration, `cargo clean` so `build.rs` re-applies it.

## Building for macOS

**macOS artifacts cannot be built on Linux.** Tauri's macOS bundling needs Apple
tooling (`.app`/`.dmg` packaging, `codesign`), and a Linux host has no Darwin std
and no macOS SDK. Note that `just build-mac` is **not** the desktop app — it builds
the *server* binary and is meant to run on a Mac.

The supported path is `.github/workflows/desktop-release.yml`, which builds on
GitHub's `macos-latest` runners for `aarch64-apple-darwin` and `x86_64-apple-darwin`
(plus Windows and Linux), signs the updater bundles, uploads them to a GitHub
Release, and publishes `latest.json` to `gh-pages`.

```bash
git tag v0.2.0 && git push origin v0.2.0
```

Before that works in a fork, four things must be set up — see
[`docs/DESKTOP-UPDATER-RUNBOOK.md`](../../docs/DESKTOP-UPDATER-RUNBOOK.md):

1. **Updater endpoint** — `tauri.conf.json`'s `plugins.updater.endpoints` must point
   at this repo's GitHub Pages, and Pages must be enabled on the `gh-pages` branch.
2. **Signing keypair** — the `pubkey` baked into `tauri.conf.json` is a throwaway dev
   key whose private half is gitignored and **absent from a fresh checkout**. Generate
   your own (`npx tauri signer generate -w ~/.tauri/ziee_updater.key`), replace the
   `pubkey`, and register the private key as the `TAURI_SIGNING_PRIVATE_KEY` +
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets. The two must be a matching pair
   or installs fail signature verification.
3. **The workflow is tag-triggered only.** There is no `workflow_dispatch`, so every
   test build costs a tag.
4. **No OS code-signing / notarization is configured.** Updater *signature*
   verification works, but a first-time install shows the "unidentified developer"
   warning on macOS and Windows.

## Working on desktop from a Linux-only machine

This is viable, and more so than it looks:

- The desktop crate contains **zero `#[cfg(target_os = "macos")]` blocks** — the
  macOS-specific code is all server-side (`code_sandbox`'s `mac_vm` backend and the
  pgvector Apple-Silicon build wrapper).
- `webkit2gtk-4.1` gives you a working **Linux** bundle from `just desktop-build`,
  which is a real smoke test of the bundling pipeline.
- The gallery, `npm run check`, `gate:ui`, and Playwright are all headless.

What you cannot verify locally: the macOS bundle itself, `desktop-test-l3`, and any
cfg-gated macOS arm (a Linux `cargo check` never compiles those — lifecycle rule P5).
Those need a macOS machine or a CI run.
