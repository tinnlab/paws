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
import { PAWS_HIDDEN_MODULE_NAMES } from '@/modules/pawsHiddenModules'

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

  // TEST-7 (paws-feature-surface).
  //
  // This is the lever that actually hides features on DESKTOP. `loadModules()`
  // in loader.desktop.ts eager-globs every core module.tsx and never evaluates
  // `shouldLoad`, so a module's `shouldLoad: () => false` does nothing here —
  // if the blocklist misses a name, that feature ships visible in the desktop
  // app while the web build hides it.
  it('blocklists every paws-hidden module', () => {
    for (const name of PAWS_HIDDEN_MODULE_NAMES) {
      expect(isBlocklisted(name), `${name} must be blocked on desktop`).toBe(true)
    }
    // Non-empty, so the loop above can't pass vacuously.
    expect(PAWS_HIDDEN_MODULE_NAMES.size).toBeGreaterThan(0)
  })

  it('keeps the modules the reduction must NOT touch', () => {
    // The design hides features; it must not take out the app around them.
    // `assistants` is explicitly called out as core (design item 12 removes the
    // template surface only).
    //
    // web-search and literature are deliberately NOT in this list any more. The
    // design table calls them `disable`, and they were first read as "server
    // switch only, UI stays"; the owner corrected that — a disabled capability
    // must not leave a configurable menu entry behind — so both are now hidden
    // modules and are asserted by the loop above instead.
    const survivors = [
      'chat',
      'projects',
      'assistants',
      'settings',
      'onboarding',
      'mcp',
      'file',
      'notification',
    ]
    for (const name of survivors) {
      expect(isBlocklisted(name), `${name} must survive the reduction`).toBe(false)
    }

    const mods = [
      ...survivors.map((name) => ({ metadata: { name } })),
      ...[...PAWS_HIDDEN_MODULE_NAMES].map((name) => ({ metadata: { name } })),
    ]
    expect(applyBlocklist(mods).map((m) => m.metadata.name)).toEqual(survivors)
  })
})
