import type { RailContribution } from '@/modules/chat/components/rail/railTypes'
import {
  countLabel,
  countOf,
  railToolStepBase,
  stringOf,
  structuredOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * The `run_js` family's rail contributions.
 *
 * JSX-free and in its own module ONLY so the unit runner can reach it: this
 * workspace runs `node --test "src/**\/*.test.ts"` with type-stripping, which
 * cannot parse a `.tsx`. A contribution that lives inside the extension file is
 * therefore untestable, which is how three of them shipped uncovered.
 */
interface JsToolApprovalData {
  elicitation_id?: string
  tool_name?: string
  server?: string
}

/** A `run_js` script execution. */
export const runJsStep: RailContribution = {
  contentTypes: ['tool_use'],
  order: 40,
  describeActivity: ctx => {
    const base = railToolStepBase(ctx)
    if (!base || base.label !== 'run_js') return null
    const sc = structuredOf(ctx)
    const logs = countOf(sc, 'logs', 'log_lines')
    const err = stringOf(sc, 'error')
    const bits: string[] = []
    if (err) bits.push(err)
    else if (logs != null) bits.push(countLabel(logs, 'log line'))
    return {
      ...base,
      label: 'Running a script',
      detail: bits.join(' · ') || undefined,
    }
  },
}

/**
 * The suspended-script approval prompt. BLOCKING: a script is stopped waiting
 * for this answer, so it can never be folded into a collapsible rail row.
 */
export const runJsApprovalStep: RailContribution = {
  contentTypes: ['run_js_approval'],
  order: 40,
  describeActivity: ctx => {
    const d = ctx.content.content as unknown as JsToolApprovalData
    const tool = (d?.tool_name ?? '').trim()
    return {
      key: d?.elicitation_id || `run_js_approval:${ctx.index}`,
      label: tool ? `Script wants to call ${tool}` : 'Script wants to call a tool',
      status: 'pending-approval',
      consumed: 1,
      blocking: true,
    }
  },
}

