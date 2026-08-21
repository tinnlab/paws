/**
 * Tests for the Rules-of-Hooks lint (taxonomy O1 / O2).
 *
 *   node --test scripts/lint-hooks.test.mjs     (npm run test:lint-hooks)
 *
 * The four ACCEPTANCE cases (TEST-1..TEST-4) do not lint a snippet I wrote — a
 * fixture I author can drift into "whatever my implementation happens to catch".
 * They extract the VERBATIM pre-fix source of the two real crashes out of git
 * (`649ae7180^` and `57f9fdb5b^`) and run the REAL lint over it, so they fail if
 * the rule is ever narrowed back to a special case.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  analyze,
  parseArgs,
  registryHealthError,
  siblingDriftError,
  PROXY_REGISTRY_FLOOR,
} from './lint-hooks.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const UI = path.resolve(HERE, '..') // src-app/ui
const DESKTOP_UI = path.resolve(UI, '../desktop/ui')
const REPO = path.resolve(UI, '../..')
const UI_SRC = path.join(UI, 'src')
const DESKTOP_SRC = path.join(DESKTOP_UI, 'src')
const FIXTURES = path.join(UI_SRC, 'dev/gallery/__detector_fixtures__')

// The two real bugs, by the commit that FIXED each. `<sha>^` is the shipped,
// crashing version; `<sha>` is the accepted fix.
const BUG_A = {
  fix: '649ae7180',
  file: 'src-app/ui/src/modules/file-rag/components/sections/EnableSection.tsx',
}
const BUG_B = {
  fix: '57f9fdb5b',
  file: 'src-app/ui/src/modules/llm-provider/components/llm-models/EditLlmModelDrawer.tsx',
}

const gitShow = (rev, file) => {
  try {
    return execFileSync('git', ['show', `${rev}:${file}`], {
      cwd: REPO,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    // A shallow clone (CI `fetch-depth: 1`) or a rewritten history would make
    // this die with a raw git error; say what is actually needed instead.
    throw new Error(
      `cannot read ${rev}:${file} — the acceptance tests lint the VERBATIM pre-fix source of the two ` +
        `shipped crashes, so the repo needs full history (git fetch --unshallow). Underlying: ${e.message}`,
    )
  }
}

/** Write `source` to a temp file whose NAME matches the original, then lint it
 *  with the registries learned from the live roots (so `LlmProvider` is known to
 *  be a proxy and `providers` is known not to be an action). */
function lintSource(source, originalPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-hooks-'))
  const file = path.join(dir, path.basename(originalPath))
  fs.writeFileSync(file, source)
  try {
    return analyze({ registryRoots: [UI_SRC, DESKTOP_SRC], targets: [file] }).findings
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Lint an inline snippet as a component file. */
const lintSnippet = (source) => lintSource(source, 'Snippet.tsx')

// The real fixture store, so factor 1 (module resolution) genuinely resolves to
// the file that DEFINES the proxy — the same path the shipped fixture uses.
const FIXTURE_STORE_SPEC = '@/dev/gallery/__detector_fixtures__/stores/fixtureStore'
const PROXY_IMPORT = `import { FixtureStore } from '${FIXTURE_STORE_SPEC}'\n`

describe('TEST-1 [acceptance][INV-1]: catches the shipped `usePermission(A) || usePermission(B)` crash', () => {
  test('FIRES on the verbatim pre-fix EnableSection.tsx', () => {
    const before = gitShow(`${BUG_A.fix}^`, BUG_A.file)
    assert.match(
      before,
      /usePermission\(READ_PERM\) \|\| usePermission\(MANAGE_PERM\)/,
      'the extracted blob must actually contain the shipped bug',
    )
    const findings = lintSource(before, BUG_A.file)
    const h1 = findings.filter((f) => f.rule === 'H1')
    assert.equal(h1.length, 1, `expected exactly 1 H1 finding, got ${JSON.stringify(findings)}`)
    assert.equal(h1[0].context, 'logical-rhs')
    assert.match(h1[0].code, /^usePermission/)
    const line = before.split('\n')[h1[0].line - 1]
    assert.match(line, /usePermission\(READ_PERM\) \|\| usePermission\(MANAGE_PERM\)/)
  })

  test('SILENT on the accepted fix (both hooks unconditional, results OR-ed)', () => {
    const after = gitShow(BUG_A.fix, BUG_A.file)
    assert.deepEqual(lintSource(after, BUG_A.file), [])
  })

  test('the rule is general, not a usePermission special case', () => {
    const findings = lintSnippet(
      `import { useFlag } from '@/core/flags'\n` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  const v = a || useFlag('x')\n` +
        `  return <div>{String(v)}</div>\n` +
        `}\n`,
    )
    assert.equal(findings.length, 1)
    assert.equal(findings[0].rule, 'H1')
    assert.match(findings[0].code, /^useFlag/)
  })
})

describe('TEST-2 [acceptance][INV-2]: catches the shipped conditional store-proxy read', () => {
  test('FIRES on the verbatim pre-fix EditLlmModelDrawer.tsx', () => {
    const before = gitShow(`${BUG_B.fix}^`, BUG_B.file)
    assert.match(before, /\? LlmProvider\.providers/s, 'the extracted blob must contain the shipped bug')
    const findings = lintSource(before, BUG_B.file)
    const h2 = findings.filter((f) => f.rule === 'H2')
    assert.equal(h2.length, 1, `expected exactly 1 H2 finding, got ${JSON.stringify(findings)}`)
    assert.equal(h2[0].context, 'ternary-branch')
    assert.equal(h2[0].code, 'LlmProvider.providers')
  })

  test('SILENT on the accepted fix (read hoisted, unconditional)', () => {
    const after = gitShow(BUG_B.fix, BUG_B.file)
    assert.deepEqual(lintSource(after, BUG_B.file), [])
  })
})

describe('TEST-3 [acceptance][INV-3]: zero findings across the live tree', () => {
  test('the real lint reports 0 over ui/src + desktop/ui/src', () => {
    const { findings, fileCount } = analyze()
    assert.ok(fileCount > 2000, `expected the full tree to be scanned, got ${fileCount} files`)
    assert.deepEqual(
      findings.map((f) => `${f.rule} ${path.relative(REPO, f.file)}:${f.line}`),
      [],
    )
  })

  test('the CLI exits 0 on the clean tree', () => {
    const res = spawnSync('node', ['scripts/lint-hooks.mjs'], { cwd: UI, encoding: 'utf8' })
    assert.equal(res.status, 0, res.stdout + res.stderr)
    assert.match(res.stdout, /0 violations/)
  })

  test('both workspace copies see the SAME roots (ui, desktop/ui and the shared SDK packages)', () => {
    const counts = []
    for (const ws of [UI, DESKTOP_UI]) {
      const res = spawnSync('node', ['scripts/lint-hooks.mjs'], { cwd: ws, encoding: 'utf8' })
      assert.equal(res.status, 0, `${ws}: ${res.stdout}${res.stderr}`)
      const scanned = Number(res.stdout.match(/across (\d+) file/)?.[1] ?? 0)
      assert.ok(scanned > 2000, `${ws} scanned only ${scanned} files — a root was not resolved`)
      counts.push(scanned)
    }
    assert.equal(counts[0], counts[1], 'the two copies must resolve an identical root set')
  })

  test('the shared SDK React packages are in the DEFAULT scan (they render inside BOTH apps)', () => {
    const sdk = path.resolve(REPO, 'sdk/packages')
    // The DEFAULT roots must include the SDK — an explicit `targets` call would
    // bypass ROOT_CANDIDATES entirely and prove only that the dir is parseable.
    const { roots, findings } = analyze()
    assert.ok(
      roots.some((r) => path.resolve(r) === sdk),
      `sdk/packages must be a default root; got ${JSON.stringify(roots)}`,
    )
    assert.deepEqual(findings, [])
    const explicit = analyze({ targets: [sdk] })
    assert.ok(explicit.fileCount > 100, `expected the SDK packages to be scanned, got ${explicit.fileCount}`)
  })
})

describe('TEST-4 [acceptance][INV-4]: wired into `npm run check` in both workspaces', () => {
  for (const [label, ws] of [
    ['ui', UI],
    ['desktop/ui', DESKTOP_UI],
  ]) {
    test(`${label}: defines lint:hooks and chains it in check`, () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'))
      assert.equal(pkg.scripts['lint:hooks'], 'node scripts/lint-hooks.mjs')
      assert.ok(pkg.scripts.check.includes('run lint:hooks'), 'check must chain lint:hooks')
    })
  }

  test('a reintroduced bug makes the wired command exit NON-ZERO (not merely print)', () => {
    const res = spawnSync('node', ['scripts/lint-hooks.mjs', `--root=${path.relative(UI, FIXTURES)}`], {
      cwd: UI,
      encoding: 'utf8',
    })
    assert.equal(res.status, 1, 'the gate must fail the build on a violation')
    assert.match(res.stderr, /Rules-of-Hooks violation/)
  })

  test('B6: the gate reads nothing from .lifecycle/ (survives the merge strip)', () => {
    for (const ws of [UI, DESKTOP_UI]) {
      const src = fs.readFileSync(path.join(ws, 'scripts/lint-hooks.mjs'), 'utf8')
      assert.ok(!src.includes('.lifecycle'), `${ws}/scripts/lint-hooks.mjs must not read .lifecycle/`)
    }
  })
})

describe('TEST-5: the conditional-evaluation core', () => {
  const CASES = [
    ['ternary-branch (whenTrue)', `  const v = a ? FixtureStore.items : null`, 'ternary-branch'],
    ['ternary-branch (whenFalse)', `  const v = a ? null : FixtureStore.items`, 'ternary-branch'],
    ['logical-rhs (&&)', `  const v = a && FixtureStore.items`, 'logical-rhs'],
    ['logical-rhs (||)', `  const v = a || FixtureStore.items`, 'logical-rhs'],
    ['logical-rhs (??)', `  const v = (a ? null : undefined) ?? FixtureStore.items`, 'logical-rhs'],
    ['if-body', `  let v: unknown = null\n  if (a) { v = FixtureStore.items }`, 'if-body'],
    ['else-body', `  let v: unknown = null\n  if (!a) { v = 1 } else { v = FixtureStore.items }`, 'if-body'],
    ['loop-body', `  let v: unknown = null\n  for (let i = 0; i < 1; i++) { v = FixtureStore.items }`, 'loop-body'],
    [
      'switch-case',
      `  let v: unknown = null\n  switch (String(a)) { case 'x': v = FixtureStore.items; break; default: break }`,
      'switch-case',
    ],
    ['after-early-return', `  if (!a) return null\n  const v = FixtureStore.items`, 'after-early-return'],
  ]

  for (const [name, body, expected] of CASES) {
    test(`detects ${name}`, () => {
      const findings = lintSnippet(
        `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n${body}\n  return <div>{String(v)}</div>\n}\n`,
      )
      assert.equal(findings.length, 1, `expected 1 finding, got ${JSON.stringify(findings)}`)
      assert.equal(findings[0].context, expected)
    })
  }

  test('the walk does not cross OUT of a function boundary — the enclosing function is the unit', () => {
    // The component has BOTH an early return and an `if`; the reads live inside
    // callbacks where they are UNCONDITIONAL, so the enclosing component's
    // conditions must not be attributed to them. (A conditional read INSIDE a
    // callback is still reported — see the next test; the boundary rule is about
    // not inheriting the OUTER function's conditions, not about ignoring
    // callbacks.) Removing the `!isFunctionBoundary(parent)` stop turns this red.
    const findings = lintSnippet(
      `import { useEffect } from 'react'\n${PROXY_IMPORT}` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  if (!a) return null\n` +
        `  useEffect(() => { console.error(FixtureStore.items) }, [])\n` +
        `  if (a) { return <button onClick={() => console.error(FixtureStore.items)}>x</button> }\n` +
        `  return null\n` +
        `}\n`,
    )
    assert.deepEqual(findings, [])
  })

  test('a conditional read INSIDE a callback is still reported (it is illegal there anyway)', () => {
    const findings = lintSnippet(
      `import { useEffect } from 'react'\n${PROXY_IMPORT}` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  useEffect(() => { const v = a ? FixtureStore.items : null; console.error(v) }, [a])\n` +
        `  return <div/>\n` +
        `}\n`,
    )
    assert.equal(findings.length, 1)
    assert.equal(findings[0].context, 'ternary-branch')
  })

  test('an inner `function` helper above a read is NOT an early return', () => {
    // `forEachChild(stmt, walk)` descends straight into a preceding function
    // DECLARATION, so its own `return` used to mark every later statement as
    // after-early-return — a false positive in a blocking gate.
    const findings = lintSnippet(
      `${PROXY_IMPORT}export function C() {\n` +
        `  function fmt(n: number) { return String(n) }\n` +
        `  const v = FixtureStore.items\n  return <div>{fmt(v.length)}</div>\n}\n`,
    )
    assert.deepEqual(findings, [])
  })

  test('a `catch` body is conditionally evaluated', () => {
    const findings = lintSnippet(
      `${PROXY_IMPORT}export function C() {\n  let v: unknown = null\n` +
        `  try { v = 1 } catch { v = FixtureStore.items }\n  return <div>{String(v)}</div>\n}\n`,
    )
    assert.equal(findings.length, 1, JSON.stringify(findings))
    assert.equal(findings[0].context, 'catch-clause')
  })

  test('a do-while body is NOT conditional (it always runs at least once)', () => {
    const findings = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  let v: unknown = null\n  do { v = FixtureStore.items } while (a)\n` +
        `  return <div>{String(v)}</div>\n}\n`,
    )
    assert.deepEqual(findings, [])
  })

  test('after-early-return also covers non-`if` guards (nested block, switch arm)', () => {
    for (const guard of [`  { if (!a) return null }`, `  switch (String(a)) { case 'x': return null }`]) {
      const findings = lintSnippet(
        `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n${guard}\n` +
          `  const v = FixtureStore.items\n  return <div>{String(v)}</div>\n}\n`,
      )
      assert.equal(findings.length, 1, `guard \`${guard}\` should have produced a finding`)
      assert.equal(findings[0].context, 'after-early-return')
    }
  })

  test('after-early-return applies to H2 but NOT to H1 (DEC-6: the type-guard idiom)', () => {
    // BOTH halves in one snippet, so the test fails if either side flips: the
    // `useState` must stay silent and the proxy read must fire, at the same
    // position after the same guard.
    const findings = lintSnippet(
      `import { useState } from 'react'\n${PROXY_IMPORT}` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  if (!a) return null\n` +
        `  const [s] = useState(0)\n` +
        `  const v = FixtureStore.items\n` +
        `  return <div>{s}{String(v)}</div>\n` +
        `}\n`,
    )
    assert.equal(findings.length, 1, `expected exactly the H2 half, got ${JSON.stringify(findings)}`)
    assert.equal(findings[0].rule, 'H2')
    assert.equal(findings[0].context, 'after-early-return')
  })

  test('the `hook-order-ok` marker must be a COMMENT and must carry a reason', () => {
    const bare = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  const v = a ? FixtureStore.items : null // hook-order-ok\n` +
        `  return <div>{String(v)}</div>\n}\n`,
    )
    assert.equal(bare.length, 1, 'a reasonless marker must NOT suppress')

    const inString = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  const doc = 'see hook-order-ok: the docs'\n` +
        `  const v = a ? FixtureStore.items : null\n` +
        `  return <div>{doc}{String(v)}</div>\n}\n`,
    )
    assert.equal(inString.length, 1, 'an occurrence inside a string must NOT suppress')
  })

  test('the `hook-order-ok` marker opts out — on the line, and on the line above', () => {
    const onLine = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  const v = a ? FixtureStore.items : null // hook-order-ok: \`a\` is a mount-stable context value\n` +
        `  return <div>{String(v)}</div>\n}\n`,
    )
    assert.deepEqual(onLine, [])

    const above = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  // hook-order-ok: \`a\` is a mount-stable context value\n` +
        `  const v = a ? FixtureStore.items : null\n` +
        `  return <div>{String(v)}</div>\n}\n`,
    )
    assert.deepEqual(above, [])
  })

  test('the walk does NOT follow symlinks out of the tree', () => {
    // `statSync` would follow a `vendor -> …/node_modules` link and defeat
    // SKIP_DIRS (which matches by directory NAME), making a gate that runs in
    // `check` read + report on arbitrary out-of-tree files.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-hooks-link-'))
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-hooks-out-'))
    try {
      fs.writeFileSync(
        path.join(outside, 'Escaped.tsx'),
        `import { useFlag } from '@/core/flags'\n` +
          `export function C({ a }: { a: boolean }) {\n  const v = a || useFlag('x')\n  return <div>{String(v)}</div>\n}\n`,
      )
      fs.writeFileSync(path.join(dir, 'Ok.tsx'), `export function Ok() {\n  return <div />\n}\n`)
      fs.symlinkSync(outside, path.join(dir, 'vendor'), 'dir')
      const { findings } = analyze({ registryRoots: [UI_SRC, DESKTOP_SRC], targets: [dir] })
      assert.deepEqual(findings, [], 'the symlinked dir must not be scanned')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  test('element access `Proxy[\'field\']` is the same read', () => {
    const findings = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  const v = a ? FixtureStore['items'] : null\n  return <div>{String(v)}</div>\n}\n`,
    )
    assert.equal(findings.length, 1, JSON.stringify(findings))
    assert.equal(findings[0].code, "FixtureStore['items']")
  })

  test('a PER-INSTANCE store reached through a hook handle is covered (`handle.store.field`)', () => {
    // The other half of the shipped OpenInNewWindowAction defect: its pre-image
    // read `pane.store.conversation` in one ternary branch. An imported-proxy-only
    // rule sees only the other branch, so re-introducing this one would pass.
    const findings = lintSnippet(
      `import { useFixtureHandle } from '${FIXTURE_STORE_SPEC}'\n` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  const handle = useFixtureHandle()\n` +
        `  const v = a ? handle.store.items : null\n  return <div>{String(v)}</div>\n}\n`,
    )
    assert.equal(findings.length, 1, JSON.stringify(findings))
    assert.equal(findings[0].code, 'handle.store.items')

    // …and NOT a `.store` on something that is merely iterated (a store
    // DEFINITION from a registry loop), which is what keeps this precise.
    const notAHandle = lintSnippet(
      `export function C({ a, exts }: { a: boolean; exts: { store: { name: string } }[] }) {\n` +
        `  const v = a ? exts[0].store.name : null\n  return <div>{String(v)}</div>\n}\n`,
    )
    assert.deepEqual(notAHandle, [])
  })

  test('an aliased / type-asserted proxy factory is still registered (the `Chat` bridge shape)', () => {
    // `export const Chat = _createStoreProxy(bridge) as StoreProxy<…>` — an
    // ALIASED factory import wrapped in an `as`. It is the most-imported proxy in
    // the app and the one in the OpenInNewWindowAction pre-image, so a registry
    // that misses this shape is blind on 50+ files.
    const findings = lintSnippet(
      `import { Chat } from '@/modules/chat/core/stores/chatBridge'\n` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  const v = a ? Chat.conversation : null\n  return <div>{String(v)}</div>\n}\n`,
    )
    assert.equal(findings.length, 1, JSON.stringify(findings))
    assert.equal(findings[0].code, 'Chat.conversation')
  })

  test('a `//` inside a STRING is not a comment — it cannot carry an opt-out', () => {
    const findings = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  const doc = 'https://docs.example.com/hook-order-ok: see this'\n` +
        `  const v = a ? FixtureStore.items : null\n  return <div>{doc}{String(v)}</div>\n}\n`,
    )
    assert.equal(findings.length, 1, 'a URL must not silence a real violation')
  })

  test('a block comment carries the opt-out too', () => {
    const findings = lintSnippet(
      `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
        `  /* hook-order-ok: \`a\` is a mount-stable context value */\n` +
        `  const v = a ? FixtureStore.items : null\n  return <div>{String(v)}</div>\n}\n`,
    )
    assert.deepEqual(findings, [])
  })

  test('--root scopes REPORTING to that dir while the registries still come from the full roots', () => {
    const { findings } = analyze({ targets: [FIXTURES] })
    // One per defect in ConditionalHooks.tsx — an exact count, so a rule that
    // stops firing (or starts over-reporting) fails here.
    assert.equal(findings.length, 6, `expected the 6 fixture defects, got ${JSON.stringify(findings)}`)
    for (const f of findings) assert.ok(f.file.startsWith(FIXTURES), `reported outside the target: ${f.file}`)
    // The real proxy registry is still available in fixture mode.
    const { proxyCount } = analyze({ targets: [FIXTURES] })
    assert.ok(proxyCount > 100, `registry was not learned from the roots (proxyCount=${proxyCount})`)
  })
})

describe('TEST-16: repeated analyze() calls never answer from a stale AST', () => {
  test('a TARGET edited between calls is re-read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-hooks-stale-'))
    const f = path.join(dir, 'S.tsx')
    const clean = `${PROXY_IMPORT}export function C() {\n  const v = FixtureStore.items\n  return <div>{String(v)}</div>\n}\n`
    const bad = `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n  const v = a ? FixtureStore.items : null\n  return <div>{String(v)}</div>\n}\n`
    try {
      const call = () => analyze({ registryRoots: [UI_SRC, DESKTOP_SRC], targets: [dir] }).findings.length
      fs.writeFileSync(f, clean)
      assert.equal(call(), 0)
      fs.writeFileSync(f, bad)
      assert.equal(call(), 1, 'a violation added between calls must be seen')
      fs.writeFileSync(f, clean)
      assert.equal(call(), 0, 'a violation fixed between calls must stop being reported')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a NON-target REGISTRY file edited between calls is re-read', () => {
    // The registry AST cache is the only thing served from memory; without a
    // disk stamp it would keep answering from a store definition that changed.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-hooks-root-'))
    const tgt = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-hooks-tgt-'))
    try {
      fs.mkdirSync(path.join(root, 'stores'), { recursive: true })
      const store = path.join(root, 'stores', 's.ts')
      const asProxy =
        'declare function registerLazyStore<T>(h: unknown): T\nexport const S = registerLazyStore<{ items: number[] }>({})\n'
      const asPlain = 'export const S = { items: [] as number[] }\n'
      fs.writeFileSync(store, asProxy)
      fs.writeFileSync(
        path.join(tgt, 'C.tsx'),
        `import { S } from '../${path.basename(root)}/stores/s'\n` +
          `export function C({ a }: { a: boolean }) {\n  const v = a ? S.items : null\n  return <div>{String(v)}</div>\n}\n`,
      )
      const call = () => analyze({ registryRoots: [root], targets: [tgt] }).findings.length
      assert.equal(call(), 1)
      fs.writeFileSync(store, asPlain)
      assert.equal(call(), 0, 'the store stopped being a proxy — a stale registry would still report')
      fs.writeFileSync(store, asProxy)
      assert.equal(call(), 1, 'and back again')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(tgt, { recursive: true, force: true })
    }
  })
})

describe('TEST-6: the non-firing shapes stay silent (zero-false-positive budget)', () => {
  const SILENT = {
    'unconditional proxy read': `  const items = FixtureStore.items\n  const v = a ? items : null`,
    'the `$` snapshot in a conditional': `  const v = a ? FixtureStore.$.items : null`,
    'an action CALL in a conditional': `  if (a) FixtureStore.reload()\n  const v = null`,
    'an action read (not called) in a conditional': `  const v = a ? FixtureStore.reload : null`,
    'an action BY REFERENCE in a conditional': `  const v = a && <button onClick={FixtureStore.reload}>x</button>`,
    'a special property in a conditional': `  const v = a ? FixtureStore.__destroyed : null`,
  }
  for (const [name, body] of Object.entries(SILENT)) {
    test(`silent on ${name}`, () => {
      const findings = lintSnippet(
        `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n${body}\n  return <div>{String(v)}</div>\n}\n`,
      )
      assert.deepEqual(findings, [])
    })
  }

  test('factor 1 is module RESOLUTION — a proxy outside a `stores/` path is still recognised', () => {
    // `Hardware` is exported from `@/modules/hardware/hardware`, and
    // `AssistantDrawer` from `@/modules/assistant/components/assistantDrawer` —
    // specifiers the legacy path-shape heuristic rejects because neither carries a
    // `stores/` segment. Making `resolveSpecifier` return [] (falling back to path
    // shape) turns this red — and silently drops ~95 proxy bindings tree-wide.
    // `AppLayout` is kept as the third case: it now DOES live under a `stores/`
    // parent (the component/store case-collision fix moved it), so it guards the
    // resolution path rather than the outside-`stores/` property.
    for (const [spec, name, field] of [
      ['@/modules/hardware/hardware', 'Hardware', 'devices'],
      ['@/modules/assistant/components/assistantDrawer', 'AssistantDrawer', 'editingAssistant'],
      ['@/modules/layouts/app-layout/stores/appLayout', 'AppLayout', 'isSidebarCollapsed'],
    ]) {
      const findings = lintSnippet(
        `import { ${name} } from '${spec}'\nexport function C({ a }: { a: boolean }) {\n` +
          `  const v = a ? ${name}.${field} : null\n  return <div>{String(v)}</div>\n}\n`,
      )
      assert.equal(findings.length, 1, `${spec} should be recognised: ${JSON.stringify(findings)}`)
      assert.equal(findings[0].code, `${name}.${field}`)
    }
  })

  test('two-factor: a same-named import from a NON-store specifier is not a proxy', () => {
    // `EditLlmModelDrawer` is BOTH a store-proxy export and a component name.
    const asComponent = lintSnippet(
      `import { EditLlmModelDrawer } from '@/modules/llm-provider/components/llm-models/EditLlmModelDrawer'\n` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  const v = a ? EditLlmModelDrawer.displayName : null\n` +
        `  return <div>{String(v)}</div>\n}\n`,
    )
    assert.deepEqual(asComponent, [], 'a component import must not be treated as a store proxy')

    const asStore = lintSnippet(
      `import { EditLlmModelDrawer } from '@/modules/llm-provider/stores/llmModelDrawers/editLlmModelDrawer'\n` +
        `export function C({ a }: { a: boolean }) {\n` +
        `  const v = a ? EditLlmModelDrawer.modelId : null\n` +
        `  return <div>{String(v)}</div>\n}\n`,
    )
    assert.equal(asStore.length, 1, 'the SAME name imported from the store module IS a proxy')
    assert.equal(asStore[0].rule, 'H2')
  })

  test('a type-only import of a proxy name is not a value read', () => {
    // The lint parses, it never type-checks, so a file CAN reach it with a
    // type-only binding used in a value position. That is the only way to
    // exercise the `isTypeOnly` guards: an identical conditional property access
    // to a firing case, silent solely because the import is type-only. (This
    // snippet is a string in the test, so `tsc` never sees it.) Dropping either
    // guard turns this red.
    for (const imp of [
      `import type { FixtureStore } from '${FIXTURE_STORE_SPEC}'`,
      `import { type FixtureStore } from '${FIXTURE_STORE_SPEC}'`,
    ]) {
      const findings = lintSnippet(
        `${imp}\nexport function C({ a }: { a: boolean }) {\n` +
          `  const v = a ? FixtureStore.items : null\n` +
          `  return <div>{String(v)}</div>\n}\n`,
      )
      assert.deepEqual(findings, [], imp)
    }
    // Control: the SAME snippet with a value import DOES fire, so the silence
    // above is attributable to `isTypeOnly` and nothing else.
    assert.equal(
      lintSnippet(
        `${PROXY_IMPORT}export function C({ a }: { a: boolean }) {\n` +
          `  const v = a ? FixtureStore.items : null\n  return <div>{String(v)}</div>\n}\n`,
      ).length,
      1,
    )
  })
})

describe('TEST-15: the gate fails LOUDLY instead of silently passing', () => {
  test('registryHealthError trips on an empty scan and on a broken proxy registry', () => {
    // Absolute values, NOT expressions in PROXY_REGISTRY_FLOOR: parameterizing on
    // the constant makes the assertions hold even at a floor of 0, i.e. with the
    // guard disabled.
    assert.ok(PROXY_REGISTRY_FLOOR >= 50, 'a floor below 50 cannot detect a partial registry break')
    assert.match(registryHealthError({ fileCount: 0, proxyCount: 300 }), /scanned 0 files/)
    assert.match(registryHealthError({ fileCount: 2000, proxyCount: 49 }), /store-proxy registry looks broken/)
    assert.match(registryHealthError({ fileCount: 2000, proxyCount: 0 }), /store-proxy registry looks broken/)
    assert.equal(registryHealthError({ fileCount: 2000, proxyCount: 300 }), null)
  })

  test('the live registry sits comfortably above the floor', () => {
    const { proxyCount } = analyze()
    assert.ok(
      proxyCount > PROXY_REGISTRY_FLOOR * 2,
      `only ${proxyCount} proxies learned — the floor would not catch a partial break`,
    )
  })

  test('an unusable --root exits 2 (an operator error is never a passing gate)', () => {
    const run = (...args) => spawnSync('node', ['scripts/lint-hooks.mjs', ...args], { cwd: UI, encoding: 'utf8' })
    for (const args of [
      ['--root=src/does/not/exist'],
      ['--root', 'package.json'],
      ['--root'],
      ['--root='], // empty value used to resolve to cwd and report the fixtures
      ['--roots=src'],
    ]) {
      const res = run(...args)
      assert.equal(res.status, 2, `${args.join(' ')} should be an operator error, got ${res.status}: ${res.stdout}`)
    }
    // …and 2 is distinct from BOTH the clean (0) and the violation (1) codes.
    assert.equal(run().status, 0)
    assert.equal(run(`--root=${path.relative(UI, FIXTURES)}`).status, 1)
  })

  test('--root is repeatable and accepts the space form, like the sibling lints', () => {
    assert.deepEqual(parseArgs(['--root=a', '--root', 'b', '--json']), { roots: ['a', 'b'], json: true, bad: [] })
    assert.equal(parseArgs(['--nope']).bad.length, 1)
    assert.equal(parseArgs(['--root']).bad.length, 1)
  })

  test('the byte-identity drift guard runs INSIDE the gate (behavioural)', () => {
    assert.equal(siblingDriftError(), null, 'the two workspace copies must be byte-identical')
    // Make the copies genuinely differ and assert the CLI REFUSES to run. A
    // source regex would match the function's own declaration and pass even if
    // main() never called it, so this drives the real binary instead.
    const sibling = path.join(DESKTOP_UI, 'scripts/lint-hooks.mjs')
    const original = fs.readFileSync(sibling)
    try {
      fs.writeFileSync(sibling, `${original.toString('utf8')}\n// drift\n`)
      assert.notEqual(siblingDriftError(), null, 'the guard must see the divergence')
      const res = spawnSync('node', ['scripts/lint-hooks.mjs'], { cwd: UI, encoding: 'utf8' })
      assert.equal(res.status, 2, 'a diverged pair must be an operator error, not a pass')
      assert.match(res.stderr, /DIVERGED/)
    } finally {
      fs.writeFileSync(sibling, original)
    }
    assert.equal(siblingDriftError(), null, 'the copies must be restored')
  })
})

describe('TEST-7: fixtures + detector-acceptance wiring', () => {
  const FIXTURE_FILES = [
    'ConditionalHooks.tsx',
    'ConditionalHooksClean.tsx',
    path.join('stores', 'fixtureStore.ts'),
  ]

  test('the known-bad fixture exists in BOTH workspaces and is identical', () => {
    for (const rel of FIXTURE_FILES) {
      const a = path.join(UI_SRC, 'dev/gallery/__detector_fixtures__', rel)
      const b = path.join(DESKTOP_SRC, 'dev/gallery/__detector_fixtures__', rel)
      assert.ok(fs.existsSync(a), `missing ${a}`)
      assert.ok(fs.existsSync(b), `missing ${b}`)
      assert.equal(fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8'), `${rel} drifted between workspaces`)
    }
  })

  test('drift guard: the lint script is byte-identical between the two workspaces', () => {
    assert.equal(
      fs.readFileSync(path.join(UI, 'scripts/lint-hooks.mjs'), 'utf8'),
      fs.readFileSync(path.join(DESKTOP_UI, 'scripts/lint-hooks.mjs'), 'utf8'),
    )
  })

  test('the lint FIRES via the exact --root invocation the acceptance harness uses, in both workspaces', () => {
    for (const ws of [UI, DESKTOP_UI]) {
      const res = spawnSync(
        'node',
        ['scripts/lint-hooks.mjs', '--root=src/dev/gallery/__detector_fixtures__'],
        { cwd: ws, encoding: 'utf8' },
      )
      assert.equal(res.status, 1, `${ws}: expected the fixture to fire`)
      assert.match(res.stderr, /__detector_fixtures__/)
      assert.match(res.stderr, /H1 /)
      assert.match(res.stderr, /H2 /)
      // Every H2 sub-rule has a fixture instance, so none can be deleted silently.
      for (const shape of [/ternary-branch/, /after-early-return/, /if-body/, /\['items'\]/, /handle\.store\.items/])
        assert.match(res.stderr, shape, `${ws}: fixture must cover ${shape}`)
    }
  })

  test('the clean companion contributes ZERO findings (both directions proven at once)', () => {
    const { findings } = analyze({ targets: [FIXTURES] })
    assert.deepEqual(findings.filter((f) => f.file.endsWith('ConditionalHooksClean.tsx')), [])
  })

  test('both detector-acceptance tables carry the O1 + O2 lint rows, each with its OWN expectation', () => {
    for (const ws of [UI, DESKTOP_UI]) {
      const src = fs.readFileSync(path.join(ws, 'scripts/detector-acceptance.mjs'), 'utf8')
      assert.match(src, /cls: 'O1'[\s\S]*?lint-hooks\.mjs/, `${ws}: missing the O1 row`)
      assert.match(src, /cls: 'O2'[\s\S]*?lint-hooks\.mjs/, `${ws}: missing the O2 row`)
      // O1 and O2 share ONE script, so without a per-row `expect` the O2 row
      // would count as "fired" on O1's finding alone — a hollow acceptance row.
      assert.match(src, /cls: 'O1'[\s\S]*?expect: \/H1 /, `${ws}: O1 row must assert an H1 finding`)
      assert.match(src, /cls: 'O2'[\s\S]*?expect: \/H2 /, `${ws}: O2 row must assert an H2 finding`)
      assert.match(src, /expect \? expect\.test\(out\)/, `${ws}: runLint must honour the row's expect`)
    }
  })

  test('the taxonomy documents O1 + O2 in both workspaces', () => {
    for (const ws of [UI, DESKTOP_UI]) {
      const doc = fs.readFileSync(path.join(ws, 'docs/DEFECT_TAXONOMY.md'), 'utf8')
      assert.match(doc, /^- O1 \[L\]/m, `${ws}: missing the O1 taxonomy row`)
      assert.match(doc, /^- O2 \[L\]/m, `${ws}: missing the O2 taxonomy row`)
      assert.match(doc, /lint-hooks\.mjs/, `${ws}: taxonomy must name the detector script`)
    }
  })
})
