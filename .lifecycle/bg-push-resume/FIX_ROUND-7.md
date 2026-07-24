# FIX_ROUND-7 — observation content type convergence

Re-reviewed the FIX_ROUND-6 fixes (all small, mechanical propagations of the new
`observation` content type + a copy tweak) and re-ran the verifying checks:

- `startRegenerateMessage` / `findMatches.messageText` / `export/extension` now all
  recognize `observation` (mirroring `MessageActions.extractText`, which is
  exercised) — the parallel-extractor gap is closed.
- `ChatMessage.tsx` uses `renderAsUser` consistently at all render/attachment call
  sites (no raw `isUser` left in the layout path).
- Card label is "Background result".
- `tsc --noEmit` PASS (all 6 changed FE files typecheck).
- `npm run check (ui)` PASS (full static contract incl. testid/gallery/state-matrix).
- TEST-10 e2e PASS (real browser: observation card renders distinctly, not a user
  bubble, no Edit affordance, assistant continues).
- TEST-5 integration PASS (injected block is `observation`-typed + assistant
  continues) and TEST-9 unit PASS (wire-map + flag selection).

No remaining findings. The MEDIUM regenerate-after-observation bug is fixed at the
extractor and mirrors the tested `MessageActions.extractText` sibling.

**New confirmed findings:** 0
