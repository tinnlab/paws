/**
 * COMPONENT HARNESS for the `run_js` inner-approval card.
 *
 * ## Why this file exists
 *
 * `FIX_ROUND-18.md` §8 named it, `FIX_ROUND-19.md` §6 ABORTED the fix loop until
 * it existed, and `LEDGER.jsonl` records two HIGH `accepted-open` findings whose
 * own prescribed fix is "closed BY CONSTRUCTION by the component harness":
 *
 *  - **FR19-10** — *"the send's ARGUMENTS are unguarded … `resolveElicitationVia(
 *    data.elicitation_id, blocked === 'not-registered' ? 'cancel' : action)` is
 *    tsc-clean, GREEN under the guards, and invisible to the matrix."*
 *    Prescription: *"construct not-registered, click Approve, assert the POST
 *    carries 'accept' under the right id."* → §1 below.
 *  - **FR19-12** — *"the SELF-HEAL has no guard at all — `registerElicitation`
 *    appears 0 times in the guard file. Deleting the call plus its two now-unused
 *    imports is tsc-clean and leaves the guards 10 pass/0 fail."* Prescription:
 *    *"construct not-registered, assert the entry heals and the outcome
 *    renders."* → §2 below.
 *
 * Nineteen rounds of hand-written SOURCE-SCANNING predicates in
 * `chat/components/rail/railIsolation.test.ts` never converged, because each
 * round closed the spellings the last audit found and the next audit found more:
 * the space of *spellings* is unbounded. This file asserts nothing about source
 * text. It MOUNTS the shipped component against a scripted transport and reads
 * the DOM and the recorded POSTs, so a defect is caught by its EFFECT — a
 * bounded space — no matter how it is spelled.
 *
 * ## The three properties that make it work
 *
 * 1. **It constructs the unreachable states.** `no-transport` needs mcp's
 *    transport absent mid-conversation and the not-open state self-heals in
 *    milliseconds, so no Playwright spec can hold either still. A scripted
 *    provider holds both still indefinitely. That unreachability is *why* every
 *    historical defect had a spelling keyed on an unreachable value.
 * 2. **It asserts the POST's ARGUMENTS, in every state.** §1 pins `(id, action)`
 *    for both controls across every answerable state, and the state table has a
 *    row in which each local visible at the send site (`blocked`,
 *    `healExhausted`, the entry's existence) is TRUE. So any
 *    `<cond> ? 'decline' : action` is red in the row that makes `<cond>` true,
 *    and any id but this card's is red everywhere. That is why this closes
 *    FR19-10 by CONSTRUCTION rather than by one more predicate: the enumeration
 *    is over STATES, which are finite, not over spellings, which are not.
 * 3. **It asserts REACHABILITY by clicking.** A control that renders but cannot
 *    be answered — the failure mode rounds 4, 6, 7, 16 and 17 each re-shipped —
 *    fails here because the assertion is "the click produced this POST", not
 *    "the attribute has this value".
 *
 * ## What this harness cannot see (stated, not papered over)
 *
 * jsdom does no layout and applies no stylesheet, so CSS INERTING via a Tailwind
 * class (`pointer-events-none`) is invisible to a dispatched click. That half of
 * FR19-11 belonged to Playwright's actionability check in
 * `tests/e2e/chat/run-js-inner-approval.spec.ts`. **That spec was DELETED by the
 * paws feature-surface reduction** — js-tool is hidden, and its chat extension is
 * the sole registrant of every testid the spec waited on, so it could no longer
 * run. The CSS-inerting channel is therefore UNCOVERED today; restoring js-tool
 * means restoring that spec from git history alongside it.
 * `assertReachable()` below covers the DOM-attribute
 * channels (`hidden` / `inert` / `aria-hidden` / `tabindex` / `disabled`) and the
 * inerting class tokens on the control and every ancestor inside the card — a
 * bounded DOM check, deliberately NOT claimed as construction-level closure.
 *
 * ## Runner
 *
 * Vitest + jsdom. `npm run test:unit` is `node --test "src/**\/*.test.ts"`, and
 * the node runner cannot load `.tsx` at all — so a component spec is invisible
 * to it. `vitest.config.ts` gained `src/**\/*.test.tsx`; the two globs are
 * disjoint by extension so nothing double-runs. Mounting uses React's own
 * `createRoot` + `act`; no `@testing-library/*` dependency was added.
 *
 *   npx vitest run src/modules/js-tool/chat-extension/components/JsToolApprovalContent.test.tsx
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { MessageContent } from '@/api-client/types'
import {
  __resetElicitationTransportForTests,
  setElicitationTransport,
  type ElicitationAction,
  type ElicitationRequestInit,
  type ElicitationStatus,
  type ElicitationTransport,
} from '@/modules/chat/core/elicitation/transport'
import { runJsElicitationInit } from '../elicitationInit'
import { JsToolApprovalContent } from './JsToolApprovalContent'

// React 19 wants this set before `act` is used outside a framework adapter.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The component's own self-heal bound, mirrored so the budget test names it. */
const HEAL_BUDGET = 3

// ── the scripted provider ───────────────────────────────────────────────────
//
// One class covers every state the card can be in, because the card derives
// EVERYTHING from this seam:
//
//   no-transport       — install nothing at all
//   pending (healthy)  — conforming provider with the entry already open
//   not open locally   — `opensOnRegister = false`, so `has()` stays false for
//                        as long as the test wants: the state that self-heals in
//                        milliseconds in a browser is held still indefinitely
//   resolve-failed     — `resolveOutcome = 'throw'`, so `carried` is false and
//                        `resolveDidFail` reports a genuine failure

/**
 * One recorded `/respond` POST.
 *
 * `action` is deliberately the WIDE `ElicitationAction`: the harness must be able
 * to OBSERVE a `'cancel'` if one is ever sent, not fail to compile against it.
 * (`resolveElicitationVia`'s parameter is the narrower `ElicitationDecision`; the
 * provider port's is not.)
 */
interface RecordedPost {
  id: string
  action: ElicitationAction
  content?: Record<string, unknown>
}

class Fixture implements ElicitationTransport {
  /** Every `resolve()` the card made, in order, with its verbatim arguments. */
  readonly posts: RecordedPost[] = []
  /** Every `register()` the card made, in order, with its verbatim payload. */
  readonly registers: ElicitationRequestInit[] = []

  private readonly entries = new Map<string, ElicitationStatus>()
  private readonly listeners = new Set<() => void>()
  private hangRelease: (() => void) | null = null

  /**
   * Ids whose entry `has()` denies while `status()` still answers. Models the
   * only situation that isolates the effect's `resolved !== null` guard: an
   * already-answered card the provider holds no OPEN entry for.
   */
  readonly hiddenFromHas = new Set<string>()

  /**
   * Does `register()` actually open the entry? `false` models a provider that
   * violates the register→`has()` contract, and is how the not-open state is
   * held still.
   */
  opensOnRegister = true
  /** What a resolve does. `'hang'` never settles, for the in-flight assertions. */
  resolveOutcome: 'settle' | 'throw' | 'rollback' | 'hang' = 'settle'

  has(id: string): boolean {
    return !this.hiddenFromHas.has(id) && this.entries.has(id)
  }

  status(id: string): ElicitationStatus | undefined {
    return this.entries.get(id)
  }

  register(init: ElicitationRequestInit): void {
    this.registers.push(init)
    if (!this.opensOnRegister) return
    this.entries.set(init.elicitation_id, 'pending')
    this.notify()
  }

  async resolve(
    id: string,
    action: ElicitationAction,
    content?: Record<string, unknown>,
  ): Promise<void> {
    this.posts.push({ id, action, content })
    if (this.resolveOutcome === 'hang') {
      await new Promise<void>(res => {
        this.hangRelease = res
      })
      return
    }
    if (this.resolveOutcome === 'throw') throw new Error('POST rejected')
    if (this.resolveOutcome === 'rollback') {
      if (this.entries.has(id)) this.entries.set(id, 'pending')
      this.notify()
      return
    }
    if (this.entries.has(id)) {
      this.entries.set(id, action === 'accept' ? 'accepted' : 'declined')
    }
    this.notify()
  }

  subscribe(onChange: () => void): () => void {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  // ── test-side controls ────────────────────────────────────────────────────

  /** Bump the seam without touching any entry (a "seam change"). */
  notify(): void {
    for (const l of [...this.listeners]) l()
  }

  /** Open an entry directly, as mcp's SSE handler would have. */
  seed(id: string, status: ElicitationStatus = 'pending'): this {
    this.entries.set(id, status)
    return this
  }

  /** Let a hung resolve settle. */
  release(): void {
    this.hangRelease?.()
    this.hangRelease = null
  }
}

/** Install a fixture as THE transport (what mcp's `initialize` does). */
function install(f: Fixture): Fixture {
  setElicitationTransport(f, 'test')
  return f
}

/** A conforming provider whose entry is already open — the healthy card. */
function healthy(id: string): Fixture {
  return install(new Fixture().seed(id))
}

/** A provider that never opens the entry — the not-open state, held still. */
function neverRegisters(): Fixture {
  const f = new Fixture()
  f.opensOnRegister = false
  return install(f)
}

// ── mounting ────────────────────────────────────────────────────────────────

interface CardData {
  elicitation_id: string
  tool_name: string
  server: string
  input?: Record<string, unknown>
}

/**
 * A stable `MessageContent` prop. Identity matters: `data` is one of the
 * self-heal effect's deps, so a fresh object per render would re-run the effect
 * and §2's budget assertions would be measuring the harness, not the card.
 */
function block(data: CardData): MessageContent {
  return {
    content: data as unknown as MessageContent['content'],
    content_type: 'run_js_approval',
    created_at: '2026-01-01T00:00:00Z',
    id: `block-${data.elicitation_id}`,
    message_id: 'msg-1',
    sequence_order: 0,
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function card(id: string, input?: Record<string, unknown>): CardData {
  return { elicitation_id: id, tool_name: 'search', server: 'files', input }
}

interface Mounted {
  host: HTMLElement
  unmount(): Promise<void>
}

const live: Mounted[] = []

async function mount(data: CardData): Promise<Mounted> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  // ONE element instance, reused: props identity is preserved across re-renders.
  const element = <JsToolApprovalContent content={block(data)} isUser={false} />
  let alive = true
  const m: Mounted = {
    host,
    unmount: async () => {
      if (!alive) return
      alive = false
      await act(async () => {
        root.unmount()
      })
      host.remove()
    },
  }
  await act(async () => {
    root.render(element)
  })
  live.push(m)
  return m
}

// ── DOM readers (no source text is read anywhere in this file) ──────────────

/**
 * The accessible name of a control, the way a screen reader computes it here: an
 * explicit `aria-label` wins, else the visible text (the kit's icon span is
 * `aria-hidden`, so it contributes nothing).
 */
function accessibleName(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function buttons(host: HTMLElement): HTMLButtonElement[] {
  return [...host.querySelectorAll('button')]
}

/**
 * The control a USER would click for `kind`, found by its accessible NAME —
 * never by `data-testid`, which is invisible to the user and can be moved
 * independently of the label.
 */
function control(host: HTMLElement, kind: 'approve' | 'deny'): HTMLButtonElement {
  const re = kind === 'approve' ? /^approve$/i : /^deny$/i
  const found = buttons(host).filter(b => re.test(accessibleName(b)))
  expect(found.length, `exactly one control must read as "${kind}"`).toBe(1)
  return found[0]
}

/**
 * The card's ONE `role=status` live region. Uniqueness is asserted on every
 * read, so a decoy region cannot silently take over the assertions below.
 */
function statusRegion(host: HTMLElement): HTMLElement {
  // The kit's Alert wrapper is itself `role="status"` for its non-error tones
  // (and `role="alert"` for warning/error), so the card's own live region is the
  // `role="status"` element that is NOT the alert container.
  const found = ([...host.querySelectorAll('[role="status"]')] as HTMLElement[]).filter(
    el => el.getAttribute('data-slot') !== 'alert',
  )
  expect(found.length, 'the card must render exactly ONE role=status live region').toBe(1)
  return found[0]
}

interface Notice {
  text: string
  status: string | null
  destructive: boolean
}

function notice(host: HTMLElement): Notice {
  const el = statusRegion(host)
  const tokens = (el.getAttribute('class') ?? '').split(/\s+/)
  return {
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    status: el.getAttribute('data-status'),
    // The kit maps `type="danger"` to `text-destructive` — the destructive red
    // DESIGN_SYSTEM.md reserves for states that genuinely stop the user.
    destructive: tokens.includes('text-destructive'),
  }
}

/**
 * Channels through which a RENDERED control can be made unanswerable while every
 * "is it there / is it enabled" assertion still passes. Bounded DOM check — see
 * the header for what it does NOT cover.
 */
const INERTING_CLASSES = ['pointer-events-none', 'hidden', 'invisible', 'opacity-0']

function assertReachable(el: HTMLElement, root: HTMLElement, label: string): void {
  expect(el.hasAttribute('disabled'), `${label} must not be disabled`).toBe(false)
  expect(el.getAttribute('aria-disabled'), `${label} must not be aria-disabled`).not.toBe('true')
  expect(el.tabIndex, `${label} must stay in the tab order`).toBeGreaterThanOrEqual(0)
  for (let n: HTMLElement | null = el; n && n !== root.parentElement; n = n.parentElement) {
    expect(n.hasAttribute('hidden'), `${label}: [hidden] on or above the control`).toBe(false)
    expect(n.hasAttribute('inert'), `${label}: [inert] on or above the control`).toBe(false)
    expect(n.getAttribute('aria-hidden'), `${label}: aria-hidden on or above`).not.toBe('true')
    const tokens = (n.getAttribute('class') ?? '').split(/\s+/)
    for (const bad of INERTING_CLASSES) {
      expect(tokens.includes(bad), `${label}: \`${bad}\` on or above the control`).toBe(false)
    }
  }
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

/** Bump the seam and let effects settle. */
async function bump(f: Fixture): Promise<void> {
  await act(async () => {
    f.notify()
  })
}

// ── the copy the card is contracted to show, VERBATIM ───────────────────────
//
// Whole sentences, not substrings (FR20-15: a loose substring let three harmful
// rewrites through, including dropping both recovery instructions from the only
// state that actually disables the controls).
const COPY = {
  pending: '',
  notOpen: 'This request is not open locally — you can still answer it.',
  notOpenExhausted:
    'This request could not be reopened locally — you can still answer it, ' +
    'or reload the conversation.',
  noTransport:
    'This request cannot be answered right now — the approval channel is unavailable. ' +
    'It will become answerable on its own once the connection is back, or reload the conversation.',
  resolveFailed: "That didn't go through — try again.",
  approved: 'Approved — script resumed.',
  denied: 'Denied.',
} as const

beforeEach(() => {
  __resetElicitationTransportForTests()
})

afterEach(async () => {
  for (const m of live.splice(0)) await m.unmount()
  __resetElicitationTransportForTests()
  document.body.innerHTML = ''
})

// ═══════════════════════════════════════════════════════════════════════════
// §1 — FR19-10. The POST carries THIS card's id and THE USER'S OWN answer, in
//      every state a user can answer in.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every answerable state, CONSTRUCTED. `prepare` leaves the card sitting in the
 * state; the test then clicks and reads the LAST post, so a state reached by a
 * prior click (resolve-failed) is measured on the click that follows it.
 *
 * The two `resolve-failed` rows deliberately fail with the OPPOSITE control, so
 * both directions of a substitution are covered:
 * `blocked === 'resolve-failed' ? 'decline' : action` is red on the approve row
 * and `? 'accept' : action` is red on the deny row.
 */
const ANSWERABLE: {
  key: string
  name: string
  expectStatus: string
  build(id: string): Fixture
  prepare?(host: HTMLElement, f: Fixture, kind: 'approve' | 'deny'): Promise<void>
}[] = [
  {
    key: 'healthy',
    name: 'healthy (entry open)',
    expectStatus: 'pending',
    build: healthy,
  },
  {
    // The state FR19-10's own prescription names. A browser cannot hold it
    // still; this provider holds it still forever.
    key: 'notopen',
    name: 'not open locally (self-heal cannot land)',
    expectStatus: 'not-registered',
    build: () => neverRegisters(),
  },
  {
    // The SAME notice status, a DIFFERENT local: `healExhausted`. Without this
    // row a substitution keyed on the spent budget
    // (`healExhausted ? 'decline' : action`) is green, because the row above
    // sits at one attempt of three. Every local the send site can see must have
    // a row where it is TRUE, or it is another unguarded condition.
    key: 'notopen-spent',
    name: 'not open locally, heal budget spent',
    expectStatus: 'not-registered',
    build: () => neverRegisters(),
    prepare: async (_host, f) => {
      for (let i = 0; i < 4; i++) await bump(f)
    },
  },
  {
    key: 'failed',
    // FR20-6's sharpest surviving spelling lives here. Both controls are
    // deliberately LIVE in this state — retrying is the entire point — so the
    // substitution is reachable by a real user; it simply was never observed.
    name: 'resolve-failed (after a rejected POST)',
    expectStatus: 'resolve-failed',
    build: id => {
      const f = healthy(id)
      f.resolveOutcome = 'throw'
      return f
    },
    prepare: async (host, f, kind) => {
      // Fail using the OTHER control, then let the next POST succeed.
      await click(control(host, kind === 'approve' ? 'deny' : 'approve'))
      f.resolveOutcome = 'settle'
    },
  },
]

describe('FR19-10 — the send carries the user’s decision under this card’s id', () => {
  for (const state of ANSWERABLE) {
    for (const [kind, decision] of [
      ['approve', 'accept'],
      ['deny', 'decline'],
    ] as const) {
      test(`${state.name}: clicking ${kind} POSTs '${decision}' under this card's id`, async () => {
        const id = `elic-${state.key}-${kind}`
        const f = state.build(id)
        const { host } = await mount(card(id))

        await state.prepare?.(host, f, kind)
        expect(notice(host).status, 'the constructed state').toBe(state.expectStatus)

        const el = control(host, kind)
        assertReachable(el, host, `${kind} in ${state.name}`)
        const before = f.posts.length
        await click(el)

        expect(f.posts.length, 'the click must produce exactly one POST').toBe(before + 1)
        const post = f.posts[f.posts.length - 1]
        // The two arguments FR19-10 named. There is no third thing to enumerate.
        expect(post.id, 'the POST must carry THIS card’s elicitation id').toBe(id)
        expect(post.action, 'the POST must carry the answer the user gave').toBe(decision)
      })
    }
  }

  test('no-transport: both controls are disabled and a click POSTs nothing', async () => {
    // Nothing installed: the state that needs mcp's transport absent
    // mid-conversation, which no browser session can arrange.
    const id = 'elic-no-transport'
    const { host } = await mount(card(id))

    expect(notice(host).status).toBe('no-transport')
    for (const kind of ['approve', 'deny'] as const) {
      const el = control(host, kind)
      expect(el.hasAttribute('disabled'), `${kind} must be disabled with no transport`).toBe(true)
      await click(el)
    }
    // Installing a transport afterwards proves the state is LIVE, not latched,
    // and that the click that then lands still carries the right arguments.
    const f = new Fixture().seed(id)
    await act(async () => {
      setElicitationTransport(f, 'test')
    })
    expect(notice(host).status).toBe('pending')
    const approve = control(host, 'approve')
    assertReachable(approve, host, 'approve after the transport arrives')
    await click(approve)
    expect(f.posts).toEqual([{ id, action: 'accept', content: undefined }])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §2 — FR19-12. The self-heal opens the entry, and only then can the outcome be
//      shown at all.
// ═══════════════════════════════════════════════════════════════════════════

describe('FR19-12 — the self-heal reopens a dropped entry', () => {
  test('a card whose entry was dropped registers it and heals to pending', async () => {
    // mcp's `initialize` awaits a dynamic import before installing the
    // transport, so a frame landing in that window is dropped and the entry is
    // never opened. Constructed here by installing a conforming provider that
    // simply holds no entry for this id.
    const id = 'elic-heal'
    const f = install(new Fixture())
    const { host } = await mount(card(id))

    expect(f.registers, 'the card must reopen the dropped entry, exactly once').toEqual([
      runJsElicitationInit(card(id)),
    ])
    expect(f.has(id), 'the entry must exist after the heal').toBe(true)
    expect(notice(host)).toEqual({ text: COPY.pending, status: 'pending', destructive: false })
  })

  test('the healed entry is what lets the OUTCOME render', async () => {
    // The harm FR19-12 names: without the heal the POST still goes out and the
    // script still resumes, but `elicitationStatus` stays undefined, so
    // `resolved` never flips — the outcome is never shown and both controls stay
    // rendered, inviting a duplicate POST to a single-use elicitation.
    const id = 'elic-heal-outcome'
    const f = install(new Fixture())
    const { host } = await mount(card(id))

    await click(control(host, 'approve'))

    expect(f.posts).toEqual([{ id, action: 'accept', content: undefined }])
    expect(notice(host)).toEqual({
      text: COPY.approved,
      status: 'approved',
      destructive: false,
    })
    expect(buttons(host), 'a resolved card must offer no further controls').toEqual([])
  })

  test('a conforming provider costs exactly ONE attempt, however many seam bumps', async () => {
    const id = 'elic-heal-once'
    const f = install(new Fixture())
    await mount(card(id))
    for (let i = 0; i < 4; i++) await bump(f)
    expect(f.registers.length, 'the heal must not re-fire once the entry exists').toBe(1)
  })

  test('a non-conforming provider is retried on each seam change, then bounded', async () => {
    // The bound is the consumer-side belt for a provider that violates the
    // register→`has()` contract: without it the effect spins (measured at ~54
    // registrations before React's update-depth bail-out).
    const id = 'elic-heal-budget'
    const f = neverRegisters()
    const { host } = await mount(card(id))

    expect(f.registers.length, 'one attempt at mount').toBe(1)
    expect(notice(host)).toEqual({ text: COPY.notOpen, status: 'not-registered', destructive: false })

    // Each seam change is a fresh chance for a transient failure to have cleared
    // — until the budget is spent. Four bumps, three attempts total.
    for (let i = 0; i < 4; i++) await bump(f)
    expect(f.registers.length, `the heal must stop at HEAL_BUDGET=${HEAL_BUDGET}`).toBe(HEAL_BUDGET)
    for (const r of f.registers) expect(r).toEqual(runJsElicitationInit(card(id)))

    // …and the copy must SAY the budget is spent, or the user is left with a
    // sentence implying a retry that will never come.
    expect(notice(host)).toEqual({
      text: COPY.notOpenExhausted,
      status: 'not-registered',
      destructive: false,
    })
  })

  test('an ALREADY-RESOLVED card never registers, even with no open entry', async () => {
    // Isolates the effect's first guard (`resolved !== null`) from its second
    // (`elicitationExists`): the provider answers `status()` but denies `has()`,
    // so only the resolved check can stop the heal. Re-registering an answered,
    // single-use elicitation is the harm.
    const id = 'elic-heal-resolved'
    const f = install(new Fixture().seed(id, 'accepted'))
    f.hiddenFromHas.add(id)
    const { host } = await mount(card(id))

    expect(notice(host).status).toBe('approved')
    for (let i = 0; i < 3; i++) await bump(f)
    expect(f.registers, 'a resolved card must never register').toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §3 — Only the impossible state disables. (Replaces the source guards that
//      pinned `disabled` / the click gate / the render gate by AST shape.)
// ═══════════════════════════════════════════════════════════════════════════

describe('actionability — only `no-transport` disables', () => {
  for (const state of ANSWERABLE) {
    test(`${state.name}: both controls render, are reachable, and POST`, async () => {
      const id = `elic-live-${state.key}`
      const f = state.build(id)
      const { host } = await mount(card(id))
      await state.prepare?.(host, f, 'approve')
      expect(notice(host).status).toBe(state.expectStatus)

      for (const kind of ['approve', 'deny'] as const) {
        assertReachable(control(host, kind), host, `${kind} in ${state.name}`)
      }
      const before = f.posts.length
      await click(control(host, 'deny'))
      expect(f.posts.length, 'a live control must reach the provider').toBe(before + 1)
    })
  }

  test('a resolve failure does not latch the card — the retry POSTs', async () => {
    // FIX_ROUND-4 folded `resolve-failed` into the disable predicate and thereby
    // gated its own reset, disabling the card permanently after ONE failure.
    const id = 'elic-retry'
    const f = healthy(id)
    f.resolveOutcome = 'throw'
    const { host } = await mount(card(id))

    await click(control(host, 'approve'))
    expect(notice(host)).toEqual({
      text: COPY.resolveFailed,
      status: 'resolve-failed',
      destructive: true,
    })

    f.resolveOutcome = 'settle'
    assertReachable(control(host, 'approve'), host, 'approve after a failure')
    await click(control(host, 'approve'))
    expect(f.posts.map(p => p.action)).toEqual(['accept', 'accept'])
    expect(notice(host).status, 'a successful retry clears the failure').toBe('approved')
  })

  test('a rolled-back POST re-enables the controls and reports the failure', async () => {
    // The provider signals a rejected POST by rolling its entry back to
    // `pending`; the card's derived `resolved` must follow it back.
    const id = 'elic-rollback'
    const f = healthy(id)
    f.resolveOutcome = 'rollback'
    const { host } = await mount(card(id))

    await click(control(host, 'approve'))
    expect(notice(host).status).toBe('resolve-failed')
    assertReachable(control(host, 'approve'), host, 'approve after a rollback')
  })

  test('the controls disappear once the card is resolved, and only then', async () => {
    const id = 'elic-gate'
    healthy(id)
    const { host } = await mount(card(id))
    expect(buttons(host).length, 'both controls render while unresolved').toBe(2)
    await click(control(host, 'deny'))
    expect(buttons(host)).toEqual([])
    expect(notice(host)).toEqual({ text: COPY.denied, status: 'denied', destructive: false })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §4 — The status region: one sentence, one tone, one probe token, always
//      mounted. (Replaces the AST wiring guard on `elicitationNotice`.)
// ═══════════════════════════════════════════════════════════════════════════

describe('the status region', () => {
  test('every state shows its own whole sentence, tone and probe token', async () => {
    // One table over every state the region can be in. Blanking the copy,
    // freezing the probe token, or painting a recoverable state destructive-red
    // is red HERE, in the state it happens in.
    const cases: { name: string; run(): Promise<Notice> }[] = [
      {
        name: 'no-transport',
        run: async () => notice((await mount(card('s-none'))).host),
      },
      {
        name: 'pending',
        run: async () => {
          healthy('s-ok')
          return notice((await mount(card('s-ok'))).host)
        },
      },
      {
        name: 'not open locally',
        run: async () => {
          neverRegisters()
          return notice((await mount(card('s-notopen'))).host)
        },
      },
      {
        name: 'not open locally, budget spent',
        run: async () => {
          const f = neverRegisters()
          const { host } = await mount(card('s-spent'))
          for (let i = 0; i < 4; i++) await bump(f)
          return notice(host)
        },
      },
      {
        name: 'resolve-failed',
        run: async () => {
          const f = healthy('s-failed')
          f.resolveOutcome = 'throw'
          const { host } = await mount(card('s-failed'))
          await click(control(host, 'approve'))
          return notice(host)
        },
      },
      {
        name: 'approved',
        run: async () => {
          healthy('s-yes')
          const { host } = await mount(card('s-yes'))
          await click(control(host, 'approve'))
          return notice(host)
        },
      },
      {
        name: 'denied',
        run: async () => {
          healthy('s-no')
          const { host } = await mount(card('s-no'))
          await click(control(host, 'deny'))
          return notice(host)
        },
      },
    ]
    const expected: Record<string, Notice> = {
      'no-transport': { text: COPY.noTransport, status: 'no-transport', destructive: true },
      pending: { text: COPY.pending, status: 'pending', destructive: false },
      'not open locally': { text: COPY.notOpen, status: 'not-registered', destructive: false },
      'not open locally, budget spent': {
        text: COPY.notOpenExhausted,
        status: 'not-registered',
        destructive: false,
      },
      'resolve-failed': { text: COPY.resolveFailed, status: 'resolve-failed', destructive: true },
      approved: { text: COPY.approved, status: 'approved', destructive: false },
      denied: { text: COPY.denied, status: 'denied', destructive: false },
    }

    const got: Record<string, Notice> = {}
    for (const c of cases) {
      got[c.name] = await c.run()
      for (const m of live.splice(0)) await m.unmount()
      __resetElicitationTransportForTests()
    }
    expect(got).toEqual(expected)
  })

  test('the region is mounted in EVERY state, including the disabling one', async () => {
    // FIX_ROUND-4: a `role=status` element that enters the tree already carrying
    // its text is announced unreliably, so the region must PRE-EXIST the change.
    // It is also the focus target when the buttons unmount.
    const id = 'elic-region'
    const { host } = await mount(card(id))
    const atMount = statusRegion(host)
    expect(atMount.getAttribute('data-status')).toBe('no-transport')

    const f = new Fixture().seed(id)
    await act(async () => {
      setElicitationTransport(f, 'test')
    })
    expect(statusRegion(host), 'the SAME node must survive the state change').toBe(atMount)
    await click(control(host, 'approve'))
    expect(statusRegion(host), 'and survive resolution').toBe(atMount)
  })

  test('the disabled control is explained by the region it points at', async () => {
    // The one state that disables must keep its only explanation (WCAG): the
    // controls' `aria-describedby` has to resolve to a region with real text.
    const { host } = await mount(card('elic-describedby'))
    const region = statusRegion(host)
    expect(region.textContent?.trim().length, 'the region must have text to describe with').toBeGreaterThan(0)
    for (const kind of ['approve', 'deny'] as const) {
      const el = control(host, kind)
      expect(el.hasAttribute('disabled')).toBe(true)
      const described = el.getAttribute('aria-describedby')
      expect(described, `${kind} must be described`).toBe(region.id)
      expect(host.ownerDocument.getElementById(described ?? '')).toBe(region)
    }
  })

  test('a successful approve is never reported as a failure', async () => {
    // Two historical inversions in one assertion: `resolveDidFail` judged in the
    // ELSE branch (every success marked failed), and judging a missing entry as
    // a failure (FIX_ROUND-9) — which is why the no-entry case is checked too.
    healthy('elic-nofail')
    const ok = await mount(card('elic-nofail'))
    await click(control(ok.host, 'approve'))
    expect(notice(ok.host).text).toBe(COPY.approved)

    const f = neverRegisters()
    const { host } = await mount(card('elic-nofail-noentry'))
    await click(control(host, 'approve'))
    expect(f.posts.length, 'the POST goes out even with no local entry').toBe(1)
    expect(notice(host).text, 'a successful POST with no entry is NOT a failure').toBe(COPY.notOpen)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §5 — Re-entrancy: never POST twice to a single-use elicitation.
// ═══════════════════════════════════════════════════════════════════════════

describe('re-entrancy', () => {
  test('a double click POSTs once, and the controls announce the in-flight state', async () => {
    const id = 'elic-double'
    const f = healthy(id)
    f.resolveOutcome = 'hang'
    const { host } = await mount(card(id))

    await click(control(host, 'approve'))
    expect(f.posts.length).toBe(1)
    for (const kind of ['approve', 'deny'] as const) {
      expect(control(host, kind).getAttribute('aria-busy'), `${kind} must announce in-flight`).toBe('true')
    }
    // Both controls, twice: neither the same control nor its sibling may send a
    // second answer while one is in flight.
    await click(control(host, 'approve'))
    await click(control(host, 'deny'))
    expect(f.posts.length, 'a single-use elicitation must receive exactly one POST').toBe(1)

    await act(async () => {
      f.release()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §6 — Accessibility of the two controls.
// ═══════════════════════════════════════════════════════════════════════════

describe('the two controls', () => {
  test('announce DISTINCT names, and the name matches what each one does', async () => {
    // FIX_ROUND-5 added a `tooltip`; the kit derives `aria-label` from a string
    // tooltip when none is given, so BOTH controls announced identically
    // (WCAG 2.5.3 / 4.1.2) — a control whose name does not identify it.
    const id = 'elic-names'
    const f = healthy(id)
    const { host } = await mount(card(id))
    const names = buttons(host).map(accessibleName)
    expect(new Set(names).size, `the controls must announce distinctly, got ${names.join(' / ')}`).toBe(2)
    expect(names.some(n => /^approve$/i.test(n))).toBe(true)
    expect(names.some(n => /^deny$/i.test(n))).toBe(true)

    // …and the control that READS as "Deny" must be the one that declines. The
    // test id is invisible to the user, so the name is what is pinned.
    await click(control(host, 'deny'))
    expect(f.posts).toEqual([{ id, action: 'decline', content: undefined }])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §7 — The resolved state is derived from the seam, so it survives a remount;
//      and focus only moves on a genuine transition.
// ═══════════════════════════════════════════════════════════════════════════

describe('resolved state and focus', () => {
  test('survives a remount (the transcript is virtualized)', async () => {
    const id = 'elic-remount'
    const f = healthy(id)
    const first = await mount(card(id))
    await click(control(first.host, 'approve'))
    expect(notice(first.host).status).toBe('approved')
    await first.unmount()

    const again = await mount(card(id))
    expect(notice(again.host)).toEqual({
      text: COPY.approved,
      status: 'approved',
      destructive: false,
    })
    expect(buttons(again.host)).toEqual([])
    expect(f.registers, 'a resolved card must not re-register on remount').toEqual([])
  })

  test('focus moves to the outcome on a real transition, and not on a remount', async () => {
    // Focusing the region restores the keyboard user's place when the buttons
    // unmount. Seeding `wasResolved` from the FIRST render is what stops a card
    // that mounts already resolved from yanking focus out of the composer when
    // the virtualized transcript scrolls it back into view.
    const id = 'elic-focus'
    healthy(id)
    const live1 = await mount(card(id))
    await click(control(live1.host, 'approve'))
    expect(document.activeElement, 'a real transition focuses the outcome').toBe(
      statusRegion(live1.host),
    )
    await live1.unmount()

    const remount = await mount(card(id))
    expect(document.activeElement, 'a remount of an already-resolved card must NOT steal focus').not.toBe(
      statusRegion(remount.host),
    )
  })
})
