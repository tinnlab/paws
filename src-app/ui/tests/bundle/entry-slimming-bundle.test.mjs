import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// TEST-6 (ITEM-1/2/3/4) — the MECHANICAL proof of the byte claims, run against a
// REAL production build (`vite build --sourcemap --mode production`). No guessed
// savings: every assertion reads the emitted chunks/sourcemaps in src-app/dist/ui.
//
// Run after building:
//   (cd src-app/ui && rm -rf ../dist/ui && \
//     VITE_API_PROXY_TARGET=http://localhost:29185/ npx vite build --sourcemap --mode production)
//   node --test src-app/ui/tests/bundle/entry-slimming-bundle.test.mjs

// Measured baseline entry on base origin/feat/agent-core (see TEST_RESULTS.md).
const BASELINE_ENTRY_BYTES = 1_040_856

const ASSETS = fileURLToPath(new URL('../../../dist/ui/assets', import.meta.url))

function assetsPresent() {
  return existsSync(ASSETS) && readdirSync(ASSETS).some(f => /^index-.*\.js$/.test(f))
}

function pick(re) {
  return readdirSync(ASSETS).filter(f => re.test(f))
}
function mapSources(jsFile) {
  const map = JSON.parse(readFileSync(`${ASSETS}/${jsFile}.map`, 'utf8'))
  return map.sources || []
}
function anySource(sources, needle) {
  return sources.some(s => s.includes(needle))
}

test('production build artifacts exist (build before running TEST-6)', () => {
  assert.ok(
    assetsPresent(),
    `no built entry in ${ASSETS} — run the production build first`,
  )
})

test('ITEM-1: a stable vendor chunk exists holding the framework libs', () => {
  const vendors = pick(/^vendor-.*\.js$/)
  assert.equal(vendors.length, 1, 'exactly one vendor-*.js chunk')
  const src = mapSources(vendors[0])
  for (const lib of ['/@base-ui/', '/react-dom/', '/react-router', '/scheduler/']) {
    assert.ok(anySource(src, lib), `vendor chunk must contain ${lib}`)
  }
})

test('ITEM-4: @base-ui / react-dom / react-router are OUT of the entry (moved to vendor)', () => {
  const entry = pick(/^index-.*\.js$/)[0]
  const src = mapSources(entry)
  for (const lib of ['/@base-ui/', '/react-dom/', '/react-router']) {
    assert.ok(!anySource(src, lib), `entry must NOT contain ${lib} (it belongs in vendor)`)
  }
})

test('ITEM-2: react-icons is gone from the entry AND from every shipped chunk', () => {
  const entry = pick(/^index-.*\.js$/)[0]
  assert.ok(!anySource(mapSources(entry), 'react-icons'), 'react-icons absent from entry sourcemap')
  // GenIcon is react-icons' runtime factory — assert it appears in NO chunk output.
  for (const f of readdirSync(ASSETS).filter(f => f.endsWith('.js'))) {
    const code = readFileSync(`${ASSETS}/${f}`, 'utf8')
    assert.ok(!code.includes('GenIcon'), `react-icons runtime leaked into ${f}`)
  }
})

test('ITEM-3: react-day-picker + date-fns are OUT of the entry and IN a lazy chunk', () => {
  const entry = pick(/^index-.*\.js$/)[0]
  const entrySrc = mapSources(entry)
  for (const lib of ['react-day-picker', '/date-fns/', '@date-fns']) {
    assert.ok(!anySource(entrySrc, lib), `entry must NOT contain ${lib}`)
  }
  // They must still exist somewhere (a lazy chunk), else the picker is broken.
  const lazyMaps = readdirSync(ASSETS)
    .filter(f => f.endsWith('.js.map') && !/^index-/.test(f))
  const hasDayPicker = lazyMaps.some(m =>
    (JSON.parse(readFileSync(`${ASSETS}/${m}`, 'utf8')).sources || []).some(s =>
      s.includes('react-day-picker'),
    ),
  )
  assert.ok(hasDayPicker, 'react-day-picker must live in a lazy (non-entry) chunk')
})

test('ITEM-1/2/3: the entry chunk is dramatically smaller than the baseline', () => {
  const entry = pick(/^index-.*\.js$/)[0]
  const bytes = statSync(`${ASSETS}/${entry}`).size
  assert.ok(
    bytes < BASELINE_ENTRY_BYTES,
    `entry ${bytes}B must be < baseline ${BASELINE_ENTRY_BYTES}B`,
  )
})
