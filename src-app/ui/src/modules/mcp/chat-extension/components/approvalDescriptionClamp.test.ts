import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isDescriptionOverflowing,
  descriptionClampClass,
  descriptionToggleLabel,
  APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX,
  APPROVAL_DESCRIPTION_COLLAPSED_CLASS,
  APPROVAL_DESCRIPTION_OVERFLOW_TOLERANCE_PX,
  TAILWIND_SPACING_BASE_PX,
} from './approvalDescriptionClamp.ts'

/** TEST-9 — the clamp decision. */

test('content taller than its box overflows', () => {
  assert.equal(isDescriptionOverflowing({ scrollHeight: 900, clientHeight: 120 }), true)
})

test('content that fits does NOT overflow (no toggle on a short description)', () => {
  assert.equal(isDescriptionOverflowing({ scrollHeight: 40, clientHeight: 120 }), false)
  assert.equal(isDescriptionOverflowing({ scrollHeight: 120, clientHeight: 120 }), false)
})

test('sub-pixel rounding within tolerance is not treated as overflow', () => {
  // Exactly at the tolerance → still not overflowing (strict `>`).
  assert.equal(
    isDescriptionOverflowing({
      scrollHeight: 120 + APPROVAL_DESCRIPTION_OVERFLOW_TOLERANCE_PX,
      clientHeight: 120,
    }),
    false,
    'a fraction of a pixel must not flicker the toggle in',
  )
  assert.equal(
    isDescriptionOverflowing({
      scrollHeight: 120 + APPROVAL_DESCRIPTION_OVERFLOW_TOLERANCE_PX + 1,
      clientHeight: 120,
    }),
    true,
  )
})

test('a non-finite measurement never claims overflow', () => {
  assert.equal(isDescriptionOverflowing({ scrollHeight: NaN, clientHeight: 120 }), false)
  assert.equal(isDescriptionOverflowing({ scrollHeight: 900, clientHeight: NaN }), false)
})

test('collapsed applies the cap; expanded applies NO height cage', () => {
  const collapsed = descriptionClampClass(false)
  assert.ok(
    collapsed.includes(APPROVAL_DESCRIPTION_COLLAPSED_CLASS),
    'collapsed must carry the max-height utility',
  )
  assert.ok(collapsed.includes('overflow-hidden'))
  assert.equal(
    descriptionClampClass(true),
    '',
    'expanded must be genuinely unconstrained, not a taller second cage',
  )
})

test('the clamp class and the px constant cannot drift', () => {
  // Tailwind v4 spacing is `n × 4px`, so `max-h-30` === 120px. If someone edits
  // one of the two without the other, the documented cap stops matching the
  // rendered cap — this is the guard.
  const n = Number(APPROVAL_DESCRIPTION_COLLAPSED_CLASS.replace('max-h-', ''))
  assert.ok(Number.isFinite(n), 'the clamp class must be a numeric spacing utility')
  assert.equal(
    n * TAILWIND_SPACING_BASE_PX,
    APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX,
    `${APPROVAL_DESCRIPTION_COLLAPSED_CLASS} must equal ${APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX}px`,
  )
})

test('the collapsed cap is a named constant on the 4px grid, and is bounded', () => {
  assert.equal(APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX % TAILWIND_SPACING_BASE_PX, 0)
  // Must stay under the sibling args clamp (max-h-40 = 160px) so the
  // description can never be the tallest region of the card.
  assert.ok(
    APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX < 160,
    'the description cap must stay below the arguments cap that bounds the card',
  )
})

test('the toggle label reflects the state', () => {
  assert.equal(descriptionToggleLabel(false), 'Show more')
  assert.equal(descriptionToggleLabel(true), 'Show less')
})
