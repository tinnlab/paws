/**
 * ACCEPTANCE — the Rules-of-Hooks gates must be ENABLED, WIRED, and NOT NO-OPS.
 *
 * ## Why this file exists
 *
 * A production white screen was traced to a hook placed after an early return in
 * `ChatMessage`. The repo already had a hooks guard (`scripts/lint-hooks.mjs`)
 * chained into `npm run check` — and it passed, because of two independent holes:
 *
 *   HOLE 1 — the guard's own rule H1 deliberately EXCLUDES the
 *     `after-early-return` context, deferring it to "the standard rules-of-hooks
 *     rule's territory". That standard rule (biome `correctness/useHookAtTopLevel`)
 *     was never enabled. The deferral pointed at nothing.
 *
 *   HOLE 2 — the guard identifies store proxies from `export const X = factory(…)`,
 *     but the `File` store is exported as `const FileInner = registerLazyStore(…);
 *     export const File = FileInner`. That bare-identifier alias never entered the
 *     proxy registry, so every conditional read of it was unchecked. The guard
 *     reported "OK — 0 violations across 2597 files" while 15 real violations
 *     existed, all in the `modules/file` tree and three of them on the chat render
 *     path.
 *
 * Both holes are now closed. This file exists so they cannot silently REOPEN, and
 * so the fix cannot degrade into a rule that is configured but never executed —
 * which is exactly what HOLE 1 was.
 *
 * ## The known-positive controls are the point
 *
 * A linter that reports zero is indistinguishable from a linter that is broken,
 * mis-scoped, or excluded away. So this asserts BOTH directions: the real source
 * tree is clean, AND each gate still FIRES on a synthesized known-bad input. The
 * repo already applies this discipline (`detector-acceptance.mjs`,
 * `__detector_fixtures__/`); this is the same idea for these two gates.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const uiRoot = path.resolve(here, '..')
const desktopRoot = path.resolve(uiRoot, '../desktop/ui')

const readJson = p => JSON.parse(readFileSync(p, 'utf8'))

/**
 * Resolve the biome binary by walking up for `node_modules/.bin/biome`.
 * npm workspaces HOIST it to the repo root, so the workspace-local path does not
 * exist — but a non-hoisted install would put it there, so try both.
 */
function biomeBin() {
  let dir = uiRoot
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'node_modules/.bin/biome')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('could not resolve the biome binary from ' + uiRoot)
}

/** Run a command, returning {status, stdout} instead of throwing on non-zero. */
function run(cmd, args, cwd) {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout }
  } catch (e) {
    return { status: e.status ?? 1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HOLE 1 — biome `useHookAtTopLevel`
// ─────────────────────────────────────────────────────────────────────────────

test('the rule is set to error in BOTH workspaces (desktop has its own standalone config)', () => {
  // The desktop workspace does NOT `extends` the shared base — it is a full
  // standalone copy. Enabling the rule only in the base would silently leave
  // desktop unguarded, so both are asserted independently.
  const base = readJson(
    path.resolve(uiRoot, '../../sdk/packages/config/biome.base.json'),
  )
  assert.equal(
    base.linter.rules.correctness.useHookAtTopLevel,
    'error',
    'shared biome base must enable useHookAtTopLevel',
  )

  const desktop = readJson(path.join(desktopRoot, 'biome.json'))
  assert.equal(
    desktop.linter.rules.correctness.useHookAtTopLevel,
    'error',
    'desktop biome.json is standalone and must enable the rule itself',
  )
})

test('the rule is CHAINED into `npm run check` in both workspaces (configured != executed)', () => {
  // This is the assertion that would have caught HOLE 1. `npm run check`'s biome
  // step is `--only=style/noRestrictedImports`, so merely turning a rule on in
  // config runs it NOWHERE. It needs its own chained script.
  for (const [label, root] of [['ui', uiRoot], ['desktop/ui', desktopRoot]]) {
    const pkg = readJson(path.join(root, 'package.json'))
    assert.match(
      pkg.scripts['lint:hooks-top-level'] ?? '',
      /useHookAtTopLevel/,
      `${label}: lint:hooks-top-level must run the rule`,
    )
    assert.match(
      pkg.scripts.check,
      /npm run lint:hooks-top-level/,
      `${label}: check must chain lint:hooks-top-level`,
    )
    assert.match(
      pkg.scripts.check,
      /npm run lint:hooks\b/,
      `${label}: check must still chain the project-specific lint:hooks`,
    )
  }
})

test('both workspaces are CLEAN under the rule', () => {
  for (const [label, root] of [['ui', uiRoot], ['desktop/ui', desktopRoot]]) {
    const r = run('npm', ['run', 'lint:hooks-top-level'], root)
    assert.equal(r.status, 0, `${label} has useHookAtTopLevel violations:\n${r.stdout}`)
  }
})

test('KNOWN-POSITIVE: the rule still FIRES on a hook after an early return', () => {
  // Without this, "0 violations" could mean the rule is excluded away, mis-scoped,
  // or silently renamed by a biome upgrade — the failure mode that let the real
  // defect ship.
  const dir = mkdtempSync(path.join(tmpdir(), 'hooktop-'))
  try {
    writeFileSync(
      path.join(dir, 'biome.json'),
      JSON.stringify({
        linter: {
          enabled: true,
          rules: {
            recommended: false,
            correctness: { useHookAtTopLevel: 'error' },
          },
        },
      }),
    )
    // The literal shape of the shipped defect: a hook below a conditional return.
    writeFileSync(
      path.join(dir, 'Bad.tsx'),
      [
        "import { useState } from 'react'",
        'export function Bad({ show }: { show: boolean }) {',
        '  if (!show) return null',
        '  const [n] = useState(0)',
        '  return <div>{n}</div>',
        '}',
        '',
      ].join('\n'),
    )
    const r = run(biomeBin(), ['lint', '--config-path=.', 'Bad.tsx'], dir)
    assert.notEqual(r.status, 0, 'the rule did not fire on a known-bad file')
    // Assert a real DIAGNOSTIC at the offending LINE, not merely that the rule
    // name appears somewhere in the output. A loose /useHookAtTopLevel/ match is
    // vacuous against the very failure this control exists to detect: if the rule
    // key were renamed by a biome upgrade, biome exits non-zero with a config
    // error whose "Known keys:" list CONTAINS the string `useHookAtTopLevel` —
    // so both a bare status check and a bare name match would pass while the rule
    // ran on nothing.
    assert.match(
      r.stdout,
      /lint\/correctness\/useHookAtTopLevel/,
      `expected a real diagnostic, not a config error:\n${r.stdout}`,
    )
    assert.match(
      r.stdout,
      /Bad\.tsx:4:/,
      `expected the diagnostic to point at the hook on line 4:\n${r.stdout}`,
    )
    assert.doesNotMatch(
      r.stdout,
      /Known keys:/,
      `biome rejected the config instead of running the rule:\n${r.stdout}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// HOLE 2 — lint-hooks.mjs proxy registry must resolve ALIAS exports
// ─────────────────────────────────────────────────────────────────────────────

test('KNOWN-POSITIVE: lint-hooks resolves an ALIAS-exported store proxy', () => {
  // `export const File = FileInner` (where FileInner = registerLazyStore(...)) was
  // invisible to the registry, so conditional reads of the File store went
  // unchecked tree-wide. This synthesizes that exact export shape and asserts the
  // guard now flags a conditional read of it — and, as the negative control, that
  // it does NOT flag the same read once hoisted.
  const dir = mkdtempSync(path.join(tmpdir(), 'linthooks-'))
  try {
    const storesDir = path.join(dir, 'stores')
    mkdirSync(storesDir, { recursive: true })
    writeFileSync(
      path.join(storesDir, 'aliased.ts'),
      [
        "import { registerLazyStore } from '@ziee/framework/stores'",
        'const Inner = registerLazyStore({ name: "Aliased", state: { items: [] } } as any)',
        '// the alias export shape that used to escape the registry',
        'export const Aliased = Inner',
        '',
      ].join('\n'),
    )
    const badFile = path.join(dir, 'Bad.tsx')
    writeFileSync(
      badFile,
      [
        "import { Aliased } from './stores/aliased'",
        'export function Bad({ id }: { id: string | null }) {',
        '  if (!id) return null',
        '  const items = Aliased.items',
        '  return <div>{items.length}</div>',
        '}',
        '',
      ].join('\n'),
    )

    const bad = run('node', [path.join(here, 'lint-hooks.mjs'), `--root=${dir}`], uiRoot)
    assert.notEqual(
      bad.status,
      0,
      `lint-hooks did not flag a conditional read of an ALIAS-exported proxy — HOLE 2 has reopened:\n${bad.stdout}`,
    )
    // Must name the FIELD, not merely the fixture: a bare /Aliased/ would match
    // almost any output mentioning the file and make the assertion vacuous.
    assert.match(bad.stdout, /Aliased\.items/, `unexpected output:\n${bad.stdout}`)

    // Negative control — hoisted above the guard, the same file must be clean.
    writeFileSync(
      badFile,
      [
        "import { Aliased } from './stores/aliased'",
        'export function Bad({ id }: { id: string | null }) {',
        '  const items = Aliased.items',
        '  if (!id) return null',
        '  return <div>{items.length}</div>',
        '}',
        '',
      ].join('\n'),
    )
    const good = run('node', [path.join(here, 'lint-hooks.mjs'), `--root=${dir}`], uiRoot)
    assert.equal(
      good.status,
      0,
      `hoisted read must be clean, else the rule is over-firing:\n${good.stdout}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the two lint-hooks copies stay byte-identical', () => {
  const a = readFileSync(path.join(here, 'lint-hooks.mjs'))
  const b = readFileSync(path.join(desktopRoot, 'scripts/lint-hooks.mjs'))
  assert.ok(a.equals(b), 'ui and desktop/ui copies of lint-hooks.mjs have diverged')
})
