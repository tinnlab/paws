import { test, expect } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
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
 */

const CONTROL_DIR = dirname(fileURLToPath(import.meta.url))
/** Vendor-specific env vars that must never appear in a skip gate. */
const VENDOR_KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY']

function controlSpecFiles(): string[] {
  return readdirSync(CONTROL_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .filter((f) => f !== 'control-spec-gating.spec.ts')
    .map((f) => join(CONTROL_DIR, f))
}

/** Lines that decide whether a spec runs. */
function gateLines(source: string): string[] {
  return source
    .split('\n')
    .filter((line) => /test\.skip\(|test\.describe\.skip\(|fixme\(/.test(line))
    .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
}

test.describe('control_mcp spec gating', () => {
  test('there is at least one control spec to guard', () => {
    expect(controlSpecFiles().length).toBeGreaterThan(0)
  })

  test('no control spec skips because one specific vendor key is absent', () => {
    for (const file of controlSpecFiles()) {
      const source = readFileSync(file, 'utf8')

      for (const line of gateLines(source)) {
        for (const key of VENDOR_KEYS) {
          expect(
            line.includes(key),
            `${file}: a skip gate must not depend on ${key}. Skip only when NO LLM is ` +
              `configured — use the shared configuredTestLlm() seam.\n  ${line.trim()}`,
          ).toBe(false)
        }
        expect(
          line.includes('process.env'),
          `${file}: a skip gate must not read process.env directly — route it through ` +
            `configuredTestLlm() so every vendor seam is honoured.\n  ${line.trim()}`,
        ).toBe(false)
      }
    }
  })

  test('every control spec gates through the shared configuredTestLlm seam', () => {
    for (const file of controlSpecFiles()) {
      const source = readFileSync(file, 'utf8')
      const gates = gateLines(source)
      if (gates.length === 0) continue // an ungated spec always runs — also fine
      expect(
        source.includes('control-llm-helpers'),
        `${file}: a gated control spec must import the shared configuredTestLlm() seam`,
      ).toBe(true)
      expect(
        gates.some((line) => line.includes('TEST_LLM')),
        `${file}: the skip gate must be driven by TEST_LLM (the resolved LLM), not by a vendor key`,
      ).toBe(true)
    }
  })
})
