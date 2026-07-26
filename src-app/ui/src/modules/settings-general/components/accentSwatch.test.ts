import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { accentSwatchColors } from '@/modules/settings-general/components/accentSwatch'
import type { AccentPresetDef } from '@/components/ThemeProvider/accentPresets'

/**
 * The shipped `ACCENT_PRESETS` live in the `@ziee/shell` workspace package,
 * which the node test loader cannot resolve, so the presets under test are
 * mirrored here VERBATIM from `sdk/packages/shell/src/theme/accentPresets.ts`.
 * The blue values are the exact ones the audit measured
 * (`hsl(220 47% 43%)` = `rgb(58, 92, 161)`).
 */
const ACCENT_PRESETS: Record<string, AccentPresetDef> = {
  blue: {
    label: 'Blue',
    light: { primary: '220 47% 43%', fg: '0 0% 100%' },
    dark: { primary: '216 56% 64%', fg: '222 47% 11%' },
  },
  teal: {
    label: 'Teal',
    light: { primary: '188 62% 30%', fg: '0 0% 100%' },
    dark: { primary: '186 52% 58%', fg: '195 60% 9%' },
  },
  rose: {
    label: 'Rose',
    light: { primary: '345 55% 46%', fg: '0 0% 100%' },
    dark: { primary: '344 70% 68%', fg: '345 50% 12%' },
  },
}

/**
 * Guards ITEM-6: the Appearance accent swatch must preview the variant that
 * selecting it would actually install. The live-ui-audit measured the bug as
 * `palette-drift` — `settingsgen-accent-blue` painting `rgb(58, 92, 161)`
 * (`hsl(220 47% 43%)`, the LIGHT `--primary`) while in dark mode.
 */

/**
 * DRIFT GUARD for the mirror above: assert every mirrored channel string is
 * literally present in the shipped presets file. Without this the mirror could
 * silently diverge from the source and the tests below would validate fiction.
 */
test('the mirrored presets still match the shipped accentPresets source', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const shipped = readFileSync(
    path.resolve(here, '../../../../../../sdk/packages/shell/src/theme/accentPresets.ts'),
    'utf8',
  )
  for (const [id, def] of Object.entries(ACCENT_PRESETS)) {
    for (const channels of [def.light.primary, def.light.fg, def.dark.primary, def.dark.fg]) {
      assert.ok(
        shipped.includes(`'${channels}'`),
        `${id}: "${channels}" is no longer in sdk/packages/shell/src/theme/accentPresets.ts — the mirror has drifted`,
      )
    }
  }
})

test('the swatch uses the LIGHT variant in light mode', () => {
  const blue = ACCENT_PRESETS.blue
  const { background } = accentSwatchColors(blue, 'light')
  assert.equal(background, `hsl(${blue.light.primary})`)
})

test('the swatch uses the DARK variant in dark mode (the measured drift)', () => {
  const blue = ACCENT_PRESETS.blue
  const { background } = accentSwatchColors(blue, 'dark')
  assert.equal(background, `hsl(${blue.dark.primary})`)
  // The exact regression: the old code returned the light value here.
  assert.notEqual(background, `hsl(${blue.light.primary})`)
  assert.equal(blue.light.primary, '220 47% 43%', 'the audit measured rgb(58,92,161) = this')
})

test('every preset differs between themes, so the theme choice is never cosmetic', () => {
  for (const [id, def] of Object.entries(ACCENT_PRESETS)) {
    const light = accentSwatchColors(def, 'light')
    const dark = accentSwatchColors(def, 'dark')
    assert.notEqual(light.background, dark.background, `${id} must differ per theme`)
  }
})
