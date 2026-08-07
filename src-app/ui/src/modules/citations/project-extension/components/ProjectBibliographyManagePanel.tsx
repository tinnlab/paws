import { useCallback, useEffect, useMemo, useState } from 'react'
import { Import, Plus } from 'lucide-react'
import { Button, Empty, message, Space, Spin, Tag, Text } from '@ziee/kit'
import { ApiClient } from '@/api-client'
import { Permissions } from '@/api-client/permissions'
import type { BibliographyEntry } from '@/api-client/types'
import { usePermission } from '@/core/permissions'
import { AttachCitationsDialog } from '../../components/AttachCitationsDialog'
import { CitationCard } from '../../components/CitationCard'
import { ImportCitationsModal } from '../../components/ImportCitationsModal'
import { ProjectDetail } from '@/modules/projects/stores/projectDetail'
import { EventBus as EventBusStore } from '@ziee/framework/stores'

/** Full management of a project's reference list — inside the knowledge drawer. */
export function ProjectBibliographyManagePanel() {
  // Import-into-project + per-card Delete require manage; gate them so a
  // read-only (`citations::use`) viewer doesn't see actions that would 403.
  const canManage = usePermission(Permissions.CitationsManage)
  const project = ProjectDetail.project
  const projectId = project?.id ?? null
  const [entries, setEntries] = useState<BibliographyEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)

  const attachedIds = useMemo(
    () => new Set(entries.map(e => e.id)),
    [entries],
  )

  const reload = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const r = await ApiClient.Citations.list({ project_id: projectId })
      setEntries(r.entries)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to load references')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void reload()
    // Stay current when the library changes elsewhere (import/attach/detach/delete).
    // Group-named subscription (the project's EventBus idiom) auto-dedups.
    const unsub = EventBusStore.on(
      'sync:bibliography_entry',
      () => void reload(),
      'ProjectBibliographyManagePanel',
    )
    return () => unsub()
  }, [reload])

  if (!projectId) return <Empty description="Open a project to manage its references." data-testid="cite-bib-panel-no-project-empty" />

  return (
    <div className="flex flex-col w-full">
      {/* Header mirrors the Knowledge-files panel: title + count chip on the
          left, the primary action on the right. */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Text strong>References</Text>
          <Tag variant="outline" data-testid="cite-bib-panel-count-tag">
            {entries.length} reference{entries.length === 1 ? '' : 's'}
          </Tag>
        </div>
        {canManage && (
          // Two ways in, because they answer different questions: "Add" links a
          // reference the user already has, "Import" resolves+verifies a new one
          // from a pasted DOI/PMID. Add is the quiet variant — Import is the
          // primary action that also creates library rows.
          <Space size={8} wrap>
            <Button
              variant="outline"
              icon={<Plus />}
              onClick={() => setAttachOpen(true)}
              data-testid="cite-bib-panel-add-button"
            >
              Add from library
            </Button>
            <Button
              variant="default"
              icon={<Import />}
              onClick={() => setImportOpen(true)}
              data-testid="cite-bib-panel-import-button"
            >
              Import
            </Button>
          </Space>
        )}
      </div>

      {loading ? (
        <Spin label="Loading" />
      ) : entries.length === 0 ? (
        <Empty description="No references in this project yet." data-testid="cite-bib-panel-empty" />
      ) : (
        <div>
          {entries.map(e => (
            // `projectId` switches the card's removal affordance from a
            // library-wide delete to a project detach — this panel is
            // project-scoped, so its remove must be too.
            <CitationCard
              key={e.id}
              entry={e}
              canManage={canManage}
              projectId={projectId}
              onDetached={() => void reload()}
            />
          ))}
        </div>
      )}

      <ImportCitationsModal
        open={importOpen}
        projectId={projectId}
        onClose={() => {
          setImportOpen(false)
          void reload()
        }}
      />

      {canManage && (
        <AttachCitationsDialog
          open={attachOpen}
          projectId={projectId}
          attachedIds={attachedIds}
          onClose={() => {
            setAttachOpen(false)
            void reload()
          }}
        />
      )}
    </div>
  )
}
