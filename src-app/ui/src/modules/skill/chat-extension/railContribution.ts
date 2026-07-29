import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'
import {
  railToolStepBase,
  stringOf,
  structuredOf,
} from '@/modules/chat/components/rail/railBlocks'

/**
 * The `skill` module's activity-rail contribution (ITEM-20).
 *
 * Describes the two tools of the built-in `skill_mcp` server:
 *
 * | tool | server source |
 * |---|---|
 * | `load_skill`      | `server/src/modules/skill_mcp/tools.rs:30` |
 * | `read_skill_file` | `server/src/modules/skill_mcp/tools.rs:44` |
 *
 * `structuredContent` (the handler wraps the tool value verbatim —
 * `skill_mcp/handlers.rs:149`):
 *
 * - `load_skill`      → `{name, content}`        (`skill_mcp/tools.rs:91`)
 * - `read_skill_file` → `{name, path, content}`  (`skill_mcp/tools.rs:164,179`)
 *
 * `name` is the skill's reverse-DNS id (`io.github.ziee/configure-llm-providers`),
 * so the row shows its trailing segment — the part a human recognises.
 *
 * ITEM-6: a `null` `structuredOf(ctx)` degrades to the plain label; nothing here
 * dereferences the payload without a guard.
 */

const LABELS: Record<string, string> = {
  load_skill: 'Loading a skill',
  read_skill_file: 'Reading a skill file',
}

/** `io.github.ziee/configure-llm-providers` → `configure-llm-providers`. */
export function shortSkillName(name: string): string {
  const tail = name.split('/').pop()
  return (tail ?? name).trim() || name
}

export function describeSkillActivity(
  ctx: RailActivityContext,
): RailStepDescriptor | null {
  const base = railToolStepBase(ctx)
  if (!base) return null
  const label = LABELS[base.label]
  if (!label) return null

  const blocking = base.status === 'pending-approval'
  const sc = structuredOf(ctx)
  const skill = stringOf(sc, 'name')
  const path = stringOf(sc, 'path')

  // `read_skill_file` is about the FILE; `load_skill` about the skill itself.
  const detail =
    base.label === 'read_skill_file'
      ? [path, skill ? shortSkillName(skill) : null].filter(Boolean).join(' · ')
      : skill
        ? shortSkillName(skill)
        : ''

  return { ...base, label, blocking, ...(detail ? { detail } : {}) }
}

/** Order 40 — ahead of `mcp`'s generic fallback (1000). */
export const skillRailContributions: RailContribution[] = [
  {
    contentTypes: ['tool_use'],
    order: 40,
    describeActivity: describeSkillActivity,
    // `renderDetail` omitted → the rail delegates to the registered renderer.
  },
]
