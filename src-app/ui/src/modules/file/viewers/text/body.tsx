import { Spin } from '@ziee/kit'
import type { FileViewerSlotProps } from '../../types/viewer'
import { useFileTextContent } from '../shared/hooks'
import { useResourceLinkContent } from '../../hooks/useResourceLinkContent'
import { RawCodeView } from '../shared/RawCodeView'
import { FindableRegion } from '../shared/find/FindableRegion'
import { getSource } from '../shared/source'
import { File } from '@/modules/file/stores/file'

export function TextBody(props: FileViewerSlotProps) {
  const { file, url } = getSource(props)
  const rightPanelContent = useFileTextContent(file, !file)
  const inlineContent = useResourceLinkContent(url, !!file)
  const content = file ? rightPanelContent : inlineContent
  // Read the wrap flag reactively (right-panel only; inline has no fileId).
  // The proxy read IS a hook, so it happens unconditionally — only the Map
  // LOOKUP is conditional on `file`, which is a plain (hook-free) call.
  const wordWrapByFile = File.fileWordWrap
  const wordWrap = file ? wordWrapByFile.get(file.id) ?? false : false

  if (content === '__error__') {
    return (
      <div className="flex items-center justify-center h-full text-sm opacity-70 p-4">
        Failed to load file content.
      </div>
    )
  }
  if (content === null) {
    return <div className="flex items-center justify-center h-full"><Spin label="Loading" /></div>
  }
  const view = <RawCodeView text={content} filename={file?.filename} wordWrap={wordWrap} />
  // Find-in-document is a right-panel affordance (needs a fileId to coordinate
  // the header toggle); inline previews render the raw view directly.
  return file ? (
    <FindableRegion fileId={file.id}>{view}</FindableRegion>
  ) : (
    view
  )
}
