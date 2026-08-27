# HUMAN_FEEDBACK — mcp-boot-probe-sandboxed-stdio

## Feedback received before implementation

The owner's brief set the scope and three non-negotiables, and they shaped the
work directly:

1. **"Settle which it is"** — race, or "desktop never sets the state at all".
   Settled, and one hypothesis is dead: `initialize_modules` is called by both
   entrypoints, so desktop does set it. Verified empirically (a desktop instance
   answers `/mcp/user-policy` with the projected sandbox state) rather than by
   reading. Neither hypothesis is the primary cause; the deterministic missing
   guard is.
2. **"The message must name the real cause instead of blaming `run_in_sandbox`"**
   — ITEM-4, plus ITEM-6/9 after the audits showed the misdirection also lived in
   the frontend tooltips, the toasts, and the create screens.
3. **"A probe failure must not silently DISABLE an admin's server on boot"** —
   ITEM-2. Two auditors flagged this as over-reach beyond the reported defect;
   it is kept because the owner asked for it explicitly, and its cost is stated
   in the PR rather than buried.
4. **"If it's a race, boot ordering needs a guarantee, not luck"** — delivered as
   a structural guarantee (the sweep never consults sandbox state for any row it
   probes) rather than the timed wait I first wrote, which the audit proved
   inert.
5. **"Chain as far as I got it, verify rather than trust"** — every link was
   re-derived first-hand; the lib.rs-vs-main.rs style lead was treated as
   unverified until checked.

Process instructions also followed: a separate branch and PR cut from
`origin/main` @ `8b295b268` (the same base as #16, not stacked on it), the
dependency noted in the PR body rather than in the branch graph, and no merge.

## Feedback received after implementation

No human feedback received on the implementation yet. The PR is open and unmerged pending the owner's review. Three
things in it are explicitly the owner's decision rather than mine, and are called
out at the top of the PR's trade-offs section:

- `unhealthy` becomes unreachable for sandboxed rows — which, because user policy
  force-sandboxes every user stdio server, is that whole class.
- A permanently dead non-sandboxed server now stays enabled and is re-dialled per
  chat turn. This follows from requirement (3) above.
- The pre-existing host-RCE via id-less Test Connection is re-escalated, not
  fixed. It was escalated on #16 and independently rediscovered here.

This file will record each critique and its resolution as review comes in.
