/**
 * Unit tests for the in-memory static middleware (fix #2 of e2e-render-serving).
 * Pure Node (fs + fake req/res) — runs under `node --test`, no vite/server.
 *
 * Proves the two robustness-critical properties:
 *  1. A matching asset is answered with ONE res.end(buffer) + Content-Length
 *     (never a streamed/chunked body) — the property that makes a response
 *     un-cuttable under CPU starvation.
 *  2. Non-asset paths (/api, unknown, non-GET) fall through via next(), so the
 *     /api proxy + SPA routing behavior is preserved.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildAssetMap,
  makeStaticMiddleware,
  contentTypeFor,
  pathnameOf,
  serveDirFromMemory,
} from './e2e-static-middleware.mjs'

function makeDist() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-static-'))
  mkdirSync(join(dir, 'assets'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'app-abc.js'), 'console.log(1)')
  writeFileSync(join(dir, 'assets', 'style-def.css'), 'body{}')
  writeFileSync(join(dir, 'assets', 'font.woff2'), Buffer.from([1, 2, 3, 4]))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html></html>')
  return dir
}

/** Minimal fake response capturing headers + the single body write. */
function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    ended: false,
    endCount: 0,
    body: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v
    },
    end(buf) {
      this.endCount++
      this.ended = true
      this.body = buf
    },
  }
}

test('contentTypeFor maps extensions', () => {
  assert.match(contentTypeFor('x.js'), /text\/javascript/)
  assert.match(contentTypeFor('x.mjs'), /text\/javascript/)
  assert.match(contentTypeFor('x.css'), /text\/css/)
  assert.match(contentTypeFor('x.html'), /text\/html/)
  assert.match(contentTypeFor('x.json'), /application\/json/)
  assert.equal(contentTypeFor('x.woff2'), 'font/woff2')
  assert.equal(contentTypeFor('x.wasm'), 'application/wasm')
  assert.equal(contentTypeFor('x.unknownext'), 'application/octet-stream')
})

test('pathnameOf strips query + hash', () => {
  assert.equal(pathnameOf('/assets/a.js'), '/assets/a.js')
  assert.equal(pathnameOf('/assets/a.js?v=1'), '/assets/a.js')
  assert.equal(pathnameOf('/assets/a.js#frag'), '/assets/a.js')
  assert.equal(pathnameOf('/assets/a.js?v=1#frag'), '/assets/a.js')
  assert.equal(pathnameOf(undefined), '/')
})

test('buildAssetMap maps every file to leading-slash POSIX url with type + bytes', () => {
  const dir = makeDist()
  try {
    const map = buildAssetMap(dir)
    assert.ok(map.has('/assets/app-abc.js'))
    assert.ok(map.has('/assets/style-def.css'))
    assert.ok(map.has('/assets/font.woff2'))
    assert.ok(map.has('/index.html'))
    // `/` is NOT served (must fall through to SPA fallback).
    assert.equal(map.has('/'), false)
    const js = map.get('/assets/app-abc.js')
    assert.match(js.type, /text\/javascript/)
    assert.equal(js.buf.toString(), 'console.log(1)')
    assert.deepEqual([...map.get('/assets/font.woff2').buf], [1, 2, 3, 4])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('middleware answers a matching GET with ONE res.end(buffer) + Content-Length', () => {
  const dir = makeDist()
  try {
    const mw = makeStaticMiddleware(buildAssetMap(dir))
    const res = fakeRes()
    let nexted = false
    mw({ method: 'GET', url: '/assets/app-abc.js?v=1' }, res, () => (nexted = true))
    assert.equal(nexted, false, 'must not fall through for a known asset')
    assert.equal(res.statusCode, 200)
    assert.equal(res.endCount, 1, 'exactly one write (un-cuttable)')
    assert.equal(res.body.toString(), 'console.log(1)')
    assert.equal(res.headers['content-length'], Buffer.byteLength('console.log(1)'))
    assert.match(String(res.headers['content-type']), /text\/javascript/)
    assert.match(String(res.headers['cache-control']), /immutable/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('middleware HEAD sets headers but writes no body', () => {
  const dir = makeDist()
  try {
    const mw = makeStaticMiddleware(buildAssetMap(dir))
    const res = fakeRes()
    mw({ method: 'HEAD', url: '/assets/style-def.css' }, res, () => {})
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['content-length'], Buffer.byteLength('body{}'))
    assert.equal(res.endCount, 1)
    assert.equal(res.body, undefined, 'HEAD sends no body')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('middleware falls through for /api, unknown paths, and non-GET', () => {
  const dir = makeDist()
  try {
    const mw = makeStaticMiddleware(buildAssetMap(dir))
    for (const req of [
      { method: 'GET', url: '/api/sync/subscribe' }, // proxy
      { method: 'GET', url: '/chat/some-conversation' }, // SPA route
      { method: 'GET', url: '/assets/does-not-exist.js' }, // unknown asset
      { method: 'POST', url: '/assets/app-abc.js' }, // non-GET
    ]) {
      const res = fakeRes()
      let nexted = false
      mw(req, res, () => (nexted = true))
      assert.equal(nexted, true, `must fall through for ${req.method} ${req.url}`)
      assert.equal(res.ended, false, `must not respond for ${req.method} ${req.url}`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('serveDirFromMemory degrades to a no-op next() for a missing dir', () => {
  const mw = serveDirFromMemory(join(tmpdir(), 'definitely-not-here-' + Date.now()))
  const res = fakeRes()
  let nexted = false
  mw({ method: 'GET', url: '/assets/x.js' }, res, () => (nexted = true))
  assert.equal(nexted, true)
  assert.equal(res.ended, false)
})
