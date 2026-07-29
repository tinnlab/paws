#!/usr/bin/env node
/**
 * MUTATION HARNESS for `JsToolApprovalContent.test.tsx`.
 *
 * A test that "passes" proves nothing about the defects it is supposed to
 * catch — the entire lesson of this branch's nineteen non-converging fix rounds.
 * This script applies each historical defect verbatim to the shipped component,
 * runs (a) `tsc --noEmit` and (b) the component harness, and reports whether the
 * mutation is caught, by which layer, and by which test — then reverts.
 *
 *   node scripts/mutate-approval-card.mjs            # all mutations
 *   node scripts/mutate-approval-card.mjs FR19-10-a  # one, by id
 *
 * Exit 0 iff EVERY defect mutation is caught (RED) and every refactor mutation
 * is tolerated (GREEN).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const UI = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMPONENT = resolve(
  UI,
  'src/modules/js-tool/chat-extension/components/JsToolApprovalContent.tsx',
)
const SPEC = 'src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx'

/**
 * `kind: 'defect'` must be caught (tsc error OR a failing test).
 * `kind: 'refactor'` must be tolerated — behaviour-preserving edits must not
 * make the harness red, or it is pinning shape again.
 */
const MUTATIONS = [
  // ── FR19-10: the send's ARGUMENTS ────────────────────────────────────────
  {
    id: 'FR19-10-a',
    kind: 'defect',
    why: "the POST lands under an id no elicitation has (FR19-10's own second sentence)",
    from: 'await resolveElicitationVia(data.elicitation_id, action)',
    to: 'await resolveElicitationVia(statusId, action)',
  },
  {
    id: 'FR19-10-b',
    kind: 'defect',
    why: 'the user clicks Approve on a resolve-failed card and a DECLINE is POSTed (FR20-6)',
    from: 'await resolveElicitationVia(data.elicitation_id, action)',
    to: "await resolveElicitationVia(data.elicitation_id, blocked === 'resolve-failed' ? 'decline' : action)",
  },
  {
    id: 'FR19-10-c',
    kind: 'defect',
    why: 'the mirror image — Deny on a resolve-failed card silently APPROVES the tool call',
    from: 'await resolveElicitationVia(data.elicitation_id, action)',
    to: "await resolveElicitationVia(data.elicitation_id, blocked === 'resolve-failed' ? 'accept' : action)",
  },
  {
    id: 'FR19-10-d',
    kind: 'defect',
    why: 'a substitution keyed on the state a browser cannot hold still: no local entry',
    from: 'await resolveElicitationVia(data.elicitation_id, action)',
    to: "await resolveElicitationVia(data.elicitation_id, elicitationExists(data.elicitation_id) ? action : 'decline')",
  },
  {
    id: 'FR19-10-f',
    kind: 'defect',
    why: 'a substitution keyed on the SPENT HEAL BUDGET — the local the not-open row alone does not make true',
    from: 'await resolveElicitationVia(data.elicitation_id, action)',
    to: "await resolveElicitationVia(data.elicitation_id, healExhausted ? 'decline' : action)",
  },
  {
    id: 'FR19-10-e',
    kind: 'defect',
    why: "round 19's verbatim mutation — Approve CANCELS. Kept to record WHICH layer stops it now.",
    from: 'await resolveElicitationVia(data.elicitation_id, action)',
    to: "await resolveElicitationVia(data.elicitation_id, blocked === 'not-registered' ? 'cancel' : action)",
  },

  // ── FR19-12: the self-heal ───────────────────────────────────────────────
  {
    id: 'FR19-12-a',
    kind: 'defect',
    why: 'the self-heal call is deleted with its two now-unused imports (tsc-clean; 10 pass/0 fail under the source guards)',
    edits: [
      ['    registerElicitation(runJsElicitationInit(data))\n', ''],
      ['  registerElicitation,\n', ''],
      ["import { runJsElicitationInit, type RunJsApprovalIdentity } from '../elicitationInit'",
        "import type { RunJsApprovalIdentity } from '../elicitationInit'"],
    ],
  },
  {
    id: 'FR19-12-b',
    kind: 'defect',
    why: 'the heal budget is spent before the first attempt (`spent >= HEAL_BUDGET` -> `>= 0`)',
    from: 'if (spent >= HEAL_BUDGET) return',
    to: 'if (spent >= 0) return',
  },
  {
    id: 'FR19-12-c',
    kind: 'defect',
    why: 'seamVersion dropped from the effect deps — the FIX_ROUND-8 fix itself, so a failed register is never retried',
    from: '}, [hasTransport, resolved, data, seamVersion])',
    to: '}, [hasTransport, resolved, data])',
  },
  {
    id: 'FR19-12-d',
    kind: 'defect',
    why: 'the already-resolved guard is dropped — an answered, single-use elicitation is re-registered',
    from: 'if (!hasTransport || resolved !== null) return',
    to: 'if (!hasTransport) return',
  },
  {
    id: 'FR19-12-e',
    kind: 'defect',
    why: 'the entry-exists guard is dropped — a conforming provider is re-registered on every seam bump',
    from: '    if (elicitationExists(data.elicitation_id)) return\n',
    to: '',
  },

  // ── the properties the deleted source guards covered ─────────────────────
  {
    id: 'DISABLE-a',
    kind: 'defect',
    why: 'a recoverable state is disabled — the card becomes unanswerable (FIX_ROUND-4/-6/-7)',
    from: 'disabled={elicitationIsUnactionable(blocked)}',
    to: 'disabled={elicitationIsUnactionable(blocked) || blocked !== null}',
    all: true,
  },
  {
    id: 'DISABLE-b',
    kind: 'defect',
    why: 'the click handler latches while the control still renders ENABLED (FIX_ROUND-14)',
    from: 'if (submitting || resolved !== null || elicitationIsUnactionable(blocked)) return',
    to: 'if (submitting || resolved !== null || elicitationIsUnactionable(blocked) || resolveFailed) return',
  },
  {
    id: 'DISABLE-c',
    kind: 'defect',
    why: 'the seam gate is inverted — every actionable decision returns early and nothing ever POSTs',
    from: 'if (submitting || resolved !== null || elicitationIsUnactionable(blocked)) return',
    to: 'if (submitting || resolved !== null || !elicitationIsUnactionable(blocked)) return',
  },
  {
    id: 'RENDER-a',
    kind: 'defect',
    why: 'the controls un-render in resolve-failed — a recoverable state loses its affordance entirely',
    from: '{resolved === null && (',
    to: '{resolved === null && blocked === null && (',
  },
  {
    id: 'INERT-a',
    kind: 'defect',
    why: 'the controls are hidden by a conditional class (FIX_ROUND-17 / FR19-11, class channel)',
    from: '<div className="mt-3">',
    to: "<div className={blocked !== null ? 'mt-3 hidden' : 'mt-3'}>",
  },
  {
    id: 'INERT-b',
    kind: 'defect',
    why: 'the controls are inerted by the `hidden` ATTRIBUTE (FR19-11, round-17 mutation F respelled)',
    from: '<div className="mt-3">',
    to: '<div className="mt-3" hidden={blocked !== null}>',
  },
  {
    id: 'ACTION-a',
    kind: 'defect',
    why: 'the two controls are swapped — the button that READS "Deny" approves the tool call',
    edits: [
      ["onClick={() => resolve('accept')}", "onClick={() => resolve('__TMP__')}"],
      ["onClick={() => resolve('decline')}", "onClick={() => resolve('accept')}"],
      ["onClick={() => resolve('__TMP__')}", "onClick={() => resolve('decline')}"],
    ],
  },
  {
    id: 'REENTRANCY-a',
    kind: 'defect',
    why: 'the in-flight flag is never raised — a double click POSTs twice to a single-use elicitation',
    from: '    setSubmitting(true)\n',
    to: '',
  },
  {
    id: 'A11Y-a',
    kind: 'defect',
    why: 'a string tooltip becomes the accessible name, so both controls announce identically (FIX_ROUND-5, WCAG 2.5.3)',
    from: 'disabled={elicitationIsUnactionable(blocked)}',
    to: "disabled={elicitationIsUnactionable(blocked)}\n                    tooltip=\"The approval channel is unavailable right now\"",
    all: true,
  },
  {
    id: 'NOTICE-a',
    kind: 'defect',
    why: 'the notice is fed constants — the copy blanks, the probe token freezes, the DISABLED control loses its only explanation (FR20-5 / FR19-14)',
    from: `  const notice = elicitationNotice({
    resolved,
    blocked,
    entryOpen: elicitationExists(data.elicitation_id),
    healExhausted,
  })`,
    to: `  const notice = elicitationNotice({
    resolved,
    blocked: null,
    entryOpen: true,
    healExhausted,
  })`,
  },
  {
    id: 'NOTICE-b',
    kind: 'defect',
    why: 'the notice reads the WRONG id (FR19-13) — every card is pinned at not-registered for life',
    from: 'entryOpen: elicitationExists(data.elicitation_id),',
    to: 'entryOpen: elicitationExists(statusId),',
  },
  {
    id: 'NOTICE-c',
    kind: 'defect',
    why: 'the status region is render-gated away — the disabling state gets two dead buttons, no explanation, and a dangling aria-describedby (FR20-9)',
    edits: [
      ['            <Text\n              ref={statusRef}', "            {blocked !== 'no-transport' && (\n            <Text\n              ref={statusRef}"],
      ['              {notice.text}\n            </Text>', '              {notice.text}\n            </Text>\n            )}'],
    ],
  },
  {
    id: 'JUDGE-a',
    kind: 'defect',
    why: 'the failure judgement is inverted into the ELSE branch — every SUCCESSFUL approve is marked failed',
    from: 'if (resolveDidFail({ carried, hadEntry, after })) setResolveFailed(true)',
    to: 'if (!resolveDidFail({ carried, hadEntry, after })) setResolveFailed(true)',
  },
  {
    id: 'FOCUS-a',
    kind: 'defect',
    why: 'wasResolved seeded from null — merely scrolling an ANSWERED card back into view yanks focus (FIX_ROUND-5)',
    from: "const wasResolved = useRef<'approved' | 'denied' | null>(resolved)",
    to: "const wasResolved = useRef<'approved' | 'denied' | null>(null)",
  },

  // ── refactors: behaviour-preserving, must stay GREEN ──────────────────────
  {
    id: 'REFACTOR-rename-handler',
    kind: 'refactor',
    why: 'renaming the handler changes nothing a user can observe',
    edits: [
      ['const resolve = async (action:', 'const answer = async (action:'],
      ["onClick={() => resolve('accept')}", "onClick={() => answer('accept')}"],
      ["onClick={() => resolve('decline')}", "onClick={() => answer('decline')}"],
    ],
  },
  {
    id: 'REFACTOR-hoist-gate',
    kind: 'refactor',
    why: 'hoisting the seam predicate into a const removes a duplicated call and changes nothing',
    edits: [
      ['  const blocked = elicitationBlockedReason({ hasTransport, resolveFailed })',
        '  const blocked = elicitationBlockedReason({ hasTransport, resolveFailed })\n  const unactionable = elicitationIsUnactionable(blocked)'],
      ['if (submitting || resolved !== null || elicitationIsUnactionable(blocked)) return',
        'if (submitting || resolved !== null || unactionable) return'],
      ['disabled={elicitationIsUnactionable(blocked)}', 'disabled={unactionable}'],
    ],
    all: true,
  },
  {
    id: 'REFACTOR-void-wrapper',
    kind: 'refactor',
    why: 'the `void` wrapper this repo writes in 18 places must not read as a defect',
    edits: [
      ["onClick={() => resolve('accept')}", "onClick={() => void resolve('accept')}"],
      ["onClick={() => resolve('decline')}", "onClick={() => void resolve('decline')}"],
    ],
  },
]

function apply(src, m) {
  let out = src
  const edits = m.edits ?? [[m.from, m.to]]
  for (const [from, to] of edits) {
    if (!out.includes(from)) throw new Error(`${m.id}: anchor not found: ${JSON.stringify(from.slice(0, 70))}`)
    if (m.all) out = out.split(from).join(to)
    else {
      const n = out.split(from).length - 1
      if (n !== 1) throw new Error(`${m.id}: anchor is not unique (${n} matches): ${JSON.stringify(from.slice(0, 70))}`)
      out = out.replace(from, to)
    }
  }
  if (out === src) throw new Error(`${m.id}: no-op mutation`)
  return out
}

function run(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, { cwd: UI, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out: stdout }
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

const only = process.argv.slice(2).filter(a => !a.startsWith('-'))
const selected = only.length ? MUTATIONS.filter(m => only.includes(m.id)) : MUTATIONS

const PRISTINE = readFileSync(COMPONENT, 'utf8')
const rows = []
let bad = 0

// The unmutated baseline, so a green run is not confused with a vacuous one.
{
  const t = run('npx', ['vitest', 'run', SPEC])
  const m = t.out.match(/Tests\s+(\d+) passed \((\d+)\)/)
  console.log(`BASELINE  spec=${t.code === 0 ? 'GREEN' : 'RED'}  ${m ? `${m[1]}/${m[2]} passed` : t.out.slice(-300)}`)
  if (t.code !== 0) {
    console.error('the unmutated harness is not green; refusing to measure mutations')
    process.exit(2)
  }
}

for (const m of selected) {
  writeFileSync(COMPONENT, apply(PRISTINE, m))
  try {
    const tsc = run('npx', ['tsc', '--noEmit'])
    const spec = run('npx', ['vitest', 'run', SPEC])
    const failed = [
      ...new Set(
        [...spec.out.matchAll(/^\s*FAIL\s+\S+\s+>\s+(.+)$/gm)].map(x =>
          x[1].replace(/\s+/g, ' ').trim(),
        ),
      ),
    ]
    const counts = spec.out.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/)
    const caught = tsc.code !== 0 || spec.code !== 0
    const ok = m.kind === 'defect' ? caught : !caught
    if (!ok) bad++
    rows.push({
      id: m.id,
      kind: m.kind,
      why: m.why,
      tsc: tsc.code === 0 ? 'clean' : 'ERROR',
      tscFirst: tsc.code === 0 ? '' : (tsc.out.split('\n').find(l => /error TS/.test(l)) ?? '').trim(),
      spec: spec.code === 0 ? 'GREEN' : 'RED',
      counts: counts ? `${counts[1] ?? 0} failed / ${counts[2]} passed of ${counts[3]}` : '',
      failed: failed.slice(0, 4),
      verdict: ok ? 'OK' : m.kind === 'defect' ? 'ESCAPED' : 'FALSE-RED',
    })
    const head = `${ok ? 'OK      ' : '!! ' + rows[rows.length - 1].verdict.padEnd(5)} ${m.id.padEnd(24)} tsc=${rows[rows.length - 1].tsc.padEnd(5)} spec=${rows[rows.length - 1].spec.padEnd(5)} ${rows[rows.length - 1].counts}`
    console.log(head)
    if (rows[rows.length - 1].tscFirst) console.log(`             tsc: ${rows[rows.length - 1].tscFirst}`)
    for (const f of failed.slice(0, 4)) console.log(`             RED: ${f}`)
  } finally {
    writeFileSync(COMPONENT, PRISTINE)
  }
}

writeFileSync(
  resolve(UI, 'mutation-report.json'),
  `${JSON.stringify({ generatedFrom: SPEC, rows }, null, 2)}\n`,
)
console.log(`\n${rows.length} mutations; ${bad} not behaving as required.`)
process.exit(bad === 0 ? 0 : 1)
