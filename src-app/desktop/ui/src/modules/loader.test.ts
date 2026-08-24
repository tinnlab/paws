/**
 * Guards the desktop bundle's core-module blocklist.
 *
 * `server-update` MUST stay blocklisted: the desktop has its own auto-updater
 * (tauri-plugin-updater) and its own /settings/about page, so loading the web
 * server-update module would surface a duplicate update banner + collide on the
 * route. See modules/updater/* and backend/mod.rs (update_check force-off).
 */

import { describe, expect, it } from 'vitest'
import { CORE_MODULE_BLOCKLIST, isBlocklisted, applyBlocklist } from '@/modules/loader.desktop'

describe('desktop CORE_MODULE_BLOCKLIST', () => {
  it('blocklists the web server-update + user-profile modules', () => {
    expect(CORE_MODULE_BLOCKLIST.has('server-update')).toBe(true)
    expect(isBlocklisted('server-update')).toBe(true)
    expect(isBlocklisted('user-profile')).toBe(true)
  })

  /**
   * TEST-20 (covers ITEM-12) — desktop parity for the default-model step.
   *
   * The desktop bundle has NO `modules/onboarding` of its own: it loads the web
   * onboarding module, so the new "Local Model" step reaches desktop users only
   * as long as `onboarding` stays off the blocklist. A desktop user is in fact
   * the likeliest person to want a local model with no API key, so silently
   * dropping the module would defeat the feature on its best-fit platform.
   *
   * This is the assertable half of R2-3 (no desktop override drops logic from a
   * changed web surface); the other half — that no `.desktop.tsx` fork of the
   * step exists — is enforced by `check:override-registry` in the desktop
   * workspace's own `npm run check`.
   */
  it('does NOT blocklist onboarding, so desktop gets the default-model step', () => {
    expect(CORE_MODULE_BLOCKLIST.has('onboarding')).toBe(false)
    expect(isBlocklisted('onboarding')).toBe(false)
    const kept = applyBlocklist([
      { metadata: { name: 'onboarding' } },
      { metadata: { name: 'server-update' } },
    ]).map((m) => m.metadata.name)
    expect(kept).toEqual(['onboarding'])
  })

  it('applyBlocklist actually drops server-update from a module list', () => {
    const mods = [
      { metadata: { name: 'server-update' } },
      { metadata: { name: 'chat' } },
      { metadata: { name: 'user-profile' } },
      { metadata: { name: 'settings' } },
    ]
    const kept = applyBlocklist(mods).map((m) => m.metadata.name)
    expect(kept).toEqual(['chat', 'settings'])
    expect(kept).not.toContain('server-update')
  })
})
