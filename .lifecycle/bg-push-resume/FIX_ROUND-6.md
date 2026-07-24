# FIX_ROUND-6 — observation content type blind audit + fixes

Ran a fresh blind full-stack audit on the observation delta (backend content type
+ wire map + injection flag; FE renderer + ChatMessage/MessageActions). Security
(non-spoofable `#[serde(skip)]` flag, model cannot emit the block), wire-visibility
(observation → user-role text on BOTH loops via the shared converter), a11y/color
(semantic tokens only), and api-contract (both workspaces regenerated) came back
clean. Confirmed findings + fixes:

- **correctness/state (MEDIUM) — regenerate broken after an observation turn** —
  `startRegenerateMessage.ts` extracted the preceding user message's text with
  `type === 'text'` only; the preceding message is the observation (no text
  block), so it extracted "" → empty re-send → cancelled. FIXED: the extractor now
  also accepts `observation` (mirrors `MessageActions.extractText`).
- **maintainability (LOW) — incomplete propagation** — `findMatches.messageText`
  (in-conversation find + the collapse-length threshold) and the transcript
  `export/extension` ignored observation blocks, so a large observation card was
  unfindable, never offered collapse, and was dropped from exports. FIXED: both now
  include `observation`.
- **patterns (LOW) — `isUser` vs `renderAsUser` inconsistency** — the fallback
  `ContentRenderer` and the attachment `ContentRenderer` still passed raw `isUser`.
  FIXED: both now pass `renderAsUser` (removes the latent inconsistency; benign
  today since observation blocks are always claimed and observation messages have
  no attachments).
- **i18n/copy (LOW) — vague card label** — "System update" → "Background result"
  (accurate for the sole producer; the body already begins "[Background task
  complete]").
- **edge-cases (LOW) — mixed observation+text message** — REJECTED as unreachable:
  the sole producer emits a single observation block; `isObservation` uses
  `.every()` guarded by `contents.length > 0`, so a pure-observation message is
  correctly the only card-rendered shape. No code change.

All fixes are tsc-clean. A final blind convergence round follows (FIX_ROUND-7).

**New confirmed findings:** 4
