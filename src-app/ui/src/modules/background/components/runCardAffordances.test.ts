/**
 * TEST-10 — the "Open conversation" affordance rule.
 *
 * A run card renders in two contexts now: inside its OWN conversation's Tasks
 * panel, and out of context. In the first case "Open conversation" navigates to
 * the conversation you are already reading — a no-op that, inside a split pane,
 * moves the whole window rather than the pane.
 *
 * Authored against `node:test` (run by `npm run test:unit`), the runner this
 * workspace uses for pure extracted helpers; Vitest is reserved for the
 * `*.store.test.ts` specs that need module mocking + jsdom.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldShowOpenConversation } from '@/modules/background/components/runCardAffordances'

const CONV_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CONV_B = 'bbbbbbbb-0000-0000-0000-000000000002'

describe('shouldShowOpenConversation (TEST-10)', () => {
  it('hides the affordance inside the run’s own conversation', () => {
    assert.equal(shouldShowOpenConversation({ conversation_id: CONV_A }, CONV_A), false)
  })

  it('shows it when the surrounding conversation is a different one', () => {
    assert.equal(shouldShowOpenConversation({ conversation_id: CONV_A }, CONV_B), true)
  })

  it('shows it when there is no surrounding conversation (unchanged behaviour)', () => {
    assert.equal(shouldShowOpenConversation({ conversation_id: CONV_A }), true)
    assert.equal(shouldShowOpenConversation({ conversation_id: CONV_A }, undefined), true)
  })

  it('hides it for a conversation-less run, which has nothing to open', () => {
    assert.equal(shouldShowOpenConversation({ conversation_id: undefined }), false)
    assert.equal(shouldShowOpenConversation({ conversation_id: undefined }, CONV_A), false)
  })
})
