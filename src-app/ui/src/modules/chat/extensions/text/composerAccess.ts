import type { ComposerSelection } from './textStore/state'

/**
 * The composer-element access closures TextInput registers with TextStore.
 *
 * Extracted from the component's mount effect so the SAME production code can
 * be driven against a real `<textarea>` in the jsdom component harness
 * (`voice/components/DictationComposer.test.tsx`) — a test that re-implemented
 * these closures would prove nothing about what ships.
 *
 * Everything here closes over the composer's OWN element. No consumer reaches
 * the textarea by `querySelector`/`data-testid`: production builds strip every
 * `data-test*` attribute (`ui/plugins/vite-plugin-remove-data-test.js`), which
 * silently turned the voice extension's testid-based focus helper into a no-op
 * in every shipped build. See `ui/docs/VOICE_DICTATION_COMPOSER.md` §2.1.
 */
export interface ComposerAccessClosures {
  getMessage: () => string
  setMessage: (text: string) => void
  clearMessage: () => void
  readSelection: () => ComposerSelection | null
  applyComposerEdit: (text: string, start: number, end: number) => void
  focusMessage: () => void
}

export function createComposerAccess(
  element: () => HTMLTextAreaElement | null,
): ComposerAccessClosures {
  return {
    getMessage: () => element()?.value ?? '',

    setMessage: (text: string) => {
      const el = element()
      if (el) el.value = text
    },

    clearMessage: () => {
      const el = element()
      if (el) el.value = ''
    },

    /**
     * The caret/selection is what makes dictation land where the user is
     * typing. A textarea RETAINS its selection while blurred, so this still
     * reports the user's insertion point after the mic button takes focus.
     * `null` means "no insertion point" — the caller appends at the end rather
     * than guessing position 0.
     */
    readSelection: () => {
      const el = element()
      if (!el) return null
      const { selectionStart, selectionEnd } = el
      if (selectionStart == null || selectionEnd == null) return null
      return { start: selectionStart, end: selectionEnd }
    },

    /**
     * Set the value AND the caret/selection together. Writing the value alone
     * leaves the caret at the end of the textarea regardless of where the text
     * went, which is precisely the defect this exists to fix.
     */
    applyComposerEdit: (text: string, start: number, end: number) => {
      const el = element()
      if (!el) return
      el.value = text
      const max = text.length
      const from = Math.min(Math.max(start, 0), max)
      const to = Math.min(Math.max(end, from), max)
      try {
        el.setSelectionRange(from, to)
      } catch {
        /* a detached/unsupported element — the value write still stands */
      }
    },

    focusMessage: () => {
      element()?.focus()
    },
  }
}
