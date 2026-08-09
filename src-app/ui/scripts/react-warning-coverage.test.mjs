/**
 * The STRICT React-warning list must match the React version THIS APP INSTALLS.
 *
 * Why this lives here and not in `@ziee/gallery`: react-dom is the APP's
 * dependency. The first attempt at this backstop sat inside the package and
 * resolved `node_modules/react-dom/...` relative to the package's own `scripts/lib/`
 * directory — which does not exist — so `if (!file) return` was taken on every
 * run and the test reported a green tick while asserting nothing. A blind auditor
 * then reproduced the exact rot it was meant to prevent (renaming the React-19
 * pattern to a wrong spelling left the whole suite green while every DOM-nesting
 * warning went back to gating HIGH).
 *
 * So: resolve react-dom through real module resolution, and treat "cannot find
 * react-dom" as a FAILURE, never a silent skip. A backstop that can quietly
 * decline to run is worse than no backstop — it reports safety it isn't providing.
 *
 * Run: node --test scripts/react-warning-coverage.test.mjs   (cwd = src-app/ui)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  REACT_WARNING_STRICT,
  classifyConsoleMessage,
} from '../../../sdk/packages/gallery/scripts/lib/finding-classify.mjs'

const require = createRequire(import.meta.url)

/** The installed react-dom development build — the source of truth for the
 *  warning strings the crawl will actually see. */
function reactDomDevSource() {
  const pkg = require.resolve('react-dom/package.json')
  const dir = path.dirname(pkg)
  const candidates = [
    'cjs/react-dom-client.development.js',
    'cjs/react-dom.development.js',
  ].map(c => path.join(dir, c))
  const found = candidates.find(c => fs.existsSync(c))
  assert.ok(
    found,
    `react-dom resolved to ${dir} but no development build was found among:\n  ` +
      candidates.join('\n  ') +
      '\nThis test must never silently skip — that is how the previous version ' +
      'of it passed while asserting nothing.',
  )
  return { src: fs.readFileSync(found, 'utf8'), file: found }
}

test('react-dom is resolvable and this test is actually running', () => {
  const { file } = reactDomDevSource()
  assert.ok(fs.statSync(file).size > 1000, `${file} looks empty`)
})

test('every DOM-nesting warning the INSTALLED React emits is in the STRICT list', () => {
  // The round-4 defect: React 19 rewrote this warning family, so a list written
  // against React 18 spellings matched none of it and the whole family kept
  // gating HIGH — against the very version the fix cited.
  const { src, file } = reactDomDevSource()
  const domNesting = [...new Set([...src.matchAll(/In HTML, [^"'`\\]{0,90}/g)].map(m => m[0]))]
  assert.ok(
    domNesting.length > 0,
    `expected React DOM-nesting warnings in ${file}; if React renamed them again, ` +
      'this test must be updated deliberately rather than quietly matching nothing',
  )
  for (const t of domNesting) {
    assert.ok(
      REACT_WARNING_STRICT.some(re => re.test(t)),
      `the installed React emits a DOM-nesting warning the STRICT list does not ` +
        `match, so it will gate HIGH as if it were a runtime failure:\n  ${t}`,
    )
    assert.deepEqual(
      classifyConsoleMessage('error', 'loaded', t),
      { category: 'react-warning', severity: 'MEDIUM' },
      `must be classified MEDIUM on the error channel: ${t}`,
    )
  }
})

test('the key warning the installed React emits is matched', () => {
  const { src } = reactDomDevSource()
  assert.ok(
    /Each child in a list should have a unique/.test(src),
    'React no longer emits the key warning in the spelling the STRICT list pins',
  )
})

test('a genuine runtime error is NOT downgraded (the gate-hole direction)', () => {
  // The dangerous direction. Kept here alongside the version check so the two
  // halves of the trade-off are asserted in one place.
  for (const t of [
    'TypeError: ReactDOM.findDOMNode is not a function',
    '[ApiClient] GET /api/models failed: 410 Gone — this endpoint is deprecated',
    'Uncaught (in promise) Error: crypto.subtle is deprecated in insecure contexts',
  ])
    assert.deepEqual(
      classifyConsoleMessage('error', 'loaded', t),
      { category: 'console-error', severity: 'HIGH' },
      `must still gate: ${t}`,
    )
})
