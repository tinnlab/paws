import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_INLINE_FILE_STATE,
  DEFAULT_MESSAGE_COLLAPSED,
  emptyViewMaps,
  forgetRailKeys,
  resolveFileState,
  resolveMessageCollapsed,
} from './messageViewState.helpers.ts'

// TEST-1 (message-scroll-stability ITEM-6): pure per-conversation view-state
// helpers — defaults + reset. No DOM / no store.

test('emptyViewMaps produces fresh empty maps (per-conversation reset)', () => {
  const a = emptyViewMaps()
  // `rails` / `steps` joined the shape when the activity rail lifted its
  // expansion state out of component state and into this store (INV-7).
  assert.deepEqual(a, { collapsed: {}, files: {}, rails: {}, steps: {} })
  // New identities each call so a reset can never alias the previous maps.
  const b = emptyViewMaps()
  assert.notEqual(a.collapsed, b.collapsed)
  assert.notEqual(a.files, b.files)
  assert.notEqual(a.rails, b.rails)
  assert.notEqual(a.steps, b.steps)
})

test('forgetRailKeys evicts exactly one message’s rail + step entries (split-pane scoping)', () => {
  // Rail keys are `<messageId>#…`, so a scoped conversation switch must evict
  // them without touching another split pane's still-open conversation — the
  // same contract `resetViewState(messageIds)` already honours for `collapsed`.
  const maps = {
    rails: { 'm1#0': true, 'm1#1': false, 'm2#0': true },
    steps: { 'm1#step#toolu_a': true, 'm2#step#toolu_b': true },
  }
  forgetRailKeys(maps, 'm1')
  assert.deepEqual(maps.rails, { 'm2#0': true })
  assert.deepEqual(maps.steps, { 'm2#step#toolu_b': true })
  // Evicting an id with no entries is a no-op, not a throw.
  assert.doesNotThrow(() => forgetRailKeys(maps, 'never-seen'))
  // A message id that is a PREFIX of another must not evict the other's keys.
  const prefix = { rails: { 'm#0': true, 'm10#0': true }, steps: {} }
  forgetRailKeys(prefix, 'm')
  assert.deepEqual(prefix.rails, { 'm10#0': true })
})

test('resolveMessageCollapsed defaults an unknown id to collapsed', () => {
  assert.equal(resolveMessageCollapsed({}, 'm1'), DEFAULT_MESSAGE_COLLAPSED)
  assert.equal(DEFAULT_MESSAGE_COLLAPSED, true)
  // A stored value wins over the default (both directions).
  assert.equal(resolveMessageCollapsed({ m1: false }, 'm1'), false)
  assert.equal(resolveMessageCollapsed({ m1: true }, 'm1'), true)
})

test('resolveFileState defaults an unknown key + returns a stored entry', () => {
  assert.deepEqual(resolveFileState({}, 'ziee://x'), DEFAULT_INLINE_FILE_STATE)
  // Default is expanded (collapsed:false), unseen, reserved-default height.
  assert.deepEqual(DEFAULT_INLINE_FILE_STATE, {
    collapsed: false,
    seen: false,
    heightPx: null,
  })
  const stored = { collapsed: true, seen: true, heightPx: 512 }
  assert.deepEqual(resolveFileState({ 'ziee://x': stored }, 'ziee://x'), stored)
})

test('message-id and file-uri key spaces are independent (same string, two maps)', () => {
  // A message id and a file uri could in principle be equal strings; they live
  // in separate maps so one never shadows the other.
  const collapsed = { key: true }
  const files = { key: { collapsed: false, seen: true, heightPx: 200 } }
  assert.equal(resolveMessageCollapsed(collapsed, 'key'), true)
  assert.equal(resolveFileState(files, 'key').seen, true)
})
