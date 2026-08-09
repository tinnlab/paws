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
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  checkParity,
  requiredCores,
  resolveHarnessCopies,
} from '../../../sdk/packages/gallery/scripts/check-harness-parity.mjs'
import { resolveGalleryConfig } from '../../../sdk/packages/gallery/scripts/lib/gallery-config.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI = path.resolve(HERE, '..') // src-app/ui — the cwd the guard runs under
const ROOT = path.resolve(UI, '../..')
const SHARED_LIB = path.join(ROOT, 'sdk/packages/gallery/scripts/lib/gallery-surfaces.mjs')

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

// ═══════════════════════════════════════════════════════════════════════════
// THE GENERATORS — the second half of "one implementation, not several".
//
// `runtime-health`/`gate-ui` were unified first; `src-app/desktop/ui/scripts/`
// kept forks of six more generators (CLAUDE.md follow-up 1). Those are gone too,
// so the same invariant now has to hold for them — and it is asserted the same
// way: by RUNNING the real scripts and by checking a fork does not exist, never
// by pattern-matching source text. A source guard was already tried in this area
// and could not converge (each audit round found a new spelling), which is why
// nothing below reads a script's contents to decide whether it is correct.
// ═══════════════════════════════════════════════════════════════════════════

const SDK_SCRIPTS = path.join(ROOT, 'sdk/packages/gallery/scripts')
const WORKSPACES = [
  { ws: 'src-app/ui', label: 'ui' },
  { ws: 'src-app/desktop/ui', label: 'desktop/ui' },
]

/** Run a shipped sdk generator under a workspace cwd. Read-only modes only. */
const runGen = (ws, script, args) =>
  spawnSync(process.execPath, [path.join(SDK_SCRIPTS, script), ...args], {
    cwd: path.join(ROOT, ws),
    encoding: 'utf8',
    timeout: 180_000,
  })

// The six files that used to be forked under an app workspace, plus the shared
// enumeration lib. Absence is the assertion: a path that does not exist has no
// evasion space, unlike a predicate over a path that does.
const UNIFIED_GENERATORS = [
  'gen-gallery-coverage.mjs',
  'gen-overlay-registry.mjs',
  'gen-state-matrix.mjs',
  'capture-gallery-states.mjs',
  'capture-gallery-screenshots.mjs',
  'lib/gallery-surfaces.mjs',
]

/** Fork violations, parameterised on `read` so the guard itself can be mutated
 *  and shown to go RED — the same idiom as `checkParity(read, copies)`. */
function generatorForkViolations(read) {
  const bad = []
  for (const { ws } of WORKSPACES)
    for (const name of UNIFIED_GENERATORS)
      if (read(path.join(ROOT, ws, 'scripts', name)) !== null)
        bad.push(`${ws}/scripts/${name} is a FORK of the shared generator`)
  return bad
}

test('TEST-3 [acceptance INV-1] no workspace re-forks a generator or the surface lib', () => {
  const violations = generatorForkViolations(realRead)
  assert.deepEqual(
    violations,
    [],
    'both workspaces must run sdk/packages/gallery/scripts/<x>.mjs with their own ' +
      'gallery.config.json; a local copy re-creates the drift this removed:\n' +
      violations.join('\n'),
  )
  // …and the npm scripts must actually point THERE, or the fork is simply
  // absent while the workspace runs something else entirely.
  const DRIVEN = {
    'gen:gallery-coverage': 'gen-gallery-coverage.mjs',
    'check:gallery-coverage': 'gen-gallery-coverage.mjs',
    'gen:overlay-registry': 'gen-overlay-registry.mjs',
    'check:overlay-registry': 'gen-overlay-registry.mjs',
    'gen:state-matrix': 'gen-state-matrix.mjs',
    'check:state-matrix': 'gen-state-matrix.mjs',
    'gallery:states': 'capture-gallery-states.mjs',
    'gallery:screenshots': 'capture-gallery-screenshots.mjs',
  }
  for (const { ws } of WORKSPACES) {
    const pkg = JSON.parse(realRead(path.join(ROOT, ws, 'package.json')))
    for (const [script, file] of Object.entries(DRIVEN)) {
      const cmd = pkg.scripts[script]
      assert.ok(cmd, `${ws} must define "${script}"`)
      const m = cmd.match(/node\s+(\S+)/)
      assert.ok(m, `${ws}'s "${script}" must invoke a node script, got: ${cmd}`)
      assert.equal(
        path.resolve(ROOT, ws, m[1]),
        path.join(SDK_SCRIPTS, file),
        `${ws}'s "${script}" must resolve to the SHARED ${file}, not a local one`,
      )
    }
  }
})

test('TEST-6 [acceptance INV-3] the fork proof goes RED when a fork comes back', () => {
  // A positive-only guard proves nothing about whether it would ever fire, and a
  // guard for THIS invariant is worth exactly as much as its mutation case.
  for (const { ws } of WORKSPACES)
    for (const name of UNIFIED_GENERATORS) {
      const resurrected = path.join(ROOT, ws, 'scripts', name)
      const mutated = abs => (abs === resurrected ? '// a re-forked copy' : realRead(abs))
      const violations = generatorForkViolations(mutated)
      assert.deepEqual(
        violations,
        [`${ws}/scripts/${name} is a FORK of the shared generator`],
        `re-creating ${ws}/scripts/${name} must be the ONLY violation reported`,
      )
    }
})

test('TEST-1 the ONE shared generator serves BOTH workspaces (real runs)', () => {
  // Executed, not inspected: each generator is spawned under each workspace's own
  // cwd, so what is proven is that one implementation + two gallery.config.json
  // files reproduce both workspaces' committed artifacts.
  const EXPECT = {
    'gen-gallery-coverage.mjs': /galleryCoverage\.generated\.ts up to date \(\d+ surfaces/,
    'gen-overlay-registry.mjs': /overlay gate OK — \d+ overlay surfaces/,
    'gen-state-matrix.mjs': /state matrix up to date \(\d+ surfaces/,
  }
  for (const { ws, label } of WORKSPACES)
    for (const [script, banner] of Object.entries(EXPECT)) {
      const r = runGen(ws, script, ['--check'])
      const out = `${r.stdout}${r.stderr}`
      assert.equal(r.status, 0, `${label} ${script} --check must exit 0:\n${out}`)
      assert.match(out, banner, `${label} ${script} --check printed an unexpected banner:\n${out}`)
    }
})

test('TEST-2 desktop’s overlay gate is NOT vacuous (positive + negative control)', () => {
  // The one behaviour the deleted desktop fork carried that config had to
  // re-express: desktop surfaces import overlay primitives from the kit PACKAGE
  // specifier. If that is lost, the gate reports zero hosts and PASSES — a gate
  // failing open, which is the worst outcome and the reason for the control below.
  const live = runGen('src-app/desktop/ui', 'gen-overlay-registry.mjs', ['--list'])
  assert.equal(live.status, 0, `--list must succeed:\n${live.stdout}${live.stderr}`)
  assert.match(
    live.stdout,
    /ConversationMountsControl/,
    'the desktop overlay gate must still SEE the kit-package-imported Popover host; ' +
      'losing it makes the gate pass with 0 hosts:\n' + live.stdout,
  )

  // Negative control: the SAME script, same source tree, with overlayKitImports
  // reduced to the package default → the host disappears. This is what proves the
  // assertion above is carried by the config key and not by luck.
  const cfg = JSON.parse(realRead(path.join(ROOT, 'src-app/desktop/ui/gallery.config.json')))
  delete cfg.overlayKitImports
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ovl-neg-'))
  try {
    // `--list` never writes, so symlinking the real tree in is safe.
    fs.symlinkSync(path.join(ROOT, 'src-app/desktop/ui/src'), path.join(tmp, 'src'))
    fs.writeFileSync(path.join(tmp, 'gallery.config.json'), JSON.stringify(cfg, null, 2))
    const r = spawnSync(
      process.execPath,
      [path.join(SDK_SCRIPTS, 'gen-overlay-registry.mjs'), '--list'],
      { cwd: tmp, encoding: 'utf8', timeout: 60_000 },
    )
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
    assert.doesNotMatch(
      r.stdout,
      /ConversationMountsControl/,
      'without overlayKitImports the host must VANISH — if it is still found, the ' +
        'config key is not what is carrying desktop’s behaviour and TEST-2’s ' +
        'positive half proves nothing',
    )
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('TEST-5 [acceptance INV-2] the divergence is a CONFIG KEY, not a second implementation', () => {
  const desktop = resolveGalleryConfig(path.join(ROOT, 'src-app/desktop/ui'))
  const web = resolveGalleryConfig(path.join(ROOT, 'src-app/ui'))
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gcfg-'))
  let base
  try {
    base = resolveGalleryConfig(empty).overlayKitImports
  } finally {
    fs.rmSync(empty, { recursive: true, force: true })
  }
  for (const p of base)
    assert.ok(
      desktop.overlayKitImports.includes(p),
      `desktop must EXTEND the package default, not replace it (missing ${p})`,
    )
  assert.ok(
    desktop.overlayKitImports.length > base.length,
    'desktop must add at least one specifier the default lacks — otherwise the key ' +
      'is noise and the real behaviour lives somewhere else',
  )
  assert.deepEqual(
    web.overlayKitImports,
    base,
    'the web workspace must still take the package default — the desktop key must ' +
      'not have been "fixed" by changing the shared default under it',
  )
})

test('TEST-8 the recorded follow-ups are still TRUE (behaviour, not prose)', () => {
  // CLAUDE.md records two findings this change deliberately did NOT fix. A
  // recorded follow-up that silently becomes false is worse than none, so both
  // are asserted by RUNNING, not by reading the doc.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gcfg2-'))
  try {
    assert.ok(
      !resolveGalleryConfig(empty).overlayKitImports.includes('@ziee/kit'),
      'follow-up is stale: the package default now includes the kit package ' +
        'specifier, so the web workspace is no longer blind to it — update CLAUDE.md',
    )
  } finally {
    fs.rmSync(empty, { recursive: true, force: true })
  }

  // `kitImport` is DEAD: declared in DEFAULTS, set by desktop’s config, read by
  // nothing. Proven by CHANGING it to a value that WOULD alter the result if any
  // script consumed it, and observing no change at all.
  const cfg = JSON.parse(realRead(path.join(ROOT, 'src-app/desktop/ui/gallery.config.json')))
  delete cfg.overlayKitImports
  const runWith = kitImport => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kitimp-'))
    try {
      fs.symlinkSync(path.join(ROOT, 'src-app/desktop/ui/src'), path.join(tmp, 'src'))
      fs.writeFileSync(
        path.join(tmp, 'gallery.config.json'),
        JSON.stringify({ ...cfg, kitImport }, null, 2),
      )
      const r = spawnSync(
        process.execPath,
        [path.join(SDK_SCRIPTS, 'gen-overlay-registry.mjs'), '--list'],
        { cwd: tmp, encoding: 'utf8', timeout: 60_000 },
      )
      assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
      return r.stdout
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
  assert.equal(
    runWith('@ziee/kit'),
    runWith('@totally/unused-specifier'),
    'follow-up is stale: changing `kitImport` now changes the overlay result, so ' +
      'the key is no longer dead — update CLAUDE.md',
  )
})

test('TEST-7 every local script consumes the SHARED surface lib', () => {
  // The scripts themselves launch browsers, so they are not imported here; what
  // is checked is that the specifier each one names RESOLVES, through node’s real
  // resolver from that script’s own directory, to the sdk module.
  const SHARED = path.join(SDK_SCRIPTS, 'lib/gallery-surfaces.mjs')
  const CONSUMERS = [
    'src-app/ui/scripts/affordance-audit.mjs',
    'src-app/ui/scripts/gen-crop-review-manifests.mjs',
    'src-app/desktop/ui/scripts/affordance-audit.mjs',
    'src-app/desktop/ui/scripts/gen-crop-review-manifests.mjs',
  ]
  for (const rel of CONSUMERS) {
    const abs = path.join(ROOT, rel)
    const src = realRead(abs)
    assert.ok(src !== null, `${rel} must exist`)
    const m = src.match(/from\s+'([^']*gallery-surfaces\.mjs)'/)
    assert.ok(m, `${rel} must import the surface enumeration`)
    const resolved = createRequire(abs).resolve(m[1])
    assert.equal(
      path.resolve(resolved),
      SHARED,
      `${rel} imports "${m[1]}", which resolves to ${resolved} — every consumer must ` +
        `reach the ONE shared module, or the workspace disagrees with itself about ` +
        `what a surface is`,
    )
  }
})

test('TEST-4 [acceptance INV-4] the shared enumeration reports the interaction class', async () => {
  // Driven for real through the shipped module. The stale desktop copy had no
  // notion of interactions: it returned no `interactions` key, emitted no
  // interaction cell, and counted none — SILENTLY (fewer cells, no error). Each
  // assertion below is one of those three silent losses.
  const { enumerateSurfaces, captureCells, cellUrl, surfaceCount } = await import(
    pathToFileURL(SHARED_LIB).href
  )

  // A Playwright-shaped stub: `evaluate(fn)` runs fn with the page globals bound,
  // exactly as the browser would.
  const stubPage = globals => ({
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async fn => {
      const prevW = globalThis.window
      const prevD = globalThis.document
      globalThis.window = globals.window
      globalThis.document = globals.document
      try {
        return fn()
      } finally {
        globalThis.window = prevW
        globalThis.document = prevD
      }
    },
  })

  const RECIPE = { slug: 'modules/demo/components/Thing', name: 'menu-open' }

  // Case 1 — the modern bundle exposing the unified listing function.
  const unified = stubPage({
    window: {
      __GALLERY_LIST_ALL_SURFACES__: () => ({
        pages: ['modules/demo/pages/DemoPage'],
        overlays: ['modules/demo/components/DemoDrawer'],
        deep: [],
        seeded: [],
        interactions: [RECIPE],
      }),
    },
    document: { querySelectorAll: () => [] },
  })
  // Case 2 — the per-class-globals fallback path, which the stale copy also lacked.
  const fallback = stubPage({
    window: { __GALLERY_INTERACTIONS__: [RECIPE] },
    document: {
      querySelectorAll: () => [{ getAttribute: () => 'gallery-page-modules/demo/pages/DemoPage' }],
    },
  })

  for (const [label, page] of [['unified', unified], ['fallback', fallback]]) {
    const classes = await enumerateSurfaces(page)
    assert.deepEqual(
      classes.interactions,
      [RECIPE],
      `${label}: enumeration must surface the interaction class (a stale copy drops it)`,
    )

    const cells = captureCells(classes)
    const cell = cells.find(c => c.cls === 'interaction')
    assert.ok(cell, `${label}: captureCells must emit an interaction cell`)
    assert.deepEqual(
      { slug: cell.slug, state: cell.state, interact: cell.interact },
      { slug: RECIPE.slug, state: RECIPE.name, interact: RECIPE.name },
      `${label}: the interaction cell must name the recipe`,
    )
    assert.match(
      cellUrl('http://x/gallery.html', cell),
      /[?&]interact=menu-open\b/,
      `${label}: the cell URL must drive the recipe`,
    )
    assert.equal(
      surfaceCount(classes),
      classes.pages.length +
        classes.overlays.length +
        classes.deep.length +
        classes.seeded.length +
        1,
      `${label}: the interaction must be COUNTED — undercounting is how the stale ` +
        `copy failed silently`,
    )
    // Negative control: the other classes must be untouched, so "interactions are
    // handled" cannot be satisfied by over-reporting everything.
    assert.equal(
      cells.filter(c => c.cls === 'page').length,
      classes.pages.length * 3,
      `${label}: page cells must still be states-expanded, unchanged`,
    )
  }
})
