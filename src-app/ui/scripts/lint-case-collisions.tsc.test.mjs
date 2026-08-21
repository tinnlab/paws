/**
 * TEST-8 [acceptance] [invariant: INV-3] — "update every import site in BOTH
 * `src-app/ui/src` and `src-app/desktop/ui/src`".
 *
 * `tsc` is the authoritative oracle for that claim: relocating the store directories
 * changed 100 import specifiers, and a single one missed in either workspace is an
 * unresolvable module, which `tsc --noEmit` reports as an error. Nothing weaker can
 * prove the claim — a grep only finds the specifiers it was told to look for.
 *
 * Exit code alone is NOT sufficient evidence, and this file does not rely on it. A
 * `tsconfig` whose `include` was narrowed (or whose `files` is `[]`) type-checks
 * nothing and exits 0 just as happily as a clean full compile — verified: replacing
 * `src-app/ui/tsconfig.json` with `{"compilerOptions":{"noEmit":true},"files":[]}`
 * left an exit-code-only version of this test green. So each workspace is asserted
 * three ways: it exits 0, `--listFilesOnly` shows it really pulled in thousands of
 * files, and that file list contains named relocated stores plus their sibling
 * components.
 *
 * Not chained into `npm run check`: `tsc` is already that script's FIRST step in each
 * workspace, so wiring this in would run the same compile three times for no extra
 * signal. It has its own runner (`npm run test:case-collisions:tsc`) so it is not
 * dead code, is enumerated in TESTS.md, and runs once at phase 8.
 *
 * Run:  npm run test:case-collisions:tsc      (~2-4 min)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../..')
const WORKSPACES = [
  { label: 'ui', dir: path.resolve(HERE, '..') },
  { label: 'desktop/ui', dir: path.resolve(HERE, '../../desktop/ui') },
]

const TSC = path.resolve(REPO, 'node_modules/typescript/bin/tsc')

/** Relocated stores + their sibling components, as substrings that MUST be compiled. */
const MUST_COMPILE = [
  'modules/user/components/user/stores/editUserDrawer/index.ts',
  'modules/user/components/user/EditUserDrawer.tsx',
  'modules/layouts/app-layout/stores/appLayout/index.ts',
  'modules/layouts/app-layout/AppLayout.tsx',
  'modules/workflow/components/builder/agentStepForm.helpers.ts',
  'modules/workflow/components/builder/AgentStepForm.tsx',
]

const runTsc = (dir, extraArgs = []) =>
  spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', ...extraArgs], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  })

describe('case-collision fix — import sites', () => {
  test('TEST-8: `tsc --noEmit` is clean in BOTH UI workspaces, and really compiled the moved files', { timeout: 1_800_000 }, () => {
    assert.ok(fs.existsSync(TSC), `hoisted typescript not found at ${TSC} — run npm install at the repo root`)

    for (const ws of WORKSPACES) {
      assert.ok(fs.existsSync(path.join(ws.dir, 'tsconfig.json')), `${ws.label} must have a tsconfig.json`)

      // 1. It type-checks cleanly.
      const check = runTsc(ws.dir, ['--noEmit'])
      assert.equal(
        check.status,
        0,
        `tsc --noEmit failed in ${ws.label} — at least one import site still points at a pre-move path:\n${check.stdout}\n${check.stderr}`,
      )

      // 2. …over a real program, not an empty one. This is what makes (1) evidence.
      const listed = runTsc(ws.dir, ['--noEmit', '--listFilesOnly'])
      assert.equal(listed.status, 0, `tsc --listFilesOnly failed in ${ws.label}:\n${listed.stderr}`)
      const files = listed.stdout.split('\n').map(s => s.trim()).filter(Boolean)
      assert.ok(
        files.length > 1000,
        `${ws.label} compiled only ${files.length} files — its tsconfig include/files no longer covers the app, so a green exit proves nothing`,
      )

      // 3. …and that program includes the files this branch actually moved.
      const joined = files.join('\n')
      for (const needle of MUST_COMPILE) {
        assert.ok(
          joined.includes(needle),
          `${ws.label}'s program does not include ${needle} — the moved module is outside the compile surface, so tsc cannot be vouching for its import sites`,
        )
      }
    }
  })

  test('TEST-8 (control): tsc really does fail on a broken specifier', { timeout: 900_000 }, () => {
    // Proves the runner reports failure at all. Complements the coverage assertions
    // above: those show the workspace compile is non-empty, this shows a bad import
    // in a compiled file is fatal rather than swallowed.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsc-control-'))
    try {
      fs.writeFileSync(
        path.join(tmp, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { noEmit: true, moduleResolution: 'bundler', module: 'esnext', target: 'esnext' },
          include: ['broken.ts'],
        }),
      )
      fs.writeFileSync(
        path.join(tmp, 'broken.ts'),
        "import { X } from './components/user/editUserDrawer'\nexport const y = X\n",
      )
      const r = runTsc(tmp, ['--noEmit'])
      assert.notEqual(r.status, 0, `the control project must FAIL tsc, got exit 0:\n${r.stdout}`)
      assert.match(r.stdout, /editUserDrawer/, `expected the unresolved specifier to be named:\n${r.stdout}`)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
