import { ApiClient } from '@/api-client'
import type { RuntimeEngine, RuntimeUpdateCheck } from '../../../types'
import type { RuntimeUpdateGet, RuntimeUpdateSet } from '../state'
import { RuntimeVersion } from '@/modules/llm-local-runtime/stores/runtimeVersion'

export default (set: RuntimeUpdateSet, _get: RuntimeUpdateGet) =>
  async (engine: RuntimeEngine): Promise<RuntimeUpdateCheck> => {
    set(s => {
      s.checking = new Map(s.checking).set(engine, true)
      s.error = null
    })
    try {
      const response = await ApiClient.RuntimeVersion.checkUpdates({ engine })
      // Get current default version for this engine.
      //
      // `.$` — the SOLE hook-free snapshot escape — not the reactive proxy.
      // A bare `RuntimeVersion.versions` read IS a hook, and this is an async
      // action, not a render: React throws #321 ("invalid hook call"), the
      // catch below swallows it into `s.error`, `updateChecks` is never set,
      // and the card renders "Couldn't load available versions — couldn't
      // reach the upstream release feed" over a catalogue the server returned
      // perfectly. That message blamed GitHub for a client-side bug; the real
      // reason was only visible behind the collapsed "Details" disclosure.
      const currentVersion = RuntimeVersion.$.versions.find(
        v => v.engine === engine && v.is_system_default,
      ) || null
      // Releases come newest-first. The "latest" we can actually install is the
      // newest one whose binary is published for this host.
      const versions = response.versions
      const latestVersion =
        versions.find(v => v.binary_ready)?.version || versions[0]?.version || ''
      // An update is available when there's a ready (built) version not yet
      // installed. Build-pending tags don't count.
      const hasUpdates = versions.some(v => v.binary_ready && !v.installed)
      const updateCheck: RuntimeUpdateCheck = {
        engine: response.engine,
        platform: response.platform,
        arch: response.arch,
        versions,
        // Provenance rides the 200 so the card can distinguish "upstream has
        // no versions" from "we couldn't reach upstream" — the server no
        // longer 500s on an unreachable feed, which used to discard a
        // perfectly good cached catalogue.
        source: (response.source ?? 'live') as RuntimeUpdateCheck['source'],
        checked_at: response.checked_at,
        unavailable_reason: response.unavailable_reason,
        // Credential health rides the same 200 as the catalogue provenance.
        // Defaulted defensively so an older/partial payload reads as "no
        // token configured" rather than crashing the card.
        credential_status: (response.credential_status ??
          'absent') as RuntimeUpdateCheck['credential_status'],
        current_version: currentVersion?.version,
        latest_version: latestVersion,
        has_updates: hasUpdates,
      }
      set(s => {
        const newChecking = new Map(s.checking)
        newChecking.delete(engine)
        const newUpdateChecks = new Map(s.updateChecks)
        newUpdateChecks.set(engine, updateCheck)
        s.checking = newChecking
        s.updateChecks = newUpdateChecks
      })
      return updateCheck
    } catch (error) {
      set(s => {
        const newChecking = new Map(s.checking)
        newChecking.delete(engine)
        s.checking = newChecking
        s.error =
          error instanceof Error ? error.message : 'Failed to check updates'
      })
      throw error
    }
  }
