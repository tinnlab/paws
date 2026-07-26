/**
 * INTENTIONALLY DEFECTIVE source fixture for the Rules-of-Hooks lint
 * (taxonomy O1 / O2). NEVER rendered — lint fodder only. Excluded from the
 * repo-wide lint scan; the acceptance harness targets this dir via --root.
 *
 * Each defect below is a shape that ACTUALLY SHIPPED and crashed:
 *   O1 — `usePermission(A) || usePermission(B)` (13 sites, fixed in 649ae7180):
 *        `||` skips the second hook when the first is truthy, so the hook COUNT
 *        tracks permission state and React throws "Rendered more hooks than
 *        during the previous render" the moment it flips.
 *   O2 — a reactive store-proxy field read inside a ternary (fixed in
 *        57f9fdb5b): a proxy read IS a hook (useEffect + useStore, see
 *        framework/src/stores.ts), so the hook count jumped when the drawer's
 *        `modelId` flipped null→set.
 */
import { usePermission } from '@/core/permissions'
import { Permissions } from '@/api-client/permissions'
import { FixtureStore, useFixtureHandle } from './stores/fixtureStore'

const READ_PERM = Permissions.FileRagAdminRead
const MANAGE_PERM = Permissions.FileRagAdminManage

/** O1: the second hook is short-circuited away whenever the first is true. */
export function ConditionalHookCall() {
  const canRead = usePermission(READ_PERM) || usePermission(MANAGE_PERM)
  const canManage = usePermission(MANAGE_PERM)
  return <div>{canRead && canManage ? 'both' : 'partial'}</div>
}

/** O2: the proxy read only happens on one branch of the ternary. */
export function ConditionalProxyReadInTernary({ selectedId }: { selectedId: string | null }) {
  const current = selectedId
    ? FixtureStore.items.find(item => item.id === selectedId)
    : null
  return <div>{current?.label ?? 'none'}</div>
}

/** O2: the proxy read sits behind an early return, so it is skipped entirely. */
export function ConditionalProxyReadAfterEarlyReturn({ id }: { id: string | null }) {
  if (!id) return null
  const count = FixtureStore.items.length
  return <div>{count}</div>
}

/** O2: destructuring a proxy is one reactive read per field — same hazard. */
export function ConditionalProxyDestructure({ show }: { show: boolean }) {
  if (show) {
    const { ready } = FixtureStore
    return <div>{String(ready)}</div>
  }
  return null
}

/** O2: element access is the same read, written differently. */
export function ConditionalProxyElementAccess({ show }: { show: boolean }) {
  const v = show ? FixtureStore['items'] : null
  return <div>{v?.length ?? 0}</div>
}

/**
 * O2: a PER-INSTANCE store reached through a hook handle. This is the other half
 * of the shipped `OpenInNewWindowAction` defect, whose pre-image read
 * `pane.store.conversation` in one ternary branch and an imported proxy in the
 * other — an imported-proxy-only rule sees just one of the two.
 */
export function ConditionalPaneStoreRead({ show }: { show: boolean }) {
  const handle = useFixtureHandle()
  const v = show ? handle.store.items : null
  return <div>{v?.length ?? 0}</div>
}
