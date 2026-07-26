/**
 * Unit-test stub for the `@ziee/framework/permissions` BARREL.
 *
 * WHY it is needed: the barrel re-exports `Can.tsx` (React/JSX), which node's
 * type-STRIPPING runtime — what `node --test` uses — cannot parse, so any spec
 * that transitively imports the barrel dies with `ERR_UNKNOWN_FILE_EXTENSION`
 * before a single assertion runs. Same mechanism as the sibling
 * `@/core/{module-system,events}` stubs registered in `scripts/node-test-hooks.mjs`.
 *
 * WHY it lives HERE and not in `sdk/packages/framework/src/`: that package's
 * export map is `"./*": "./src/*"`, so anything under its `src/` is a RESOLVABLE
 * PUBLIC SUBPATH for ALL THREE consuming applications — one bad import away from
 * disabling every permission check in any of them. Moving it into this app's own
 * source tree NARROWS that blast radius from three packages to one app; it does
 * not eliminate it (a stray `@/core/__test-stubs__/framework-permissions` import
 * here would still disable this app's client-side gates, and nothing lints for
 * it). It is placed alongside the two pre-existing stubs so it shares whatever
 * guard is added for them.
 *
 * LIMIT, stated plainly: this answers `true` unconditionally, so a unit spec
 * running under this resolver CANNOT observe a permission DENY. Any spec that
 * needs the deny path must import `permissions/evaluatePermission.ts` (a plain
 * `.ts` module) directly, which resolves without the barrel. The permission
 * gates themselves are covered by the backend deny tests and the restricted-user
 * e2e specs, not here.
 */
export function hasPermissionNow(_expr?: unknown): boolean {
  return true
}

// NOTHING ELSE is exported. `setAuthView` / `evaluatePermission` stubs were
// present initially and had no consumer — dead surface that only widened the
// always-allow footprint. A spec that needs the real `evaluatePermission`
// (including its DENY path) imports `permissions/evaluatePermission.ts` directly;
// it is a plain `.ts` module and resolves without the JSX-carrying barrel.
