import type {
  RailActivityContext,
  RailContribution,
  RailStepDescriptor,
} from '@/modules/chat/components/rail/railTypes'

/**
 * The ACTIVITY-RAIL contribution registry, as a pure class (ITEM-1).
 *
 * Split out of `registry.tsx` for two reasons:
 *  - `registry.tsx` contains JSX, and this workspace's unit runner is
 *    `node --test` with type-stripping only — it cannot parse JSX, so anything
 *    living there is unreachable from a unit spec. Resolution order and
 *    enable-gating are exactly the behaviour that must be pinned, so they live
 *    where they can be pinned.
 *  - it keeps the change to `registry.tsx` genuinely ADDITIVE (a field + three
 *    thin delegations), which is what lets it merge cleanly against the
 *    concurrent edits that file is receiving on this branch.
 */
export interface RailRegistryEntry {
  extensionName: string
  contribution: RailContribution
  order: number
}

export class RailContributionRegistry {
  /** content type → entries, kept sorted ascending by `order`. */
  private byType = new Map<string, RailRegistryEntry[]>()

  /**
   * Register one extension's contributions. `order` defaults to the extension's
   * priority, so a contribution can deliberately sit BEHIND every other one
   * (a generic fallback declares a high order) without core knowing why.
   */
  register(
    extensionName: string,
    contributions: readonly RailContribution[],
    defaultOrder: number,
  ): void {
    for (const contribution of contributions) {
      const order = contribution.order ?? defaultOrder
      for (const contentType of contribution.contentTypes) {
        const list = this.byType.get(contentType) ?? []
        list.push({ extensionName, contribution, order })
        list.sort((a, b) => a.order - b.order)
        this.byType.set(contentType, list)
      }
    }
  }

  /** Drop every entry belonging to an extension (unregister / HMR re-register). */
  unregister(extensionName: string): void {
    for (const [contentType, entries] of this.byType.entries()) {
      const kept = entries.filter(e => e.extensionName !== extensionName)
      if (kept.length === 0) this.byType.delete(contentType)
      else this.byType.set(contentType, kept)
    }
  }

  /**
   * First non-null wins, in `order` sequence — the same first-wins discipline the
   * content-type registry uses. `isEnabled` lets the caller apply the host's
   * enable-gate without this module knowing what an extension option is.
   *
   * A contribution that THROWS is skipped and the next one gets a turn: a broken
   * descriptor must degrade the row, never break the transcript.
   */
  resolve(
    ctx: RailActivityContext,
    isEnabled: (extensionName: string) => boolean,
    onError?: (extensionName: string, error: unknown) => void,
  ): { step: RailStepDescriptor; contribution: RailContribution } | null {
    const entries = this.byType.get(ctx.content.content_type)
    if (!entries || entries.length === 0) return null

    for (const { extensionName, contribution } of entries) {
      if (!isEnabled(extensionName)) continue
      try {
        const step = contribution.describeActivity(ctx)
        if (step) return { step, contribution }
      } catch (error) {
        onError?.(extensionName, error)
      }
    }
    return null
  }

  /** Content types with at least one registered contribution (diagnostics/tests). */
  registeredTypes(): string[] {
    return [...this.byType.keys()].sort()
  }
}
