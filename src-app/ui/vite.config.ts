// @ts-ignore
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { formNamesPlugin } from './plugins/vite-plugin-form-names.js'
import { removeDataTestPlugin } from './plugins/vite-plugin-remove-data-test.js'
import { inlineApiPlugin } from './plugins/vite-plugin-inline-api.js'
import { testidUniquePlugin } from './plugins/vite-plugin-testid-unique.js'
import { moduleManifestPlugin } from './plugins/vite-plugin-module-manifest.js'
import { preloadGraphPlugin } from './plugins/vite-plugin-preload-graph.js'
// @ts-ignore — self-contained JS plugins re-homed under @ziee/gallery (B4).
import { galleryCoveragePlugin } from '@ziee/gallery/vite/vite-plugin-gallery-coverage.js'
// @ts-ignore
import { galleryAliasPlugin } from '@ziee/gallery/vite/vite-plugin-gallery-alias.js'
// @ts-ignore — worktree-sentinel middleware (no-foreign-reuse, audit §7)
import { gallerySentinelPlugin } from '@ziee/gallery/vite/vite-plugin-gallery-sentinel.js'
// @ts-ignore — unified run-key: key-derived, bind-checked dev port (no fixed 1420)
import { resolveGalleryPort, pickBindablePort } from '@ziee/gallery/scripts/lib/run-key.mjs'

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig(async () => {
  const isDev = process.env.NODE_ENV !== 'production'
  const isTest = process.env.NODE_ENV === 'test'

  // PART 2 (gallery branch-coverage): when GALLERY_COVERAGE=1, instrument the
  // component/page source with babel-plugin-istanbul so the render pass exposes
  // `window.__coverage__` (per-branch hit counts). Off by every other build —
  // normal dev/build/test never pays the instrumentation cost.
  const coverage = process.env.GALLERY_COVERAGE === '1'

  // Key-derived, bind-checked dev port (audit §7: no fixed 1420). Precedence:
  // explicit VITE_DEV_PORT > per-worktree key-derived base, then forward
  // bind-search so strictPort is safe on an already-verified port. gate:ui /
  // playwright pass `--port X` on the CLI which overrides this; a bare
  // `npm run dev` gets a per-worktree port so two worktrees never collide.
  const devPortBase = resolveGalleryPort({
    env: process.env.VITE_DEV_PORT,
    cfgPort: null,
    which: 'webGallery',
  })
  const devPort = await pickBindablePort(devPortBase)
  const hmrPort = devPort + 1

  return {
    plugins: [
      // Inline generated map lookups (dev+prod, enforce:'pre'): Permissions.X →
      // literal, ApiClient.NS.method() → callAsync (the latter activates once
      // apiEndpoints.ts is split out). Keeps these maps call-site-granular so the
      // entry chunk stays flat as the API/permission surface grows.
      inlineApiPlugin({
        permissionsPath: path.resolve(__dirname, 'src/api-client/permissions.ts'),
        endpointsPath: path.resolve(__dirname, 'src/api-client/apiEndpoints.ts'),
      }),
      // Smart module loading: bake a cheap {name, shouldLoad, routePaths, deps,
      // load} manifest into the entry so the loader can gate each module body's
      // download on auth/permission/platform (vite-plugin-module-manifest.js).
      moduleManifestPlugin({
        srcDir: path.resolve(__dirname, './src'),
      }),
      // Emit the chunk dependency graph so the runtime can idle-prefetch the
      // dynamic closure of loaded chunks at LOWEST priority (see
      // src/core/preload/idleClosurePrefetch.ts).
      preloadGraphPlugin(),
      // Instrument component/page source FIRST (enforce:'pre') so branch coverage
      // maps to real source lines, before react/oxc transpiles it.
      ...(coverage ? [galleryCoveragePlugin({ srcDir: path.resolve(__dirname, 'src') })] : []),
      react(),
      tailwindcss(),
      // Serve the gallery at the pretty `/gallery` URL + keep `/dev-gallery.html`
      // working post-rename (dev/preview only).
      galleryAliasPlugin(),
      // Serve the worktree sentinel at /__worktree so gate:ui/visual/proof can
      // prove a running server belongs to THIS worktree (no-foreign-reuse).
      gallerySentinelPlugin(),
      // Detect duplicate form names
      formNamesPlugin({
        srcDir: 'src',
      }),
      // Fail the build on any duplicate data-testid literal (i18n-safe selectors)
      testidUniquePlugin({
        srcDirs: [path.resolve(__dirname, './src')],
      }),
      // Remove data-test-* attributes in production builds
      ...(isDev || isTest ? [] : [removeDataTestPlugin()]),
    ],

  // Vite options tailored for Tauri development
  clearScreen: false,
  root: 'src',

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      ignored: [
        '**/.*/**',
        '**/node_modules/**',
      ],
    },
    proxy: {
      '/api/': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000/',
        changeOrigin: true,
        // xfwd: http-proxy sets X-Forwarded-For/Port/Proto but NOT
        // X-Forwarded-Host. The backend's OAuth-authorize handler
        // derives redirect_uri from X-Forwarded-Host (the
        // user-facing origin); without it, Vite would proxy with
        // its target's HOST (the backend's internal port) and the
        // post-OAuth redirect would 404 against the backend port
        // instead of the SPA's port. We set X-Forwarded-Host
        // explicitly from the original request's Host header so
        // the backend always sees the user-facing origin.
        xfwd: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Node's IncomingMessage typing allows `host` to be
            // string | string[] | undefined (multiple Host headers
            // arrive as an array — RFC 7230 §5.4 forbids this but
            // Node still parses them). Use the first value; if it
            // somehow stringified to "a,b" the backend's URL parse
            // would fail and 500.
            const raw = req.headers.host
            const host = Array.isArray(raw) ? raw[0] : raw
            if (host) {
              proxyReq.setHeader('X-Forwarded-Host', host)
            }
          })
        },
      },
    },
    allowedHosts: true
  },

  build: {
    outDir: '../../dist/ui',
    rollupOptions: {
      output: {
        // Stable vendor chunk (Vite 8 / rolldown API: advancedChunks.groups —
        // NOT Rollup's manualChunks). Group the large, rarely-changing framework
        // libs into ONE cached `vendor-<hash>.js` so it is re-fetched only when a
        // framework version bumps, not on every app-code deploy. react + react-dom
        // + scheduler stay in the SAME group (a split React instance breaks hooks).
        // Deliberately EXCLUDES react-day-picker/date-fns (kept lazy, see
        // components/common/LazyDatePicker.tsx) and react-icons (removed).
        advancedChunks: {
          groups: [
            {
              name: 'vendor',
              test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@base-ui|@floating-ui|tslib)[\\/]/,
              priority: 1,
            },
          ],
        },
        // Name each module-boundary chunk after its module (e.g.
        // `assets/module.chat-<hash>.js`) instead of the default collision-hashed
        // `module-<hash>.js`. This makes the smart-loader's per-module network
        // requests identifiable in a prod build (the 16-smart-loading e2e tracks
        // WHICH module chunks download), and it aids prod debugging. Does not
        // affect gating: the preload-graph plugin keys off facadeModuleId, not
        // the filename.
        chunkFileNames: chunkInfo => {
          const id = chunkInfo.facadeModuleId
          const m = id && id.match(/[\\/]modules[\\/](.+?)[\\/]module\.tsx$/)
          // `.`-separated name so a module name that is a prefix of another
          // (`user` vs `user-llm-providers`) can't cross-match.
          if (m) return `assets/module.${m[1].replace(/[\\/]/g, '_')}.[hash].js`
          return 'assets/[name]-[hash].js'
        },
      },
    },
  },

  // NOTE: stripping `console.log` from prod bundles is deferred. Vite 8
  // uses Rolldown's Oxc minifier by default, which doesn't honor the
  // esbuild `pure` config. Forcing `build.minify: 'esbuild'` errors
  // out on Vite 8. The Biome `noConsole` rule (biome.json) prevents
  // NEW console.log/debug additions; pre-existing 173 calls remain in
  // the bundle as verbose noise but no security/correctness impact.
  // Follow-up: install vite-plugin-remove-console or pin Rolldown's
  // minifier options. (audit 09 B-15)

  }
})
