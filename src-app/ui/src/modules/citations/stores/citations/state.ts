import type { StoreSet } from '@ziee/framework/store-kit'
import type { BibliographyEntry } from '@/api-client/types'

export const citationsState = {
  entries: [] as BibliographyEntry[],
  loading: false,
  importing: false,
  verifying: false,
  error: null as string | null,
  /** When set, the store scopes to a project's reference list. */
  projectId: null as string | null,
  /**
   * Bundled CSL style names (`GET /api/citations/styles`). Fetched lazily by
   * `loadStyles` rather than at init: only the export dialog needs them, and the
   * set is fixed for the life of the binary, so one fetch per session is enough.
   */
  styles: [] as string[],
  stylesLoading: false,
  /** In-flight flag for the project reference-list membership mutations. */
  attaching: false,
  detaching: false,
}

export type CitationsState = typeof citationsState
export type CitationsSet = StoreSet<CitationsState>
export type CitationsGet = () => CitationsState
