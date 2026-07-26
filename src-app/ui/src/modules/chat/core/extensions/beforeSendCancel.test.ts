import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCancel, mergeCancelDecision } from './beforeSendCancel.ts'

/**
 * TEST-1 — the cancel-severity algebra.
 *
 * The whole safety property of the `silent` flag is that it can never widen to
 * cover a genuine blocker. These assertions ARE that property.
 */

test('no cancels at all → not cancelled', () => {
  const d = resolveCancel([
    ['a', { cancel: false }],
    ['b', {}],
  ])
  assert.equal(d.cancel, false)
  assert.equal(d.silent, false)
})

test('a cancel without `silent` stays LOUD (the pre-existing default)', () => {
  const d = resolveCancel([['file', { cancel: true, errorMessage: 'still uploading' }]])
  assert.equal(d.cancel, true)
  assert.equal(d.silent, false, 'an unflagged cancel must keep throwing')
  assert.equal(d.errorMessage, 'still uploading')
  assert.equal(d.cancelledBy, 'file')
})

test('a silent cancel alone → silent', () => {
  const d = resolveCancel([['text', { cancel: true, silent: true, errorMessage: 'Message cannot be empty' }]])
  assert.equal(d.cancel, true)
  assert.equal(d.silent, true)
})

test('silent + silent → silent', () => {
  const d = resolveCancel([
    ['text', { cancel: true, silent: true }],
    ['other', { cancel: true, silent: true }],
  ])
  assert.equal(d.cancel, true)
  assert.equal(d.silent, true)
})

test('FAIL-LOUD WINS: silent first, loud second → LOUD', () => {
  const d = resolveCancel([
    ['text', { cancel: true, silent: true, errorMessage: 'Message cannot be empty' }],
    ['file', { cancel: true, errorMessage: 'still uploading' }],
  ])
  assert.equal(d.cancel, true)
  assert.equal(d.silent, false, 'a real blocker must not be masked by an empty composer')
  assert.equal(
    d.errorMessage,
    'still uploading',
    'the surviving message must be the LOUD one the user needs to see',
  )
})

test('FAIL-LOUD WINS regardless of order: loud first, silent second → LOUD', () => {
  const d = resolveCancel([
    ['file', { cancel: true, errorMessage: 'still uploading' }],
    ['text', { cancel: true, silent: true }],
  ])
  assert.equal(d.silent, false)
  assert.equal(d.errorMessage, 'still uploading')
})

test('a discarded cancel is ignored entirely', () => {
  const d = resolveCancel(
    [['file', { cancel: true, errorMessage: 'still uploading' }]],
    new Set(['file']),
  )
  assert.equal(d.cancel, false)
})

test('a discarded LOUD cancel does not keep a surviving silent cancel loud', () => {
  const d = resolveCancel(
    [
      ['file', { cancel: true, errorMessage: 'still uploading' }],
      ['text', { cancel: true, silent: true }],
    ],
    new Set(['file']),
  )
  assert.equal(d.cancel, true)
  assert.equal(d.silent, true, 'only SURVIVING vetoes participate in the severity vote')
})

test('a non-cancel result never becomes a cancel', () => {
  const d = resolveCancel([
    ['a', { cancel: false, silent: true, errorMessage: 'ignored' }],
  ])
  assert.equal(d.cancel, false)
})

test('mergeCancelDecision applies the same algebra to a flat list', () => {
  assert.equal(mergeCancelDecision([{ cancel: false }]).cancel, false)
  assert.equal(mergeCancelDecision([{ cancel: true, silent: true }]).silent, true)
  assert.equal(
    mergeCancelDecision([{ cancel: true, silent: true }, { cancel: true }]).silent,
    false,
    'fail-loud wins in the merge path too',
  )
})
