import { ApiClient } from '@/api-client'
import { useLlmProviderStore } from '@/modules/llm-provider/stores/llmProvider'
import { useLlmModelDownloadStore } from '@/modules/llm-provider/stores/llmModelDownload'
import type {
  DownloadInstance,
  DownloadProgressData,
  DownloadProgressUpdate,
  SSEDownloadProgressConnectedData,
} from '@/api-client/types'
import type { LlmModelDownloadGet, LlmModelDownloadSet } from '../state'
import loadExistingDownloadsFactory from './_loadExistingDownloads'
import {
  emitLlmModelDownloadCompleted,
  emitLlmModelDownloadFailed,
} from '@/modules/llm-provider/events/emitters'

export default (set: LlmModelDownloadSet, get: LlmModelDownloadGet) => {
  const loadExistingDownloads = loadExistingDownloadsFactory(set, get)

  const action: () => Promise<void> = async () => {
    const state = get()
    if (state.sseConnected) return

    try {
      await ApiClient.LlmModel.subscribeDownloadProgress(undefined, {
        SSE: {
          // Only the abort handle is knowable here: the transport dispatches
          // `__init` as soon as fetch() resolves and BEFORE it checks
          // response.ok, so a failing status reaches this callback too.
          // Marking the stream connected and resetting the retry counter here
          // made every failed attempt look like a fresh start — the catch
          // below would take it 0 → 1, forever short of maxAttempts — so the
          // bounded reconnect never terminated and re-hit the endpoint every
          // 3s indefinitely.
          __init: ({ abortController }) => {
            // Signal the abort controller so onCleanup can abort it.
            ;(globalThis as Record<string, unknown>).__LLM_DL_SSE_ABORT = abortController
          },
          connected: (_data: SSEDownloadProgressConnectedData) => {
            // The server's handshake, reachable only on a real 200 stream —
            // the one point at which the connection has genuinely succeeded.
            set({ sseConnected: true, sseError: null, reconnectAttempts: 0 })
          },
          update: (updates: DownloadProgressUpdate[]) => {
            const prevState = get()
            const prevStatusById = new Map<string, string>(
              prevState.downloads.map((d: DownloadInstance) => [d.id, d.status]),
            )
            const newlyCompleted = updates.filter((u) => u.status === 'completed')
            if (newlyCompleted.length > 0) {
              const providerIds = [
                ...new Set(
                  newlyCompleted
                    .map((d) => d.provider_id)
                    .filter((id): id is string => !!id),
                ),
              ]
              for (const providerId of providerIds) {
                void useLlmProviderStore.getState().loadModelsForProvider(providerId)
              }
            }
            for (const u of updates) {
              if (!u.id || typeof u.status !== 'string') continue
              const prev = prevStatusById.get(u.id)
              if (prev === u.status) continue
              const isNewlyTerminal =
                (u.status === 'completed' || u.status === 'failed') && prev !== undefined
              if (!isNewlyTerminal) continue
              const priorRow = prevState.downloads.find((d) => d.id === u.id)
              const displayName =
                priorRow?.request_data?.display_name ||
                priorRow?.request_data?.model_name ||
                'Model'
              if (u.status === 'completed') {
                void emitLlmModelDownloadCompleted(
                  u.id,
                  u.provider_id ?? priorRow?.provider_id ?? '',
                  displayName,
                )
              } else {
                void emitLlmModelDownloadFailed(
                  u.id,
                  u.provider_id ?? priorRow?.provider_id ?? '',
                  displayName,
                  u.error_message ?? priorRow?.error_message ?? '',
                )
              }
            }
            set((state) => {
              const updatedDownloads = state.downloads.map((download) => {
                const update = updates.find((u) => u.id === download.id)
                if (!update) return download
                // The SSE payload is FLAT — `current` / `total` / `speed_bps` /
                // `eta_seconds` / `message` / `phase` sit at the TOP LEVEL of
                // `DownloadProgressUpdate`. Every UI that renders a download
                // reads `progress_data.*`. Spreading the update therefore added
                // stray top-level keys and left `progress_data` untouched, so
                // the bar sat at 0% and the byte counts read "0 bytes / 0 bytes"
                // — in the onboarding step AND the LLM-providers view, because
                // both read this one store. The `as DownloadInstance` cast is
                // what stopped the compiler from noticing (FB-12).
                //
                // Rebuild `progress_data` from the delivered fields, falling
                // back to the previous value per-field: the server sends these
                // as `Option`, so a null must not blank a figure we already had.
                const progress_data: DownloadProgressData = {
                  phase: update.phase ?? download.progress_data?.phase ?? 'created',
                  current: update.current ?? download.progress_data?.current ?? 0,
                  total: update.total ?? download.progress_data?.total ?? 0,
                  message: update.message ?? download.progress_data?.message ?? '',
                  speed_bps: update.speed_bps ?? download.progress_data?.speed_bps ?? 0,
                  eta_seconds:
                    update.eta_seconds ?? download.progress_data?.eta_seconds ?? 0,
                }
                return { ...download, ...update, progress_data } as DownloadInstance
              })
              const filteredDownloads = updatedDownloads.filter(
                (download) => download.status !== 'cancelled' && download.status !== 'completed',
              )
              return { downloads: filteredDownloads }
            })
          },
          complete: (_data: string) => {
            const allDownloads = get().downloads
            const providerIds = [
              ...new Set(allDownloads.map((d) => d.provider_id).filter((id): id is string => !!id)),
            ]
            for (const providerId of providerIds) {
              void useLlmProviderStore.getState().loadModelsForProvider(providerId)
            }
            void useLlmModelDownloadStore.getState().disconnectSSE()
            void loadExistingDownloads()
          },
          error: (errorMessage: string) => {
            console.error('SSE error:', errorMessage)
            set({ sseError: errorMessage, sseConnected: false })
          },
          default: (event: string, data: unknown) => {
            console.warn('Unknown SSE event:', event, data)
          },
        },
      })
    } catch (error) {
      console.error('SSE connection failed:', error)
      const attempts = get().reconnectAttempts + 1
      const maxAttempts = 5
      if (attempts < maxAttempts) {
        set({
          sseConnected: false,
          sseError: 'Connection lost, reconnecting...',
          reconnectAttempts: attempts,
        })
        setTimeout(() => {
          void action()
        }, 3000)
      } else {
        console.error('Max reconnection attempts reached')
        set({
          sseConnected: false,
          sseError: 'Failed to connect to download updates',
          reconnectAttempts: attempts,
        })
      }
    }
  }

  return action
}
