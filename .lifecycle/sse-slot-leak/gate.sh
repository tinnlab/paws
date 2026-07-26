#!/usr/bin/env bash
# Run lifecycle-check against a faithful "only THIS feature's .lifecycle dir"
# view of the worktree.
#
# WHY: A1 ("a branch may carry exactly ONE .lifecycle feature dir") assumes the
# branch was cut from main, where .lifecycle is stripped at merge. This branch is
# cut from `origin/feat/agent-core`, which has ACCUMULATED 7 prior features'
# artifacts. Deleting them here would delete them from agent-core on a
# fast-forward, so they stay. Instead we stash the INHERITED dirs into a
# scratch dir for the duration of one gate run and restore them immediately
# after (trap-guarded), so the gate sees exactly the post-merge-strip state.
#
# Usage: bash .lifecycle/sse-slot-leak/gate.sh --phase 3
#        bash .lifecycle/sse-slot-leak/gate.sh --all
set -u

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
FEATURE="sse-slot-leak"
BASE="${LIFECYCLE_BASE:-origin/feat/agent-core}"
PARK="$(mktemp -d)"

restore() {
  for d in "$PARK"/*; do
    [ -e "$d" ] || continue
    mv "$d" "$REPO/.lifecycle/$(basename "$d")"
  done
  rmdir "$PARK" 2>/dev/null || true
}
trap restore EXIT INT TERM

for d in "$REPO"/.lifecycle/*/; do
  name="$(basename "$d")"
  [ "$name" = "$FEATURE" ] && continue
  mv "$d" "$PARK/$name"
done

node "$REPO/.claude/lifecycle/lifecycle-check.mjs" \
  --repo "$REPO" --dir ".lifecycle/$FEATURE" --base "$BASE" "$@"
