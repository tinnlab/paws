import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { formNamesPlugin } from './plugins/vite-plugin-form-names.js'
import { removeDataTestPlugin } from './plugins/vite-plugin-remove-data-test.js'
import { localOverridePlugin } from './plugins/vite-plugin-local-override.js'
import { testidUniquePlugin } from './plugins/vite-plugin-testid-unique.js'
import { galleryAliasPlugin } from './plugins/vite-plugin-gallery-alias.js'
// @ts-ignore — worktree-sentinel + unified run-key (audit §7; no fixed 1420/1455)
import { gallerySentinelPlugin } from '@ziee/gallery/vite/vite-plugin-gallery-sentinel.js'
// @ts-ignore
import { resolveGalleryPort, pickBindablePort } from '@ziee/gallery/scripts/lib/run-key.mjs'

const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig(async () => {
  const isDev = process.env.NODE_ENV !== 'production'
  const isTest = process.env.NODE_ENV === 'test'

  // Key-derived, bind-checked desktop dev port (disjoint from the web workspace's
  // range so a web + desktop dev/gate run in the same worktree never collide).
  const devPortBase = resolveGalleryPort({
    env: process.env.VITE_DEV_PORT,
    cfgPort: null,
    which: 'desktopGallery',
  })
  const devPort = await pickBindablePort(devPortBase)
  const hmrPort = devPort + 1

  return {
    plugins: [
      // Must be first to intercept @ imports before alias resolution
      localOverridePlugin({
        localSrc: path.resolve(__dirname, './src'),
        fallbackSrc: path.resolve(__dirname, '../../ui/src'),
        aliasPrefix: '@/',
      }),
      react(),
      tailwindcss(),
      // Serve the gallery at the pretty `/gallery` URL + keep `/dev-gallery.html`
      // working post-rename (dev/preview only).
      galleryAliasPlugin(),
      // Worktree sentinel at /__worktree (no-foreign-reuse, audit §7).
      gallerySentinelPlugin(),
      // Detect duplicate form names
      formNamesPlugin({
        srcDir: 'src',
      }),
      // Fail the build on any duplicate data-testid literal. Desktop renders
      // BOTH trees (core-ui fallback via localOverridePlugin), so scan both —
      // core first (lowest priority), desktop last (an override shadows core).
      testidUniquePlugin({
        srcDirs: [
          path.resolve(__dirname, '../../ui/src'),
          path.resolve(__dirname, './src'),
        ],
      }),
      // Remove data-test-* attributes in production builds
      ...(isDev || isTest ? [] : [removeDataTestPlugin()]),
    ],

    // Vite options tailored for Tauri development
    clearScreen: false,
    root: 'src',

    resolve: {
      alias: {
        // @/ imports are handled by localOverridePlugin (checks desktop/src first, falls back to core UI)
        // DO NOT add '@' alias here - it would bypass the plugin
        '@ziee/desktop': path.resolve(__dirname, './src'),
        // Resolve @ziee/ui-core to core UI source files
        '@ziee/ui-core': path.resolve(__dirname, '../../ui/src'),
      },
      // With npm workspaces, shared deps hoist to the root node_modules
      // and dedupe ensures only one copy ends up in the final bundle.
      // The list mirrors `src-app/desktop/ui/package.json` runtime deps
      // that are also imported from `src-app/ui/src/` (since the
      // localOverridePlugin falls back into core source).
      dedupe: [
        'react',
        'react-dom',
        'react-router-dom',
        'zustand',
        'antd',
        '@ant-design/icons',
        'i18next',
        'react-i18next',
        'react-use',
        'dayjs',
        'immer',
        'tinycolor2',
        'overlayscrollbars',
        'overlayscrollbars-react',
        'streamdown',
        'mermaid',
      ],
    },

    // Per-worktree key-derived port (bind-verified above) instead of a fixed
    // 1420; gate:ui / playwright pass `--port` on the CLI to override.
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
        // Tell vite to ignore watching `src-tauri`
        ignored: ['**/src-tauri/**', '**/.*/**', '**/node_modules/**'],
      },
      // Proxy API requests to backend (for development without Tauri)
      allowedHosts: true,
    },

    build: {
      outDir: '../dist',
      rollupOptions: {
        output: {
          // Stable vendor chunk — mirrors src-app/ui/vite.config.ts (Vite 8 /
          // rolldown advancedChunks.groups). Group the large framework libs into
          // ONE cached `vendor-<hash>.js`. react + react-dom + scheduler stay in
          // the SAME group (a split React instance breaks hooks). Excludes
          // react-day-picker/date-fns (kept lazy) and react-icons (removed).
          advancedChunks: {
            groups: [
              {
                name: 'vendor',
                test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@base-ui|@floating-ui|tslib)[\\/]/,
                priority: 1,
              },
            ],
          },
        },
      },
    },
  }
})
