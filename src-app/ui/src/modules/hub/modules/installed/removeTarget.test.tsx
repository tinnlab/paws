import { describe, it, expect } from 'vitest'
import { Permissions } from '@/api-client/permissions'
import {
  REMOVE_PERMISSIONS,
  removeUnsupportedReason,
  resolveRemoveTarget,
  type RemoveTargetRow,
} from '@/modules/hub/modules/installed/removeTarget'

/**
 * Guards the `/hub/installed` Remove dispatch table.
 *
 * The defect it locks down: a hub install is not always user-owned. A
 * `Use as Template` install writes `assistants.created_by = NULL`, so the
 * user-scoped `DELETE /api/assistants/{id}` rejects it with 403 ACCESS_DENIED
 * for EVERY caller (`delete_user_assistant`'s `created_by != auth.user.id`
 * check), and the system MCP equivalent 404s (`delete_user_mcp_server` filters
 * `AND user_id = $2 AND is_system = false`). Routing a system-scoped row down
 * the user route is a control that can never succeed, whoever clicks it.
 *
 * The same function feeds the render-time permission gate, so a wrong arm here
 * both fires the wrong request AND checks the wrong permission.
 *
 * NOTE ON THE `.tsx` EXTENSION (no JSX in here): the workspace's other pure-
 * helper specs run under `node --test` (`npm run test:unit`), whose strip-only
 * TypeScript loader cannot load a TS `enum` — and this module's whole point is
 * mapping rows onto `Permissions` enum members. Vitest is the only runner here
 * that can, and its glob is `src/**\/*.test.tsx`. Run with
 * `npm run test:component`.
 */

const row = (over: Partial<RemoveTargetRow>): RemoveTargetRow => ({
  hub_category: 'assistant',
  is_template_install: false,
  is_system_mcp_install: false,
  ...over,
})

describe('resolveRemoveTarget', () => {
  it('routes a user-scoped assistant install to the user endpoint', () => {
    expect(
      resolveRemoveTarget(
        row({ hub_category: 'assistant', is_template_install: false }),
      ),
    ).toEqual({ kind: 'assistant', permission: Permissions.AssistantsDelete })
  })

  it('routes a TEMPLATE assistant install to the template endpoint', () => {
    expect(
      resolveRemoveTarget(
        row({ hub_category: 'assistant', is_template_install: true }),
      ),
    ).toEqual({
      kind: 'assistant-template',
      permission: Permissions.AssistantsTemplateDelete,
    })
  })

  it('routes a user-scoped MCP install to the user endpoint', () => {
    expect(
      resolveRemoveTarget(
        row({ hub_category: 'mcp_server', is_system_mcp_install: false }),
      ),
    ).toEqual({ kind: 'mcp-server', permission: Permissions.McpServersDelete })
  })

  it('routes a SYSTEM MCP install to the system endpoint', () => {
    expect(
      resolveRemoveTarget(
        row({ hub_category: 'mcp_server', is_system_mcp_install: true }),
      ),
    ).toEqual({
      kind: 'mcp-server-system',
      permission: Permissions.McpServersAdminDelete,
    })
  })

  it('routes a model install to the model endpoint whatever the scope flags say', () => {
    for (const flags of [
      { is_template_install: false, is_system_mcp_install: false },
      { is_template_install: true, is_system_mcp_install: true },
    ]) {
      expect(
        resolveRemoveTarget(row({ hub_category: 'model', ...flags })),
      ).toEqual({ kind: 'model', permission: Permissions.LlmModelsDelete })
    }
  })

  // Negative control: a category with no Remove endpoint must resolve to null
  // so the UI disables the control rather than firing a doomed request.
  it.each(['skill', 'workflow', 'something_new'])(
    'resolves the unsupported category %s to null',
    category => {
      expect(resolveRemoveTarget(row({ hub_category: category }))).toBeNull()
    },
  )

  it('never lands a template / system row on a user-scoped permission', () => {
    const systemRows: RemoveTargetRow[] = [
      row({ hub_category: 'assistant', is_template_install: true }),
      row({ hub_category: 'mcp_server', is_system_mcp_install: true }),
    ]
    for (const r of systemRows) {
      const target = resolveRemoveTarget(r)
      expect(target).not.toBeNull()
      expect([
        Permissions.AssistantsDelete,
        Permissions.McpServersDelete,
      ]).not.toContain(target!.permission)
    }
  })

  // The component resolves REMOVE_PERMISSIONS once (a `usePermission` call is a
  // hook, so it can't be made per-row). A permission reachable from the table
  // but absent from that list would evaluate as `undefined` → the control would
  // silently disappear for everyone.
  it('only yields permissions listed in REMOVE_PERMISSIONS', () => {
    for (const hub_category of [
      'model',
      'assistant',
      'mcp_server',
      'skill',
      'workflow',
    ]) {
      for (const is_template_install of [true, false]) {
        for (const is_system_mcp_install of [true, false]) {
          const target = resolveRemoveTarget({
            hub_category,
            is_template_install,
            is_system_mcp_install,
          })
          if (target) expect(REMOVE_PERMISSIONS).toContain(target.permission)
        }
      }
    }
  })
})

describe('removeUnsupportedReason', () => {
  it('names the category so the disabled control explains itself', () => {
    const reason = removeUnsupportedReason('skill')
    expect(reason).toContain('skill')
    expect(reason).toMatch(/Remove isn't available/)
  })
})
