import { Check } from 'lucide-react'
import { Button, Card, Select } from '@ziee/kit'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from '@ziee/kit/shadcn/field'
import type { ThemePreference } from '@/modules/config-client/configClient'
import {
  ACCENT_PRESETS,
  ACCENT_ORDER,
  type AccentPreset,
} from '@/components/ThemeProvider/accentPresets'
import { cn } from '@/lib/utils'
import { useTheme } from '@/hooks/useTheme'
import { accentSwatchColors } from '@/modules/settings-general/components/accentSwatch'
import { ConfigClient } from '@/modules/config-client/configClient'

export function ThemeSettings() {
  const { themePreference, accentPreset } = ConfigClient
  // The RESOLVED theme (`system` already collapsed to light/dark) — the swatch
  // must preview the variant `applyAccent` would actually install.
  const { resolvedTheme } = useTheme()

  const handleChange = (value: string) => {
    ConfigClient.setThemePreference(value as ThemePreference)
  }

  return (
    <Card title="Appearance" data-testid="settingsgen-appearance-card">
      {/* Instant-apply settings (no form state) → the shadcn Field row API:
          label + description on the left, the control on the right. FieldGroup
          supplies the uniform inter-row gap. */}
      <FieldGroup>
        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>Theme</FieldTitle>
            <FieldDescription>
              Choose your preferred theme or match the OS theme.
            </FieldDescription>
          </FieldContent>
          <Select
            data-testid="settingsgen-theme-select"
            aria-label="Theme"
            className="min-w-[120px]"
            value={themePreference}
            onChange={handleChange}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ]}
          />
        </Field>

        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>Accent color</FieldTitle>
            <FieldDescription>
              Used for buttons, links, focus rings, and selected items.
            </FieldDescription>
          </FieldContent>
          <div
            className="flex flex-wrap gap-2 items-center justify-end"
            data-testid="settingsgen-accent-picker"
          >
            {ACCENT_ORDER.map(id => {
              const def = ACCENT_PRESETS[id as AccentPreset]
              const selected = accentPreset === id
              const swatch = accentSwatchColors(def, resolvedTheme)
              return (
                <Button
                  key={id}
                  size="icon"
                  variant="ghost"
                  aria-label={`${def.label} accent`}
                  // The active preset is signalled visually by the check +
                  // ring; expose it to assistive tech too, or a screen-reader
                  // user hears nine identical "X accent" buttons.
                  aria-pressed={selected}
                  data-testid={`settingsgen-accent-${id}`}
                  onClick={() =>
                    ConfigClient.setAccentPreset(id as AccentPreset)
                  }
                  // genuinely-dynamic: the swatch shows the preset's own color,
                  // in the CURRENTLY RESOLVED theme (see accentSwatchColors).
                  data-allow-custom-color
                  style={{ backgroundColor: swatch.background }}
                  className={cn(
                    // inline bg wins over ghost's hover bg, so signal hover via scale instead.
                    'size-7 rounded-full border border-border/40 transition-transform hover:scale-110',
                    selected &&
                      'ring-2 ring-offset-2 ring-offset-background ring-foreground',
                  )}
                >
                  {selected && (
                    // The check only renders on the ACTIVE preset, and
                    // `applyAccent` sets `--primary-foreground` to exactly that
                    // preset's `fg` — so the semantic token IS the right colour
                    // here, no inline colour and no lint escape needed. (A
                    // fixed `text-white` was wrong: the dark variants are LIGHT
                    // fills whose readable check is near-black.)
                    <Check className="size-4 text-primary-foreground" aria-hidden />
                  )}
                </Button>
              )
            })}
          </div>
        </Field>
      </FieldGroup>
    </Card>
  )
}
