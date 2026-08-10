import { Spin } from '@ziee/kit'
import type { File as FileEntity } from '@/api-client/types'
import type { FileViewerSlotProps } from '../../types/viewer'
import { useFileTextContent, useFileViewMode } from '../shared/hooks'
import { RawCodeView } from '../shared/RawCodeView'
import { FindableRegion } from '../shared/find/FindableRegion'
import { File } from '@/modules/file/stores/file'

export function WebBody(props: FileViewerSlotProps) {
  // Web viewer is not inline-capable (XSS surface; deferred). Type guard
  // only — chat dispatcher won't reach here for source-shaped props.
  //
  // The guard is an EARLY RETURN, so every hook (incl. the reactive
  // store-proxy reads, which are hooks in this codebase) lives in the inner
  // component below — a hook after a conditional return makes the hook count
  // vary between renders and React unmounts the tree.
  if (!('file' in props)) return null
  return <WebBodyInner file={props.file} />
}

function WebBodyInner({ file }: { file: FileEntity }) {
  const content = useFileTextContent(file)
  const mode = useFileViewMode(file.id)
  const wordWrap = File.fileWordWrap.get(file.id) ?? false

  if (content === null) {
    return <div className="flex items-center justify-center h-full"><Spin label="Loading" /></div>
  }
  if (mode === 'raw') {
    // Find/word-wrap operate on the raw source (the rendered branch below is a
    // sandboxed iframe — a separate document our highlight can't reach).
    return (
      <FindableRegion fileId={file.id}>
        <RawCodeView text={content} filename={file.filename} wordWrap={wordWrap} />
      </FindableRegion>
    )
  }
  // sandbox WITHOUT allow-scripts. Both file types (HTML and SVG) render
  // their visual content declaratively; script execution would be a real
  // XSS vector since file content comes from messageFilesCache, which
  // includes files from OTHER users in shared conversations. An attacker-
  // crafted SVG or HTML could phish or fetch external endpoints from the
  // viewer's same-origin context.
  //
  // If a future tool needs to render interactive HTML, gate that behind
  // an explicit "I trust this content" user action rather than letting
  // every uploaded file execute by default.
  return (
    <iframe
      sandbox=""
      srcDoc={content}
      className="w-full h-full border-none"
      style={{ minHeight: 400 }}
      title="preview"
    />
  )
}
