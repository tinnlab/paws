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
      // `null` (an input type that does not support selection) and a
      // non-finite offset both mean "no usable insertion point" — the caller
      // must then append at the end rather than silently treat it as 0.
      if (selectionStart == null || selectionEnd == null) return null
      if (!Number.isFinite(selectionStart) || !Number.isFinite(selectionEnd)) {
        return null
      }
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
      const from = Number.isFinite(start) ? Math.min(Math.max(start, 0), max) : max
      const to = Number.isFinite(end) ? Math.min(Math.max(end, from), max) : from
      try {
        el.setSelectionRange(from, to)
      } catch {
        /* a detached/unsupported element — the value write still stands */
      }
      // Tell React the composer changed, exactly as typing would.
      //
      // An imperative `el.value =` fires no event, so TextInput's `onChange`
      // (and therefore `setDraft`) never runs. That was tolerable when the only
      // programmatic writer appended once at the end of a recording; it is not
      // now that dictation is the composer's primary content producer. Without
      // this, a user dictates a paragraph, switches conversation and comes back,
      // and TextInput's draft-restore effect writes the STALE stored draft over
      // the whole transcript — silent data loss.
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },

    focusMessage: () => {
      element()?.focus()
    },
  }
}
