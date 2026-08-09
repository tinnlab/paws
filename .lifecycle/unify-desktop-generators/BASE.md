# BASE — conflict surface vs current main

Branched from `origin/main` @ `dca29493f`
("lifecycle: round-7 audit record, coverage for the config-driven branches").
sdk submodule pinned at `0ba6253855742813bb43e7e0466131496c8ed97a` (branch `chat`).

- **Highest existing server migration prefix:** `202607200400`. This branch adds
  **no** migration, so no collision surface.
- **Files main is also touching:** the immediately-preceding merged work touched
  the same area (`sdk/packages/gallery/scripts/`, `gallery-harness-copies.json`,
  `src-app/ui/scripts/check-harness-parity.consumer.test.mjs`). This branch edits
  the consumer test and both `package.json`s; a concurrent branch in that area
  would conflict textually but not semantically.
- **OpenAPI regen implied:** no. No Rust handler / `JsonSchema` type is touched.
- **Submodule:** changes may land in `sdk` (branch `chat`). Sequenced sdk-first,
  then the pointer, by the owner. Not pushed from here.
