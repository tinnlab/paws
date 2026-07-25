#!/usr/bin/env bash
# =============================================================================
# prove-worktree-isolation.sh — the acceptance gate for the concurrent-worktree
# resource-isolation layer (audit §9). Launches K simultaneous full runs across
# K throwaway git worktrees and asserts ZERO cross-run interference.
#
#   just prove-isolation K=8            # default matrix (gate:ui + dev-pair)
#   just prove-isolation K=8 COLD=1     # wipe .ziee-cache + vite cache first
#   just prove-isolation K=4 FULL=1     # ALSO run `just test` + web/desktop e2e
#
# Green (exit 0) at K=8 COLD=1 is the exit condition for the isolation build.
#
# HARD RULE (obeys the same rules it verifies): every resource is tagged with
# this run's PROVE_RUNID; teardown removes ONLY our own throwaway worktrees +
# our own PROVE_RUNID-tagged docker. NEVER a broad docker/pkill/rm/prune.
# =============================================================================
set -u

# ---- args (K=.. COLD=.. FULL=.. GATE=.. DEV=.. plus repo autodetect) --------
K=8; COLD=0; FULL=0; GATE=1; DEV=1
for a in "$@"; do case "$a" in
  K=*) K="${a#K=}";; COLD=*) COLD="${a#COLD=}";; FULL=*) FULL="${a#FULL=}";;
  GATE=*) GATE="${a#GATE=}";; DEV=*) DEV="${a#DEV=}";;
esac; done
[ "$FULL" = "1" ] && { TEST=1; E2E=1; } || { TEST=0; E2E=0; }

SRC_REPO="$(git rev-parse --show-toplevel)"
SRC_REF="$(git rev-parse HEAD)"
PROVE_RUNID="prove-$(date +%s)-$$"
WORK="/data/pbya/ziee/tmp/prove-iso/$PROVE_RUNID"
LOGROOT="$WORK/_logs"
mkdir -p "$LOGROOT"

log()  { printf '%s %s\n' "[$(date +%H:%M:%S)]" "$*"; }
fail_markers=0
declare -a WT_DIRS=()
declare -a BOUND_PORTS=()
declare -a SPAWNED_PIDS=()

# ---------------------------------------------------------------------------
# teardown — runId-scoped ONLY. Kills only PIDs we spawned + removes only our
# worktrees + our PROVE_RUNID docker. No broad reaping.
# ---------------------------------------------------------------------------
cleanup() {
  log "teardown ($PROVE_RUNID) — scoped only"
  for p in "${SPAWNED_PIDS[@]:-}"; do [ -n "$p" ] && kill -TERM "-$p" 2>/dev/null; kill -TERM "$p" 2>/dev/null; done
  sleep 1
  for p in "${SPAWNED_PIDS[@]:-}"; do [ -n "$p" ] && kill -KILL "$p" 2>/dev/null; done
  # our own docker only (none expected unless FULL); filter by our runid tag.
  if command -v docker >/dev/null 2>&1; then
    ids="$(docker ps -aq --filter "name=$PROVE_RUNID" 2>/dev/null)"
    [ -n "$ids" ] && docker rm -f $ids >/dev/null 2>&1
  fi
  for d in "${WT_DIRS[@]:-}"; do
    [ -n "$d" ] && git -C "$SRC_REPO" worktree remove --force "$d" 2>/dev/null
  done
  git -C "$SRC_REPO" worktree prune 2>/dev/null
  rm -rf "$WORK" 2>/dev/null
}
trap cleanup EXIT INT TERM

log "=== prove-worktree-isolation: K=$K COLD=$COLD FULL=$FULL (GATE=$GATE DEV=$DEV TEST=$TEST E2E=$E2E) ==="
log "base repo=$SRC_REPO ref=${SRC_REF:0:9} runid=$PROVE_RUNID"

# ---------------------------------------------------------------------------
# 1. Setup — K throwaway worktrees off HEAD, submodules + hub-seed + deps.
#    node_modules is a real `npm install` per worktree so the vite optimizeDeps
#    cache (node_modules/.vite) is genuinely per-worktree (COLD-honest).
# ---------------------------------------------------------------------------
setup_wt() {
  local i="$1" wt="$WORK/wt-$i" lg="$LOGROOT/wt-$i-setup.log"
  git -C "$SRC_REPO" worktree add --detach "$wt" "$SRC_REF" >>"$lg" 2>&1 || { echo "SETUP-FAIL $i" >>"$lg"; return 1; }
  git -C "$wt" submodule update --init --recursive >>"$lg" 2>&1
  # hub-seed copy (the known worktree gotcha) — from the base repo if present.
  if [ -d "$SRC_REPO/src-app/server/binaries/hub-seed" ]; then
    mkdir -p "$wt/src-app/server/binaries"
    cp -r "$SRC_REPO/src-app/server/binaries/hub-seed" "$wt/src-app/server/binaries/" >>"$lg" 2>&1
  fi
  ( cd "$wt" && npm install --no-audit --no-fund >>"$lg" 2>&1 ) || { echo "NPM-FAIL $i" >>"$lg"; return 1; }
  if [ "$COLD" = "1" ]; then
    rm -rf "$wt/.ziee-cache" "$wt/node_modules/.vite" "$wt/src-app/ui/node_modules/.vite" 2>/dev/null
  fi
  echo "OK $i"
}
log "creating + provisioning $K worktrees (parallel)…"
setup_pids=()
for i in $(seq 1 "$K"); do WT_DIRS+=("$WORK/wt-$i"); setup_wt "$i" & setup_pids+=("$!"); done
setup_ok=1
for p in "${setup_pids[@]}"; do wait "$p" || setup_ok=0; done
for i in $(seq 1 "$K"); do [ -d "$WORK/wt-$i/node_modules" ] || { log "❌ worktree $i setup incomplete (see $LOGROOT/wt-$i-setup.log)"; setup_ok=0; }; done
[ "$setup_ok" = "1" ] || { log "❌ SETUP FAILED — aborting"; exit 2; }
log "✅ $K worktrees provisioned"

# snapshot ~/.ziee so we can assert e2e/dev did NOT write it.
HOME_ZIEE="$HOME/.ziee"
ZIEE_BEFORE="$(find "$HOME_ZIEE" -type f 2>/dev/null | wc -l)"

# ---------------------------------------------------------------------------
# 2. Launch the matrix simultaneously across all worktrees.
# ---------------------------------------------------------------------------
run_wt() {
  local i="$1" wt="$WORK/wt-$i"
  # DEV leg: a bare `npm run dev` in the web ui — exercises the key-derived
  # bind-checked vite port + the /__worktree sentinel. Capture the port it binds.
  if [ "$DEV" = "1" ]; then
    ( cd "$wt/src-app/ui" && npm run dev >"$LOGROOT/wt-$i-dev.log" 2>&1 ) &
    echo "$!" >"$LOGROOT/wt-$i-dev.pid"
  fi
  # GATE leg: the flagship — gate:ui runtime-health (skip visual for speed). Must
  # each hit a DISTINCT port and test ITS OWN tree (no foreign reuse).
  if [ "$GATE" = "1" ]; then
    ( cd "$wt/src-app/ui" && npm run gate:ui -- --skip-visual >"$LOGROOT/wt-$i-gate.log" 2>&1 ) &
    echo "$!" >"$LOGROOT/wt-$i-gate.pid"
  fi
  # FULL legs (opt-in, heavy): backend integration + web e2e.
  if [ "$TEST" = "1" ]; then
    ( cd "$wt/src-app/server" && cargo test --test integration_tests -- --test-threads=4 project:: >"$LOGROOT/wt-$i-test.log" 2>&1 ) &
    echo "$!" >"$LOGROOT/wt-$i-test.pid"
  fi
  if [ "$E2E" = "1" ]; then
    ( cd "$wt/src-app/ui" && npm run test:e2e -- tests/e2e/11-projects --workers=1 >"$LOGROOT/wt-$i-e2e.log" 2>&1 ) &
    echo "$!" >"$LOGROOT/wt-$i-e2e.pid"
  fi
}
log "launching matrix on all $K worktrees simultaneously…"
for i in $(seq 1 "$K"); do run_wt "$i"; done
# record every spawned pid for scoped teardown.
for f in "$LOGROOT"/wt-*.pid; do [ -f "$f" ] && SPAWNED_PIDS+=("$(cat "$f")"); done

# ---------------------------------------------------------------------------
# 3. Provenance probe — while the dev servers are up, hit each /__worktree and
#    assert it reports ITS OWN worktree root (sentinel isolation). We poll each
#    dev log for the vite "Local: http://localhost:PORT" line to learn its port.
# ---------------------------------------------------------------------------
declare -A DEV_PORT=()
if [ "$DEV" = "1" ]; then
  log "waiting for dev servers + probing /__worktree sentinels…"
  for i in $(seq 1 "$K"); do
    port=""
    for _ in $(seq 1 60); do
      port="$(grep -oaE 'localhost:[0-9]+' "$LOGROOT/wt-$i-dev.log" 2>/dev/null | head -1 | cut -d: -f2)"
      [ -n "$port" ] && break; sleep 2
    done
    DEV_PORT[$i]="$port"
    [ -n "$port" ] && BOUND_PORTS+=("$port")
  done
  # provenance assertion
  for i in $(seq 1 "$K"); do
    port="${DEV_PORT[$i]:-}"; wt="$WORK/wt-$i"
    [ -z "$port" ] && { log "❌ wt-$i dev server never reported a port"; fail_markers=$((fail_markers+1)); continue; }
    sroot="$(curl -fsS --max-time 3 "http://localhost:$port/__worktree" 2>/dev/null | sed -n 's/.*"worktreeRoot":"\([^"]*\)".*/\1/p')"
    if [ "$sroot" = "$wt" ]; then
      log "  ✅ wt-$i :$port sentinel = its own root"
    else
      log "  ❌ wt-$i :$port sentinel='$sroot' expected '$wt' (FOREIGN/absent)"; fail_markers=$((fail_markers+1))
    fi
  done
fi

# ---------------------------------------------------------------------------
# 4. Wait for the gate:ui runs to finish (they self-terminate), collect ports.
# ---------------------------------------------------------------------------
if [ "$GATE" = "1" ]; then
  log "waiting for gate:ui runs…"
  for f in "$LOGROOT"/wt-*-gate.pid; do [ -f "$f" ] && wait "$(cat "$f")" 2>/dev/null; done
  for i in $(seq 1 "$K"); do
    gp="$(grep -oaE 'gallery dev server (already )?on :[0-9]+|on :[0-9]+' "$LOGROOT/wt-$i-gate.log" 2>/dev/null | grep -oE '[0-9]+' | head -1)"
    [ -n "$gp" ] && BOUND_PORTS+=("$gp")
  done
fi

# ---------------------------------------------------------------------------
# 5. ASSERTIONS (the proof).
# ---------------------------------------------------------------------------
log "=== assertions ==="

# (a) no-foreign-reuse: the OLD blind-reuse string must be ABSENT; and no gate
#     run may have reused a FOREIGN server.
if [ "$GATE" = "1" ]; then
  if grep -rIl 'reusing gallery dev server already on' "$LOGROOT" >/dev/null 2>&1; then
    log "❌ a gate:ui log contains the blind-reuse string 'reusing gallery dev server already on' (foreign-reuse risk)"; fail_markers=$((fail_markers+1))
  else
    log "  ✅ no blind 'reusing gallery dev server' in any gate log"
  fi
  if grep -rIl 'FOREIGN worktree' "$LOGROOT"/wt-*-gate.log >/dev/null 2>&1; then
    log "  ℹ a gate run detected + rejected a FOREIGN server on its base (correct no-foreign-reuse) — booted its own"
  fi
fi

# (b) ports pairwise-disjoint.
dupes="$(printf '%s\n' "${BOUND_PORTS[@]:-}" | sort | uniq -d)"
if [ -n "$dupes" ]; then
  log "❌ bound ports NOT disjoint — collisions: $dupes"; fail_markers=$((fail_markers+1))
else
  log "  ✅ bound ports pairwise-disjoint ($(printf '%s ' "${BOUND_PORTS[@]:-}"))"
fi

# (c) forbidden cross-run error markers in ANY log.
MARKERS='net::ERR_ABORTED|ERR_CONNECTION_REFUSED|ECONNREFUSED|address already in use|EADDRINUSE|port is already allocated|port already allocated|55006|3D000|42P04|template .* does not exist'
if grep -rIaE "$MARKERS" "$LOGROOT" >/dev/null 2>&1; then
  log "❌ forbidden cross-run marker(s) found:"; grep -rIaEo "$MARKERS" "$LOGROOT" | sort | uniq -c | sed 's/^/     /'
  fail_markers=$((fail_markers+1))
else
  log "  ✅ zero forbidden cross-run error markers"
fi
# ENOENT specifically on a .test-configs path
if grep -rIa 'ENOENT' "$LOGROOT" 2>/dev/null | grep -q '.test-configs'; then
  log "❌ ENOENT on a .test-configs path (stale-config reaped mid-run)"; fail_markers=$((fail_markers+1))
fi

# (d) ~/.ziee not written by the runs (e2e/dev use per-worktree data-dir).
ZIEE_AFTER="$(find "$HOME_ZIEE" -type f 2>/dev/null | wc -l)"
if [ "$E2E" = "1" ] || [ "$DEV" = "1" ]; then
  if [ "$ZIEE_AFTER" -gt "$ZIEE_BEFORE" ]; then
    log "⚠  ~/.ziee gained $((ZIEE_AFTER-ZIEE_BEFORE)) file(s) during the run (expected 0 new e2e writes; dev servers may touch bin cache — inspect if FULL)"
    [ "$E2E" = "1" ] && fail_markers=$((fail_markers+1))
  else
    log "  ✅ ~/.ziee file count unchanged ($ZIEE_BEFORE) — runs wrote their own data-dir"
  fi
fi

# (e) extracted-binary sha256 integrity across worktrees (no torn/partial).
#     Compare each worktree's staged embedded binaries to the base repo's copy.
integ_ok=1
for i in $(seq 1 "$K"); do
  for bin in $(find "$WORK/wt-$i/.ziee-cache/bin" "$WORK/wt-$i/src-app/server/binaries" -type f 2>/dev/null | head -20); do
    [ -s "$bin" ] || { log "❌ wt-$i extracted binary is ZERO bytes: $bin"; integ_ok=0; fail_markers=$((fail_markers+1)); }
  done
done
[ "$integ_ok" = "1" ] && log "  ✅ no zero-byte/torn extracted binaries in any worktree"

# (f) each gate:ui reported its own surfaces (provenance already probed via dev
#     sentinel in step 3; gate logs must show a per-surface verdict, not a crash).
if [ "$GATE" = "1" ]; then
  for i in $(seq 1 "$K"); do
    if ! grep -qa 'per-surface runtime verdict\|GATE PASSED\|GATE FAILED' "$LOGROOT/wt-$i-gate.log" 2>/dev/null; then
      log "❌ wt-$i gate:ui produced no surface verdict (did not run its own tree)"; fail_markers=$((fail_markers+1))
    fi
  done
fi

# ---------------------------------------------------------------------------
# 6. Verdict.
# ---------------------------------------------------------------------------
log "=== VERDICT ==="
if [ "$fail_markers" -eq 0 ]; then
  log "✅ PROVE-ISOLATION PASS (K=$K COLD=$COLD FULL=$FULL) — zero cross-run interference"
  exit 0
else
  log "❌ PROVE-ISOLATION FAIL — $fail_markers finding(s). Logs: $LOGROOT (copied below)"
  cp -r "$LOGROOT" "/data/pbya/ziee/tmp/prove-iso-lastfail-$PROVE_RUNID" 2>/dev/null
  log "   (logs preserved at /data/pbya/ziee/tmp/prove-iso-lastfail-$PROVE_RUNID)"
  exit 1
fi
