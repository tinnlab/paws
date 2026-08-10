# BASE — conflict surface vs current main

Base commit: `000853d3b` (= `origin/main` at branch time).

- **Highest existing server migration prefix:** `202607200400`. This branch adds
  **no migration** — it is frontend-only.
- **OpenAPI regen implied?** No. No Rust handler/type changes, so neither
  `openapi.json` nor `api-client/types.ts` changes in either workspace.
- **Files this branch will touch that main is also active in:**
  - `src-app/ui/src/modules/chat/components/ChatMessage.tsx` — actively changed on
    main (the offending hook landed in `e6f33d71d`). Highest collision risk; the
    edit is a 5-line move within one function, so a textual conflict is possible
    but trivially resolvable.
  - `sdk/packages/shell/src/bootstrap/AppShell.tsx` — SDK submodule. Any change
    here is committed on the `sdk` submodule branch `chat` (tip
    `0ba6253855742813bb43e7e0466131496c8ed97a`), NOT pushed; the parent-repo
    pointer bump is sequenced by the orchestrator.
  - `src-app/ui/` lint config — low churn.
- **Desktop workspace:** `src-app/desktop/ui/` has its own hand-written overrides.
  `ChatMessage.tsx` lives only in `src-app/ui`; the desktop app consumes the same
  `@ziee/shell` SDK package, so ITEM-2/3 benefit both automatically. R2-3 diff-review
  of the desktop counterpart still applies — checked in PLAN_AUDIT.
