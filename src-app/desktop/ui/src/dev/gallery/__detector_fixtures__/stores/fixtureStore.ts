/**
 * Fixture store for the Rules-of-Hooks lint (taxonomy O2). NEVER imported at
 * runtime, NEVER rendered — lint fodder only.
 *
 * `ConditionalHooks.tsx` needs a binding that passes BOTH factors of the lint's
 * store-proxy test: an import specifier that resolves to the file DEFINING the
 * proxy, and a proxy-factory-shaped export here. Declaring it locally (rather
 * than importing a real app store) means the STORE half of the fixture depends on
 * no app internals; the fixture still imports `usePermission`/`Permissions` via
 * `@/`, which each workspace resolves into its own tree.
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

/**
 * A per-instance store handle, mirroring `useChatPane()` — its `.store` is a
 * proxy, so `handle.store.<field>` is a path-4 reactive read (a hook).
 */
declare function useFixtureHandle(): { store: FixtureProxy }
export { useFixtureHandle }
