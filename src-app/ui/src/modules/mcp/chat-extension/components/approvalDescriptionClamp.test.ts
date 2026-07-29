import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX,
  approvalDescriptionViewKey,
} from './approvalDescriptionClamp.ts'
import { COLLAPSE_MAX_HEIGHT_PX } from '@/modules/chat/components/collapsible'

/**
 * TEST-9 — the two surface-specific values behind the approval-description
 * clamp. The clamp MECHANISM is `CollapsibleBlock`'s and is covered by its own
 * tests; what is specific here is the bound and the view-state key.
 *
 * The behavioural proof that the card actually stays inside the fold is the e2e
 * (TEST-10b) — these are the invariants that keep the constant meaningful.
 */

test('the collapsed cap is bounded ABOVE by the sibling args clamp', () => {
  // The arguments block on this same card is `max-h-40` = 160px. If the
  // description cap ever exceeded it, the description would become the tallest
  // region of the card and the whole "card fits in the fold" property would rest
  // on nothing.
  assert.ok(
    APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX < 160,
    `description cap (${APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX}px) must stay under the 160px args cap`,
  )
})

test('the collapsed cap is bounded BELOW — still enough to read a real description', () => {
  // ~6 lines at the card's text-sm. Small enough to bound the card, large enough
  // that a normal one-paragraph description needs no toggle at all.
  assert.ok(APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX >= 96)
})

test('the cap is on the 4px spacing grid', () => {
  assert.equal(APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX % 4, 0)
})

test('it is TIGHTER than the whole-message collapse (a field, not a message body)', () => {
  assert.ok(
    APPROVAL_DESCRIPTION_COLLAPSED_MAX_PX < COLLAPSE_MAX_HEIGHT_PX,
    'one field on a decision card must clamp tighter than a full assistant message',
  )
})

test('the view-state key is namespaced away from real message ids', () => {
  const key = approvalDescriptionViewKey('toolu_abc123')
  assert.ok(key.includes('toolu_abc123'), 'must stay unique per tool call')
  assert.notEqual(
    key,
    'toolu_abc123',
    'a bare id would share the MessageViewState map with real message ids',
  )
  assert.notEqual(
    approvalDescriptionViewKey('a'),
    approvalDescriptionViewKey('b'),
    'two pending approvals must not share one collapsed flag',
  )
})
