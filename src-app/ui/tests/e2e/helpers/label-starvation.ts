/**
 * LABEL-STARVATION — the deterministic detector for a form label whose column
 * has collapsed.
 *
 * WHY this exists (the defect it was written from): `/settings/scheduler`
 * shipped with every field label wrapping to ONE WORD PER LINE beside a
 * full-bleed input, because the page hand-composed the kit's horizontal `Field`
 * with the label inside `FieldContent` (`flex-1`, flex-basis 0) and a `w-full`
 * `InputNumber` as its sibling. Nothing overflowed, nothing was clipped,
 * contrast passed and every control had an accessible name — so NONE of the
 * existing gates (tsc, biome, runtime-health, Layer-A layout invariants, axe,
 * the 24/7 live-UI rig) could see it. A label wrapping *inside its allotted
 * column* is, mechanically, correct rendering. What is wrong is the
 * PROPORTION: the column is a fraction of the width the text needs while the
 * row has room to spare.
 *
 * That proportion IS measurable, and this is the measurement.
 *
 * ## Definition
 *
 * A label is STARVED when ALL of:
 *   1. it WRAPS            — rendered height >= 2 x its computed line-height;
 *   2. it is SQUEEZED      — box width < 0.5 x its natural single-line text
 *                            advance width (the sum of the client rects of a
 *                            Range over its own contents);
 *   3. the row HAD ROOM    — the enclosing field row is >= 2 x the label's
 *                            natural width;
 *   4. it is REAL TEXT     — >= 2 words and >= 8 characters.
 *
 * ## Why these thresholds (measured, not guessed)
 *
 * Applied to the 220 field labels rendered across all 46 gallery page surfaces
 * + 47 overlays at 1280x900, this flags EXACTLY the five Scheduler labels
 * (squeeze 0.26-0.37) and nothing else — zero false positives. A label that
 * wraps merely because its text is long sits at squeeze ~0.5-1.0 (it is using
 * the width it was given); a label whose column collapsed sits far below 0.5.
 * Clause 3 keeps a genuinely narrow container (a dense drawer, a 390px
 * viewport) from being blamed for a wrap it could not avoid.
 *
 * The same four clauses are mirrored in the `label-starvation` detector of the
 * agent-kit `live-ui-audit` rig, so the gated gallery check and the 24/7 live
 * check agree by construction.
 */
import type { Locator, Page } from '@playwright/test'

export interface LabelMetrics {
  /** The label's trimmed text. */
  text: string
  /** Word count of `text`. */
  words: number
  /** Character count of `text`. */
  chars: number
  /** Rendered line count (box height / computed line-height, rounded). */
  lines: number
  /** Rendered border-box width, px. */
  boxW: number
  /** Natural single-line advance width of the text, px. */
  naturalW: number
  /** Width of the enclosing field row, px (0 when no row could be resolved). */
  rowW: number
  /** A stable-ish selector for the offending element (reporting only). */
  selector: string
}

export const STARVATION = {
  /** wraps: rendered lines at or above this count */
  minLines: 2,
  /** squeezed: boxW / naturalW strictly below this */
  maxSqueeze: 0.5,
  /** the row had room: rowW / naturalW at or above this */
  minRowSlack: 2,
  /** real text, not an icon or a single token */
  minWords: 2,
  minChars: 8,
} as const

/** The predicate. Pure — unit-testable without a browser. */
export function isStarvedLabel(m: LabelMetrics): boolean {
  if (m.words < STARVATION.minWords || m.chars < STARVATION.minChars) return false
  if (m.lines < STARVATION.minLines) return false
  if (m.naturalW <= 0 || m.boxW <= 0) return false
  if (m.boxW / m.naturalW >= STARVATION.maxSqueeze) return false
  if (m.rowW <= 0) return false
  return m.rowW / m.naturalW >= STARVATION.minRowSlack
}

/** Human-readable one-liner for a failure message. */
export function describeStarvedLabel(m: LabelMetrics): string {
  const squeeze = (m.boxW / m.naturalW).toFixed(2)
  return (
    `"${m.text}" wraps to ${m.lines} lines in a ${Math.round(m.boxW)}px column ` +
    `while the text needs ${Math.round(m.naturalW)}px (squeeze ${squeeze}) and its ` +
    `row is ${Math.round(m.rowW)}px wide — the label column collapsed. ` +
    `Compose the row with <Form layout="horizontal"> + <FormField>, ` +
    `not a hand-rolled <Field orientation="horizontal"> with the label inside ` +
    `<FieldContent> and a w-full control beside it. [${m.selector}]`
  )
}

/**
 * Measure every label in the page. Runs IN the browser, so it must stay
 * self-contained (no imports, no closure captures).
 */
/* c8 ignore start — executes in the page context */
function measureLabelsInPage(): LabelMetrics[] {
  const out: LabelMetrics[] = []
  const sel = '[data-slot="field-label"], label, legend'
  for (const el of Array.from(document.querySelectorAll(sel))) {
    const node = el as HTMLElement
    const r = node.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    const cs = getComputedStyle(node)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const text = (node.textContent || '').trim()
    if (!text) continue
    // A label containing its own control (the shadcn "card" label pattern)
    // is a container, not a text column — its height is its content's.
    if (node.querySelector('input, textarea, select, [data-slot="field"]')) continue

    let lh = parseFloat(cs.lineHeight)
    if (!Number.isFinite(lh) || lh <= 0) lh = parseFloat(cs.fontSize) * 1.2
    const lines = Math.max(1, Math.round(r.height / lh))

    let naturalW = 0
    try {
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of Array.from(range.getClientRects())) naturalW += rect.width
    } catch {
      naturalW = r.width
    }

    const row = node.closest('[data-slot="field"]') as HTMLElement | null
    const rowW = row ? row.getBoundingClientRect().width : (node.parentElement?.getBoundingClientRect().width ?? 0)

    const testid = node.getAttribute('data-testid')
    const forAttr = node.getAttribute('for')
    const selector = testid
      ? `[data-testid="${testid}"]`
      : forAttr
        ? `label[for="${forAttr}"]`
        : `${node.tagName.toLowerCase()}${node.className ? '.' + String(node.className).split(/\s+/)[0] : ''}`

    out.push({
      text,
      words: text.split(/\s+/).filter(Boolean).length,
      chars: text.length,
      lines,
      boxW: r.width,
      naturalW,
      rowW,
      selector,
    })
  }
  return out
}
/* c8 ignore stop */

/** Measure every label currently rendered in `page`. */
export async function measureLabels(page: Page): Promise<LabelMetrics[]> {
  return page.evaluate(measureLabelsInPage)
}

/** Measure, then keep only the starved ones. */
export async function collectStarvedLabels(page: Page): Promise<LabelMetrics[]> {
  return (await measureLabels(page)).filter(isStarvedLabel)
}

/** Scoped variant — measure only inside `root` (used by the fixture leg). */
export async function collectStarvedLabelsIn(root: Locator): Promise<LabelMetrics[]> {
  const all = await measureLabels(root.page())
  const texts = new Set(
    (await root.locator('[data-slot="field-label"], label, legend').allTextContents()).map(t =>
      t.trim(),
    ),
  )
  return all.filter(m => texts.has(m.text)).filter(isStarvedLabel)
}
