// Full project knowledge-files management panel — relocated from
// `projects/components/ProjectFilesPanel.tsx` and retrofitted to use
// FileCard's row variant + multi-select + the file-module's
// ProjectFiles store.
//
// Rendered inside the knowledge drawer by `ProjectKnowledgeSection`
// via the `ProjectExtensionSlot view="managePanel"` slot — the projects
// module never imports this file directly.

import { Trash2, Upload as UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button,
  Confirm,
  dialog,
  Empty,
  message,
  Spin,
  Tag,
  Text,
  Tooltip,
  Upload,
} from '@ziee/kit'
import { usePermission } from '@/core/permissions'
import { Permissions } from '@/api-client/permissions'
import { FileCard } from '@/modules/file/components/FileCard'
import { MAX_FILE_UPLOAD_BYTES as MAX_FILE_SIZE } from '@/modules/file/constants'
import { ProjectDetail } from '@/modules/projects/stores/projectDetail'
import { ProjectFiles as ProjectFilesStore } from '@/modules/file/project-extension/stores/projectFiles'

/**
 * Server-enforced cap (`PROJECT_MAX_FILES`). Mirrored here so the UI
 * shows a counter + warning before hitting a 422.
 */
const PROJECT_FILE_CAP = 100

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function ProjectFilesManagePanel() {
  const project = ProjectDetail.project
  const {
    files,
    filesLoading,
    uploadingFiles,
    selectedFileIds,
  } = ProjectFilesStore
  // Both permission hooks must be called UNCONDITIONALLY every render —
  // `canEdit && usePermission(B)` short-circuits the second hook whenever
  // `canEdit` is false, so the hook COUNT varies with permission state and React
  // throws "Rendered more hooks than during the previous render" when it flips
  // (taxonomy O1; the same shape crashed 13 settings sections in 649ae7180).
  const canEdit = usePermission(Permissions.ProjectsEdit)
  const canUploadFiles = usePermission(Permissions.FilesUpload)
  const canUpload = canEdit && canUploadFiles

  const projectId = project?.id
  const count = files.length
  const atCap = count >= PROJECT_FILE_CAP
  const nearCap = count >= PROJECT_FILE_CAP - 5 && !atCap

  const rootRef = useRef<HTMLDivElement>(null)
  const [drawerBody, setDrawerBody] = useState<HTMLElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // This panel is project-SCOPED, so both affordances detach (drop the
  // project↔file membership) and never delete from the library. The copy below
  // has to say so: it previously promised a permanent library-wide delete while
  // the store called one, which destroyed the file in every OTHER project it was
  // attached to. Copy and call must move together.
  const handleRemove = async (fileId: string, filename: string) => {
    if (!projectId) return
    try {
      await ProjectFilesStore.detachFile(projectId, fileId)
      message.success(`Removed ${filename} from this project`)
    } catch (err) {
      message.error(
        err instanceof Error
          ? err.message
          : 'Failed to remove file from project',
      )
    }
  }

  const handleBatchRemove = async () => {
    if (!projectId || selectedFileIds.size === 0) return
    const n = selectedFileIds.size
    const confirmed = await dialog.confirm({
      title: `Remove ${n} file${n === 1 ? '' : 's'} from this project?`,
      description:
        n === 1
          ? 'The file stays in your library and in any other project it is attached to.'
          : 'They stay in your library and in any other project they are attached to.',
      okText: 'Remove',
      cancelText: 'Cancel',
    })
    if (confirmed) {
      try {
        await ProjectFilesStore.batchDetach(projectId)
        message.success(
          `Removed ${n} file${n === 1 ? '' : 's'} from this project`,
        )
      } catch (err) {
        message.error(
          err instanceof Error ? err.message : 'Failed to remove files',
        )
      }
    }
  }

  // Pre-flight + dispatch — stable ref so the DOM listener attached in
  // useEffect always calls the latest version.
  const dispatchFiles = (incoming: File[]) => {
    if (!projectId || incoming.length === 0) return
    if (atCap) {
      message.error(
        `Project is at the ${PROJECT_FILE_CAP}-file cap. Remove a file first.`,
      )
      return
    }
    const accepted: File[] = []
    for (const file of incoming) {
      if (file.size > MAX_FILE_SIZE) {
        message.error(
          `${file.name} is too large (max ${formatFileSize(MAX_FILE_SIZE)}).`,
        )
        continue
      }
      accepted.push(file)
    }
    if (accepted.length === 0) return
    void ProjectFilesStore.uploadAndAttachFiles(projectId, accepted)
  }
  const dispatchRef = useRef(dispatchFiles)
  dispatchRef.current = dispatchFiles

  // Drag handlers — attach to the Drawer's panel (the Radix dialog
  // surface) so the overlay covers the full drawer.
  useEffect(() => {
    if (!canUpload) return
    const body = rootRef.current?.closest(
      '[role="dialog"]',
    ) as HTMLElement | null
    if (!body) return
    setDrawerBody(body)

    const previousPosition = body.style.position
    if (!body.style.position && getComputedStyle(body).position === 'static') {
      body.style.position = 'relative'
    }

    let dragCounter = 0

    const onDragEnter = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
      e.preventDefault()
      dragCounter += 1
      if (dragCounter === 1) setIsDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
      e.preventDefault()
      dragCounter = Math.max(0, dragCounter - 1)
      if (dragCounter === 0) setIsDragging(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
      e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
      e.preventDefault()
      dragCounter = 0
      setIsDragging(false)
      const dropped = Array.from(e.dataTransfer?.files ?? [])
      dispatchRef.current(dropped)
    }

    body.addEventListener('dragenter', onDragEnter)
    body.addEventListener('dragleave', onDragLeave)
    body.addEventListener('dragover', onDragOver)
    body.addEventListener('drop', onDrop)

    return () => {
      body.removeEventListener('dragenter', onDragEnter)
      body.removeEventListener('dragleave', onDragLeave)
      body.removeEventListener('dragover', onDragOver)
      body.removeEventListener('drop', onDrop)
      if (!previousPosition) body.style.position = ''
    }
  }, [canUpload])

  if (!project) return null

  const counterChip = (
    <Tag variant="outline"
      tone={atCap ? 'error' : nearCap ? 'warning' : undefined}
      aria-label={`Project file count: ${count} of ${PROJECT_FILE_CAP}`}
      data-testid="file-project-count-tag"
    >
      {count} / {PROJECT_FILE_CAP} files
    </Tag>
  )

  const uploadButton = canUpload ? (
    // No dashed dropzone (border-0 p-0) — drag-and-drop is already handled by
    // the drawer-body drag listeners above; this is just the click affordance.
    <Upload
      multiple
      onFiles={(files) => dispatchFiles(files)}
      accept="*/*"
      disabled={atCap}
      label="Upload files"
      data-testid="file-project-upload-area"
      className="!border-0 !p-0 !gap-0 !rounded-none"
    >
      <Tooltip title={atCap ? `At ${PROJECT_FILE_CAP}-file cap` : 'Upload files'}>
        <Button
          icon={<UploadIcon />}
          disabled={atCap}
          aria-label="Upload files to project"
          data-testid="file-project-upload-btn"
        >
          Upload
        </Button>
      </Tooltip>
    </Upload>
  ) : null

  const header = (
    <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
      <div className="flex items-center gap-2">
        <Text strong>Knowledge files</Text>
        {counterChip}
      </div>
      {uploadButton}
    </div>
  )

  const selectionBar = selectedFileIds.size > 0 && (
    <div
      className="flex items-center justify-between gap-2 mb-3 px-3 py-2 rounded bg-primary/10 border border-primary/30"
    >
      <Text>
        {selectedFileIds.size} selected
      </Text>
      <div className="flex items-center gap-2">
        <Button size="default" variant="outline" onClick={() => ProjectFilesStore.deselectAll()} data-testid="file-project-clear-selection-btn">
          Clear
        </Button>
        <Button
          size="default"
          variant="ghost"
          icon={<Trash2 />}
          onClick={handleBatchRemove}
          // testid keeps its legacy `-delete-` spelling: the registry that
          // validates it (`testIds.generated.ts`) lives in the `sdk` submodule,
          // so renaming it here would strand every other sdk consumer.
          data-testid="file-project-delete-selected-btn"
        >
          Remove selected
        </Button>
      </div>
    </div>
  )

  const uploadingRows = Array.from(uploadingFiles.values())
  const uploadingPreview =
    uploadingRows.length === 0 ? null : (
      <div className="flex flex-col mb-3 gap-2">
        {uploadingRows.map(progress => (
          <FileCard
            key={progress.id}
            uploadProgress={{
              ...progress,
              status: progress.status === 'pending' ? 'pending' : progress.status,
            }}
            variant="row"
            onRemove={() => ProjectFilesStore.dismissUploadingFile(progress.id)}
          />
        ))}
      </div>
    )

  // Only the FIRST load (no files yet) shows the full spinner. A background
  // refresh (e.g. after an upload completes) keeps `files` on screen so the
  // list stays mounted and React reconciles by key — existing cards stay put
  // and the new file just appends, instead of the whole list blinking out.
  const initialLoading = filesLoading && files.length === 0
  const emptyOrList =
    initialLoading ? (
      <div className="flex justify-center py-6">
        <Spin label="Loading" />
      </div>
    ) : files.length === 0 ? (
      <Empty
        description="No knowledge files yet"
        data-testid="file-project-empty"
      >
        <Text type="secondary" className="block">
          {canUpload
            ? 'Drag files anywhere on this drawer, or use the Upload button above.'
            : 'Attach files from your library to share their contents with every conversation in this project.'}
        </Text>
      </Empty>
    ) : (
      <div className="flex flex-col gap-2">
        {files.map(file => {
          const isSelected = selectedFileIds.has(file.id)
          return (
            <FileCard
              key={file.id}
              file={file}
              variant="row"
              canRemove={false}
              selectable={canEdit}
              selected={isSelected}
              onSelectChange={() => ProjectFilesStore.toggleSelection(file.id)}
              subtitle={
                <>
                  {formatFileSize(file.file_size)} · {file.mime_type ?? 'unknown'}
                </>
              }
              actions={
                canEdit ? (
                  // One styled tooltip only: kit Tooltip on the span (a sibling
                  // node of the Confirm trigger) + data-tooltip-wrapped on the
                  // Button to kill its own auto-tooltip. Two overlapping Base-UI
                  // tooltips thrash (flash-then-vanish); a single one on a sibling
                  // coexists with the Confirm popover.
                  <Tooltip title="Remove from project">
                    <span className="inline-flex">
                      <Confirm
                        title="Remove this file from the project?"
                        description="It stays in your library and in any other project it is attached to."
                        okText="Remove"
                        cancelText="Cancel"
                        onConfirm={() => handleRemove(file.id, file.filename)}
                        data-testid={`file-project-delete-confirm-${file.id}`}
                      >
                        <Button
                          variant="outline"
                          icon={<Trash2 />}
                          aria-label={`Remove ${file.filename} from this project`}
                          data-tooltip-wrapped=""
                          data-testid={`file-project-delete-btn-${file.id}`}
                        />
                      </Confirm>
                    </span>
                  </Tooltip>
                ) : undefined
              }
            />
          )
        })}
      </div>
    )

  return (
    <div ref={rootRef} className="w-full">
      {/* Sticky header — keeps title/counter/upload/selection visible
          while the file list scrolls. */}
      <div
        // z-30: the FileCard's AttachmentActions are `relative z-20`, so a lower
        // header would let their buttons show through as the list scrolls under.
        className="sticky z-30 -mx-1 px-1 bg-background"
        style={{ top: -1, paddingTop: 1 }}
      >
        {header}
        {atCap && (
          <Text type="danger" className="block mb-2 text-sm">
            You've reached the {PROJECT_FILE_CAP}-file cap. Remove a file to
            attach a new one.
          </Text>
        )}
        {selectionBar}
        {uploadingPreview}
      </div>
      {emptyOrList}

      {/* Drag overlay portaled into the drawer body so it covers the
          full surface. */}
      {isDragging && drawerBody &&
        createPortal(
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-primary/10 text-primary font-medium text-base pointer-events-none"
            style={{ zIndex: 10 }}
          >
            <UploadIcon size={36} />
            <span>Drop files to attach to this project</span>
          </div>,
          drawerBody,
        )}
    </div>
  )
}
