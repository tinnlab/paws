import { memo } from 'react'

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: string | number
}

// Brand logo ported verbatim from react-icons (RiGeminiFill) so the glyph is
// pixel-identical after dropping the react-icons dependency. Mirrors the
// DeepSeek / Mistral custom-SVG sibling pattern in this dir.
export const Gemini = memo<IconProps>(({ size = '1em', style, ...rest }) => {
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
      <title>Gemini</title>
      <path d="M23.9996 12.0235C17.5625 12.4117 12.4114 17.563 12.0232 24H11.9762C11.588 17.563 6.4369 12.4117 0 12.0235V11.9765C6.4369 11.5883 11.588 6.43719 11.9762 0H12.0232C12.4114 6.43719 17.5625 11.5883 23.9996 11.9765V12.0235Z" />
    </svg>
  )
})

Gemini.displayName = 'Gemini'
