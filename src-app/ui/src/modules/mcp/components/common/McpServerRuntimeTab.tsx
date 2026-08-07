import { useCallback, useState } from 'react'
import { PlugZap, Play, RotateCw, Unplug } from 'lucide-react'
import {
  Alert,
  Button,
  Card,
  Confirm,
  Empty,
  Space,
  Tag,
  Text,
  Textarea,
  message,
} from '@ziee/kit'
import { ApiClient } from '@/api-client'
import type { Prompt, Resource, Tool } from '@/api-client/types'

/**
 * Live runtime introspection for ONE MCP server — ping, prompts, resources, and
 * a test tool-call, plus a forced reconnect.
 *
 * These are the operations you want when a server misbehaves, and the backend
 * has shipped all seven of them (`/api/mcp/servers/{id}/{ping,prompts,resources,
 * tools/{name}/call,disconnect}`) with no UI at all. Everything here is a live
 * probe against the actual server process, so nothing is cached in a store and
 * nothing loads until the admin asks for it: a `prompts/list` on a stdio server
 * SPAWNS it, and mounting this tab must not do that as a side effect of clicking
 * a tab.
 *
 * Every endpoint is gated by `mcp_servers::read` server-side. `canManage` gates
 * the two affordances with a real effect — dropping the session and invoking a
 * tool — so a read-only viewer is never shown a control it can drive.
 */
export function McpServerRuntimeTab({
  serverId,
  canManage,
}: {
  serverId: string
  canManage: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <ConnectionCard serverId={serverId} canManage={canManage} />
      <PromptsCard serverId={serverId} />
      <ResourcesCard serverId={serverId} />
      <ToolsCard serverId={serverId} canManage={canManage} />
    </div>
  )
}

/** Pretty-printed JSON in a bounded, scrollable, monospace block. */
function OutputBlock({
  value,
  testId,
  tone,
}: {
  value: unknown
  testId: string
  tone?: 'error'
}) {
  return (
    <div
      className={`mt-2 max-h-64 overflow-y-auto rounded border p-2 font-mono text-xs whitespace-pre-wrap break-all ${
        tone === 'error'
          ? 'border-destructive bg-destructive/10 text-destructive'
          : 'border-border bg-muted'
      }`}
      data-testid={testId}
    >
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </div>
  )
}

/** Parse a JSON-object argument blob, tolerating an empty box as `{}`. */
function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid JSON' }
  }
}

function ConnectionCard({
  serverId,
  canManage,
}: {
  serverId: string
  canManage: boolean
}) {
  const [pinging, setPinging] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [result, setResult] = useState<
    { ok: boolean; ms: number; detail?: string } | null
  >(null)

  const handlePing = async () => {
    setPinging(true)
    // Round-trip time is measured client side: the MCP ping response carries
    // only `{ok}`, and "it answered, in 40 ms" is the diagnostic an operator
    // actually wants when deciding whether a server is wedged or just slow.
    const started = performance.now()
    try {
      const resp = await ApiClient.McpServerRuntime.ping({ id: serverId })
      setResult({ ok: resp.ok, ms: Math.round(performance.now() - started) })
    } catch (e) {
      setResult({
        ok: false,
        ms: Math.round(performance.now() - started),
        detail: e instanceof Error ? e.message : 'Ping failed',
      })
    } finally {
      setPinging(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await ApiClient.McpServerRuntime.disconnect({ id: serverId })
      setResult(null)
      message.success('Session dropped — the next call reconnects')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Card title="Connection" size="sm" data-testid="mcp-runtime-connection-card">
      <Space size={8} wrap>
        <Button
          icon={<PlugZap />}
          loading={pinging}
          onClick={handlePing}
          data-testid="mcp-runtime-ping-btn"
        >
          Ping
        </Button>
        {canManage && (
          <Confirm
            title="Drop this server's session?"
            description="The pooled connection is closed. The next tool call reconnects automatically — use this to pick up a restarted or reconfigured server."
            okText="Disconnect"
            cancelText="Cancel"
            onConfirm={handleDisconnect}
            data-testid="mcp-runtime-disconnect-confirm"
          >
            <Button
              variant="outline"
              icon={<Unplug />}
              loading={disconnecting}
              data-testid="mcp-runtime-disconnect-btn"
            >
              Disconnect
            </Button>
          </Confirm>
        )}
      </Space>
      {result && (
        <div className="mt-2">
          <Space size={8} wrap>
            <Tag
              variant="outline"
              tone={result.ok ? 'success' : 'error'}
              data-testid="mcp-runtime-ping-result-tag"
            >
              {result.ok ? 'Responded' : 'No response'}
            </Tag>
            <Text type="secondary">{result.ms} ms</Text>
          </Space>
          {result.detail && (
            <Alert
              className="mt-2"
              tone="error"
              title="Ping failed"
              description={result.detail}
              data-testid="mcp-runtime-ping-error"
            />
          )}
        </div>
      )}
    </Card>
  )
}

/**
 * Shared "load a list on demand, show error/empty/rows" scaffold.
 *
 * Extracted because the three list cards differ only in the fetch and the row
 * body — duplicating the loading/error/empty ladder three times is exactly how
 * one of them ends up silently rendering nothing on failure.
 */
function ListCard<T>({
  title,
  description,
  testIdBase,
  load,
  emptyText,
  renderRow,
}: {
  title: string
  description: string
  testIdBase: string
  load: () => Promise<T[]>
  emptyText: string
  renderRow: (item: T, index: number) => React.ReactNode
}) {
  const [items, setItems] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await load())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      setItems(null)
    } finally {
      setLoading(false)
    }
  }, [load])

  return (
    <Card
      title={title}
      size="sm"
      data-testid={`${testIdBase}-card`}
      extra={
        <Button
          size="default"
          variant="outline"
          icon={<RotateCw />}
          loading={loading}
          onClick={() => void run()}
          data-testid={`${testIdBase}-load-btn`}
        >
          {items === null ? 'Load' : 'Refresh'}
        </Button>
      }
    >
      <Text type="secondary" className="text-sm">
        {description}
      </Text>
      {error && (
        <Alert
          className="mt-2"
          tone="error"
          title={`Couldn't load ${title.toLowerCase()}`}
          description={error}
          data-testid={`${testIdBase}-error`}
        />
      )}
      {items !== null && items.length === 0 && !error && (
        <Empty
          className="mt-2"
          description={emptyText}
          data-testid={`${testIdBase}-empty`}
        />
      )}
      {items !== null && items.length > 0 && (
        <div className="mt-2 flex flex-col gap-2" data-testid={`${testIdBase}-list`}>
          {items.map(renderRow)}
        </div>
      )}
    </Card>
  )
}

function PromptsCard({ serverId }: { serverId: string }) {
  const load = useCallback(
    () =>
      ApiClient.McpServerRuntime.listPrompts({ id: serverId }).then(r => r.prompts),
    [serverId],
  )
  return (
    <ListCard<Prompt>
      title="Prompts"
      description="Prompt templates this server advertises. Fetch one to see the messages it would inject."
      testIdBase="mcp-runtime-prompts"
      load={load}
      emptyText="This server advertises no prompts."
      renderRow={p => <PromptRow key={p.name} serverId={serverId} prompt={p} />}
    />
  )
}

function PromptRow({ serverId, prompt }: { serverId: string; prompt: Prompt }) {
  const [args, setArgs] = useState('')
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<unknown>(null)
  const [failed, setFailed] = useState(false)
  const hasArgs = (prompt.arguments?.length ?? 0) > 0

  const handleGet = async () => {
    const parsed = parseArgs(args)
    if (!parsed.ok) {
      setFailed(true)
      setOutput(`Arguments must be a JSON object: ${parsed.error}`)
      return
    }
    setBusy(true)
    try {
      const resp = await ApiClient.McpServerRuntime.getPrompt({
        id: serverId,
        name: prompt.name,
        arguments: parsed.value,
      })
      setFailed(false)
      setOutput(resp)
    } catch (e) {
      setFailed(true)
      setOutput(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <Text strong className="[overflow-wrap:anywhere]">
          {prompt.name}
        </Text>
        <Button
          size="default"
          variant="outline"
          loading={busy}
          onClick={handleGet}
          data-testid={`mcp-runtime-prompt-get-${prompt.name}`}
        >
          Get
        </Button>
      </div>
      {prompt.description && (
        <Text type="secondary" className="block">
          {prompt.description}
        </Text>
      )}
      {hasArgs && (
        <Textarea
          rows={2}
          value={args}
          className="mt-2"
          aria-label={`Arguments for ${prompt.name}`}
          placeholder={`{ ${(prompt.arguments ?? [])
            .map(a => `"${a.name}": ""`)
            .join(', ')} }`}
          data-testid={`mcp-runtime-prompt-args-${prompt.name}`}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setArgs(e.target.value)
          }
        />
      )}
      {output !== null && (
        <OutputBlock
          value={output}
          tone={failed ? 'error' : undefined}
          testId={`mcp-runtime-prompt-output-${prompt.name}`}
        />
      )}
    </div>
  )
}

function ResourcesCard({ serverId }: { serverId: string }) {
  const load = useCallback(
    () =>
      ApiClient.McpServerRuntime.listResources({ id: serverId }).then(
        r => r.resources,
      ),
    [serverId],
  )
  return (
    <ListCard<Resource>
      title="Resources"
      description="Documents and data this server exposes. Read one to see exactly what the agent would receive."
      testIdBase="mcp-runtime-resources"
      load={load}
      emptyText="This server exposes no resources."
      renderRow={r => <ResourceRow key={r.uri} serverId={serverId} resource={r} />}
    />
  )
}

function ResourceRow({
  serverId,
  resource,
}: {
  serverId: string
  resource: Resource
}) {
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<unknown>(null)
  const [failed, setFailed] = useState(false)

  const handleRead = async () => {
    setBusy(true)
    try {
      const resp = await ApiClient.McpServerRuntime.readResource({
        id: serverId,
        uri: resource.uri,
      })
      setFailed(false)
      setOutput(resp.content)
    } catch (e) {
      setFailed(true)
      setOutput(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <Text strong className="[overflow-wrap:anywhere]">
            {resource.name}
          </Text>
          <Text type="secondary" className="[overflow-wrap:anywhere] font-mono text-xs">
            {resource.uri}
          </Text>
        </div>
        <Button
          size="default"
          variant="outline"
          loading={busy}
          onClick={handleRead}
          data-testid={`mcp-runtime-resource-read-${resource.uri}`}
        >
          Read
        </Button>
      </div>
      {resource.description && (
        <Text type="secondary" className="block">
          {resource.description}
        </Text>
      )}
      {output !== null && (
        <OutputBlock
          value={output}
          tone={failed ? 'error' : undefined}
          testId={`mcp-runtime-resource-output-${resource.uri}`}
        />
      )}
    </div>
  )
}

function ToolsCard({
  serverId,
  canManage,
}: {
  serverId: string
  canManage: boolean
}) {
  const load = useCallback(
    () => ApiClient.McpServerRuntime.listTools({ id: serverId }).then(r => r.tools),
    [serverId],
  )
  return (
    <ListCard<Tool>
      title="Tools"
      description={
        canManage
          ? 'Tools this server advertises. A test call runs FOR REAL against the server — it is not a dry run.'
          : 'Tools this server advertises.'
      }
      testIdBase="mcp-runtime-tools"
      load={load}
      emptyText="This server advertises no tools."
      renderRow={t => (
        <ToolRow key={t.name} serverId={serverId} tool={t} canManage={canManage} />
      )}
    />
  )
}

function ToolRow({
  serverId,
  tool,
  canManage,
}: {
  serverId: string
  tool: Tool
  canManage: boolean
}) {
  const [args, setArgs] = useState('')
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<unknown>(null)
  const [failed, setFailed] = useState(false)

  const handleCall = async () => {
    const parsed = parseArgs(args)
    if (!parsed.ok) {
      setFailed(true)
      setOutput(`Arguments must be a JSON object: ${parsed.error}`)
      return
    }
    setBusy(true)
    try {
      const resp = await ApiClient.McpServerRuntime.callTool({
        id: serverId,
        name: tool.name,
        arguments: parsed.value,
      })
      // A tool that *ran* but reported failure answers 200 with `is_error` —
      // surface that as an error block, not as a success the admin misreads.
      setFailed(resp.is_error)
      setOutput(resp.content)
    } catch (e) {
      setFailed(true)
      setOutput(e instanceof Error ? e.message : 'Call failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <Text strong className="[overflow-wrap:anywhere]">
          {tool.name}
        </Text>
        {canManage && (
          // Confirm, not a bare button: this invokes the real tool with real
          // side effects. The admin has to acknowledge that before it fires.
          <Confirm
            title={`Call "${tool.name}" now?`}
            description="This runs the tool for real against the server, with whatever side effects it has. There is no dry-run mode."
            okText="Call"
            cancelText="Cancel"
            onConfirm={handleCall}
            data-testid={`mcp-runtime-tool-call-confirm-${tool.name}`}
          >
            <Button
              size="default"
              variant="outline"
              icon={<Play />}
              loading={busy}
              data-testid={`mcp-runtime-tool-call-${tool.name}`}
            >
              Test call
            </Button>
          </Confirm>
        )}
      </div>
      {tool.description && (
        <Text type="secondary" className="block">
          {tool.description}
        </Text>
      )}
      {canManage && (
        <Textarea
          rows={2}
          value={args}
          className="mt-2"
          aria-label={`Arguments for ${tool.name}`}
          placeholder='{ "argument": "value" }'
          data-testid={`mcp-runtime-tool-args-${tool.name}`}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            setArgs(e.target.value)
          }
        />
      )}
      {output !== null && (
        <OutputBlock
          value={output}
          tone={failed ? 'error' : undefined}
          testId={`mcp-runtime-tool-output-${tool.name}`}
        />
      )}
    </div>
  )
}
