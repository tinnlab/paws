import { pathToFileURL } from 'node:url'
import { existsSync, statSync } from 'node:fs'
import { dirname, resolve as presolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = presolve(HERE, '../src') + '/'
const SDK_SRC = presolve(HERE, '../../../sdk/packages') + '/'
const STUBS = {
  '@/core/module-system': SRC + 'core/__test-stubs__/module-system.ts',
  '@/core/events': SRC + 'core/__test-stubs__/events.ts',
  // The permissions BARREL re-exports `Can.tsx` (JSX), which node's
  // type-stripping runtime cannot parse — any spec that transitively imports it
  // dies before a single assertion. Concrete `.ts` members
  // (`permissions/authView.ts`, `permissions/evaluatePermission.ts`) still
  // resolve normally.
  '@ziee/framework/permissions':
    SDK_SRC + 'framework/src/__test-stubs__/permissions.ts',
}
// `@ziee/<pkg>/<subpath>` → `sdk/packages/<pkg>/src/<subpath>`. The workspace
// packages publish an EXTENSIONLESS export map (`"./*": "./src/*"`), which Vite
// resolves but node's ESM resolver cannot, so a unit spec importing a framework
// module (directly, or transitively through the app module under test) fails
// with ERR_MODULE_NOT_FOUND. Same probe order as the `@/` branch below.
const SDK = SDK_SRC
const isFile = p => existsSync(p) && statSync(p).isFile()
const probe = base => {
  for (const c of [base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx', base]) {
    if (isFile(c)) return { url: pathToFileURL(c).href, shortCircuit: true }
  }
  return null
}
export async function resolve(spec, ctx, next) {
  if (STUBS[spec]) return { url: pathToFileURL(STUBS[spec]).href, shortCircuit: true }
  if (spec.startsWith('@/')) {
    const hit = probe(SRC + spec.slice(2))
    if (hit) return hit
  }
  if (spec.startsWith('@ziee/')) {
    const [pkg, ...rest] = spec.slice('@ziee/'.length).split('/')
    const hit = probe(`${SDK}${pkg}/src/${rest.join('/') || 'index'}`)
    if (hit) return hit
  }
  // Extensionless RELATIVE specifiers INSIDE the sdk packages (`./x`, `../y/z`).
  // The sdk sources are written for Vite, which fills in `.ts` / `/index.ts`;
  // node's ESM resolver does not, so a spec that reaches an sdk module through
  // one of those hops dies with ERR_MODULE_NOT_FOUND before any assertion runs.
  //
  // Deliberately scoped to the SDK tree: the app tree (`src-app/ui/src`) resolves
  // exactly as it did before, so no existing app spec's behaviour — including its
  // failure signature — changes.
  if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL?.startsWith('file:')) {
    const parentFile = fileURLToPath(ctx.parentURL)
    if (parentFile.startsWith(SDK_SRC)) {
      const hit = probe(presolve(dirname(parentFile), spec))
      if (hit) return hit
    }
  }
  return next(spec, ctx)
}
