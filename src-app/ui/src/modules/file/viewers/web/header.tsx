import { Space } from '@ziee/kit'
import {
  CopyButton,
  CopySelectionButton,
  FindButton,
  RawToggle,
  WrapToggle,
} from '../shared/chrome'
import type { FileViewerSlotProps } from '../../types/viewer'
import { File } from '@/modules/file/stores/file'

export function WebHeader(props: FileViewerSlotProps) {
  // A reactive store-proxy read IS a hook here (it calls useEffect + useStore),
  // so it must stay ABOVE the type-guard early return — otherwise the hook count
  // varies between renders and React unmounts the tree.
  const viewModes = File.fileViewModes
  if (!('file' in props)) return null
  const { file } = props
  const isRaw = (viewModes.get(file.id) ?? 'compiled') === 'raw'
  return (
    <Space size="small">
      {/* Find + copy-selection operate on the raw text; the rendered iframe is a
          separate document our highlight/selection can't reach, so they're most
          useful in raw mode but the buttons stay available for the raw toggle. */}
      {isRaw ? <FindButton file={file} /> : null}
      {isRaw ? <WrapToggle file={file} /> : null}
      {isRaw ? <CopySelectionButton /> : null}
      <RawToggle file={file} />
      <CopyButton file={file} />
    </Space>
  )
}
