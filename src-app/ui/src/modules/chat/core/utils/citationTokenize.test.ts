import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citationTokenize, isCitationHref } from './citationTokenize.ts'

/**
 * An empty hidden-module set — i.e. "the knowledge base is present".
 *
 * The tokenization RULES below are about regex behaviour and are worth keeping
 * whether or not this instance hides the KB, so they inject this rather than
 * depending on the shipping list. The paws behaviour is asserted separately at
 * the bottom of the file, against the REAL list.
 */
const KB_PRESENT: ReadonlySet<string> = new Set()

// TEST-59 (FB-11): bare `[n]` KB citations become chip links, but real links,
// footnotes, non-numeric brackets, and already-tokenized markers are untouched.
test('citationTokenize rewrites only bare numeric [n]', () => {
  assert.equal(
    citationTokenize('It is in the chloroplast [1] and mitochondria [12].', KB_PRESENT),
    'It is in the chloroplast [1](#kb-cite-1) and mitochondria [12](#kb-cite-12).',
  )
  // real markdown link — the `(` lookahead protects it
  assert.equal(citationTokenize('see [the docs](https://x.y)', KB_PRESENT), 'see [the docs](https://x.y)')
  // footnote ref — has `^`, never matches
  assert.equal(citationTokenize('a claim[^1]', KB_PRESENT), 'a claim[^1]')
  // non-numeric bracket
  assert.equal(citationTokenize('array[i] and [TODO]', KB_PRESENT), 'array[i] and [TODO]')
  // NUMERIC array index (word-char before `[`) — left alone, not a citation
  assert.equal(citationTokenize('arr[1] and list[0]', KB_PRESENT), 'arr[1] and list[0]')
  // reference-style link usage/definition — untouched
  assert.equal(citationTokenize('[Smith][1] and [1]: http://x', KB_PRESENT), '[Smith][1] and [1]: http://x')
  // inside a code span / fenced block — never rewritten (would corrupt code)
  assert.equal(citationTokenize('use `x[1]` now', KB_PRESENT), 'use `x[1]` now')
  // A bare `[1]` INSIDE a code span — the only shape that actually exercises
  // CODE_SEGMENT_RE. The two cases around it are blocked by the lookbehind
  // alone (`x[1]`, `arr[1]` have a word char before the bracket), so without
  // this one the whole code-splitting stage could be deleted and the suite
  // would stay green.
  assert.equal(citationTokenize('see `a [1] b` here', KB_PRESENT), 'see `a [1] b` here')
  assert.equal(citationTokenize('```py\narr[1]\n```', KB_PRESENT), '```py\narr[1]\n```')
  // idempotent — an already-tokenized citation is left alone
  assert.equal(citationTokenize('[1](#kb-cite-1)', KB_PRESENT), '[1](#kb-cite-1)')
})

test('isCitationHref parses the chip href', () => {
  assert.equal(isCitationHref('#kb-cite-3'), 3)
  assert.equal(isCitationHref('#kb-cite-42'), 42)
  assert.equal(isCitationHref('#section'), null)
  assert.equal(isCitationHref('https://x.y'), null)
  assert.equal(isCitationHref(undefined), null)
})

// paws feature-surface reduction: with the knowledge base hidden (design item
// 9), tokenization is OFF against the REAL shipping list — no dead citation
// chips are manufactured from ordinary prose.
//
// This is the assertion that would go red if the gate were removed; the cases
// above deliberately inject KB_PRESENT so they keep testing the regex rules
// rather than the instance's configuration.
test('citationTokenize is disabled while the knowledge base is hidden', () => {
  const withKbHidden = citationTokenize(
    'It is in the chloroplast [1] and mitochondria [12].',
  )
  assert.equal(
    withKbHidden,
    'It is in the chloroplast [1] and mitochondria [12].',
    'bare [n] must be left alone — a chip whose source card cannot exist is a ' +
      'dead but focusable, screen-reader-announced affordance',
  )
})
