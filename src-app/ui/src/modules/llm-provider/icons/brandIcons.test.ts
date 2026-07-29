import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// TEST-4 (ITEM-2) — the 4 provider brand logos that replaced react-icons
// (OpenAI/Anthropic/Gemini/HuggingFace) are custom inline-SVG components that
// MUST match the DeepSeek/Mistral sibling contract, so the swap is visual/API
// parity and not a regression. Brand SVGs are `.tsx` (JSX can't be imported
// under `node --test`), so this is a source-contract test; the live render is
// asserted by the e2e (TEST-2) on the LLM-provider surface.

const BRANDS = ['OpenAI', 'Anthropic', 'Gemini', 'HuggingFace'] as const

function src(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./${name}.tsx`, import.meta.url)),
    'utf8',
  )
}

for (const name of BRANDS) {
  test(`${name} brand icon matches the DeepSeek/Mistral custom-SVG contract`, () => {
    const s = src(name)
    // memo<IconProps> component with the shared size/style/...rest API
    assert.match(s, /memo<IconProps>/, `${name}: must be a memo<IconProps>`)
    assert.match(s, /size = '1em'/, `${name}: size defaults to 1em (font-scaled)`)
    assert.match(s, /\.\.\.rest/, `${name}: must forward ...rest onto the svg`)
    // renders an actual SVG glyph, not an empty placeholder
    assert.match(s, /<svg/, `${name}: renders an <svg>`)
    assert.match(s, /fill="currentColor"/, `${name}: inherits color via currentColor`)
    assert.match(s, /viewBox=/, `${name}: has a viewBox`)
    // a non-empty path (the actual glyph geometry) — parity with react-icons
    assert.match(s, /<path d="[^"]{40,}"/, `${name}: has a non-empty <path>`)
    assert.match(s, /<title>/, `${name}: has an accessible <title>`)
    assert.match(
      s,
      new RegExp(`${name}\\.displayName = '${name}'`),
      `${name}: sets displayName`,
    )
  })
}

test('icons/index.ts re-exports all four brand icons next to DeepSeek/Mistral', () => {
  const barrel = readFileSync(
    fileURLToPath(new URL('./index.ts', import.meta.url)),
    'utf8',
  )
  for (const name of BRANDS) {
    assert.match(
      barrel,
      new RegExp(`export \\{ ${name} \\} from './${name}'`),
      `index.ts must re-export ${name}`,
    )
  }
})
