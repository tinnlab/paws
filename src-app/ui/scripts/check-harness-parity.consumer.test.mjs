/**
 * TEST-6 [acceptance · INV-6] — ziee's REAL harness copies all carry every core.
 *
 * INV-6: "Check whether the ziee copies are synced from the sdk or independently
 * maintained and handle both, or the fix lands in one place and not the others."
 *
 * This is the CONSUMER half of the parity proof, and it lives here — not in
 * `@ziee/gallery` — because the paths it asserts on (`src-app/desktop/ui/...`,
 * `sdk/packages/...`) are ZIEE's layout. Holding them inside the shared package
 * made the package's own test red-by-construction in a standalone checkout,
 * which is the same "shared tooling assumes one consumer" defect the guard
 * exists to catch (HUMAN_FEEDBACK FB-7). The package keeps the engine + the
 * config contract; this file keeps the fact that ZIEE's tree conforms.
 *
 * The mutation cases matter as much as the positive control: a guard that only
 * passes today proves nothing about whether it would fire.
 *
 * Run: node --test scripts/check-harness-parity.consumer.test.mjs   (cwd = src-app/ui)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkParity,
  requiredCores,
  resolveHarnessCopies,
} from '../../../sdk/packages/gallery/scripts/check-harness-parity.mjs'
import { resolveGalleryConfig } from '../../../sdk/packages/gallery/scripts/lib/gallery-config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI = path.resolve(HERE, '..') // src-app/ui — the cwd the guard runs under
const ROOT = path.resolve(UI, '../..')

// Resolve exactly what `npm run check:harness-parity` resolves.
const { copies, source } = resolveHarnessCopies(resolveGalleryConfig(UI))
const realRead = abs => {
  try {
    return fs.readFileSync(abs, 'utf-8')
  } catch {
    return null
  }
}
const rel = abs => path.relative(ROOT, abs)


test('TEST-6 [acceptance INV-6] ziee declares its live copies via config', () => {
  assert.ok(
    source && source.endsWith('gallery-harness-copies.json'),
    'the copy list must come from a committed product-tree manifest, not from ' +
      'hardcoded paths inside the shared package (and never from .lifecycle/, which ' +
      'is stripped at merge — B6)',
  )
  assert.ok(fs.existsSync(source), `${source} must exist`)
  // Two, not four: the desktop forks were deleted and desktop now runs these
  // same sdk scripts with its own gallery.config.json.
  assert.equal(copies.length, 2, `expected ziee's 2 live copies, got ${copies.length}`)
  assert.ok(
    copies.every(c => rel(c.file).startsWith('sdk/packages/gallery/')),
    'every live copy must be the SHARED implementation — a copy under an app ' +
      'workspace is a fork, which is what this whole exercise removed',
  )
})

test('TEST-6 [acceptance INV-6] the REAL tree passes (positive control)', () => {
  const violations = checkParity(realRead, copies)
  assert.deepEqual(
    violations,
    [],
    `every live harness copy must carry every core:\n${violations.join('\n')}`,
  )
})

test('TEST-6b the guard goes RED when a copy loses a core', () => {
  // Formerly "when the DESKTOP copy loses a core". There is no desktop copy any
  // more — that is the fix — so the mutation now targets the shared copies,
  // which is what a future fork would be measured against.
  for (const module of ['host-lock.mjs', 'finding-classify.mjs']) {
    const mutated = abs => {
      const src = realRead(abs)
      return src == null ? null : src.replaceAll(module, 'REMOVED')
    }
    const violations = checkParity(mutated, copies)
    const expected = copies.flatMap(c =>
      requiredCores(c).filter(core => core.module === module).map(core => [c.id, core.id]),
    )
    assert.ok(expected.length >= 1, `fixture must target a copy for ${module}`)
    assert.equal(
      violations.length,
      expected.length,
      `every (copy, core) pair on ${module} must be flagged, and ONLY those. Got:\n${violations.join('\n')}`,
    )
    for (const [copyId, coreId] of expected)
      assert.ok(
        violations.some(v => v.startsWith(`${copyId} `) && v.includes(`"${coreId}"`)),
        `${copyId} must be flagged for core ${coreId}`,
      )
  }
})

test('TEST-6h there is exactly ONE implementation — no app workspace forks it', () => {
  // THE invariant this branch ended on, and the reason the guard shrank: INV-6
  // ("a fix must not land in one copy and not the others") is satisfied by
  // construction when there are no other copies. A call-site guard could only
  // ever prove WIRING — a fork could keep every call and hardcode its result —
  // so the durable check is that no fork exists at all.
  for (const ws of ['src-app/ui/scripts', 'src-app/desktop/ui/scripts'])
    for (const name of ['runtime-health.mjs', 'gate-ui.mjs'])
      assert.equal(
        realRead(path.join(ROOT, ws, name)),
        null,
        `${ws}/${name} is a FORK of the shared harness. Both workspaces run ` +
          `sdk/packages/gallery/scripts/${name} with their own gallery.config.json; ` +
          `re-adding a local copy re-creates the drift this branch removed.`,
      )
  for (const ws of ['src-app/ui', 'src-app/desktop/ui']) {
    const pkg = JSON.parse(realRead(path.join(ROOT, ws, 'package.json')))
    for (const script of ['gallery:runtime', 'gate:ui'])
      assert.match(
        pkg.scripts[script] ?? '',
        /sdk\/packages\/gallery\/scripts\//,
        `${ws}'s "${script}" must invoke the SHARED script, not a local one`,
      )
  }
})

test('TEST-6c an IMPORT without a CALL is still a violation (dead wiring)', () => {
  const mutated = abs => {
    const src = realRead(abs)
    if (src == null) return null
    return rel(abs) === 'sdk/packages/gallery/scripts/runtime-health.mjs'
      ? src.replaceAll('withHostLock', 'notCalledAtAll')
      : src
  }
  const violations = checkParity(mutated, copies)
  assert.ok(
    violations.some(v => /imports host-lock\.mjs but never calls/.test(v)),
    'the guard must distinguish "not imported" from "imported but unused"',
  )
})

test('TEST-6d a MISSING copy is reported, not silently skipped', () => {
  const mutated = abs => (rel(abs).endsWith('scripts/gate-ui.mjs') ? null : realRead(abs))
  assert.ok(checkParity(mutated, copies).some(v => /is MISSING at/.test(v)))
})

test('TEST-6e every declared copy is checked for a non-empty, role-derived core set', () => {
  for (const c of copies)
    assert.ok(
      requiredCores(c).length > 0,
      `live copy "${c.id}" (role ${c.role}) resolves to no cores — it would be listed but never verified`,
    )
})

test('the DEAD ui-local copy is not resurrected', () => {
  assert.equal(
    realRead(path.join(ROOT, 'src-app/ui/scripts/runtime-health.mjs')),
    null,
    'src-app/ui/scripts/runtime-health.mjs had zero invokers and was deleted; ' +
      'a new copy there is a third divergent harness and must not come back',
  )
})

test('TEST-6f BOTH ui workspaces declare the manifest (desktop is not exempt)', () => {
  // The desktop workspace runs its own `check:harness-parity`; deleting
  // `harnessCopies` from ITS config alone disabled the gate there while every
  // suite stayed green, because this file resolves config from src-app/ui only.
  for (const ws of ['src-app/ui', 'src-app/desktop/ui']) {
    const r = resolveHarnessCopies(resolveGalleryConfig(path.join(ROOT, ws)))
    assert.ok(
      r.source && r.source.endsWith('gallery-harness-copies.json'),
      `${ws}/gallery.config.json must set "harnessCopies" — without it that ` +
        `workspace's npm run check passes with the parity gate switched off`,
    )
    assert.equal(
      path.resolve(r.source),
      path.join(ROOT, 'gallery-harness-copies.json'),
      `${ws} must point at the ONE root manifest, not a per-workspace copy`,
    )
    assert.deepEqual(
      r.copies.map(c => c.id).sort(),
      copies.map(c => c.id).sort(),
      `${ws} must resolve the same copy set`,
    )
  }
})

test('TEST-6g every harness-shaped file on disk is DECLARED (closed-world guard)', () => {
  // The manifest is hand-enumerated, so a NEW divergent copy is invisible to the
  // guard unless something DISCOVERS it. Name-matching was tried and is not a
  // guard: `crawl-health.mjs`, `runtime_health.mjs`, `gallery-runtime-health.mjs`,
  // `.js`/`.cjs`, and anything outside two roots all walked straight past it.
  // So discover by CONTENT instead — a real crawl/gate copy cannot function
  // without importing the shared cores, whatever it calls itself.
  const declared = new Set(copies.map(c => path.resolve(c.file)))
  const CORE_MODULES = ['host-lock.mjs', 'run-validity.mjs', 'finding-classify.mjs']
  // `dist` is NOT skipped: a built copy under dist/ is still a copy that can
  // diverge, and skipping it was a documented evasion.
  const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'coverage', 'target'])
  const found = []
  const files = []
  const walk = dir => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      // Resolve symlinks explicitly: `isDirectory()` is FALSE for a symlinked
      // dir, so the plain check silently declines to descend into one.
      let st
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        walk(full)
      } else if (/\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/.test(e.name)) {
        let src
        try {
          src = fs.readFileSync(full, 'utf-8')
        } catch {
          continue
        }
        // A harness copy IMPORTS two or more shared cores AND actually DRIVES a
        // crawl — it launches a browser (a crawl) or spawns one (a gate). The
        // second clause is what separates a copy from a file that merely
        // mentions the modules, e.g. a test carrying fixture source. Both halves
        // are behavioural, not naming, so renaming or relocating a copy does not
        // hide it.
        // ONE core is enough. A >=2 threshold made the guard blindest exactly
        // where it matters: the divergent copy being hunted is by definition the
        // one MISSING cores, so requiring two of them to notice it inverts the
        // test. (A probe importing only the classifier + launching chromium —
        // i.e. a copy missing host-lock AND run-validity, the literal target
        // defect — walked straight past the old threshold.)
        // Static `from '...'`, `require('...')` and dynamic `import('...')` all
        // count; a copy that reaches a core by any of them is still a copy.
        const imports = CORE_MODULES.filter(m => {
          const q = m.replace('.', '\\.')
          return new RegExp(`(from|import\\s*\\(|require\\s*\\()\\s*['"][^'"]*${q}['"]`).test(src)
        })
        const drives =
          /\b(chromium|firefox|webkit)\b/.test(src) ||
          /\.newPage\s*\(/.test(src) ||
          /spawn\w*\s*\(/.test(src)
        files.push({ full, src, imports, drives })
      }
    }
  }
  walk(ROOT)

  // A local BARREL that re-exports the cores would otherwise launder them: the
  // barrel imports cores but drives nothing, and the copy drives but imports
  // only the barrel, so neither trips the check. Resolve one level of
  // re-export and treat such a barrel as a core module itself.
  const CORE_RE = new RegExp(`(${CORE_MODULES.map(m => m.replace('.', '\\.')).join('|')})`)
  const barrels = files
    .filter(f => CORE_RE.test(f.src) && /export\s[^\n]*\sfrom\s*['"]/.test(f.src))
    .map(f => path.basename(f.full))
  for (const f of files) {
    if (!f.drives) continue
    const viaBarrel = barrels.some(
      b => b !== path.basename(f.full) && new RegExp(`['"][^'"]*${b.replace('.', '\\.')}['"]`).test(f.src),
    )
    if (f.imports.length >= 1 || viaBarrel) found.push(f.full)
  }

  // Files that legitimately import the cores without BEING a crawl copy.
  // Explicit + reasoned, and each is re-verified, so an exemption cannot rot
  // into cover for a real divergent copy.
  const NOT_A_COPY = {
    'sdk/packages/gallery/scripts/lib/host-lock.test.mjs':
      'the UNIT TEST for the host lock. It imports the core and spawns child ' +
      'processes to prove cross-process mutual exclusion; it crawls nothing. ' +
      'Exempted by exact path, never by a *.test.mjs rule — a suffix rule is a ' +
      'loophole a real divergent copy could adopt.',
    'sdk/packages/gallery/scripts/gate-ui.stale.e2e.mjs':
      'an E2E that DRIVES the real gate-ui against fixtures; it asserts the gate ' +
      'refuses an unattributable run, it is not itself a crawl harness',
  }
  for (const [f, why] of Object.entries(NOT_A_COPY)) {
    const abs = path.join(ROOT, f)
    assert.ok(fs.existsSync(abs), `stale NOT_A_COPY exemption: ${f} no longer exists`)
    assert.ok(why.length > 20, `exemption for ${f} must state WHY`)
    // An exemption must not become a hiding place: an exempted file may not
    // itself look like a crawl (it must not run a crawl loop of its own).
    const src = fs.readFileSync(abs, 'utf-8')
    assert.ok(
      !/\.newPage\s*\(/.test(src),
      `${f} is exempted from the copy guard but now opens pages like a crawl copy — re-classify it`,
    )
    // A stale exemption is cover for a future real copy at the same path. If
    // discovery no longer produces this file, the entry has to go.
    assert.ok(
      found.includes(abs),
      `stale NOT_A_COPY exemption: ${f} is no longer discovered, so the exemption ` +
        `exempts nothing and would silently cover a real copy added at that path`,
    )
  }

  const undeclared = found.filter(f => !declared.has(f) && !(rel(f) in NOT_A_COPY)).map(f => rel(f))
  assert.deepEqual(
    undeclared,
    [],
    'these files import the shared harness cores but are NOT declared in ' +
      'gallery-harness-copies.json, so no core is checked in them — a fix can ' +
      'land in one copy and not these:\n  ' + undeclared.join('\n  '),
  )
  for (const c of copies)
    assert.ok(
      found.includes(path.resolve(c.file)),
      `discovery must find the declared copy ${c.id}; if it cannot, it cannot find an undeclared one either`,
    )
})

test('TEST-40 the guard PRINTS its own limit (behaviour, not source text)', () => {
  // Executed, not scanned. The first version of this test read the SOURCE for the
  // caveat; an auditor defeated it by deleting the words from the printed line and
  // leaving them in an adjacent comment — green suite, silent operator. What
  // matters is what an operator SEES, so run the guard and read stdout.
  const r = spawnSync(
    process.execPath,
    ['../../sdk/packages/gallery/scripts/check-harness-parity.mjs'],
    { cwd: UI, encoding: 'utf8' },
  )
  assert.equal(r.status, 0, `guard should pass on the real tree:\n${r.stdout}\n${r.stderr}`)
  const out = `${r.stdout}${r.stderr}`
  assert.match(out, /harness parity: OK/, 'expected the success banner')
  assert.match(out, /WIRES each core/, 'the printed line must say it proves WIRING')
  assert.match(
    out,
    /NOT prove the copy'?s logic/,
    'and must print what it does NOT prove — a wiring check read as verification is the defect',
  )
})
