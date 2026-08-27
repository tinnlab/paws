# HUMAN_FEEDBACK — upstream-pulldown

- **FB-1** [status: resolved] — "All 9 (full defect set)" — the owner's answer to an
  explicit option picker offering (a) all nine, (b) everything except the agent
  task-list chain, (c) security/correctness only. → All nine picked, including the
  agent chain with its migration. Recorded as DEC-1.
- **FB-2** [status: resolved] — "Do NOT move the sdk submodule pointer in any PR; if a
  port needs an sdk change, STOP and escalate" (standing instruction in the worker
  brief). → `f09558f48` / `f6c586408` were excluded on exactly this ground and
  escalated; TEST-31 asserts mechanically that no gitlink moved. Recorded as DEC-6.
  [generalizable: yes — when a fix spans a submodule boundary, the branch a shared
  submodule's change goes to is an OWNER decision, never the implementer's; port the
  sdk-free subset if one exists and escalate the rest, rather than either widening the
  PR or silently dropping the fix]
- **FB-3** [status: resolved] — "Never edit a migration that has already shipped"
  (worker brief). → `abc8d2429` edits the migration `ee48f1a77` adds, so the two are
  squashed into one commit; no `GRANDFATHERED` entry was added, and TEST-30 confirms
  the guard stays green. Recorded as DEC-3/DEC-4.

No further human feedback has been received on the running code — the branch has not
yet been reviewed by the owner. The three entries above are the instructions that
shaped it, recorded verbatim with their resolutions.
