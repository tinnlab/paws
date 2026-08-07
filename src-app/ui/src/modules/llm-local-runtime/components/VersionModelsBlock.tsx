import { useEffect, useState } from 'react'
import {
  Accordion,
  Button,
  Descriptions,
  Empty,
  Flex,
  Select,
  Space,
  Tag,
  Text,
  Tooltip,
} from '@ziee/kit'
import {
  ChevronDown,
  ChevronUp,
  CirclePlay,
  HeartPulse,
  Power,
  RotateCw,
  Stethoscope,
  Wrench,
} from 'lucide-react'
import { message } from '@ziee/kit'
import type { RuntimeEngine } from '../types'
import { LiveLogsPanel } from './LiveLogsPanel'
import { RuntimeModelUsage } from '@/modules/llm-local-runtime/stores/runtimeModelUsage'

interface ModelInfo {
  id: string
  display_name: string
  running: boolean
  pinned: boolean
}

interface RawModel {
  id: string
  display_name: string
  provider_id: string
  provider_name: string
  running: boolean
  pinned: boolean
}

/**
 * Per-version models block — extracted from the old standalone
 * RuntimeModelsByVersion card so it can render inline under each
 * installed-version row in InstalledVersionsCard. Groups the models
 * by provider, exposes start/stop/restart + version-swap controls
 * (manage gate) + the Logs disclosure (logs gate, independent
 * permission so a logs-only operator still sees them on a running
 * model).
 *
 * Receives `versionOptions` from the parent — the swap dropdown's
 * full set of installed versions for this engine, including the
 * current one (so the Select shows the active value as well).
 */
export function VersionModelsBlock({
  engine,
  versionId,
  models,
  versionOptions,
  canManage,
  canViewLogs,
}: {
  engine: RuntimeEngine
  versionId: string
  models: RawModel[]
  versionOptions: { value: string; label: string }[]
  canManage: boolean
  canViewLogs: boolean
}) {
  const groups = groupByProvider(models)
  const label = (
    <Text type="secondary" className="text-xs">
      Models using this version ({models.length})
    </Text>
  )
  return (
    <Accordion
      ghost
      defaultValue="models"
      data-testid={`llmrt-version-models-${versionId}`}
      items={[
        {
          key: 'models',
          label,
          children:
            models.length === 0 ? (
              <Empty
                description="No models use this version — safe to delete"
                data-testid={`llmrt-version-models-empty-${versionId}`}
              />
            ) : (
              <Flex direction="column" gap="small">
                {groups.map(group => (
                  <Flex direction="column" gap="small" key={group.providerId}>
                    <Text type="secondary" className="text-xs">
                      {group.providerName}
                    </Text>
                    {group.models.map(m => (
                      <ModelRow
                        key={m.id}
                        engine={engine}
                        model={m}
                        versionId={versionId}
                        versionOptions={versionOptions}
                        canManage={canManage}
                        canViewLogs={canViewLogs}
                      />
                    ))}
                  </Flex>
                ))}
              </Flex>
            ),
        },
      ]}
    />
  )
}

function ModelRow({
  engine,
  model,
  versionId,
  versionOptions,
  canManage,
  canViewLogs,
}: {
  engine: RuntimeEngine
  model: ModelInfo
  versionId: string
  versionOptions: { value: string; label: string }[]
  canManage: boolean
  canViewLogs: boolean
}) {
  const { acting, instances, statuses, health } = RuntimeModelUsage
  const [expanded, setExpanded] = useState(false)
  const busy = acting.get(model.id) || false
  const instance = instances.get(model.id)
  const status = statuses.get(model.id)
  const probe = health.get(model.id)
  const failed = status?.status === 'failed'

  // Diagnose a model that ISN'T running: the usage snapshot only carries a
  // boolean, so "never started" and "gave up after five crashes" look identical
  // until this resolves the real state.
  const handleDiagnose = async () => {
    try {
      const s = await RuntimeModelUsage.loadStatus(model.id)
      if (s.status !== 'failed') {
        message.info(`${model.display_name} is ${s.status}`)
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to read status')
    }
  }

  const handleClearFailed = async () => {
    try {
      const r = await RuntimeModelUsage.clearFailed(engine, model.id)
      message.success(
        r.cleared
          ? `${model.display_name} reset — auto-start can retry it`
          : `${model.display_name} was not in a failed state`,
      )
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : 'Failed to clear the failed state',
      )
    }
  }

  const handleHealth = async () => {
    try {
      const h = await RuntimeModelUsage.checkHealth(model.id)
      if (h.healthy) {
        message.success(
          `${model.display_name} answered${
            h.response_time_ms != null ? ` in ${h.response_time_ms} ms` : ''
          }`,
        )
      } else {
        message.error(
          h.message ?? `${model.display_name} is up but not answering`,
          { duration: 8000 },
        )
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Health check failed')
    }
  }

  // Lazily fetch instance detail when the row is expanded on a running model.
  useEffect(() => {
    if (expanded && model.running) {
      RuntimeModelUsage.loadInstance(model.id)
    }
  }, [expanded, model.running, model.id])

  return (
    <Flex direction="column" gap="small" className="py-1" data-testid={`llmrt-model-row-${model.id}`}>
      <Flex align="center" justify="between" gap="small">
        <Space>
          <span className={`inline-block size-2 rounded-full ${model.running ? 'bg-primary' : 'bg-muted-foreground/40'}`} aria-hidden />
          <span>{model.display_name}</span>
          {!model.pinned && <Tag variant="outline" tone="default" data-testid={`llmrt-model-inherited-tag-${model.id}`}>inherited</Tag>}
          {/* Probe results are pinned to the row, not left in a toast: an
              operator triaging several models needs to compare them. */}
          {failed && (
            <Tag
              variant="outline"
              tone="error"
              data-testid={`llmrt-model-failed-tag-${model.id}`}
            >
              failed
            </Tag>
          )}
          {model.running && probe && (
            <Tag
              variant="outline"
              tone={probe.healthy ? 'success' : 'error'}
              data-testid={`llmrt-model-health-tag-${model.id}`}
            >
              {probe.healthy ? 'healthy' : 'not responding'}
            </Tag>
          )}
        </Space>
        <Space>
          {canManage && (
            <>
              <Tooltip
                title={
                  versionOptions.length < 2
                    ? 'Only one engine version installed — install another to swap'
                    : 'Swap this model to a different engine version'
                }
              >
                <Select
                  className="min-w-[180px]"
                  data-testid={`llmrt-model-version-select-${model.id}`}
                  value={versionId}
                  options={versionOptions}
                  loading={busy}
                  disabled={busy || versionOptions.length < 2}
                  onChange={vid =>
                    RuntimeModelUsage.swapVersion(engine, model.id, vid).catch(
                      () => {},
                    )
                  }
                  aria-label={
                    versionOptions.length < 2
                      ? `Engine version for ${model.display_name} — swapping disabled, only one engine version installed; install another to swap`
                      : `Engine version for ${model.display_name}`
                  }
                />
              </Tooltip>
              {model.running ? (
                <>
                  <Button
                    variant="outline"
                    icon={<HeartPulse />}
                    data-testid={`llmrt-model-health-${model.id}`}
                    loading={busy}
                    onClick={() => void handleHealth()}
                    aria-label={`Check health of ${model.display_name}`}
                  >
                    Health
                  </Button>
                  <Button
                    icon={<RotateCw />}
                    data-testid={`llmrt-model-restart-${model.id}`}
                    loading={busy}
                    onClick={() =>
                      RuntimeModelUsage.restartModel(engine, model.id).catch(
                        () => {},
                      )
                    }
                  >
                    Restart
                  </Button>
                  <Button
                    variant="destructive"
                    icon={<Power />}
                    data-testid={`llmrt-model-stop-${model.id}`}
                    loading={busy}
                    onClick={() =>
                      RuntimeModelUsage.stopModel(engine, model.id).catch(
                        () => {},
                      )
                    }
                  >
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  {/* Only offered once a probe has actually reported `failed` —
                      a recovery button on a merely-stopped model would read as
                      "something is wrong here" on every idle row. */}
                  {failed ? (
                    <Button
                      variant="outline"
                      icon={<Wrench />}
                      data-testid={`llmrt-model-clear-failed-${model.id}`}
                      loading={busy}
                      onClick={() => void handleClearFailed()}
                      aria-label={`Clear the failed state of ${model.display_name}`}
                    >
                      Clear failed state
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      icon={<Stethoscope />}
                      data-testid={`llmrt-model-diagnose-${model.id}`}
                      loading={busy}
                      onClick={() => void handleDiagnose()}
                      aria-label={`Check the runtime state of ${model.display_name}`}
                    >
                      Diagnose
                    </Button>
                  )}
                  <Button
                    icon={<CirclePlay />}
                    data-testid={`llmrt-model-start-${model.id}`}
                    loading={busy}
                    onClick={() =>
                      RuntimeModelUsage.startModel(engine, model.id).catch(
                        () => {},
                      )
                    }
                  >
                    Start
                  </Button>
                </>
              )}
            </>
          )}
          {model.running && canViewLogs && (
            <Button
              variant="ghost"
              data-testid={`llmrt-model-logs-${model.id}`}
              icon={expanded ? <ChevronUp /> : <ChevronDown />}
              onClick={() => setExpanded(e => !e)}
              aria-label={
                expanded
                  ? `Hide logs for ${model.display_name}`
                  : `Show logs for ${model.display_name}`
              }
              aria-expanded={expanded}
            >
              Logs
            </Button>
          )}
        </Space>
      </Flex>

      {expanded && model.running && (
        <Flex direction="column" gap="small" className="pl-6">
          {instance && (
            <Descriptions
              size="sm"
              column={2}
              data-testid={`llmrt-model-instance-desc-${model.id}`}
              items={[
                { key: 'status', label: 'Status', children: instance.status },
                { key: 'port', label: 'Port', children: instance.local_port },
                { key: 'baseUrl', label: 'Base URL', children: instance.base_url },
                {
                  key: 'started',
                  label: 'Started',
                  children: instance.started_at
                    ? new Date(instance.started_at).toLocaleString()
                    : '—',
                },
                {
                  key: 'health',
                  label: 'Last health check',
                  children: instance.last_health_check
                    ? new Date(instance.last_health_check).toLocaleString()
                    : '—',
                },
                ...(instance.error_message
                  ? [{ key: 'error', label: 'Error', children: instance.error_message }]
                  : []),
              ]}
            />
          )}
          <LiveLogsPanel modelId={model.id} />
        </Flex>
      )}
    </Flex>
  )
}

interface ProviderGroup {
  providerId: string
  providerName: string
  models: ModelInfo[]
}

function groupByProvider(models: RawModel[]): ProviderGroup[] {
  const map = new Map<string, ProviderGroup>()
  for (const m of models) {
    let g = map.get(m.provider_id)
    if (!g) {
      g = { providerId: m.provider_id, providerName: m.provider_name, models: [] }
      map.set(m.provider_id, g)
    }
    g.models.push({
      id: m.id,
      display_name: m.display_name,
      running: m.running,
      pinned: m.pinned,
    })
  }
  return Array.from(map.values())
}
