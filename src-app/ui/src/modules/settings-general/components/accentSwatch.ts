import type { AccentPresetDef } from '@/components/ThemeProvider/accentPresets'

/**
 * Colours for one accent-preset swatch in the Appearance picker.
 *
 * WHY this exists as a pure function: the swatch used to hardcode
 * `hsl(${def.light.primary})` + a white check, so in DARK mode every swatch
 * painted its LIGHT-mode value on a dark surface — a preview of a colour the
 * click would NOT produce. The live-ui-audit measured exactly that as
 * `palette-drift`: the `settingsgen-accent-blue` swatch rendering
 * `rgb(58, 92, 161)` (= `hsl(220 47% 43%)`, the LIGHT `--primary`) in all three
 * dark cells, while `applyAccent` would have set `hsl(216 56% 64%)`.
 *
 * `applyAccent` picks `def[isDark ? 'dark' : 'light']`; this MUST agree with it,
 * so the swatch shows what selecting it actually does.
 */
export function accentSwatchColors(
  def: AccentPresetDef,
  resolvedTheme: 'light' | 'dark',
): { background: string } {
  const variant = resolvedTheme === 'dark' ? def.dark : def.light
  return { background: `hsl(${variant.primary})` }
}
