import { createExtension, type ChatExtension } from '@/modules/chat/core/extensions'
import { createVoiceStore } from './voiceStore'
import { MicButton } from './components/MicButton'

/**
 * Voice Extension
 *
 * Adds a microphone button to the composer toolbar for local voice dictation.
 * Recording is captured via MediaRecorder, converted to 16 kHz mono WAV, and
 * POSTed to `/voice/transcribe`; the returned text is INSERTED AT THE
 * COMPOSER'S CARET (replacing a selection if there is one, appending at the end
 * only when the composer has no insertion point) and — with live captions on —
 * streamed in progressively while the user speaks. It is never auto-sent, and a
 * cancelled recording leaves the composer exactly as it was. The full contract
 * is `ui/docs/VOICE_DICTATION_COMPOSER.md`.
 *
 * Only recording CHROME lives in the toolbar (state dot, elapsed timer, Stop,
 * Cancel, the live-captions toggle) — never transcript text.
 *
 * All state lives in VoiceStore (`Chat.VoiceStore`), whose `init` fetches the
 * readiness capability so the button can hide/disable itself appropriately.
 */
const voiceExtension: ChatExtension = createExtension({
  name: 'voice',
  description: 'Local voice dictation into the chat composer',
  priority: 85,

  store: {
    name: 'VoiceStore',
    createStore: createVoiceStore,
  },

  // Sits just left of the keyboard-tips text (order 90) in the toolbar.
  slots: {
    toolbar_actions: { component: MicButton, order: 85 },
  },
})

export default voiceExtension
