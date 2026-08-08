/**
 * The ONLY import surface a per-module `src/modules/<X>/gallery.tsx` needs:
 * the ziee-bound entry types + the authoring helpers (from `@ziee/gallery`).
 */
export type {
  Cassette,
  CassetteEntry,
  DeepStateEntry,
  GalleryStory,
  InteractionRecipe,
  ModuleGallery,
  OverlayEntry,
  SeededSurfaceEntry,
} from './types'

export {
  holdForever,
  holdPatch,
  whenTrue,
  lazyBound,
  lazyCompose,
  lazyNamed,
  lazyProps,
  // A seeded surface whose error state is reached by a FAILED REQUEST (not by a
  // store field it could patch) flips the mock engine into `error` mode from its
  // `setup`. `mountGallery` sets the mode once from `?state=` before render, and
  // seeded/interaction cells are visited without a `state` param, so a `setup`
  // call is the only way those cells can put a request-driven error on screen.
  // Page-kind surfaces must NOT use this — they get `?state=error` for free.
  setMockMode,
} from '@ziee/gallery'
