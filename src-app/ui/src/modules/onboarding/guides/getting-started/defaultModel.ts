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
 * ## These strings are load-bearing and NOT covered by any test
 *
 * A wrong org, repo or quant name would ship green and 404 at clone time for
 * every user — no test can catch it, because the design forbids contacting the
 * real Hugging Face from tests, and a fixture necessarily uses its own names.
 * They were therefore verified by hand against the live upstream on
 * **2026-08-23**:
 *
 * - `GIT_TERMINAL_PROMPT=0 git ls-remote https://huggingface.co/unsloth/Qwen3.5-9B-GGUF`
 *   → exit 0, no credential prompt (which is also the INV-1 premise).
 * - `https://huggingface.co/api/models/unsloth/Qwen3.5-9B-GGUF` lists
 *   `Qwen3.5-9B-Q4_K_M.gguf` among its 28 files.
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
export const DEFAULT_MODEL_REPOSITORY_URL = 'https://huggingface.co/unsloth'

export interface DefaultModelDescriptor {
  /** Repository row the weights are cloned from. */
  repositoryId: string
  /** Path UNDER the org-scoped repository base — not org-qualified. */
  repositoryPath: string
  repositoryBranch: string
  /** The single quant file to fetch. The repo holds 25 quants up to a 17.92 GB BF16. */
  mainFilename: string
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
