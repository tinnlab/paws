#!/usr/bin/env node
/**
 * boot-probe — fast, focused measurement of the two numbers this feature moves:
 *   1. boot request waterfall (per-request start/end, serial-chain depth)
 *   2. per-endpoint duplicate counts on a cold load of a set of routes
 *
 * It is a thin, deterministic subset of `agent-kit/skills/live-ui-audit`'s
 * network dimension (same "serial dependent chain" definition), so a number here
 * is directly comparable to the audit's — but it runs in seconds, which is what
 * makes an implement→measure loop possible.
 *
 *   node boot-probe.mjs --url=http://127.0.0.1:1547 --routes=/,/settings/general --out=/tmp/x.json
 */
import { chromium } from '@playwright/test'

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}
const BASE = arg('url', 'http://127.0.0.1:1547')
const USER = arg('user', 'admin')
const PASS = arg('password', 'password123')
const ROUTES = arg('routes', '/').split(',')
const SETTLE = Number(arg('settle', '4000'))
const OUT = arg('out', '')
// A single cold load is noisy (a shared backend, a 19-deep N+1 whose requests
// interleave differently run to run). Repeat and report the MEDIAN so a
// before→after comparison means something.
const RUNS = Number(arg('runs', '1'))

// The audit's waterfall detector's exact slack: a request whose start is at/after
// the PREVIOUS (by start order) request's end (−20ms) continues the serial run.
const CHAIN_GAP_MS = 20

const norm = u => {
  try {
    const p = new URL(u).pathname
    return p.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '/{id}')
  } catch {
    return u
  }
}

/** Longest run of CONSECUTIVE (start-ordered) requests where each starts at/after
 *  the previous one ended — byte-identical to the audit's `waterfall` detector. */
function longestSerialChain(reqs) {
  const ordered = [...reqs].sort((a, b) => a.start - b.start)
  let run = 1
  let maxRun = 1
  let runStart = 0
  let bestStart = 0
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start >= ordered[i - 1].end - CHAIN_GAP_MS) {
      run++
      if (run > maxRun) {
        maxRun = run
        bestStart = runStart
      }
    } else {
      run = 1
      runStart = i
    }
  }
  return ordered.slice(bestStart, bestStart + maxRun)
}

const main = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()

  // Authenticate the same way the audit does: seed the persisted auth store.
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })
  if (!res.ok) throw new Error(`login failed ${res.status}`)
  const body = await res.json()
  const token = body.access_token ?? body.token
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            token: t,
            user: u,
            isAuthenticated: true,
            expiresAt: Date.now() + 20 * 3600 * 1000,
          },
          version: 0,
        }),
      )
    },
    [token, body.user],
  )

  const perRoute = []
  for (const route of ROUTES) {
   for (let runIdx = 0; runIdx < RUNS; runIdx++) {
    const reqs = []
    const started = new Map()
    const onReq = r => {
      if (!r.url().includes('/api/')) return
      started.set(r, Date.now())
    }
    const onDone = r => {
      const req = r.request()
      if (!started.has(req)) return
      reqs.push({
        url: norm(req.url()),
        method: req.method(),
        status: r.status?.() ?? 0,
        start: started.get(req),
        end: Date.now(),
      })
    }
    page.on('request', onReq)
    page.on('response', onDone)
    page.on('requestfailed', r => {
      if (!started.has(r)) return
      reqs.push({ url: norm(r.url()), method: r.method(), status: -1, start: started.get(r), end: Date.now() })
    })

    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(SETTLE)
    page.removeAllListeners('request')
    page.removeAllListeners('response')
    page.removeAllListeners('requestfailed')

    const t0 = Math.min(...reqs.map(r => r.start))
    const rel = reqs.map(r => ({ ...r, start: r.start - t0, end: r.end - t0 }))
    const dupes = {}
    for (const r of rel) {
      const k = `${r.method} ${r.url}`
      dupes[k] = (dupes[k] || 0) + 1
    }
    // A streaming/SSE endpoint never "ends" within the window; exclude it from
    // the serial-chain math (the audit does the same — an open stream is not a
    // blocking predecessor).
    const STREAMING = /\/api\/(sync\/subscribe|chat\/stream)/
    const chain = longestSerialChain(rel.filter(r => !STREAMING.test(r.url)))
    // The two endpoints owned by a CONCURRENT branch (the by-conversation N+1
    // batch and the llm-models de-dup) are out of scope here, and the N+1 alone
    // is ~19 inherently-serial requests — it dominates and destabilises the raw
    // waterfall figure. Reporting the chain with those removed isolates what
    // THIS branch actually moved; the raw figure is reported alongside it, never
    // instead of it.
    const OWNED = /\/api\/(projects\/by-conversation|llm-models(?![\w/-]))/
    const scoped = rel.filter(r => !STREAMING.test(r.url) && !OWNED.test(r.url))
    const scopedChain = longestSerialChain(scoped)

    // ── Deterministic boot-ordering metrics ──────────────────────────────────
    // The audit's `waterfall` DEPTH is dominated by the 19-request
    // by-conversation N+1 (owned elsewhere) and is therefore noisy run to run.
    // These two are stable and measure exactly what this branch changed:
    //
    //  bootOverlapMs  — how long `/api/auth/me` and `/api/app/setup/status`
    //                   OVERLAP. ≤0 means they are serialized (the pre-fix
    //                   shape: setup/status → … → auth/me); >0 means they were
    //                   issued in the same burst.
    //  shellBurstMs   — when the shell's first DATA burst
    //                   (notifications / server-update / llm-models downloads)
    //                   starts. Pre-fix this could not begin until `/auth/me`
    //                   resolved, because AuthGuard rendered a full-screen
    //                   spinner while `isInitializing`.
    const at = re => rel.filter(r => re.test(r.url)).sort((a, b) => a.start - b.start)[0]
    const me = at(/\/api\/auth\/me/)
    const setup = at(/\/api\/app\/setup\/status/)
    const shell = rel
      .filter(r => /\/api\/(notifications|server-update\/status)/.test(r.url))
      .sort((a, b) => a.start - b.start)[0]
    const bootOverlapMs =
      me && setup ? Math.min(me.end, setup.end) - Math.max(me.start, setup.start) : null
    const shellBurstMs = shell ? shell.start : null
    perRoute.push({
      route,
      total: rel.length,
      totalExcludingOwned: scoped.length + rel.filter(r => STREAMING.test(r.url)).length,
      duplicates: Object.fromEntries(Object.entries(dupes).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])),
      chainDepth: chain.length,
      chainMs: chain.length ? chain[chain.length - 1].end - chain[0].start : 0,
      chainDepthExcludingOwned: scopedChain.length,
      chainExcludingOwned: scopedChain.map(r => r.url),
      bootOverlapMs,
      shellBurstMs,
      authMeStartMs: me ? me.start : null,
      chain: chain.map(r => r.url),
      requests: rel.sort((a, b) => a.start - b.start).map(r => `${r.start}-${r.end} ${r.method} ${r.url} ${r.status}`),
    })
   }
  }

  await browser.close()

  // Median across runs, per route.
  const median = xs => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
  }
  const routes = [...new Set(perRoute.map(r => r.route))]
  const medians = routes.map(route => {
    const rs = perRoute.filter(r => r.route === route)
    return {
      route,
      runs: rs.length,
      total: median(rs.map(r => r.total)),
      totalExcludingOwned: median(rs.map(r => r.totalExcludingOwned)),
      chainDepth: median(rs.map(r => r.chainDepth)),
      chainDepthExcludingOwned: median(rs.map(r => r.chainDepthExcludingOwned)),
      bootOverlapMs: median(rs.map(r => r.bootOverlapMs ?? 0)),
      shellBurstMs: median(rs.map(r => r.shellBurstMs ?? 0)),
      authMeStartMs: median(rs.map(r => r.authMeStartMs ?? 0)),
      // Union of every duplicate seen, with its median multiplicity.
      duplicates: Object.fromEntries(
        [...new Set(rs.flatMap(r => Object.keys(r.duplicates)))].map(k => [
          k,
          median(rs.map(r => r.duplicates[k] ?? 1)),
        ]),
      ),
    }
  })
  const out = { base: BASE, at: new Date().toISOString(), runs: RUNS, medians, perRoute }
  if (OUT) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(OUT, JSON.stringify(out, null, 2))
  }
  for (const r of medians) {
    console.log(`\n=== ${r.route}  (median of ${r.runs})  total=${r.total}  serial-chain-depth=${r.chainDepth}`)
    console.log(
      `  excluding owned endpoints: total=${r.totalExcludingOwned}  serial-chain-depth=${r.chainDepthExcludingOwned}`,
    )
    console.log(
      `  boot ordering: auth/me starts @${r.authMeStartMs}ms  overlap-with-setup/status=${r.bootOverlapMs}ms  shell-burst @${r.shellBurstMs}ms`,
    )
    console.log('  duplicates:', JSON.stringify(r.duplicates))
  }
  console.log(`\nTOTAL across routes (median): ${medians.reduce((a, r) => a + r.total, 0)}`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
