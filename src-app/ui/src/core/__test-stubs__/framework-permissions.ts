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
 * PUBLIC SUBPATH for all three consuming applications. An always-allow
 * `hasPermissionNow` reachable as `@ziee/framework/__test-stubs__/permissions`
 * is one bad import away from disabling every permission check in production,
 * with no lint rule or build exclusion to stop it. Keeping it in the APP's test
 * tree — which is not a published package and is never imported by the
 * framework — removes that reachability entirely.
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

export function setAuthView(_view?: unknown): void {
  /* no-op */
}

export function evaluatePermission(): boolean {
  return true
}
