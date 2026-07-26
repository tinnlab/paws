#!/usr/bin/env bash
# Run lifecycle-check against a faithful, CLEAN "only THIS feature's .lifecycle
# dir" view of the branch — i.e. exactly the post-merge-strip state.
#
# WHY: A1 ("a branch may carry exactly ONE .lifecycle feature dir") assumes the
# branch was cut from main, where .lifecycle is stripped at merge. This branch is
# cut from `origin/feat/agent-core`, which has ACCUMULATED 7 prior features'
# artifacts; deleting them here would delete them from agent-core on a
# fast-forward, so they stay.
#
# Earlier this script parked the inherited dirs in a temp dir, but that makes the
# working tree dirty and A2 (clean-tree at phase 8) rightly fails. Instead it now
# builds a detached STAGING WORKTREE at HEAD, removes the inherited dirs there
# and COMMITS the removal, so the gate sees a genuinely clean tree with exactly
# one feature dir. The real worktree is never touched.
#
# Usage: bash .lifecycle/sse-slot-leak/gate.sh --phase 8
#        bash .lifecycle/sse-slot-leak/gate.sh --all
set -eu

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
FEATURE="sse-slot-leak"
BASE="${LIFECYCLE_BASE:-origin/feat/agent-core}"
STAGE="${LIFECYCLE_STAGE:-/data/pbya/ziee/tmp/sse-slot-leak-gate-stage}"

git -C "$REPO" worktree remove --force "$STAGE" >/dev/null 2>&1 || true
rm -rf "$STAGE"
git -C "$REPO" worktree add --detach --quiet "$STAGE" HEAD

for d in "$STAGE"/.lifecycle/*/; do
  name="$(basename "$d")"
  [ "$name" = "$FEATURE" ] && continue
  git -C "$STAGE" rm -r --quiet -- ".lifecycle/$name"
done
if ! git -C "$STAGE" diff --cached --quiet; then
  git -C "$STAGE" -c user.name=gate -c user.email=gate@local \
      commit -q -m "gate: strip inherited .lifecycle dirs (staging only)"
fi

set +e
node "$REPO/.claude/lifecycle/lifecycle-check.mjs" \
  --repo "$STAGE" --dir ".lifecycle/$FEATURE" --base "$BASE" "$@"
rc=$?
set -e

git -C "$REPO" worktree remove --force "$STAGE" >/dev/null 2>&1 || true
exit $rc
