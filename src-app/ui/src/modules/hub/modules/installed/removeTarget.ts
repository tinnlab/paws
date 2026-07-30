import { Permissions } from '@/api-client/permissions'
import type { HubInstalledRow } from '@/api-client/types'

/**
 * Which DELETE endpoint a `/hub/installed` row's **Remove** action has to go
 * through, and the permission that endpoint enforces.
 *
 * WHY THIS EXISTS — the bug it closes:
 *
 * A hub install is not always a personal, user-owned copy. Installing an
 * assistant "as Template" writes an `assistants` row with `is_template = true`
 * and `created_by IS NULL` (migration 6's `template_must_have_no_owner` CHECK),
 * and installing an MCP server "as system" writes `mcp_servers` with
 * `is_system = true, user_id = NULL`. Those rows are served by a DIFFERENT pair
 * of routes than their user-scoped siblings:
 *
 *   assistant   user      DELETE /api/assistants/{id}             assistants::delete
 *   assistant   template  DELETE /api/assistant-templates/{id}    assistant_templates::delete
 *   mcp_server  user      DELETE /api/mcp/servers/{id}            mcp_servers::delete
 *   mcp_server  system    DELETE /api/mcp/system-servers/{id}     mcp_servers_admin::delete
 *
 * The user-scoped handlers are ownership-scoped on purpose:
 * `delete_user_assistant` rejects `created_by != caller` with **403
 * ACCESS_DENIED "You can only delete your own assistants"**, and
 * `delete_user_mcp_server` deletes with `AND user_id = $2 AND is_system = false`
 * so a system row yields **404**. A system-scoped install therefore can NEVER be
 * removed through the user route — no matter who clicks, admin included.
 *
 * The Installed tab's Re-install action already dispatches on
 * `is_template_install` / `is_system_mcp_install`; its Remove action did not,
 * and sent every row down the user route. That made Remove a permanently dead
 * affordance for template / system installs.
 *
 * Keeping the endpoint choice AND the permission that guards it in one table
 * means the render-time gate and the click-time dispatch can't drift apart
 * again: both read `resolveRemoveTarget(row)`.
 */
export type RemoveTargetKind =
  | 'model'
  | 'assistant'
  | 'assistant-template'
  | 'mcp-server'
  | 'mcp-server-system'

export interface RemoveTarget {
  /** Which DELETE endpoint `remove()` must call. */
  kind: RemoveTargetKind
  /**
   * The permission that endpoint is gated on server-side. The Remove control is
   * rendered only when the caller holds it — the no-403 rule (an affordance that
   * can only ever fail is a defect, CODING_GUIDELINES §13).
   */
  permission: Permissions
}

/**
 * The fixed set of permissions any row can require. The component resolves all
 * of them once (a `usePermission` call is a hook, so it cannot be made per-row
 * inside a `.map()` — the hook count would change with the row count).
 */
export const REMOVE_PERMISSIONS: readonly Permissions[] = [
  Permissions.LlmModelsDelete,
  Permissions.AssistantsDelete,
  Permissions.AssistantsTemplateDelete,
  Permissions.McpServersDelete,
  Permissions.McpServersAdminDelete,
] as const

/** The subset of `HubInstalledRow` the dispatch decision depends on. */
export type RemoveTargetRow = Pick<
  HubInstalledRow,
  'hub_category' | 'is_template_install' | 'is_system_mcp_install'
>

/**
 * Resolve a row to its Remove endpoint + required permission.
 *
 * Returns `null` when the page has no Remove endpoint for the row's category.
 * Today that covers `skill` and `workflow`: the backend tracks and returns those
 * installs, but `CATEGORY_CARDS` in `InstalledHubTab` renders only
 * model / assistant / mcp_server, so those rows never reach the DOM. Adding a
 * card for them means adding an arm here too — and `skills::manage` is missing
 * from the generated `Permissions` enum, so that has to be regenerated first.
 */
export function resolveRemoveTarget(row: RemoveTargetRow): RemoveTarget | null {
  switch (row.hub_category) {
    case 'model':
      // Models are always system-scoped; `LlmModel.delete` has no ownership
      // check, only the `llm_models::delete` permission.
      return { kind: 'model', permission: Permissions.LlmModelsDelete }
    case 'assistant':
      return row.is_template_install
        ? {
            kind: 'assistant-template',
            permission: Permissions.AssistantsTemplateDelete,
          }
        : { kind: 'assistant', permission: Permissions.AssistantsDelete }
    case 'mcp_server':
      return row.is_system_mcp_install
        ? {
            kind: 'mcp-server-system',
            permission: Permissions.McpServersAdminDelete,
          }
        : { kind: 'mcp-server', permission: Permissions.McpServersDelete }
    default:
      return null
  }
}

/**
 * Tooltip copy for the disabled Remove button shown when a row's category has no
 * Remove endpoint. (The lacking-permission case HIDES the control instead —
 * same as the template-assistant admin list, and what the backend's own
 * `HubInstalledRow.is_system` doc comment prescribes: "the frontend … suppresses
 * the Remove button".)
 */
export function removeUnsupportedReason(hubCategory: string): string {
  return `Remove isn't available for ${hubCategory} installs from this page.`
}
