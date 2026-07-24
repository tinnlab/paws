import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// TEST-5 (ITEM-3) — LazyDatePicker moves react-day-picker + date-fns out of the
// eager entry into a lazy chunk. It MUST be a forwardRef that dynamic-imports the
// kit DatePicker and forwards every prop + the ref, because the kit FormField
// injects value/onChange/name/id/ref via React.cloneElement and the kit
// DatePicker is itself a forwardRef. LazyDatePicker is `.tsx` (JSX can't be
// imported under `node --test`), so this is a source-contract test of that
// wiring; the LIVE prop/ref binding in a real elicitation form is proven by the
// e2e (TEST-3).

const wrapperSrc = readFileSync(
  fileURLToPath(new URL('./LazyDatePicker.tsx', import.meta.url)),
  'utf8',
)

test('LazyDatePicker is a forwardRef wrapper that forwards props + ref', () => {
  assert.match(wrapperSrc, /React\.forwardRef</, 'must be a React.forwardRef')
  // props spread + ref forwarded onto the inner picker (the FormField binding)
  assert.match(wrapperSrc, /\{\.\.\.props\}/, 'must spread {...props}')
  assert.match(wrapperSrc, /ref=\{ref\}/, 'must forward ref={ref}')
})

test('LazyDatePicker dynamic-imports the kit DatePicker inside a Suspense boundary', () => {
  // React.lazy + a dynamic import of the deep kit export = the lazy-chunk split.
  assert.match(wrapperSrc, /React\.lazy\(/, 'must use React.lazy')
  assert.match(
    wrapperSrc,
    /import\('@ziee\/kit\/kit\/date-picker'\)/,
    'must dynamic-import the deep @ziee/kit/kit/date-picker export',
  )
  assert.match(
    wrapperSrc,
    /m\.DatePicker/,
    'must resolve the module to its DatePicker export',
  )
  assert.match(wrapperSrc, /React\.Suspense/, 'must wrap in Suspense')
  assert.match(wrapperSrc, /Skeleton/, 'must show a Skeleton fallback while loading')
})

test('both elicitation consumers use LazyDatePicker, not the eager barrel DatePicker', () => {
  for (const rel of [
    '../../modules/workflow/components/WorkflowElicitForm.tsx',
    '../../modules/mcp/chat-extension/components/elicitationFields.tsx',
  ]) {
    const s = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
    assert.match(
      s,
      /LazyDatePicker/,
      `${rel}: must render the LazyDatePicker wrapper`,
    )
    // must NOT statically import DatePicker from the kit barrel (that would keep
    // react-day-picker eager and make the dynamic import INEFFECTIVE).
    assert.doesNotMatch(
      s,
      /^\s*DatePicker,\s*$/m,
      `${rel}: must not import DatePicker from the @ziee/kit barrel`,
    )
    assert.doesNotMatch(s, /<DatePicker\b/, `${rel}: must not render the eager <DatePicker>`)
  }
})
