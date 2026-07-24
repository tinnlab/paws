import { Server, Wrench, Route, Zap, type LucideProps } from 'lucide-react'
import {
  DeepSeek,
  Mistral,
  OpenAI,
  Anthropic,
  Gemini,
  HuggingFace,
} from '@/modules/llm-provider/icons'

// The provider list renders every icon at 1em (font-size via `text-lg`/`text-xl`
// at the call sites), matching the custom brand SVGs (DeepSeek/Mistral/…). lucide
// glyphs default to a fixed 24px, so wrap them to scale to 1em for size parity
// with the brand icons (this preserves the prior react-icons 1em behavior).
const em = (Icon: React.ComponentType<LucideProps>) => {
  const Wrapped = (props: LucideProps) => <Icon size="1em" {...props} />
  Wrapped.displayName = `Em(${Icon.displayName ?? Icon.name ?? 'Icon'})`
  return Wrapped
}

export const PROVIDER_ICONS: Record<string, any> = {
  local: em(Server),
  openai: OpenAI,
  anthropic: Anthropic,
  groq: em(Zap),
  gemini: Gemini,
  mistral: Mistral,
  deepseek: DeepSeek,
  huggingface: HuggingFace,
  openrouter: em(Route),
  custom: em(Wrench),
}

// Model file type configuration
export interface ModelFileType {
  key: string
  label: string
  description: string
  extensions: string[]
  mimeTypes?: string[]
}

// Supported file types for Local models
export const LOCAL_FILE_TYPES: ModelFileType[] = [
  {
    key: 'safetensors',
    label: 'SafeTensors (.safetensors)',
    description:
      'Safe tensor format with metadata validation and memory mapping support',
    extensions: ['.safetensors'],
    mimeTypes: ['application/octet-stream'],
  },
  {
    key: 'pytorch',
    label: 'PyTorch Binary (.bin)',
    description: 'Traditional PyTorch binary format',
    extensions: ['.bin', '.pt', '.pth'],
    mimeTypes: ['application/octet-stream'],
  },
  {
    key: 'gguf',
    label: 'GGUF (.gguf)',
    description: 'GGML Universal Format for quantized models',
    extensions: ['.gguf'],
    mimeTypes: ['application/octet-stream'],
  },
]

// Convert to options format for Select component
export const LOCAL_FILE_TYPE_OPTIONS = LOCAL_FILE_TYPES.map(type => ({
  value: type.key,
  label: type.label,
  description: type.description,
  extensions: type.extensions,
}))
