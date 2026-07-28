#!/usr/bin/env node
// Emit AUDIT_COVERAGE.tsv for the phase-6 blind audit.
//
// The gate requires EVERY hunk of `base...HEAD` to be reviewed by >= 3 distinct
// angles. Hunks are enumerated exactly as `lifecycle-check.mjs` does (same git
// invocation, same excludes, same deletion-only anchoring) so the two can never
// disagree about what "every hunk" means.
//
// Angles are assigned per FILE GROUP from `angles.json`, which records what each
// audit agent actually reviewed. This script only expands that mapping across
// hunks — it does not invent coverage.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '../..')
const BASE = process.argv[2] ?? 'origin/feat/agent-core'

const EXCLUDES = [
  ':(exclude).lifecycle',
  ':(glob,exclude)**/openapi.json',
  ':(glob,exclude)**/api-client/types.ts',
]

const out = execFileSync(
  'git',
  ['-C', REPO, 'diff', `${BASE}...HEAD`, '--unified=0', '--no-color', '--', '.', ...EXCLUDES],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
)

const hunks = []
let file = null
for (const ln of out.split(/\r?\n/)) {
  const fm = /^\+\+\+ b\/(.+)$/.exec(ln)
  if (fm) {
    file = fm[1] === '/dev/null' ? null : fm[1]
    continue
  }
  if (/^--- /.test(ln) || /^diff --git/.test(ln)) continue
  const hm = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(ln)
  if (hm && file) {
    const start = parseInt(hm[1], 10)
    const count = hm[2] === undefined ? 1 : parseInt(hm[2], 10)
    const s = count === 0 ? Math.max(start, 1) : start
    const e = count === 0 ? Math.max(start, 1) : start + count - 1
    hunks.push({ file, start: s, end: e })
  }
}

/** { "<path-prefix or exact path>": ["angle", …] } — longest prefix wins. */
const map = JSON.parse(readFileSync(join(HERE, 'angles.json'), 'utf8'))
const prefixes = Object.keys(map).sort((a, b) => b.length - a.length)

const rows = ['file\tstart\tend\tangles']
const uncovered = []
for (const h of hunks) {
  const key = prefixes.find(p => h.file === p || h.file.startsWith(p))
  if (!key) {
    uncovered.push(h.file)
    continue
  }
  rows.push(`${h.file}\t${h.start}\t${h.end}\t${map[key].join(',')}`)
}

writeFileSync(join(HERE, 'AUDIT_COVERAGE.tsv'), `${rows.join('\n')}\n`)
console.log(`hunks=${hunks.length} rows=${rows.length - 1}`)
if (uncovered.length) {
  console.error(`UNMAPPED FILES (${new Set(uncovered).size}):`)
  for (const f of new Set(uncovered)) console.error(`  ${f}`)
  process.exit(1)
}
