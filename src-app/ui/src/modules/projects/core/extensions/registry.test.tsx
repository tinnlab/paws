/**
 * TEST-8 (paws-feature-surface) — the project "References" entry is gone at its
 * source (design item 13).
 *
 * This drives the REAL `ProjectExtensionRegistry`, because the thing worth
 * proving is behavioural and slightly counter-intuitive: hiding the citations
 * MODULE does not remove its project contribution. That registration is made by
 * an eager glob owned by the PROJECTS module (`projects/extensions/index.ts`),
 * which runs whenever projects loads and never consults any module predicate.
 * Filtering the glob's keys would have been a silent no-op — each extension
 * calls `register(...)` as a top-level import side effect, so it has already
 * happened by the time those keys are visible. The filter therefore lives inside
 * `register()`, and this test pins that.
 *
 * A vitest (.test.tsx) test rather than a node:test one because the registry is
 * a .tsx module and the node runner cannot load it.
 */

import { describe, expect, it } from 'vitest'
import { ProjectExtensionRegistry } from './registry'

/** Minimal stand-ins — the registry only reads `name`, `slots`, `order`. */
const contribution = (name: string, label: string, order: number) =>
  ({
    name,
    slots: {
      knowledge_kinds: {
        label,
        icon: null,
        inlinePreview: () => null,
        managePanel: () => null,
        order,
      },
    },
  }) as never

describe('ProjectExtensionRegistry — paws feature-surface reduction', () => {
  it('drops hidden modules’ knowledge-kind contributions', () => {
    const registry = new ProjectExtensionRegistry()

    // Exactly what the eager glob does at boot, in the same order.
    registry.register(contribution('file', 'Knowledge files', 10))
    registry.register(contribution('citations', 'References', 20))
    registry.register(contribution('knowledge-base', 'Knowledge bases', 30))

    const labels = registry.knowledgeKinds().map(k => k.label)

    expect(labels).toEqual(['Knowledge files'])
    expect(labels).not.toContain('References')
    expect(labels).not.toContain('Knowledge bases')
  })

  it('still registers a surviving contribution', () => {
    // The control: without it, a `register()` that dropped EVERYTHING would make
    // the assertion above pass while breaking the project page entirely (INV-2).
    const registry = new ProjectExtensionRegistry()
    registry.register(contribution('file', 'Knowledge files', 10))

    expect(registry.knowledgeKinds()).toHaveLength(1)
    expect(registry.knowledgeKinds()[0].extensionName).toBe('file')
  })

  it('treats zero contributions as a valid state, not an error', () => {
    // The registry documents this as an acid-test invariant; the reduction turns
    // it from hypothetical into reachable, so it is worth pinning.
    const registry = new ProjectExtensionRegistry()
    registry.register(contribution('citations', 'References', 20))
    expect(registry.knowledgeKinds()).toEqual([])
  })
})
