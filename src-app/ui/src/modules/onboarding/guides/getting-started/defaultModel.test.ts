import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_MIN_MEMORY_BYTES,
  DEFAULT_MODEL_MIN_MEMORY_GB,
  DEFAULT_MODEL_REPOSITORY_ID,
  DEFAULT_MODEL_REPOSITORY_URL,
} from './defaultModel.ts'

// TEST-8 (default-model-onboarding) — the default-model descriptor is coherent
// with itself AND with the two other artifacts that state the same facts.
//
// Three files describe this model: the seed migration (which repository row,
// at which URL), this descriptor (which repo path, file and engine), and the
// design doc (the human-readable record of the choice). Nothing links them at
// build time, so the failure mode is silent drift — the doc naming one quant
// while the code installs another, or the descriptor pointing at a repository
// UUID the migration never seeded, which would make every install 404.

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../../../../..')
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8')

test('the descriptor is internally coherent', () => {
  assert.ok(
    DEFAULT_MODEL.mainFilename.endsWith('.gguf'),
    'the weight file must be a GGUF — the verified llama.cpp path',
  )
  assert.equal(DEFAULT_MODEL.fileFormat, 'gguf')
  assert.equal(DEFAULT_MODEL.engineType, 'llamacpp')
  assert.equal(DEFAULT_MODEL.engine, 'llamacpp')
  assert.equal(DEFAULT_MODEL.repositoryId, DEFAULT_MODEL_REPOSITORY_ID)

  assert.ok(
    !DEFAULT_MODEL.repositoryPath.includes('/'),
    'the repository path is relative to the ORG-SCOPED base, so it must not be ' +
      `org-qualified; got "${DEFAULT_MODEL.repositoryPath}"`,
  )
  assert.ok(
    DEFAULT_MODEL.mainFilename.includes(DEFAULT_MODEL.quantization),
    'the quant named in the descriptor must be the quant of the file it downloads',
  )
  assert.match(
    DEFAULT_MODEL.mainFileSha256,
    /^[0-9a-f]{64}$/,
    'the drift pin must be a lowercase hex sha256',
  )
  assert.equal(
    DEFAULT_MODEL_MIN_MEMORY_BYTES,
    DEFAULT_MODEL_MIN_MEMORY_GB * 1024 ** 3,
    'the advisory threshold in bytes must match its GB figure',
  )
})

test('the descriptor matches the seed migration', () => {
  const seed = read(
    'src-app/server/src/modules/llm_repository/migrations/202607210100_llm_repository_default_model_seed.sql',
  )
  assert.ok(
    seed.includes(DEFAULT_MODEL_REPOSITORY_ID),
    'the descriptor\'s repository UUID must be the one the migration seeds — otherwise ' +
      'every install resolves a repository that does not exist',
  )
  assert.ok(
    seed.includes("'none'"),
    "the seeded row must be auth_type 'none' (INV-1)",
  )

  // The LIVE url lives in the LATER migration, not the seed.
  //
  // The seed was shipped, so it is immutable: editing it in place broke every
  // upgraded install with a checksum mismatch (FB-11). The mirror swap is
  // therefore an additive UPDATE, and this assertion follows the value rather
  // than the filename — asserting against the seed would either fail or, worse,
  // silently pass again the day someone "fixes" it by editing the seed.
  const mirror = read(
    'src-app/server/src/modules/llm_repository/migrations/202607210200_llm_repository_default_model_mirror.sql',
  )
  assert.ok(
    mirror.includes(`'${DEFAULT_MODEL_REPOSITORY_URL}'`),
    `the mirror migration must set the org-scoped base ${DEFAULT_MODEL_REPOSITORY_URL}`,
  )
  assert.ok(
    mirror.includes(DEFAULT_MODEL_REPOSITORY_ID),
    'the update must be scoped to the seeded row by id',
  )
  // Non-vacuity: the two files must genuinely differ on the url, otherwise this
  // test would keep passing if the split were undone.
  assert.ok(
    !seed.includes(`'${DEFAULT_MODEL_REPOSITORY_URL}'`),
    'the SHIPPED seed migration must not be edited to carry the new url — that is ' +
      'the change that bricks upgraded installs (FB-11)',
  )
})

test('the descriptor matches the design doc', () => {
  const design = read('docs/design/default-model-onboarding.md')
  // Derive the org from the seeded base instead of hardcoding it. This
  // assertion used to pin `unsloth/` as a literal, which made a provider-URL
  // swap fail here for a reason that has nothing to do with what it checks.
  const org = DEFAULT_MODEL_REPOSITORY_URL.split('/').pop()
  assert.ok(
    design.includes(`${org}/${DEFAULT_MODEL.repositoryPath}`),
    'the design doc names the repository this descriptor installs from',
  )
  assert.ok(
    design.includes(DEFAULT_MODEL.mainFilename),
    'the design doc names the exact quant file this descriptor installs',
  )
  assert.ok(
    design.includes(`${DEFAULT_MODEL.sizeGb} GB`),
    `the design doc states the same download size (${DEFAULT_MODEL.sizeGb} GB)`,
  )
})
