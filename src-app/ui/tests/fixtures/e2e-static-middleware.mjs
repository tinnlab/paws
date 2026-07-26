/**
 * e2e-static-middleware — graph-agnostic robust static asset delivery for the
 * E2E `vite preview` server (fix #2 of the two-part e2e-render-serving fix).
 *
 * PROBLEM. Under CPU saturation the single-threaded `vite preview` Node event
 * loop cannot flush socket writes promptly, and a STREAMED static response
 * (sirv reads the file off disk and pipes it) can be cut mid-flight, which the
 * browser reports as `net::ERR_INCOMPLETE_CHUNKED_ENCODING`. The chat render
 * pipeline fans out into MANY on-demand chunks — streamdown internals AND ~200
 * hashed shiki per-language grammar chunks — so no enumerated eager-include can
 * cover every render-time fetch.
 *
 * FIX. Serve every built asset from an in-memory map with a SINGLE
 * `res.end(buffer)` + `Content-Length`. The whole response is handed to the OS
 * socket send buffer in ONE event-loop tick, so CPU starvation AFTER that tick
 * cannot cut it (the kernel delivers the buffered bytes independently of the
 * starved Node process). This is graph-agnostic: it makes highlighted-body,
 * shiki grammars, katex, and every other asset un-cuttable.
 *
 * It runs FIRST in the preview middleware stack and answers ONLY GET requests
 * whose pathname exactly matches a built asset; `/`, SPA routes, `/api/*`
 * (proxy), non-GET methods, and unknown paths all `next()` — preserving the
 * existing compression-strip / SSE-timeout-0 / proxy behavior for those.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Content-Type by file extension (covers everything dist-e2e emits). */
const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
}

/**
 * Recursively load every file under `dir` into a Map keyed by URL path
 * (leading-slash, POSIX). e.g. `<dir>/assets/x.js` → `/assets/x.js`.
 * `index.html` is intentionally INCLUDED under `/index.html` but NOT `/` — the
 * bare `/` and SPA deep-links must fall through to vite preview's SPA fallback
 * (which rewrites unknown routes to index.html); serving `/` here would bypass
 * that and is unnecessary since the module loader only fetches hashed assets.
 *
 * @param {string} dir  absolute path to the built dist dir
 * @returns {Map<string, { buf: Buffer, type: string }>}
 */
export function buildAssetMap(dir) {
  const map = new Map()
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name)
      if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile()) {
        const urlPath = '/' + path.relative(dir, abs).split(path.sep).join('/')
        map.set(urlPath, { buf: fs.readFileSync(abs), type: contentTypeFor(abs) })
      }
    }
  }
  walk(dir)
  return map
}

/** Parse the pathname out of a raw request url (strip query + hash). */
export function pathnameOf(rawUrl) {
  if (!rawUrl) return '/'
  const q = rawUrl.indexOf('?')
  const h = rawUrl.indexOf('#')
  let end = rawUrl.length
  if (q !== -1) end = Math.min(end, q)
  if (h !== -1) end = Math.min(end, h)
  return rawUrl.slice(0, end)
}

/**
 * Build a connect-style middleware `(req, res, next)` that answers a matching
 * GET/HEAD from the in-memory map with one `res.end(buffer)`; otherwise `next()`.
 *
 * @param {Map<string, { buf: Buffer, type: string }>} assetMap
 */
export function makeStaticMiddleware(assetMap) {
  return function inMemoryStatic(req, res, next) {
    const method = (req.method || 'GET').toUpperCase()
    if (method !== 'GET' && method !== 'HEAD') return next()
    const asset = assetMap.get(pathnameOf(req.url))
    if (!asset) return next()
    res.statusCode = 200
    res.setHeader('Content-Type', asset.type)
    res.setHeader('Content-Length', asset.buf.length)
    // Hashed assets are immutable; this also stops any revalidation round-trip.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    if (method === 'HEAD') return res.end()
    // ONE write: the whole body goes to the OS socket buffer in this tick, so a
    // subsequently-starved event loop cannot cut the response mid-stream.
    res.end(asset.buf)
  }
}

/**
 * Convenience: build the map from `dir` and return the middleware. Returns a
 * no-op `next()` middleware (never throws) if the dir is missing/empty, so a
 * misconfiguration degrades to the existing sirv behavior rather than breaking
 * the whole preview server.
 *
 * @param {string} dir  absolute path to the built dist dir
 */
export function serveDirFromMemory(dir) {
  let assetMap
  try {
    assetMap = buildAssetMap(dir)
  } catch {
    return (_req, _res, next) => next()
  }
  return makeStaticMiddleware(assetMap)
}
