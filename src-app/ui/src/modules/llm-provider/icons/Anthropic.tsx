import { memo } from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string | number
}

// Brand logo ported verbatim from react-icons (RiAnthropicFill) so the glyph is
// pixel-identical after dropping the react-icons dependency. Mirrors the
// DeepSeek / Mistral custom-SVG sibling pattern in this dir.
export const Anthropic = memo<IconProps>(({ size = '1em', style, ...rest }) => {
  return (
    <svg
      fill="currentColor"
      height={size}
      style={{
        flex: 'none',
        lineHeight: 1,
        ...style,
      }}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <title>Anthropic</title>
      <path d="M16.7645 5H13.4568L19.3799 20H22.6107L16.7645 5ZM7.22604 5L1.37988 20H4.68758L5.99527 16.8462H12.1491L13.3799 19.9231H16.6876L10.6876 5H7.30296H7.22604ZM6.91834 14.0769L8.91834 8.76923L10.9953 14.0769H6.99527H6.91834Z" />
    </svg>
  )
})

Anthropic.displayName = 'Anthropic'
