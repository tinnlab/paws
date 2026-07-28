/**
 * Dev-gallery seed for the `voice` module — the `/settings/voice` admin page
 * (whisper runtime + installed models + catalog + settings) and the upload-model
 * drawer overlay. Auto-discovered by the gallery's runtime registry
 * (`@/dev/gallery/support`); never imported by `module.tsx`, so it is dev-only
 * and tree-shaken from prod.
 */
import type { ModuleGallery } from '@/dev/gallery/support'
import { holdPatch, lazyNamed } from '@/dev/gallery/support'
import { VoiceUploadModelDrawer } from '@/modules/voice/stores/voiceUploadModelDrawer'

export const gallery: ModuleGallery = {
  cassette: {
    'Voice.getSettings': {
      enabled: true,
      model: 'base.en',
      model_source_repo: 'ggerganov/whisper.cpp',
      language: 'auto',
      auto_start_timeout_secs: 30,
      idle_unload_secs: 300,
      drain_timeout_secs: 15,
      max_clip_seconds: 300,
      max_upload_bytes: 26_214_400,
      stream_interval_ms: 800,
      stream_max_decode_secs: 8,
      streaming_enabled: true,
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    'Voice.listModels': [
      {
        id: 'vm000000-0000-0000-0000-000000000001',
        name: 'base.en',
        filename: 'ggml-base.en.bin',
        size_bytes: 147_951_465,
        source: 'catalog',
        is_active: true,
        verified: true,
        update_available: false,
        sha256: 'a3c0...e91f',
        created_at: '2025-12-10T00:00:00.000Z',
      },
      {
        id: 'vm000000-0000-0000-0000-000000000002',
        name: 'small',
        filename: 'ggml-small.bin',
        size_bytes: 487_601_967,
        source: 'upload',
        is_active: false,
        verified: false,
        update_available: true,
        created_at: '2025-12-15T00:00:00.000Z',
      },
    ],
    'Voice.listVersions': {
      versions: [
        {
          id: 'rv000000-0000-0000-0000-000000000001',
          version: '1.9.1',
          backend: 'cpu',
          arch: 'x86_64',
          platform: 'linux',
          binary_path: '/home/user/.ziee/voice-runtime/1.9.1/whisper-server',
          is_system_default: true,
          created_at: '2025-12-01T00:00:00.000Z',
        },
      ],
    },
    'Voice.listModelCatalog': {
      source_reachable: true,
      source_repo: 'ggerganov/whisper.cpp',
      models: [
        {
          name: 'tiny',
          filename: 'ggml-tiny.bin',
          english_only: false,
          installed: false,
          quantization: undefined,
          size_bytes: 77_691_713,
        },
        {
          name: 'base.en',
          filename: 'ggml-base.en.bin',
          english_only: true,
          installed: true,
          size_bytes: 147_951_465,
        },
        {
          name: 'small',
          filename: 'ggml-small.bin',
          english_only: false,
          installed: true,
          size_bytes: 487_601_967,
        },
      ],
    },
    'Voice.getInstance': {
      status: 'running',
      state: 'healthy',
      state_changed_at: '2026-01-07T08:00:00.000Z',
      restart_attempts: 0,
      active_model: 'ggml-base.en.bin',
      base_url: 'http://127.0.0.1:52117',
      local_port: 52117,
      pid: 40122,
      uptime_seconds: 3620,
      last_used_at: '2026-01-07T08:55:00.000Z',
    },
  },
  seeded: [
    // ── AvailableModelsCard: a catalog with NOTHING installed and one row whose
    //    install FAILED → the DownloadFailureRow ("Install failed — <reason>" +
    //    Retry). This is the layout the owner's screenshot showed in its broken
    //    form (a bare secondary line + a naked "0 Bytes"), so the design-critic
    //    pass has to review the real failure row rather than an empty card.
    //    See `.lifecycle/voice-model-bad-magic/` (INV-1, INV-2, INV-6).
    {
      slug: 'seeded-available-models-failed-install',
      title: 'Voice — available models, failed install row',
      note: 'nothing installed + a terminal failed task → labelled "Install failed" + Retry, and NO bare "0 Bytes"',
      path: '/',
      initialPath: '/',
      component: lazyNamed(
        () => import('@/modules/voice/components/AvailableModelsCard'),
        'AvailableModelsCard',
      ),
      setup: async () => {
        const { VoiceModelUpdate } = await import(
          '@/modules/voice/stores/voiceModelUpdate'
        )
        const { VoiceModelDownloadProgress } = await import(
          '@/modules/voice/stores/voiceModelDownloadProgress'
        )
        await holdPatch(() => {
          VoiceModelUpdate.__setState({
            sourceRepo: 'ggerganov/whisper.cpp',
            sourceReachable: true,
            hasLoaded: true,
            checking: false,
            catalog: [
              {
                name: 'base-q5_1',
                filename: 'ggml-base-q5_1.bin',
                english_only: false,
                installed: false,
                quantization: 'q5_1',
                size_bytes: 59_707_625,
              },
              {
                name: 'base',
                filename: 'ggml-base.bin',
                english_only: false,
                installed: false,
                size_bytes: 147_951_465,
              },
            ],
          } as never)
          VoiceModelDownloadProgress.__setState({
            loadingActive: false,
            activeByKey: new Map([
              [
                'model@base-q5_1',
                {
                  key: 'model@base-q5_1',
                  status: 'failed',
                  // 0 received with no total — the exact shape that used to
                  // render a naked "0 Bytes" under a 56.94 MB row.
                  bytes_received: 0,
                  total_bytes: null,
                  percent: null,
                  error:
                    'the downloaded file is not a whisper model: it starts with `3c 21 44 4f` ("<!DO") instead of a recognised container header. Expected a whisper model file (a `ggml` or `GGUF` container). This usually means the URL served a web page or an error message rather than the model itself — check that it points directly at the raw `.bin`/`.gguf` file, then re-download.',
                },
              ],
            ]),
          } as never)
        })
      },
    },
  ],
  overlays: [
    {
      slug: 'overlay-upload-model-drawer',
      surface: 'modules/voice/components/UploadModelDrawer',
      title: 'Voice — upload whisper model (drawer)',
      component: lazyNamed(
        () => import('@/modules/voice/components/UploadModelDrawer'),
        'UploadModelDrawer',
      ),
      open: () => VoiceUploadModelDrawer.openUploadModelDrawer(),
    },
  ],
}
