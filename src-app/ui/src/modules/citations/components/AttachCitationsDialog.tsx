import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import {
  Button,
  Checkbox,
  Dialog,
  Empty,
  Input,
  message,
  Paragraph,
  ScrollArea,
  Text,
} from '@ziee/kit'
import type { BibliographyEntry } from '@/api-client/types'
import { Citations as CitationsStore } from '@/modules/citations/stores/citations'
import { VerificationBadge } from './VerificationBadge'

/**
 * Pick library entries to add to a project's reference list.
 *
 * The project bibliography was previously agent-write-only: the only path that
 * ever wrote `project_bibliography` was the citations MCP tools. This is the
 * human path. It mirrors the project knowledge-files panel — attach existing
 * items from the user's own library, membership only, never a copy.
 */
export function AttachCitationsDialog({
  open,
  projectId,
  attachedIds,
  onClose,
}: {
  open: boolean
  projectId: string
  /** Ids already on the project's list — filtered out, so the dialog only ever offers a real addition. */
  attachedIds: ReadonlySet<string>
  /** Called on close; `attached` is the number the server actually inserted. */
  onClose: (attached: number) => void
}) {
  // The library list itself. Read reactively so an import in another surface
  // (or a sync refetch) shows up here without remounting the dialog.
  const { entries, attaching } = CitationsStore
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Reset on every open so a previous session's selection/filter can't leak
  // into the next one and silently attach something the user didn't re-pick.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(new Set())
    }
  }, [open])

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e: BibliographyEntry) => {
      if (attachedIds.has(e.id)) return false
      if (!q) return true
      return (
        e.citation_key.toLowerCase().includes(q) ||
        (e.title ?? '').toLowerCase().includes(q) ||
        (e.doi ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, attachedIds, query])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAdd = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    try {
      const count = await CitationsStore.attachToProject(projectId, ids)
      message.success(
        `Added ${count} reference${count === 1 ? '' : 's'} to this project`,
      )
      onClose(count)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to add references')
    }
  }

  return (
    <Dialog
      open={open}
      title="Add references from your library"
      data-testid="cite-attach-dialog"
      onOpenChange={v => {
        if (!v) onClose(0)
      }}
      footer={
        <>
          <Button
            variant="outline"
            data-testid="cite-attach-cancel"
            onClick={() => onClose(0)}
          >
            Cancel
          </Button>
          <Button
            data-testid="cite-attach-submit"
            loading={attaching}
            disabled={selected.size === 0}
            onClick={handleAdd}
          >
            {selected.size === 0
              ? 'Add'
              : `Add ${selected.size} reference${selected.size === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <Paragraph type="secondary">
        The reference stays in your library — a project keeps a link to it, not a
        copy.
      </Paragraph>
      <Input
        value={query}
        allowClear
        prefix={<Search />}
        aria-label="Filter references"
        placeholder="Filter by key, title, or DOI"
        data-testid="cite-attach-filter"
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setQuery(e.target.value)
        }
      />
      {candidates.length === 0 ? (
        <Empty
          className="mt-3"
          description={
            entries.length === 0
              ? 'Your library is empty. Import references first.'
              : query.trim()
                ? 'No library reference matches that filter.'
                : 'Every reference in your library is already in this project.'
          }
          data-testid="cite-attach-empty"
        />
      ) : (
        <ScrollArea axis="y">
          <div className="flex flex-col gap-2 mt-3 max-h-80">
            {candidates.map((e: BibliographyEntry) => (
              <label
                key={e.id}
                className="flex items-start gap-2 rounded-md border border-border p-2 hover:bg-accent cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(e.id)}
                  onCheckedChange={() => toggle(e.id)}
                  aria-label={`Select ${e.citation_key}`}
                  data-testid={`cite-attach-option-${e.id}`}
                />
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2 min-w-0">
                    <Text code ellipsis>
                      {e.citation_key}
                    </Text>
                    <VerificationBadge status={e.verification_status} />
                  </span>
                  <Text type="secondary" className="[overflow-wrap:anywhere]">
                    {e.title || '(untitled)'}
                    {e.year ? ` · ${e.year}` : ''}
                  </Text>
                </span>
              </label>
            ))}
          </div>
        </ScrollArea>
      )}
    </Dialog>
  )
}
