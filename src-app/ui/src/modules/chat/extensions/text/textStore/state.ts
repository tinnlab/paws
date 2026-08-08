import type { StoreSet } from '@ziee/framework/store-kit'

/**
 * TextStore state — manages composer text via getter/setter FUNCTIONS. Instead
 * of storing the Form instance directly (immer would freeze it), we store
 * functions that access the form. The form stays in the TextInput component;
 * these functions capture it via closure.
 */
/** A composer caret (`start === end`) or selection range. */
export interface ComposerSelection {
  start: number
  end: number
}

export const textStoreState = {
  /** Function to get current message text (set by TextInput). */
  getMessage: null as (() => string) | null,
  /** Function to set message text (set by TextInput). */
  setMessage: null as ((text: string) => void) | null,
  /** Function to clear message text (set by TextInput). */
  clearMessage: null as (() => void) | null,
  /** Backup of message text (for error recovery). */
  backupMessage: null as string | null,
  /**
   * Function to read the composer's caret/selection (set by TextInput). Returns
   * null when there is no insertion point at all — the caller then appends at
   * the end rather than guessing a position.
   */
  readSelection: null as (() => ComposerSelection | null) | null,
  /**
   * Function to set the composer's text AND caret/selection in one step (set by
   * TextInput). Separate from `setMessage` because an insertion is only correct
   * if the caret moves with it — writing the value alone leaves the caret at
   * the end of the textarea, which is the defect this exists to fix.
   */
  applyComposerEdit: null as
    | ((text: string, start: number, end: number) => void)
    | null,
  /**
   * Function to focus the composer (set by TextInput).
   *
   * This is a REGISTERED CLOSURE over the composer's own ref — deliberately not
   * a `document.querySelector('[data-testid=…]')`, because production builds
   * strip every `data-test*` attribute
   * (`ui/plugins/vite-plugin-remove-data-test.js`), which silently made the
   * previous testid-based focus helper a no-op in every shipped build. See
   * `ui/docs/VOICE_DICTATION_COMPOSER.md` §2.1.
   */
  focusMessage: null as (() => void) | null,
}

export type TextStoreState = typeof textStoreState
export type TextStoreSet = StoreSet<TextStoreState>
export type TextStoreGet = () => TextStoreState
