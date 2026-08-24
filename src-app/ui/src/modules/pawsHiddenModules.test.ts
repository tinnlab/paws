/**
 * The paws feature-surface reduction — acceptance tests for INV-4 and INV-5.
 *
 * TEST-1 [acceptance] [invariant: INV-4] — hiding IS the `shouldLoad` manifest
 * predicate, applied uniformly.
 * TEST-5 [acceptance] [invariant: INV-5] — the reduction is reversible by
 * editing ONE list, not by restoring deleted code.
 *
 * TEST-1 runs the BUILD's own extractor (`extractModule` from
 * vite-plugin-module-manifest.js) over the real `module.tsx` files and then
 * EVALUATES the predicate it lifted. That matters: asserting on the source text
 * would only prove the file says what I wrote, whereas evaluating the lifted
 * function proves the thing the loader will actually call returns false. It is
 * also the same extractor the build uses, so a change to the lifting rules fails
 * here rather than at `vite build`.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

// @ts-expect-error — plain JS build plugin, no types
import { extractModule } from '../../plugins/vite-plugin-module-manifest.js'
import {
  PAWS_HIDDEN_CHAT_EXTENSION_DIRS,
  PAWS_HIDDEN_MODULE_DIRS,
  PAWS_HIDDEN_MODULE_NAMES,
  extensionOwnerDir,
  isPawsHiddenModuleDir,
  isPawsHiddenModuleName,
  shouldRegisterDiscoveredExtension,
} from './pawsHiddenModules.ts'

const MODULES_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Every `module.tsx` a hidden name maps to, by its real path on disk. */
const HIDDEN_MODULE_FILES: Record<string, string> = {
  workflow: 'workflow/module.tsx',
  scheduler: 'scheduler/module.tsx',
  citations: 'citations/module.tsx',
  'knowledge-base': 'knowledge-base/module.tsx',
  file_rag: 'file-rag/module.tsx',
  hub: 'hub/module.tsx',
  'hub-installed': 'hub/modules/installed/module.tsx',
  'hub-assistants': 'hub/modules/assistants/module.tsx',
  'hub-llm-models': 'hub/modules/llm-models/module.tsx',
  'hub-mcp': 'hub/modules/mcp/module.tsx',
  'hub-skill': 'hub/modules/skill/module.tsx',
  'hub-workflow': 'hub/modules/workflow/module.tsx',
  voice: 'voice/module.tsx',
  'js-tool': 'js-tool/module.tsx',
}

/** A context in which EVERY other predicate in the tree would pass. */
const ALL_ACCESS_CTX = {
  isAuthenticated: true,
  needsSetup: false,
  path: '/hub/models',
  permissions: ['*'],
  platform: 'web' as const,
  can: () => true,
}

function liftPredicate(relPath: string): (ctx: unknown) => boolean {
  const abs = join(MODULES_DIR, relPath)
  const extracted = extractModule(abs, readFileSync(abs, 'utf8'))
  assert.ok(extracted, `${relPath}: not a createModule default export`)
  assert.ok(
    extracted.shouldLoadSrc,
    `${relPath}: declares no shouldLoad — a CORE module is ALWAYS loaded, so it ` +
      `cannot be hidden by the predicate at all`,
  )
  // eslint-disable-next-line no-new-func
  return new Function('Permissions', `return (${extracted.shouldLoadSrc})`)(
    new Proxy({}, { get: () => 'perm' }),
  )
}

// ── TEST-1 [acceptance] [invariant: INV-4] ──────────────────────────────────

test('TEST-1: every hidden module’s lifted shouldLoad evaluates false', () => {
  assert.equal(
    Object.keys(HIDDEN_MODULE_FILES).length,
    PAWS_HIDDEN_MODULE_NAMES.size,
    'the hidden list and this test’s file map have diverged — a module was ' +
      'added to PAWS_HIDDEN_MODULE_NAMES without a module.tsx to prove it hides',
  )

  for (const [name, relPath] of Object.entries(HIDDEN_MODULE_FILES)) {
    assert.ok(
      PAWS_HIDDEN_MODULE_NAMES.has(name),
      `${name} is not in PAWS_HIDDEN_MODULE_NAMES`,
    )
    const predicate = liftPredicate(relPath)
    assert.equal(
      predicate(ALL_ACCESS_CTX),
      false,
      `${relPath}: shouldLoad must return false even for a fully-permissioned ` +
        `admin on the module’s own route`,
    )
  }
})

test('TEST-1: a surviving module’s predicate still passes', () => {
  // The control. Without it, a broken extractor returning a falsy predicate for
  // everything would make the test above pass while proving nothing.
  assert.equal(liftPredicate('chat/module.tsx')(ALL_ACCESS_CTX), true)
  assert.equal(liftPredicate('projects/module.tsx')(ALL_ACCESS_CTX), true)
})

test('TEST-1: hidden dirs and names stay in step', () => {
  // The two projections exist because dirs and metadata names diverge
  // (`file-rag/` declares `file_rag`). Every DIR must still map to a hidden
  // module file, or the glob filters are keyed on something the list doesn’t
  // cover.
  for (const dir of PAWS_HIDDEN_MODULE_DIRS) {
    const owned = Object.values(HIDDEN_MODULE_FILES).some(p => p.startsWith(`${dir}/`))
    assert.ok(owned, `hidden dir "${dir}" matches no hidden module.tsx`)
  }
})

// ── TEST-5 [acceptance] [invariant: INV-5] ──────────────────────────────────

test('TEST-5: emptying the one list re-admits a hidden module everywhere', () => {
  const EMPTY: ReadonlySet<string> = new Set()

  // Consumer 1 — the desktop blocklist predicate.
  assert.equal(isPawsHiddenModuleName('workflow'), true)
  assert.equal(isPawsHiddenModuleName('workflow', EMPTY), false)

  // Consumer 2 — the chat-extension discovery filter (sibling-module glob).
  const chatKey = '../../knowledge-base/chat-extension/extension.tsx'
  assert.equal(shouldRegisterDiscoveredExtension(chatKey), false)
  assert.equal(shouldRegisterDiscoveredExtension(chatKey, EMPTY, EMPTY), true)

  // Consumer 3 — the chat-OWNED extension dirs (no module, no predicate).
  const inChatKey = './schedule/extension.tsx'
  assert.equal(shouldRegisterDiscoveredExtension(inChatKey), false)
  assert.equal(shouldRegisterDiscoveredExtension(inChatKey, EMPTY, EMPTY), true)

  // Consumer 4 — the dir predicate the project registry shares.
  assert.equal(isPawsHiddenModuleDir('citations'), true)
  assert.equal(isPawsHiddenModuleDir('citations', EMPTY), false)
})

test('TEST-5: surviving extensions are never dropped', () => {
  // web-search and literature are DISABLE-ONLY rows in the design's item table
  // (1 and 2) — their UI modules and chat extensions stay. If this ever flips,
  // the reduction has quietly exceeded the design.
  for (const key of [
    '../../web-search/chat-extension/extension.tsx',
    '../../literature/chat-extension/extension.tsx',
    '../../file/chat-extension/extension.tsx',
    '../../mcp/chat-extension/extension.tsx',
    './text/extension.tsx',
    './export/extension.tsx',
  ]) {
    assert.equal(shouldRegisterDiscoveredExtension(key), true, `${key} must survive`)
  }
})

test('TEST-5: an unparseable glob key keeps the extension', () => {
  // Fail OPEN on a path shape we don't recognise: silently dropping a surviving
  // extension is far worse than failing to drop a hidden one, which the module
  // predicate and the desktop blocklist would still catch.
  assert.equal(extensionOwnerDir('extension.tsx'), null)
  assert.equal(shouldRegisterDiscoveredExtension('extension.tsx'), true)
})

test('TEST-5: the two chat-owned dirs are the composer half of hidden features', () => {
  // `voice` appears in BOTH namespaces (a module dir and a chat-extension dir);
  // `schedule` only in the chat one — it has no module of its own, which is
  // exactly why the module predicate cannot reach it.
  assert.ok(PAWS_HIDDEN_CHAT_EXTENSION_DIRS.has('schedule'))
  assert.ok(PAWS_HIDDEN_CHAT_EXTENSION_DIRS.has('voice'))
  assert.equal(PAWS_HIDDEN_MODULE_DIRS.has('schedule'), false)
})
