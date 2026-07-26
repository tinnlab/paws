/**
 * Fixture store for the Rules-of-Hooks lint (taxonomy O2). NEVER imported at
 * runtime, NEVER rendered — lint fodder only.
 *
 * `ConditionalHooks.tsx` needs a binding that passes BOTH factors of the lint's
 * store-proxy test: imported from a `…/stores/…` specifier AND exported here by
 * one of the proxy factories. Declaring it locally (instead of importing a real
 * app store) keeps the fixture self-contained and byte-identical between the two
 * UI workspaces, whose `@/` aliases point at different trees.
 *
 * `registerLazyStore` is `declare`d rather than imported: the lint pattern-matches
 * the SHAPE of the declaration (a proxy-factory call assigned to an exported
 * const), and a declaration emits no code — so this file can never register a
 * real store or run a side effect if something imports it by accident.
 */
type FixtureState = {
  items: { id: string; label: string }[]
  ready: boolean
}

type FixtureProxy = FixtureState & {
  /** hook-free snapshot escape (path 1 of createStoreProxy) */
  $: FixtureState
  /** an ACTION (path 2) — hook-free, must never be reported by the lint */
  reload: () => void
}

declare function registerLazyStore<T>(handle: unknown): T

export const FixtureStore = registerLazyStore<FixtureProxy>({
  name: 'LintFixtureStore',
  state: { items: [], ready: false },
})
