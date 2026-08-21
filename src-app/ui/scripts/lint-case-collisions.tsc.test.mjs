/**
 * TEST-8 [acceptance] [invariant: INV-3] — "update every import site in BOTH
 * `src-app/ui/src` and `src-app/desktop/ui/src`".
 *
 * `tsc` is the authoritative oracle for that claim: relocating the 24 store
 * directories changed 99 import specifiers, and a single one missed in either
 * workspace is an unresolvable module, which `tsc --noEmit` reports as an error.
 * Nothing weaker can prove the claim — a grep can only find the specifiers it was
 * told to look for.
 *
 * Deliberately NOT chained into `npm run check`: `tsc` is already that script's
 * FIRST step in each workspace, so wiring this in would run the same compile three
 * times for no extra signal. It exists as its own file because the lifecycle's A11
 * rule requires the TEST-8 id to appear on an added line of this branch's diff, and
 * a package.json chain entry cannot carry one. It is enumerated in TESTS.md and run
 * once, at phase 8.
 *
 * Run:  node --test scripts/lint-case-collisions.tsc.test.mjs      (~2-4 min)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { describe } from 'node:test'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WORKSPACES = [
  { label: 'ui', dir: path.resolve(HERE, '..') },
  { label: 'desktop/ui', dir: path.resolve(HERE, '../../desktop/ui') },
]

const TSC = path.resolve(HERE, '../../../node_modules/typescript/bin/tsc')

describe('case-collision fix — import sites', () => {
  test('TEST-8: `tsc --noEmit` is clean in BOTH UI workspaces after the store move', { timeout: 900_000 }, () => {
    assert.ok(fs.existsSync(TSC), `hoisted typescript not found at ${TSC} — run npm install at the repo root`)

    for (const ws of WORKSPACES) {
      assert.ok(
        fs.existsSync(path.join(ws.dir, 'tsconfig.json')),
        `${ws.label} must have a tsconfig.json`,
      )
      const r = spawnSync(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.json'], {
        cwd: ws.dir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
      assert.equal(
        r.status,
        0,
        `tsc --noEmit failed in ${ws.label} — at least one import site still points at a pre-move path:\n${r.stdout}\n${r.stderr}`,
      )
    }
  })

  test('TEST-8 (control): tsc really does fail on a broken specifier', { timeout: 900_000 }, () => {
    // Without this, a `tsc` invocation that silently did nothing (wrong cwd, wrong
    // project, a swallowed exit code) would satisfy the assertion above while
    // proving nothing. Point the same runner at a throwaway project containing one
    // unresolvable import — the exact shape a missed rewrite would leave — and
    // require a NON-zero exit.
    // Outside the workspace: a scratch project inside src-app/ui would be picked up
    // by the tree-walking lints and by tsc's own `include`.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsc-control-'))
    try {
      fs.writeFileSync(
        path.join(tmp, 'tsconfig.json'),
        JSON.stringify({ compilerOptions: { noEmit: true, moduleResolution: 'bundler', module: 'esnext', target: 'esnext' }, include: ['broken.ts'] }),
      )
      fs.writeFileSync(path.join(tmp, 'broken.ts'), "import { X } from './components/user/editUserDrawer'\nexport const y = X\n")
      const r = spawnSync(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.json'], {
        cwd: tmp,
        encoding: 'utf8',
      })
      assert.notEqual(r.status, 0, `the control project must FAIL tsc, got exit 0:\n${r.stdout}`)
      assert.match(r.stdout, /editUserDrawer/, `expected the unresolved specifier to be named:\n${r.stdout}`)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
