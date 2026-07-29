import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Skeleton, Tag, Text } from '@ziee/kit'
import { Copy, Eye } from 'lucide-react'
import { ApiClient } from '@/api-client'
import type { McpToolCall } from '@/api-client/types'
import { TOOL_STATUS, toolStatusKey } from '@/modules/chat/core/tool-status'
import { ToolStatusIcon } from '@/modules/chat/core/ToolStatusIcon'
import { formatElapsed } from '@/modules/chat/components/rail/railView'
import { RAIL_LIMITS } from '@/modules/chat/components/rail/railTypes'
import { Can } from '@/core/permissions'
import { Permissions } from '@/api-client/permissions'

/** Serializable payload for a `tool_call` right-panel tab (DEC-7/DEC-8). */
export interface ToolCallPanelData {
  /** The join key — stable, and the tab id is derived from it. */
  toolUseId: string
  /** The message the step belongs to, for the deep-link producer (ITEM-15). */
  messageId: string
  /** Fallback title while the record loads (or if it never does). */
  toolName?: string
}

function CopyButton({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  // Clear on unmount: closing the tab within the reset window would otherwise
  // set state on an unmounted component.
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    // `writeText` REJECTS (rather than being absent) in a non-secure context,
    // without a transient user activation, or when permission is denied — all
    // reachable in a Tauri webview and on a plain-HTTP tunnel deployment. An
    // uncaught rejection is a gating `page-error` in this repo's runtime-health
    // pass, and the user would get no signal at all that the copy failed.
    try {
      await navigator.clipboard?.writeText(value)
      setCopied(true)
      setFailed(false)
    } catch {
      setFailed(true)
      setCopied(false)
    }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, 1500)
  }
  return (
    <Button
      size="default"
      variant="ghost"
      icon={<Copy />}
      aria-label={`Copy ${label}`}
      data-testid={`tool-call-copy-${label}`}
      onClick={() => void copy()}
    >
      {failed ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

function Json({ value, testid }: { value: unknown; testid: string }) {
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
  const page = text.slice(0, RAIL_LIMITS.panelResultPageChars)
  const truncated = text.length > page.length
  return (
    <>
      <pre
        className="max-h-80 overflow-auto rounded-sm bg-muted p-2 text-xs"
        data-testid={testid}
      >
        {page}
      </pre>
      {truncated && (
        <Text type="secondary" className="text-xs">
          {`Showing the first ${RAIL_LIMITS.panelResultPageChars.toLocaleString()} characters of ${text.length.toLocaleString()}.`}
        </Text>
      )}
    </>
  )
}

/**
 * LEVEL-2 detail for one rail step (ITEM-12) — the full persisted record.
 *
 * This is the surface that makes INV-2 ("every detail reachable today must
 * remain reachable, ideally better") a net GAIN rather than a wash: duration,
 * `source`, result size, timeout-vs-failure and the exact error message are all
 * persisted on `mcp_tool_calls` and were, until now, reachable only from an
 * admin drawer — never from the message that produced them.
 *
 * Arguments come from the RECORD, which the backend redacts at write time
 * (ITEM-17). A user holding `mcp_servers_admin::edit` can reveal the raw
 * arguments through a permission-gated endpoint (DEC-1/DEC-2), so no detail is
 * permanently unreachable — it is just no longer printed by default.
 */
export function ToolCallPanel({ toolUseId, messageId, toolName }: ToolCallPanelData) {
  const [call, setCall] = useState<McpToolCall | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [raw, setRaw] = useState<unknown>(undefined)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    // Reset the REVEALED state too. The panel host renders the registered
    // component with no `key` and memoises it, so switching between two
    // `tool_call` tabs reuses this instance with new props — leaving call A's
    // raw, unredacted arguments rendered under call B's record. That is both a
    // wrong-record display and an unaudited secret exposure (the audit line
    // fires on `reveal()`, not on a re-display).
    setRaw(undefined)
    setRevealError(null)
    ApiClient.McpToolCall.list({ tool_use_id: toolUseId, per_page: 1 })
      .then(res => {
        if (!active) return
        setCall(res.calls[0] ?? null)
      })
      .catch((e: unknown) => {
        if (!active) return
        setError(e instanceof Error ? e.message : 'Failed to load the tool-call record')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [toolUseId])

  const reveal = useCallback(() => {
    // In-flight guard: without it every click fires another request, and each
    // emits its own audit line for one user intent — muddying the very audit
    // trail the endpoint exists to produce.
    if (!call || revealing) return
    setRevealing(true)
    setRevealError(null)
    ApiClient.McpToolCall.reveal({ id: call.id })
      .then((res: { arguments_json: unknown }) => setRaw(res.arguments_json))
      .catch((e: unknown) =>
        setRevealError(
          e instanceof Error ? e.message : 'Failed to reveal the raw arguments',
        ),
      )
      .finally(() => setRevealing(false))
  }, [call, revealing])

  const deepLink = `${window.location.origin}${window.location.pathname}#message-${messageId}`

  if (loading) return <Skeleton aria-label="Loading tool call record" />

  if (error) {
    return (
      <Alert
        tone="error"
        title="Could not load this step"
        description={error}
        data-testid="tool-call-panel-error"
      />
    )
  }

  if (!call) {
    return (
      <div className="flex flex-col gap-2 p-3" data-testid="tool-call-panel-empty">
        <Text strong>{toolName ?? 'Tool call'}</Text>
        <Alert
          tone="info"
          title="No stored record"
          description="This call has no history row — it may have been pruned by the retention policy, or it never reached the recorder."
          data-testid="tool-call-panel-no-record"
        />
        <CopyButton label="link" value={deepLink} />
      </div>
    )
  }

  const statusKey = toolStatusKey(call.status, call.is_error)

  return (
    <div className="flex flex-col gap-3 p-3" data-testid="tool-call-panel">
      <div className="flex min-w-0 items-center gap-2">
        <ToolStatusIcon status={statusKey} />
        <Text strong className="min-w-0 truncate">
          {call.tool_name}
        </Text>
        <Tag tone={TOOL_STATUS[statusKey].tone} data-testid="tool-call-panel-status">
          {TOOL_STATUS[statusKey].label}
        </Tag>
      </div>

      <Card size="sm" data-testid="tool-call-panel-meta">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Server</dt>
          <dd className="truncate">{call.server_name}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd data-testid="tool-call-panel-source">{call.source}</dd>
          <dt className="text-muted-foreground">Duration</dt>
          <dd data-testid="tool-call-panel-duration">
            {call.duration_ms != null ? formatElapsed(call.duration_ms) : '—'}
          </dd>
          <dt className="text-muted-foreground">Result size</dt>
          <dd data-testid="tool-call-panel-bytes">
            {`${call.result_bytes.toLocaleString()} bytes`}
          </dd>
        </dl>
      </Card>

      {call.error_message && (
        <Alert
          tone="error"
          title="Error"
          description={call.error_message}
          data-testid="tool-call-panel-error-message"
        />
      )}

      <section className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Text strong className="text-xs">
            Arguments
          </Text>
          <CopyButton label="arguments" value={JSON.stringify(call.arguments_json, null, 2)} />
          {/* Admin-gated raw reveal (DEC-1/DEC-2). Gated by the SAME permission
              whose holder can already read and set a server's configured secret
              headers, so revealing arguments grants no capability they lack. A
              user without it sees no affordance at all — `Can` renders nothing,
              and the endpoint refuses independently. */}
          <Can permission={Permissions.McpServersAdminEdit}>
            <Button
              variant="ghost"
              icon={<Eye />}
              onClick={reveal}
              loading={revealing}
              data-testid="tool-call-reveal-btn"
            >
              Reveal raw
            </Button>
          </Can>
        </div>
        <Json value={call.arguments_json} testid="tool-call-panel-args" />
        {revealError && (
          <Alert
            tone="error"
            title="Reveal failed"
            description={revealError}
            data-testid="tool-call-reveal-error"
          />
        )}
        {raw !== undefined && (
          <>
            <Text strong className="text-xs">
              Raw arguments
            </Text>
            <Json value={raw} testid="tool-call-panel-raw-args" />
          </>
        )}
      </section>

      {call.result_json !== undefined && call.result_json !== null && (
        <section className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Text strong className="text-xs">
              Result
            </Text>
            <CopyButton label="result" value={JSON.stringify(call.result_json, null, 2)} />
          </div>
          <Json value={call.result_json} testid="tool-call-panel-result" />
        </section>
      )}

      {/* Deep-link PRODUCER (ITEM-15). The `#message-<id>` consumer has existed
          on the conversation page all along with nothing anywhere producing one. */}
      <div className="flex items-center gap-2">
        <Text type="secondary" className="text-xs">
          Link to this message
        </Text>
        <CopyButton label="link" value={deepLink} />
      </div>
    </div>
  )
}
