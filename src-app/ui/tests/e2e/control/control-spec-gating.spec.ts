import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * TEST-12 — the guard that keeps this whole surface from going dark again.
 *
 * The control-MCP e2e specs were gated on `ANTHROPIC_API_KEY`. On every box
 * wired to a local OpenAI-compatible bridge that key is unset, so the specs
 * reported SKIPPED and the "LLM mutates the app's own state" surface was never
 * verified — which is how a `list_capabilities` search that returns 0 results
 * for any two-word query reached production.
 *
 * The rule: a control spec may skip only when NO LLM is configured at all, never
 * because one particular vendor's key is absent. That rule lives in the shared
 * `configuredTestLlm()` seam. This test pins it, because a rule that is only
 * written in a comment is a rule that gets edited away.
 *
 * It is deliberately environment-independent (no server, no LLM) so it ALWAYS
 * runs — a guard that can itself be skipped would be self-defeating.
 *
 * The checks below are deliberately WHOLE-FILE, not line-scoped. A line-scoped
 * check (only inspecting lines containing `test.skip(`) is defeated by a
 * prettier line-wrap or by hoisting the read into a `const` on the line above —
 * exactly the shape the pre-fix spec used.
 */

const CONTROL_DIR = dirname(fileURLToPath(import.meta.url))
const SELF = 'control-spec-gating.spec.ts'
/** Vendor-specific env vars that must never decide whether a control spec runs. */
const VENDOR_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY']

/** Every `*.spec.ts` under the control e2e tree, recursively (this file excluded). */
function controlSpecFiles(dir: string = CONTROL_DIR): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...controlSpecFiles(full))
    } else if (entry.endsWith('.spec.ts') && entry !== SELF) {
      out.push(full)
    }
  }
  return out
}

/** Source with block/line comments stripped, so a doc comment can mention a key. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

test.describe('control_mcp spec gating', () => {
  test('there is at least one control spec to guard', () => {
    expect(controlSpecFiles().length).toBeGreaterThan(0)
  })

  test('no control spec reads a vendor-specific API key at all', () => {
    for (const file of controlSpecFiles()) {
      const src = code(readFileSync(file, 'utf8'))
      for (const key of VENDOR_KEYS) {
        expect(
          src.includes(key),
          `${file}: must not reference ${key}. A control spec may skip only when NO LLM ` +
            `is configured — route the decision through the shared configuredTestLlm() seam.`,
        ).toBe(false)
      }
    }
  })

  test('no control spec reads process.env directly', () => {
    // Whole-file, so a multi-line or hoisted `const HAS_X = process.env.…` is
    // caught just as well as an inline gate.
    for (const file of controlSpecFiles()) {
      const src = code(readFileSync(file, 'utf8'))
      expect(
        src.includes('process.env'),
        `${file}: must not read process.env — every environment decision belongs in ` +
          `configuredTestLlm(), which honours ALL vendor seams rather than one.`,
      ).toBe(false)
    }
  })

  test('every control spec that can skip gates on the resolved LLM', () => {
    for (const file of controlSpecFiles()) {
      const src = code(readFileSync(file, 'utf8'))
      const skips = [...src.matchAll(/test(?:\.describe)?\.skip\(/g)]
      if (skips.length === 0) continue // an always-running spec is fine
      expect(
        src.includes('control-llm-helpers'),
        `${file}: a gated control spec must import the shared configuredTestLlm() seam`,
      ).toBe(true)
      expect(
        src.includes('TEST_LLM'),
        `${file}: the skip decision must come from TEST_LLM (the resolved LLM), not a vendor key`,
      ).toBe(true)
    }
  })

  test('the shared seam honours every vendor the harness supports', () => {
    // A seam that resolves fewer vendors than `provider-helpers.ts` supports
    // sends a Gemini/Groq box dark again — the same class of failure, narrower.
    const seam = readFileSync(join(CONTROL_DIR, 'helpers', 'control-llm-helpers.ts'), 'utf8')
    for (const key of VENDOR_KEYS) {
      expect(
        seam.includes(key),
        `control-llm-helpers.ts must be able to resolve ${key}; otherwise a box configured ` +
          `with only that vendor skips while claiming "no LLM configured at all"`,
      ).toBe(true)
    }
  })
})
