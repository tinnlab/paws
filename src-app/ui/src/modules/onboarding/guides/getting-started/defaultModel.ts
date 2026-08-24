/**
 * The default local model Onboarding offers — ONE definition (ITEM-2 / DEC-7).
 *
 * The step, its store, its tests and the seed migration all describe the same
 * model; keeping three copies of "which quant file" is how they drift. Everything
 * that names the model reads from here.
 *
 * These are deliberately FIXED CONSTANTS rather than an admin-configurable
 * settings row. They are not an operational limit an operator tunes against
 * their environment (the class the configurable-settings rule exists for —
 * memory/CPU/timeout caps, retention, quotas); they are the product's identity
 * choice of a default, versioned with the binary in the same way
 * `SEED_HUB_VERSION` and `BIOMCP_VERSION` are. An admin who wants a different
 * model already has a complete, permission-gated surface for it (Settings → LLM
 * Providers → "Download from Repository"), so a settings row would duplicate an
 * existing capability rather than add one. They are named exports, not inline
 * literals, so any of them can be promoted to a settings row later without a
 * rewrite.
 *
 * See `docs/design/default-model-onboarding.md` for why THIS model:
 * Qwen publishes no official GGUF, `unsloth` is the highest-usage ungated
 * third-party build, and GGUF routes to llama.cpp — the verified engine path.
 * The safetensors base repo would route to mistral.rs, whose flags CLAUDE.md
 * records as unverified against a real binary.
 *
 * The repository below is OUR MIRROR of that build
 * (`tinnlab/Qwen3.5-9B-GGUF`), not unsloth's repo directly. Nothing pins a
 * revision at install time — the LFS download asks for `refs/heads/main` and
 * takes what is there — so a shipped flow must not depend on a third-party
 * repository staying put. The mirrored file is byte-identical to unsloth's;
 * see `DEFAULT_MODEL_FILE_SHA256`.
 *
 * ## These strings are load-bearing and NOT covered by any test
 *
 * A wrong org, repo or quant name would ship green and 404 at clone time for
 * every user — no test can catch it, because the design forbids contacting the
 * real Hugging Face from tests, and a fixture necessarily uses its own names.
 * They were therefore verified by hand against the live upstream on
 * **2026-08-23** against upstream, and again on **2026-08-24** against the
 * mirror:
 *
 * - `GIT_TERMINAL_PROMPT=0 git ls-remote https://huggingface.co/tinnlab/Qwen3.5-9B-GGUF`
 *   → exit 0, no credential prompt (which is also the INV-1 premise).
 * - `https://huggingface.co/api/models/tinnlab/Qwen3.5-9B-GGUF` lists
 *   `Qwen3.5-9B-Q4_K_M.gguf` at 5680522464 bytes with LFS sha256
 *   matching `DEFAULT_MODEL_FILE_SHA256`.
 *
 * **Re-run both if you change any of them.**
 */

import type { EngineType, FileFormat } from '@/api-client/types'

/**
 * The seeded anonymous repository row
 * (`202607210100_llm_repository_default_model_seed.sql`).
 *
 * `built_in` + `enabled` + `auth_type = 'none'`, so a fresh install has it with
 * no admin action and installing needs no credential (INV-1 / INV-5).
 */
export const DEFAULT_MODEL_REPOSITORY_ID =
  'b3f1c5d2-7a48-4e91-9c26-5d0e8f3a1b74'

/**
 * ORG-SCOPED on purpose. `llm_repositories` carries `UNIQUE (url)` and the
 * credentialed built-in row already holds `https://huggingface.co`, so the
 * anonymous row lives one level down. `GitService::build_repository_url`
 * composes this base with `repositoryPath` — which is why that path is the bare
 * model name and NOT `unsloth/Qwen3.5-9B-GGUF`.
 */
export const DEFAULT_MODEL_REPOSITORY_URL = 'https://huggingface.co/tinnlab'

/**
 * The exact bytes the default install must land — the DRIFT PIN.
 *
 * `repositoryBranch: 'main'` is a moving target: the LFS client asks for
 * `refs/heads/main` (`utils/git/lfs/service.rs`) and takes whatever the branch
 * points at on the day the user installs. That client ALREADY verifies the
 * downloaded bytes against the oid in the pointer it was served (it fails with
 * `ChecksumMismatch`), so corruption in transit is covered. What is NOT covered
 * is the pointer itself changing — the repository publishing a DIFFERENT file at
 * the same path. This constant closes that gap: it names the file that was
 * actually reviewed, so a silent republish fails loudly instead of installing.
 *
 * It lives here, beside the rest of the descriptor, and NOT in the seed
 * migration: that migration seeds a REPOSITORY row (a URL and its auth), it
 * never names a file, and `llm_repositories` has no column for a per-file
 * digest. Versioning the pin with the binary — as `SEED_HUB_VERSION` and
 * `BIOMCP_VERSION` are — also means an upgrade ships a new expected hash,
 * whereas a row already in a user's database would not.
 */
export const DEFAULT_MODEL_FILE_SHA256 =
  '03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8'

/**
 * Upstream provenance of the mirrored file: the commit of
 * `unsloth/Qwen3.5-9B-GGUF` that `tinnlab/Qwen3.5-9B-GGUF` was mirrored from.
 * Recorded so the chain can be re-derived later; not used at runtime.
 */
export const DEFAULT_MODEL_UPSTREAM_COMMIT =
  '3885219b6810b007914f3a7950a8d1b469d598a5'

export interface DefaultModelDescriptor {
  /** Repository row the weights are cloned from. */
  repositoryId: string
  /** Path UNDER the org-scoped repository base — not org-qualified. */
  repositoryPath: string
  repositoryBranch: string
  /**
   * The single quant file to fetch. Upstream holds 25 quants up to a 17.92 GB
   * BF16; the mirror carries only this one.
   */
  mainFilename: string
  /** Expected sha256 of `mainFilename` — see `DEFAULT_MODEL_FILE_SHA256`. */
  mainFileSha256: string
  /**
   * STABLE model name — never timestamped.
   *
   * `llm_models` carries `UNIQUE (provider_id, name)`, so a stable name makes
   * the already-installed check exact AND makes a double install impossible at
   * the database level rather than only in the UI (DEC-3). This is a deliberate
   * departure from `AddLocalLlmModelDownloadDrawer`'s `generateModelId`, which
   * appends a timestamp because that surface wants a NEW model per submission;
   * this one wants exactly one.
   */
  name: string
  displayName: string
  description: string
  fileFormat: FileFormat
  engineType: EngineType
  /** Runtime engine to provision before the model can be served. */
  engine: 'llamacpp'
  quantization: string
  /** Download size as published, for the offer copy. */
  sizeGb: number
}

export const DEFAULT_MODEL: DefaultModelDescriptor = {
  repositoryId: DEFAULT_MODEL_REPOSITORY_ID,
  repositoryPath: 'Qwen3.5-9B-GGUF',
  repositoryBranch: 'main',
  mainFilename: 'Qwen3.5-9B-Q4_K_M.gguf',
  mainFileSha256: DEFAULT_MODEL_FILE_SHA256,
  name: 'ziee-default-qwen3-5-9b-q4-k-m',
  displayName: 'Qwen3.5 9B (Q4_K_M)',
  description:
    'The default local model — runs offline on your own machine, no API key required.',
  fileFormat: 'gguf',
  engineType: 'llamacpp',
  engine: 'llamacpp',
  quantization: 'Q4_K_M',
  sizeGb: 5.68,
}

/**
 * Capabilities recorded on the created model row. Chat + tools are what the
 * chat pipeline gates on; `context_length` is filled in by the local-runtime
 * validator from the GGUF metadata, so it is deliberately not guessed here.
 */
export const DEFAULT_MODEL_CAPABILITIES = { chat: true, tools: true } as const

/**
 * Working-set floor for the hardware ADVISORY (DEC-4).
 *
 * A 9B at Q4_K_M needs roughly this much free memory to run comfortably. Below
 * it the step shows a non-blocking warning — it never disables the install
 * control and never blocks Next, because INV-3 makes the download offerable and
 * never mandatory, and because a machine the user is about to free up is the
 * user's call, not ours.
 */
export const DEFAULT_MODEL_MIN_MEMORY_GB = 8

/** Bytes per GB as the hardware surface reports them (binary, not decimal). */
const BYTES_PER_GB = 1024 ** 3

export const DEFAULT_MODEL_MIN_MEMORY_BYTES =
  DEFAULT_MODEL_MIN_MEMORY_GB * BYTES_PER_GB
