# FIX_ROUND-1 — the inherited round (commit `4597e1baf`)

Authored by the session that was killed shortly afterwards (SIGTERM at 00:21:37);
it left the commit but no round record. The continuation session **verified each
finding and each fix against the code before adopting them** — nothing here is
taken on the commit message's word.

## Findings fixed

- **F1-1 [test-faithfulness] — TEST-9 could never have failed for the right
  reason.** It scanned each catalog entry's whole JSON (including `name`) for the
  substring `"magic"`, while the mock mirror serves a fixture literally called
  `badmagic`. Verified: `default_fixtures` contains `name: "badmagic"`, and the
  pre-fix assertion was `entry.to_string().to_lowercase()`.
  **Fix (verified):** the entry's identity fields (`name`, `filename`) are removed
  before the scan, so the assertion is about whether *we* attached a validation
  error, not about upstream's naming.

- **F1-2 [test-faithfulness] — TEST-9's `size_bytes > 0` assertion was both
  wrong and tautological.** Wrong: the new `emptybody` fixture legitimately
  advertises 0, so the test would have failed on a correct system. Tautological:
  `> 0` passes for *any* nonzero number, including an on-disk one — which is
  precisely the confusion INV-6 exists to prevent.
  **Fix (verified):** the advertised size is compared against
  `fixture.bytes.len()` — what the mirror actually served, an external anchor.

- **F1-3 [test-coverage] — the `truncated` fixture was added but never driven.**
  `ModelRejection::Truncated` had unit coverage only; no test exercised it
  through the real download path.
  **Fix (verified):** TEST-3 gained a third arm asserting the message says
  "too short"/"ended after" and explicitly NOT "bad magic".

- **F1-4 [ui-presentation] — INV-6 from the other direction.** A catalog source
  that advertises `size_bytes: 0` rendered a naked "0 Bytes" on the row's own
  metadata line, with no failed download involved at all.
  **Fix (verified):** `AvailableModelsCard` suppresses the size when it is 0.

- **F1-5 [build-gate] — `npm run check` was RED on two generated artifacts.**
  `galleryCoverage` and `stateMatrix` had not been regenerated after
  `DownloadFailureRow` was added.
  **Fix (verified):** both regenerated; `check:gallery-coverage` and
  `check:state-matrix` pass.

## Verification performed by the continuation session

- Read the full commit diff and re-derived each claim from the source.
- Ran the whole voice integration suite on the resulting tree: **51 passed,
  0 failed** (`--test-threads=6`), including all five gap-closing tests.

**New confirmed findings:** 5
