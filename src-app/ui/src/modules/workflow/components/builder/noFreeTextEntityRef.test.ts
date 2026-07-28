import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// TEST-3 (acceptance, INV-3) — "an entity reference the system can enumerate is
// never a free-text field."
//
// This is deliberately the CLASS test, not "the Tool field is a Combobox". The
// rule the owner stated is general: any field whose valid values the system can
// list must be a picker. A test pinned to the one field we happened to fix would
// still pass the day someone adds a free-text `model` or `assistant` field to a
// new step form — which is exactly the regression this guards.
//
// It scans the SOURCE of every builder step form for a free-text control bound
// to an enumerable field. Source-scanning is the honest mechanism here: the rule
// is about which CONTROL a field uses, which no runtime assertion over one
// rendered form can generalise across forms that do not exist yet.

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Fields whose valid values this app can enumerate from an existing endpoint.
 * Adding a new one here is how the rule grows.
 *   server / tool  → GET /api/mcp/servers[/{id}/tools]
 *   model          → the model registry
 *   assistant      → the assistant list
 *   flavor         → code_sandbox KNOWN_FLAVORS
 */
const ENUMERABLE_FIELDS = [
  'server',
  'tool',
  'model',
  'model_id',
  'assistant',
  'assistant_id',
  'flavor',
] as const

/** Controls that let a person type an arbitrary value. */
const FREE_TEXT_CONTROLS = ['Input', 'Textarea', 'PasswordInput'] as const

/** Controls that offer a value set the person chooses from. */
const PICKER_CONTROLS = ['Select', 'Combobox', 'MultiSelect', 'RadioGroup', 'Segmented'] as const

/** Every step-form source in the builder. */
function stepFormSources(): { file: string; src: string }[] {
  return readdirSync(HERE)
    .filter(f => /StepForm\.tsx$/.test(f))
    .map(file => ({ file, src: readFileSync(join(HERE, file), 'utf8') }))
}

/** Every enumerable step field bound to one of `controls` in `src`. */
function fieldsBoundTo(src: string, controls: readonly string[]): Set<string> {
  const found = new Set<string>()
  for (const control of controls) {
    // Each JSX element occurrence of this control, up to its closing bracket.
    const re = new RegExp(`<${control}\\b[\\s\\S]*?/>`, 'g')
    for (const match of src.match(re) ?? []) {
      for (const field of ENUMERABLE_FIELDS) {
        // `value={step.server ...}` / `value={step.tool ?? ''}` — the binding,
        // not a mention in a comment or a placeholder string. `CapabilitySelect`
        // and friends wrap a picker, so a `testid`-carrying wrapper is matched
        // through its own `value={step.<field>}` binding too.
        const bind = new RegExp(`value=\\{[^}]*\\bstep\\.${field}\\b`)
        if (bind.test(match)) found.add(field)
      }
    }
  }
  return found
}

/**
 * An enumerable field bound to a free-text control, with NO picker for the same
 * field anywhere in the file.
 *
 * The paired-picker carve-out is the INV-6 escape hatch and nothing wider: a
 * server that cannot be reached has no enumerable value set, so hand entry is
 * the only way to finish the workflow — but the form must still offer the picker
 * as the PRIMARY path. A form that binds the field ONLY to a text box has not
 * degraded from anything; it just never asked the system.
 */
function offendingBindings(src: string): string[] {
  const typed = fieldsBoundTo(src, FREE_TEXT_CONTROLS)
  const picked = fieldsBoundTo(src, PICKER_CONTROLS)
  return [...typed]
    .filter(field => !picked.has(field))
    .map(field => `step.${field} is typed, with no picker for it`)
}

test('the builder never asks a person to TYPE a value the system can enumerate', () => {
  const sources = stepFormSources()
  assert.ok(
    sources.length >= 5,
    `expected to find the builder step forms; found ${sources.length} — this scanner ` +
      'has drifted from the file layout and is no longer guarding anything',
  )

  const offenders: string[] = []
  for (const { file, src } of sources) {
    for (const hit of offendingBindings(src)) offenders.push(`${file}: ${hit}`)
  }

  assert.deepEqual(
    offenders,
    [],
    'These fields hold an entity the system can list, so they must be a picker ' +
      '(Select / Combobox / MultiSelect) rather than a text box the author fills ' +
      'from memory. See DESIGN.md §2.3.',
  )
})

test('the tool step actually offers its server’s tools as options', () => {
  // The concrete half of the rule: ToolStepForm must build its options from the
  // fetched catalog. Asserting a Combobox EXISTS would not prove the options
  // come from the server — this asserts the wiring.
  const src = readFileSync(join(HERE, 'ToolStepForm.tsx'), 'utf8')
  assert.match(src, /<Combobox\b/, 'the Tool field must be a picker')
  assert.match(
    src,
    /entry\.tools\.map/,
    "the Tool picker's options must be derived from the server's real tool list",
  )
  assert.match(
    src,
    /ToolCatalogStoreDef/,
    'the tool list must come from the catalog that calls listTools',
  )
})

test('the scanner would CATCH a regression (negative control)', () => {
  // Guards the guard: if `offendingBindings` silently stopped matching, the
  // test above would pass vacuously forever. This is the EXACT shape the tool
  // step had before this change — a text box and nothing else.
  // NB: the fixtures carry NO data-testid — these strings are scanned by the
  // shared testid-registry generator, and a unit test's fixture must never
  // enter the app's cross-repo production registry.
  const regressed = `
    <Input
      value={step.tool ?? ''}
      onChange={e => patch({ tool: e.target.value })}
    />`
  assert.deepEqual(offendingBindings(regressed), [
    'step.tool is typed, with no picker for it',
  ])

  // And the carve-out is narrow: adding a picker for the SAME field clears it,
  // adding one for a DIFFERENT field does not.
  const withPicker = `${regressed}
    <Combobox options={o} value={step.tool ?? ''} onChange={f} />`
  assert.deepEqual(offendingBindings(withPicker), [])

  const withUnrelatedPicker = `${regressed}
    <Select options={o} value={step.server ?? ''} onChange={f} />`
  assert.deepEqual(offendingBindings(withUnrelatedPicker), [
    'step.tool is typed, with no picker for it',
  ])
})
