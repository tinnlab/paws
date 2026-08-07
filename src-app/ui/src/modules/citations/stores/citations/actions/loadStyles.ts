import { ApiClient } from '@/api-client'
import type { CitationsGet, CitationsSet } from '../state'

export default (set: CitationsSet, get: CitationsGet) => {
  return async (): Promise<string[]> => {
    // The bundled `.csl` set is baked into the binary, so it cannot change
    // while the tab is open — cache after the first success and never refetch.
    // The in-flight guard keeps two dialogs opening at once from double-fetching.
    const { styles, stylesLoading } = get()
    if (styles.length > 0 || stylesLoading) return styles
    set(s => {
      s.stylesLoading = true
    })
    try {
      const resp = await ApiClient.Citations.listStyles()
      set(s => {
        s.styles = resp.styles
        s.stylesLoading = false
      })
      return resp.styles
    } catch (error) {
      set(s => {
        s.stylesLoading = false
        s.error =
          error instanceof Error
            ? error.message
            : 'Failed to load citation styles'
      })
      // Non-fatal: the export falls back to pandoc's built-in default style,
      // which is exactly what the format did before a picker existed.
      return []
    }
  }
}
