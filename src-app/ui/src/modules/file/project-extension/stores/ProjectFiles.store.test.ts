/**
 * ProjectFiles — removing a file from a project must DETACH, never DELETE.
 *
 * The defect these pin: both removal actions called `ApiClient.File.delete`
 * (`DELETE /api/files/{file_id}` — a library-wide destroy) while every other
 * signal in the module said detach. Removing a file from one project therefore
 * destroyed it in every OTHER project it was attached to, with a confirm dialog
 * the user had no reason to read as cross-project. `Project.detachFile`
 * (`DELETE /api/projects/{id}/files/{file_id}`) is documented as "Does NOT
 * delete the underlying file" and is the correct call.
 *
 * `File.delete` is stubbed on the mock client precisely so it CAN be called —
 * these assertions only mean something because the destructive path is
 * reachable and simply must not be taken.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  Project: {
    // Params are typed so `mock.calls` stays a typed tuple (the specs read
    // `file_id` off the recorded args).
    detachFile: vi.fn((_args: { id: string; file_id: string }) =>
      Promise.resolve(),
    ),
    listFiles: vi.fn(() => Promise.resolve([])),
  },
  File: {
    // The destructive endpoint. Present, callable — and never expected.
    delete: vi.fn((_args: { file_id: string }) => Promise.resolve()),
  },
}))

const emitted = vi.hoisted(
  () => [] as Array<{ type: string; data: Record<string, unknown> }>,
)

vi.mock('@/api-client', () => ({ ApiClient: apiMock }))
vi.mock('@ziee/framework/stores', () => ({
  EventBus: {
    emit: (e: { type: string; data: Record<string, unknown> }) => {
      emitted.push(e)
      return Promise.resolve()
    },
  },
  createStoreProxy: () => ({}),
  registerLazyStore: () => ({}),
}))
// Only read inside `init`'s `watch(...)`, which these specs never run.
vi.mock('@/modules/projects/stores', () => ({ useProjectDetailStore: {} }))

import { useProjectFilesStore } from './projectFiles'

const store = () => useProjectFilesStore.getState()
const PROJECT = 'p-1'

beforeEach(() => {
  vi.clearAllMocks()
  emitted.length = 0
  useProjectFilesStore.setState({
    currentProjectId: PROJECT,
    files: [],
    filesLoading: false,
    uploadingFiles: new Map(),
    selectedFileIds: new Set<string>(),
    attaching: false,
    detaching: false,
    error: null,
  })
})

describe('ProjectFiles — the library-wide delete is never reachable', () => {
  // Standalone negative control. The `not.toHaveBeenCalled()` guards inside the
  // behavioural specs below sit AFTER a positive assertion, so on the buggy
  // source they were never reached — these two assert the destructive call in
  // isolation, and are what actually fail when someone reintroduces it.
  it('detachFile does not call File.delete', async () => {
    await store().detachFile(PROJECT, 'f-1')
    expect(apiMock.File.delete).not.toHaveBeenCalled()
  })

  it('batchDetach does not call File.delete', async () => {
    useProjectFilesStore.setState({ selectedFileIds: new Set(['f-1', 'f-2']) })
    await store().batchDetach(PROJECT)
    expect(apiMock.File.delete).not.toHaveBeenCalled()
  })
})

describe('ProjectFiles.detachFile', () => {
  it('detaches the membership and never deletes the file from the library', async () => {
    await store().detachFile(PROJECT, 'f-1')

    expect(apiMock.Project.detachFile).toHaveBeenCalledWith({
      id: PROJECT,
      file_id: 'f-1',
    })
    expect(apiMock.File.delete).not.toHaveBeenCalled()
  })

  it('emits project.file_detached and clears the detaching flag', async () => {
    await store().detachFile(PROJECT, 'f-1')

    expect(emitted).toEqual([
      { type: 'project.file_detached', data: { projectId: PROJECT, fileId: 'f-1' } },
    ])
    expect(store().detaching).toBe(false)
    expect(store().error).toBeNull()
  })

  it('surfaces a failure and rethrows, without falling back to a delete', async () => {
    apiMock.Project.detachFile.mockRejectedValueOnce(new Error('detach boom'))

    await expect(store().detachFile(PROJECT, 'f-1')).rejects.toThrow(
      'detach boom',
    )

    expect(store().error).toBe('detach boom')
    expect(store().detaching).toBe(false)
    expect(apiMock.File.delete).not.toHaveBeenCalled()
  })
})

describe('ProjectFiles.batchDetach', () => {
  it('detaches every selected file and never deletes any of them', async () => {
    useProjectFilesStore.setState({
      selectedFileIds: new Set(['f-1', 'f-2', 'f-3']),
    })

    await store().batchDetach(PROJECT)

    expect(apiMock.Project.detachFile.mock.calls.map(([a]) => a.file_id)).toEqual(
      ['f-1', 'f-2', 'f-3'],
    )
    expect(apiMock.File.delete).not.toHaveBeenCalled()
    expect(store().selectedFileIds.size).toBe(0)
    expect(store().detaching).toBe(false)
  })

  it('keeps going past a per-item failure, still without deleting', async () => {
    useProjectFilesStore.setState({ selectedFileIds: new Set(['f-1', 'f-2']) })
    apiMock.Project.detachFile.mockRejectedValueOnce(new Error('nope'))

    await store().batchDetach(PROJECT)

    expect(apiMock.Project.detachFile).toHaveBeenCalledTimes(2)
    expect(store().error).toBe('nope')
    expect(apiMock.File.delete).not.toHaveBeenCalled()
  })

  it('is a no-op when nothing is selected', async () => {
    await store().batchDetach(PROJECT)

    expect(apiMock.Project.detachFile).not.toHaveBeenCalled()
    expect(apiMock.File.delete).not.toHaveBeenCalled()
  })
})
