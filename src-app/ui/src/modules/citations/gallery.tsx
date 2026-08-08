/**
 * Dev-gallery seed for the `citations` module — the import-citations modal and
 * the project-bibliography manage/inline empty surfaces. Owns the shared
 * `citationsCassette`. Auto-discovered by the gallery's runtime registry
 * (`@/dev/gallery/support`); never imported by `module.tsx`, so it is dev-only
 * and tree-shaken from prod.
 */
import type { ModuleGallery } from '@/dev/gallery/support'
import { holdPatch, lazyBound, lazyNamed } from '@/dev/gallery/support'
import { citationsCassette } from '@/dev/gallery/fixtures/citations'

const noop = () => {}

/** A project stub — enough for `ProjectDetail.project` reads (`project.id`). */
const galleryProject = { id: 'proj-s4', name: 'Gallery Project' }

/**
 * The ids of every entry in `citationsCassette`'s library, in the same order.
 * Passing the WHOLE set as `attachedIds` is what drives AttachCitationsDialog's
 * `candidates.length === 0` arm honestly: the library loads for real (the store's
 * `init` fetches `Citations.list`, which the cassette answers with these four),
 * and every row is filtered out because it is already on the project — the
 * "Every reference in your library is already in this project" Empty. Seeding an
 * EMPTY library instead would render the other message and leave the
 * already-attached arm unexercised.
 */
const galleryLibraryIds: ReadonlySet<string> = new Set([
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
])

/** Seed the active project so the project-scoped panels mount past their
 *  `if (!project) return null` guard and their effects fetch with a real id. */
const seedProject = async () => {
  const { ProjectDetailDef } = await import(
    '@/modules/projects/stores/projectDetail'
  )
  await holdPatch(() =>
    ProjectDetailDef.store.setState({ project: galleryProject } as any),
  )
}

export const gallery: ModuleGallery = {
  cassette: citationsCassette,
  overlays: [
    {
      slug: 'overlay-import-citations-modal',
      surface: 'modules/citations/components/ImportCitationsModal',
      title: 'Import citations (modal)',
      component: lazyBound(
        () => import('@/modules/citations/components/ImportCitationsModal'),
        'ImportCitationsModal',
        { open: true, onClose: noop, projectId: null },
      ),
    },
    // ── AttachCitationsDialog: the human path onto a project's reference list.
    //    `open` (the picker with a real library to choose from) and `empty` (the
    //    `candidates.length === 0` Empty) are its two required states; each gets
    //    its own cell so both render for real rather than one masking the other.
    {
      slug: 'overlay-attach-citations-dialog',
      surface: 'modules/citations/components/AttachCitationsDialog',
      title: 'Add references from library (dialog)',
      component: lazyBound(
        () => import('@/modules/citations/components/AttachCitationsDialog'),
        'AttachCitationsDialog',
        {
          open: true,
          projectId: galleryProject.id,
          // Nothing attached yet → every library row is a candidate.
          attachedIds: new Set<string>(),
          onClose: noop,
        },
      ),
    },
    {
      slug: 'overlay-attach-citations-dialog-empty',
      surface: 'modules/citations/components/AttachCitationsDialog',
      title: 'Add references from library — nothing left to add',
      component: lazyBound(
        () => import('@/modules/citations/components/AttachCitationsDialog'),
        'AttachCitationsDialog',
        {
          open: true,
          projectId: galleryProject.id,
          attachedIds: galleryLibraryIds,
          onClose: noop,
        },
      ),
    },
  ],
  seeded: [
    {
      slug: 'seeded-s4-project-bib-manage-empty',
      title: 'Project bibliography manage — empty',
      note: 'initial fetch → loading spinner, then entries.length===0 → <Empty/>',
      path: '/',
      initialPath: '/',
      component: lazyNamed(
        () =>
          import(
            '@/modules/citations/project-extension/components/ProjectBibliographyManagePanel'
          ),
        'ProjectBibliographyManagePanel',
      ),
      setup: seedProject,
    },
    {
      slug: 'seeded-s4-project-bib-inline-empty',
      title: 'Project bibliography inline — empty',
      note: 'count===0 → the "No references yet — click Manage" link',
      path: '/',
      initialPath: '/',
      component: lazyNamed(
        () =>
          import(
            '@/modules/citations/project-extension/components/ProjectBibliographyInlinePreview'
          ),
        'ProjectBibliographyInlinePreview',
      ),
      setup: seedProject,
    },
  ],
}
