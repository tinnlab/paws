/**
 * TEST-4 — detector-acceptance meta-test. Asserts the desktop workspace owns the
 * detector scripts + copied fixtures, and that `detector-acceptance.mjs` PASSES:
 * the two lint detectors fire on the fixtures and the geometry detector is
 * byte-identical to the validated web source. Runs the REAL script (no mocks).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WS = path.resolve(HERE, '../../..') // desktop/ui
const has = (p: string) => fs.existsSync(path.join(WS, p))

describe('TEST-4: detector-acceptance', () => {
  test('detector scripts + fixtures present', () => {
    expect(has('scripts/detector-acceptance.mjs')).toBe(true)
    expect(has('scripts/lint-icon-action.mjs')).toBe(true)
    expect(has('scripts/lint-native-scroll.mjs')).toBe(true)
    expect(has('scripts/lint-hooks.mjs')).toBe(true)
    expect(has('src/dev/gallery/__detector_fixtures__')).toBe(true)
    // O1/O2 (Rules of Hooks) fixtures — the known-bad instance AND its clean
    // companion, so pointing the lint at this dir proves both directions.
    expect(has('src/dev/gallery/__detector_fixtures__/ConditionalHooks.tsx')).toBe(true)
    expect(has('src/dev/gallery/__detector_fixtures__/ConditionalHooksClean.tsx')).toBe(true)
    expect(has('src/dev/gallery/__detector_fixtures__/stores/fixtureStore.ts')).toBe(true)
  })

  test('lint-hooks.mjs is byte-identical to the web source (drift guard)', () => {
    expect(fs.readFileSync(path.join(WS, 'scripts/lint-hooks.mjs'), 'utf8')).toBe(
      fs.readFileSync(path.join(WS, '../../ui/scripts/lint-hooks.mjs'), 'utf8'),
    )
  })

  test('the O1 + O2 lint detectors FIRE on their fixture (exit 1)', () => {
    const res = spawnSync('node', ['scripts/lint-hooks.mjs', '--root=src/dev/gallery/__detector_fixtures__'], {
      cwd: WS,
      encoding: 'utf8',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toMatch(/H1 .*__detector_fixtures__/)
    expect(res.stderr).toMatch(/H2 .*__detector_fixtures__/)
  })

  test('detector-acceptance.mjs exits 0 (lint detectors fire + geometry byte-identical)', () => {
    // Throws (non-zero exit) → test fails, surfacing which detector did not fire.
    const out = execFileSync('node', ['scripts/detector-acceptance.mjs'], {
      cwd: WS,
      encoding: 'utf8',
    })
    expect(out).toMatch(/DETECTOR-ACCEPTANCE PASSED/)
    expect(out).toMatch(/C11.*OK/)
    expect(out).toMatch(/J8.*OK/)
    expect(out).toMatch(/geometry-identity.*OK/)
  })
})
