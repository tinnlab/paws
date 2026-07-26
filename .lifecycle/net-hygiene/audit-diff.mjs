#!/usr/bin/env node
/**
 * audit-diff — render the before→after numbers this feature is judged on, from
 * two `live-ui-audit` runs and/or two `boot-probe` runs.
 *
 *   node audit-diff.mjs --audit-before=<dir> --audit-after=<dir>
 *   node audit-diff.mjs --probe-before=<a.json> --probe-after=<b.json>
 *
 * It reports the raw figures AND the same figures with the two endpoints owned
 * by a concurrent branch removed (`/api/projects/by-conversation/{id}`,
 * `/api/llm-models`) — the N+1 alone is ~19 inherently-serial requests, so it
 * dominates and destabilises the raw waterfall depth, and attributing its
 * movement (in either direction) to this branch would be dishonest.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : d
}

const OWNED = /\/api\/(projects\/by-conversation|llm-models(?![\w/-]))/
const STREAMING = /\/api\/(sync\/subscribe|chat\/stream)/
const CHAIN_GAP_MS = 20 // the audit's own slack

// ── live-ui-audit findings ──────────────────────────────────────────────────

function loadFindings(dir) {
  const f = join(dir, 'findings.jsonl')
  if (!existsSync(f)) return null
  return readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
}

const isOwned = detail => OWNED.test(detail)

function summarizeAudit(rows) {
  const net = rows.filter(r => r.category === 'network')
  const bySub = sub => net.filter(r => r.subcategory === sub)
  const depth = d => {
    const m = /waterfall: (\d+) sequential/.exec(d)
    return m ? Number(m[1]) : 0
  }
  const waterfalls = bySub('waterfall')
  const dupes = bySub('duplicate')
  const dupCount = pattern =>
    dupes
      .filter(r => pattern.test(r.detail))
      .map(r => Number(/fired (\d+)×/.exec(r.detail)?.[1] ?? 0))
  return {
    networkFindings: net.length,
    waterfall: waterfalls.length,
    waterfallScoped: waterfalls.filter(r => !isOwned(r.detail)).length,
    maxWaterfallDepth: Math.max(0, ...waterfalls.map(r => depth(r.detail))),
    maxWaterfallDepthScoped: Math.max(
      0,
      ...waterfalls.filter(r => !isOwned(r.detail)).map(r => depth(r.detail)),
    ),
    duplicate: dupes.length,
    duplicateScoped: dupes.filter(r => !isOwned(r.detail)).length,
    conversationsDup: dupCount(/GET \/api\/conversations fired/),
    authMeDup: dupCount(/GET \/api\/auth\/me fired/),
    syncSubscribeDup: dupCount(/GET \/api\/sync\/subscribe fired/),
    nPlus1: bySub('n+1').length,
    nPlus1Scoped: bySub('n+1').filter(r => !isOwned(r.detail)).length,
    failure: bySub('failure').length,
    excess: bySub('excess').length,
    irrelevant: bySub('irrelevant').length,
  }
}

// ── boot-probe runs ─────────────────────────────────────────────────────────

/** Same detector as the audit: longest run of CONSECUTIVE (start-ordered)
 *  requests where each starts at/after the previous one ended. */
function longestRun(reqs) {
  const ordered = [...reqs].sort((a, b) => a.start - b.start)
  let run = 1
  let max = ordered.length ? 1 : 0
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start >= ordered[i - 1].end - CHAIN_GAP_MS) {
      run++
      if (run > max) max = run
    } else run = 1
  }
  return max
}

/** Probe JSONs store `requests` as "<start>-<end> <METHOD> <path> <status>". */
function parseRequests(lines) {
  return lines
    .map(l => {
      const m = /^(\d+)-(\d+) (\w+) (\S+) (\S+)$/.exec(l)
      return m
        ? { start: +m[1], end: +m[2], method: m[3], url: m[4], status: m[5] }
        : null
    })
    .filter(Boolean)
}

function summarizeProbe(file) {
  if (!existsSync(file)) return null
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const out = {}
  for (const r of doc.perRoute) {
    const reqs = parseRequests(r.requests)
    const nonStream = reqs.filter(q => !STREAMING.test(q.url))
    const scoped = nonStream.filter(q => !OWNED.test(q.url))
    const dupes = {}
    for (const q of reqs) dupes[q.url] = (dupes[q.url] || 0) + 1
    out[r.route] = {
      total: reqs.length,
      totalScoped: scoped.length + reqs.filter(q => STREAMING.test(q.url)).length,
      chainDepth: longestRun(nonStream),
      chainDepthScoped: longestRun(scoped),
      duplicates: Object.fromEntries(
        Object.entries(dupes)
          .filter(([, n]) => n > 1)
          .sort((a, b) => b[1] - a[1]),
      ),
    }
  }
  return out
}

// ── report ──────────────────────────────────────────────────────────────────

const pct = (a, b) => (a === 0 ? '—' : `${(((b - a) / a) * 100).toFixed(0)}%`)
const row = (label, a, b) =>
  `| ${label} | ${a} | ${b} | ${typeof a === 'number' ? pct(a, b) : ''} |`

const auditBefore = arg('audit-before')
const auditAfter = arg('audit-after')
if (auditBefore && auditAfter) {
  const A = summarizeAudit(loadFindings(auditBefore) ?? [])
  const B = summarizeAudit(loadFindings(auditAfter) ?? [])
  console.log('\n## live-ui-audit — network dimension\n')
  console.log('| metric | before | after | Δ |')
  console.log('|---|---|---|---|')
  for (const k of Object.keys(A)) {
    const a = A[k]
    const b = B[k]
    if (Array.isArray(a)) {
      console.log(
        `| ${k} | ${a.length ? a.join(',') : 'none'} | ${b.length ? b.join(',') : 'none'} | |`,
      )
    } else console.log(row(k, a, b))
  }
}

const probeBefore = arg('probe-before')
const probeAfter = arg('probe-after')
if (probeBefore && probeAfter) {
  const A = summarizeProbe(probeBefore)
  const B = summarizeProbe(probeAfter)
  console.log('\n## boot-probe — per cold page load\n')
  console.log(
    '| route | total (before→after) | total excl. owned | serial-chain depth | depth excl. owned |',
  )
  console.log('|---|---|---|---|---|')
  for (const route of Object.keys(A)) {
    if (!B[route]) continue
    const a = A[route]
    const b = B[route]
    console.log(
      `| \`${route}\` | ${a.total} → ${b.total} | ${a.totalScoped} → ${b.totalScoped} | ${a.chainDepth} → ${b.chainDepth} | ${a.chainDepthScoped} → ${b.chainDepthScoped} |`,
    )
  }
  console.log('\n### duplicates per route\n')
  for (const route of Object.keys(A)) {
    if (!B[route]) continue
    console.log(`- \`${route}\``)
    console.log(`  - before: ${JSON.stringify(A[route].duplicates)}`)
    console.log(`  - after:  ${JSON.stringify(B[route].duplicates)}`)
  }
}
