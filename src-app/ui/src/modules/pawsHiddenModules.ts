/**
 * The paws feature-surface reduction — THE single source of truth.
 *
 * paws is a separate instance from ziee with a narrower audience, so a set of
 * inherited features is hidden from its UI. Realizes
 * `docs/design/paws-feature-surface.md`; every entry below is one row of that
 * document's item table.
 *
 * **To restore a HIDDEN feature's UI: delete its entry from the two sets below,
 * and restore the module's original `shouldLoad` predicate** (each hidden
 * `module.tsx` carries its previous predicate in a comment). No HIDDEN feature's
 * code was deleted, which is the design's INV-5 ("reversible by configuration or
 * a single predicate, not by deleting code").
 *
 * That claim is about the HIDDEN items only. The design's two `remove` rows
 * (items 12 and 13) genuinely deleted code — `assistant/pages/AssistantsSettings.tsx`
 * and `assistant/stores/templateAssistants/` are gone — so restoring the
 * assistant-templates admin surface is a `git revert`, not a list edit.
 *
 * Two honest caveats, so this header does not overstate the claim:
 *
 *  - **Server-side capabilities are a separate lever**: web search, literature,
 *    voice and programmatic tools are config keys in `server/src/core/config.rs`,
 *    not entries here. Re-enable with e.g. `web_search: { enabled: true }`.
 *  - **Semantic search (design item 3) is a DB default**, not a predicate.
 *    Restoring it is an admin settings write (`PUT /api/file-rag/admin-settings`
 *    with `semantic_enabled: true`) — and since the file-rag admin UI is itself
 *    hidden here, that is an API/DB action rather than a click.
 *
 * The hidden features' e2e suites were deleted (an explicit owner decision), so
 * restoring a feature restores it without its end-to-end coverage; recover those
 * specs from git history if you bring one back.
 *
 * ## Why a module is hidden in FOUR places and not one
 *
 * Hiding is the `shouldLoad` manifest predicate (INV-4), but the predicate alone
 * is provably not sufficient — several surfaces reach a hidden feature without
 * consulting it, and each needs this list.
 *
 * **Keep this enumeration current.** It is the audit-and-revert surface INV-4
 * and INV-5 promise; a stale count here is the "the doc claims N places" trap.
 * Consumers today (grep `isPawsHiddenModuleName` / `PAWS_HIDDEN_MODULE_NAMES`
 * for the authoritative set):
 *
 *  1. `<module>/module.tsx` — `shouldLoad: () => false`. The predicate CANNOT
 *     import this file: `vite-plugin-module-manifest.js` lifts each predicate's
 *     source verbatim into the entry chunk and hard-fails on any free identifier
 *     besides `ctx`/`Permissions`. So those literals are bound back to this list
 *     by a test instead (`pawsHiddenModules.test.ts`).
 *  2. `loader.desktop.ts` — the desktop loader eager-globs every core module and
 *     NEVER evaluates `shouldLoad`, so on desktop the blocklist is the only
 *     lever that does anything.
 *  3. `chat/extensions/index.ts` — a glob owned by the CHAT module, which
 *     registers hidden modules' composer pills, toolbar rows, panel renderers
 *     and rail steps regardless of whether the module loaded.
 *  4. `projects/core/extensions/registry.tsx` — likewise for the project
 *     "knowledge kinds", which is what puts the citations "References" entry on
 *     the project page.
 *  5. **Copy, empty states and fetches inside SURVIVING modules** that reference
 *     a hidden feature. These are unreachable by any of the levers above,
 *     because they live in modules that are not hidden: the onboarding MCP step
 *     and its hub fetch, the memory-setup step's copy, the skills empty state,
 *     the MCP user-policy admin copy, the model-capabilities tooltip, and the
 *     llm-provider download widget's hub lookup (which would otherwise trigger a
 *     lazy-store init and fire live `/api/hub/*` requests).
 *  6. `chat/core/utils/citationTokenize.ts` — chat CORE turns every bare `[n]`
 *     in an assistant message into a knowledge-base citation chip; with the KB
 *     hidden that chip is dead but still focusable and announced.
 *
 * Keys differ per consumer, which is why there are two sets: the loader and the
 * desktop blocklist match on `metadata.name`, while the two globs only ever see
 * a filesystem path. The two do NOT coincide (`file-rag/` declares `file_rag`),
 * so they are listed explicitly rather than derived from one another.
 */

/**
 * Hidden modules by `metadata.name` — the key the module loader and the desktop
 * `CORE_MODULE_BLOCKLIST` match on.
 */
export const PAWS_HIDDEN_MODULE_NAMES: ReadonlySet<string> = new Set([
  // Design item 6 — workflow.
  'workflow',
  // Design item 7 — scheduler.
  'scheduler',
  // Design item 8 — citations (also removes the project "References" entry,
  // design item 13, via the project-extension registry).
  'citations',
  // Design item 9 — knowledge base.
  'knowledge-base',
  // Design item 10 — document RAG. NOTE the underscore: the directory is
  // `file-rag/` but the module declares `file_rag`.
  'file_rag',
  // Design item 11 — hub, plus its six location-scoped sub-modules. They are
  // separate manifest entries, so hiding the parent does not hide them.
  'hub',
  'hub-installed',
  'hub-assistants',
  'hub-llm-models',
  'hub-mcp',
  'hub-skill',
  'hub-workflow',
  // Design item 4 — voice dictation (hide + disable; the server switch is
  // `voice.enabled`).
  'voice',
  // Design item 5 — programmatic tools (hide + disable; the server switch is
  // `js_tool.enabled`).
  'js-tool',
])

/**
 * Hidden modules by SOURCE DIRECTORY under `src/modules/` — the key the two
 * auto-discovery globs can match, since they see paths rather than module names.
 *
 * Only top-level module directories appear: both globs are single-segment
 * (`../../<dir>/chat-extension/extension.tsx`), so the `hub/modules/*`
 * sub-modules are unreachable through them and are covered by the name set
 * alone.
 */
export const PAWS_HIDDEN_MODULE_DIRS: ReadonlySet<string> = new Set([
  'workflow',
  'scheduler',
  'citations',
  'knowledge-base',
  'file-rag',
  'hub',
  'voice',
  'js-tool',
])

/**
 * Chat-owned extension directories (`chat/extensions/<dir>/`) that are the
 * composer-side half of a hidden feature.
 *
 * These are NOT modules and have no manifest entry — they live inside the chat
 * module and are discovered by its own `./*​/extension.tsx` glob, so no module
 * predicate can reach them. Without this list, hiding `scheduler` still leaves
 * chat offering "schedule this" (backed by the hidden module's store), and
 * hiding `voice` still leaves the composer's dictation mic.
 */
export const PAWS_HIDDEN_CHAT_EXTENSION_DIRS: ReadonlySet<string> = new Set([
  // Design item 7 — the scheduler's in-chat affordance. Its dialog imports
  // `@/modules/scheduler/stores/scheduledTasks` directly.
  'schedule',
  // Design item 4 — the composer dictation button.
  'voice',
])

/**
 * True when `name` is a module hidden on this instance.
 *
 * `hidden` is injectable so a test can prove the behaviour is driven by the LIST
 * and not by anything hard-coded at the call site — pass an empty set and every
 * consumer must admit the module again (INV-5).
 */
export function isPawsHiddenModuleName(
  name: string,
  hidden: ReadonlySet<string> = PAWS_HIDDEN_MODULE_NAMES,
): boolean {
  return hidden.has(name)
}

/**
 * True when a `src/modules/` directory belongs to a hidden module.
 */
export function isPawsHiddenModuleDir(
  dir: string,
  hidden: ReadonlySet<string> = PAWS_HIDDEN_MODULE_DIRS,
): boolean {
  return hidden.has(dir)
}

/**
 * Pull the owning directory out of an auto-discovery glob key.
 *
 * Handles both glob shapes in use:
 *   `../../knowledge-base/chat-extension/extension.tsx` → `knowledge-base`
 *   `./schedule/extension.tsx`                          → `schedule`
 *
 * Returns null when the key has no recognisable owner, and the callers treat
 * null as "keep it" — an unparseable path must never silently drop a surviving
 * extension.
 */
export function extensionOwnerDir(globKey: string): string | null {
  const segments = globKey.split('/').filter(s => s !== '' && s !== '.' && s !== '..')
  // The owner is the first real segment: `<owner>/chat-extension/extension.tsx`
  // or `<owner>/extension.tsx`.
  return segments.length >= 2 ? segments[0] : null
}

/**
 * Should an auto-discovered extension at `globKey` be registered?
 *
 * `hiddenDirs` covers sibling-module extensions (`../../<module>/…`) and
 * `hiddenChatDirs` the chat-owned ones (`./<name>/…`). Both are injectable for
 * the INV-5 test.
 */
export function shouldRegisterDiscoveredExtension(
  globKey: string,
  hiddenDirs: ReadonlySet<string> = PAWS_HIDDEN_MODULE_DIRS,
  hiddenChatDirs: ReadonlySet<string> = PAWS_HIDDEN_CHAT_EXTENSION_DIRS,
): boolean {
  const owner = extensionOwnerDir(globKey)
  if (owner === null) return true
  // A sibling-module path carries its module directory; a chat-owned path
  // carries the extension directory. The two namespaces overlap by design
  // (`voice` is both), and either match is a reason to drop it.
  const isSibling = globKey.includes('/chat-extension/')
  return isSibling ? !hiddenDirs.has(owner) : !hiddenChatDirs.has(owner)
}
