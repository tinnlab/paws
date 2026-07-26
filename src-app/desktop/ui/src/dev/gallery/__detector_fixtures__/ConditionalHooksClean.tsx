/**
 * DELIBERATELY CLEAN companion to `ConditionalHooks.tsx` — the negative half of
 * the Rules-of-Hooks lint fixture (taxonomy O1 / O2). NEVER rendered.
 *
 * Every shape here is legal and MUST NOT be reported, so pointing the lint at
 * this directory proves both directions at once: it fires on the defects next
 * door and stays silent on these. Each case is a real pattern the app relies on
 * — see `sdk/packages/framework/src/stores.ts` for the four proxy access paths.
 */
import { usePermission } from '@/core/permissions'
import { Permissions } from '@/api-client/permissions'
import { FixtureStore } from './stores/fixtureStore'

const READ_PERM = Permissions.FileRagAdminRead
const MANAGE_PERM = Permissions.FileRagAdminManage

/** The ACCEPTED fix for O1: both hooks called unconditionally, results OR'd. */
export function UnconditionalHookCalls() {
  const canManage = usePermission(MANAGE_PERM)
  const canRead = usePermission(READ_PERM) || canManage
  return <div>{canRead ? 'yes' : 'no'}</div>
}

/** The ACCEPTED fix for O2: read once, unconditionally, then branch on the value. */
export function HoistedProxyRead({ selectedId }: { selectedId: string | null }) {
  const items = FixtureStore.items
  const current = selectedId ? items.find(item => item.id === selectedId) : null
  return <div>{current?.label ?? 'none'}</div>
}

/** Path 1 — the `$` snapshot is hook-free, so it is legal anywhere. */
export function SnapshotReadInCondition({ show }: { show: boolean }) {
  if (show) return <div>{FixtureStore.$.items.length}</div>
  return null
}

/** Path 2 — an action CALL is hook-free (resolved from getState()). */
export function ActionCallInCondition({ show }: { show: boolean }) {
  if (show) FixtureStore.reload()
  return null
}

/**
 * Path 2 — an action passed BY REFERENCE inside a conditional. This is the shape
 * (`{err && <Alert onClose={Auth.clearAuthenticationError} />}`) that is the ONLY
 * source of false positives if the lint's action registry is dropped.
 */
export function ActionByReferenceInCondition({ error }: { error: string | null }) {
  return <div>{error && <button onClick={FixtureStore.reload}>{error}</button>}</div>
}

/** A hook inside a CALLBACK body is not on this component's render path. */
export function HookInsideCallback() {
  const items = FixtureStore.items
  return (
    <button
      onClick={() => {
        if (items.length > 0) {
          // A snapshot read in a handler — legal, and the walk stops at the
          // callback boundary regardless.
          console.error(FixtureStore.$.ready)
        }
      }}
    >
      go
    </button>
  )
}
