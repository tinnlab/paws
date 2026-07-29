import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * TEST-16 — BOTH app entries install the code-split chunk recovery.
 *
 * The desktop workspace resolves `@/*` through `localOverridePlugin`, falling
 * back to the core UI tree — but `main.tsx` is one of the few files it does NOT
 * inherit: it ships its own hand-written entry. So "wired it in the web entry,
 * forgot the desktop one" is a real, precedented failure mode (the R2-3 desktop
 * -override-parity rule exists because a dropped `evaluatePermission` filter
 * once reached desktop production the same way), and it is invisible to every
 * other gate: no type error, no lint, and the web e2e passes either way.
 *
 * Reading the two entry sources is the only thing that catches it. Mirrors this
 * workspace's existing source-reading unit spec,
 * `src/index.css.auth-backdrop.test.ts`.
 */

const HERE = dirname(fileURLToPath(import.meta.url))

const ENTRIES = [
  { label: 'web (src-app/ui)', path: resolve(HERE, 'main.tsx') },
  {
    label: 'desktop (src-app/desktop/ui)',
    path: resolve(HERE, '../../desktop/ui/src/main.tsx'),
  },
]

for (const entry of ENTRIES) {
  test(`TEST-16: the ${entry.label} entry installs chunk-load recovery`, () => {
    const source = readFileSync(entry.path, 'utf8')

    assert.match(
      source,
      /import\s*\{[^}]*\binstallChunkLoadRecovery\b[^}]*\}\s*from\s*['"]@ziee\/framework\/chunk-recovery['"]/,
      `${entry.path} must import installChunkLoadRecovery from @ziee/framework/chunk-recovery`,
    )
    // Deliberately permissive about the CALL FORM (a leading `void`/`await`, any
    // indentation) so a legal refactor does not false-fail; the point is only
    // that a call exists outside the import line. Importing is not installing.
    const callSites = source
      .split('\n')
      .filter(l => !/^\s*import\b/.test(l))
      .filter(l => /(^|[^.\w])installChunkLoadRecovery\s*\(/.test(l))
    assert.ok(
      callSites.length > 0,
      `${entry.path} must CALL installChunkLoadRecovery() — importing it is not installing it`,
    )
  })
}
