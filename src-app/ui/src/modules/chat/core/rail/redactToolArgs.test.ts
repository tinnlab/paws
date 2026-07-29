import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REDACTED, isSecretKey, redactValue, redactedJson } from './redactToolArgs.ts'

// ITEM-17 / DEC-1 — the SURFACE-side mirror of the backend recorder's denylist.
// The chat card renders `tool_use.input` completely unredacted today, so a secret
// the model passed to a tool prints verbatim into the transcript and stays there.
// TEST-22 pins the backend list; this pins the client one. They must agree.

test('the five gaps this feature closes are redacted', () => {
  // Every one of these was CONFIRMED open before this change.
  for (const k of ['cookie', 'credentials', 'x_auth_token', 'openai_api_key', 'Bearer-Token']) {
    assert.equal(isSecretKey(k), true, `${k} must be a secret key`)
  }
})

test('the pre-existing keys stay redacted', () => {
  for (const k of [
    'authorization', 'auth', 'bearer', 'password', 'passwd', 'secret', 'token',
    'access_token', 'refresh_token', 'api_key', 'apikey', 'api-key', 'x-api-key',
    'client_secret', 'private_key',
  ]) {
    assert.equal(isSecretKey(k), true, `${k} must stay a secret key`)
  }
})

test('matching is case-insensitive', () => {
  assert.equal(isSecretKey('AUTHORIZATION'), true)
  assert.equal(isSecretKey('Api_Key'), true)
  assert.equal(isSecretKey('X-Api-Key'), true)
})

test('matching is EXACT, so user-meaningful arguments stay reachable (INV-2)', () => {
  // A substring rule would redact these, which are legitimate arguments a user
  // needs to see. INV-2 says every user-meaningful detail must remain reachable;
  // only credentials are deliberately removed from the default surface.
  for (const k of ['token_count', 'password_policy', 'api_key_name', 'auth_provider', 'secret_santa']) {
    assert.equal(isSecretKey(k), false, `${k} must NOT be treated as a secret`)
  }
})

test('redactValue replaces secret values and preserves everything else', () => {
  const out = redactValue({
    url: 'https://example.com',
    Authorization: 'Bearer sk-live-123',
    count: 3,
    keep: null,
  }) as Record<string, unknown>
  assert.equal(out.url, 'https://example.com')
  assert.equal(out.Authorization, REDACTED)
  assert.equal(out.count, 3)
  assert.equal(out.keep, null)
})

test('redactValue walks nested objects AND arrays', () => {
  const out = redactValue({
    headers: [{ cookie: 'session=abc' }, { 'x-api-key': 'k' }],
    nested: { deep: { token: 't', fine: 'ok' } },
  }) as any
  assert.equal(out.headers[0].cookie, REDACTED)
  assert.equal(out.headers[1]['x-api-key'], REDACTED)
  assert.equal(out.nested.deep.token, REDACTED)
  assert.equal(out.nested.deep.fine, 'ok')
})

test('redactValue does not mutate its input', () => {
  const input = { token: 'secret' }
  redactValue(input)
  assert.equal(input.token, 'secret', 'the store’s block must never be mutated during render')
})

test('a pathological/cyclic structure is depth-bounded rather than blowing the stack', () => {
  const cyclic: Record<string, unknown> = { token: 't' }
  cyclic.self = cyclic
  assert.doesNotThrow(() => redactValue(cyclic))
})

test('redactedJson emits pretty, redacted JSON and never throws on an unserializable value', () => {
  assert.equal(redactedJson({ token: 't', a: 1 }), '{\n  "token": "[redacted]",\n  "a": 1\n}')
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.doesNotThrow(() => redactedJson(cyclic))
})
