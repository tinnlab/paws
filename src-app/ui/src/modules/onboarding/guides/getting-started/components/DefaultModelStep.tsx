import { useEffect } from 'react'
import {
  Alert,
  Button,
  Paragraph,
  Progress,
  Spin,
  Tag,
  Text,
  Title,
} from '@ziee/kit'
import {
  CircleAlert,
  CircleCheck,
  Download,
  HardDriveDownload,
  RotateCw,
  WifiOff,
  X,
} from 'lucide-react'
import { Permissions } from '@/api-client/permissions'
import { usePermission } from '@/core/permissions'
import { formatSpeed, formatTime } from '@/utils/downloadUtils'
import { Hardware as HardwareStore } from '@/modules/hardware/hardware'
import { LlmModelDownload as LlmModelDownloadStore } from '@/modules/llm-provider/stores/llmModelDownload'
import { ModelPicker as ModelPickerStore } from '@/modules/user-llm-providers/modelPicker'
import { RuntimeDownloadProgress as RuntimeDownloadProgressStore } from '@/modules/llm-local-runtime/stores/runtimeDownloadProgress'
import type { OnboardingStepProps } from '@/modules/onboarding/types/onboarding'
import { Onboarding } from '@/modules/onboarding/stores/onboarding'
import { DEFAULT_MODEL } from '@/modules/onboarding/guides/getting-started/defaultModel'
import { DefaultModelStep as DefaultModelStepStore } from '@/modules/onboarding/guides/getting-started/components/stores/defaultModelStep'
import {
  DEFAULT_MODEL_MIN_MEMORY_GB,
  shouldWarnLowMemory,
} from '@/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/memoryAdvisory'
import {
  activeDefaultModelDownload,
  deriveViewState,
  downloadPercent,
  failureReason,
  isDefaultModelInstalled,
  type DefaultModelView,
} from '@/modules/onboarding/guides/getting-started/components/stores/defaultModelStep/viewState'

/**
 * The step's before-next hook: it does nothing, on purpose.
 *
 * INV-3 — "Onboarding is completable without installing the model. The download
 * is offerable, never mandatory; skipping leaves a valid state." Registering an
 * action that always resolves states that intent explicitly (and makes it
 * testable) rather than leaving it to the absence of a call.
 */
async function advanceUnconditionally(): Promise<void> {
  return
}

/**
 * What the step's live region announces for each state.
 *
 * Deliberately a sentence rather than a status word: it is read out of context,
 * with no surrounding layout, to someone who may have activated a control that
 * has since vanished.
 */
function liveStatus(view: DefaultModelView, modelName: string): string {
  switch (view) {
    case 'preparing':
      return `Preparing to install ${modelName}.`
    case 'installing-runtime':
      return 'Step 1 of 2: installing the local runtime.'
    case 'downloading':
      return `Step 2 of 2: downloading ${modelName}. This continues if you move on.`
    case 'already-installed':
      return `${modelName} is installed and ready to use.`
    case 'failed':
      return `${modelName} could not be installed. You can try again, or continue without it.`
    case 'runtime-unavailable':
      return 'No local runtime is available for this machine right now. You can continue without it.'
    default:
      return ''
  }
}

/**
 * DefaultModelStep — install a local model with no API key (INV-1 / INV-2).
 *
 * Three properties this surface exists to hold, in the order they are easiest
 * to break:
 *
 *  1. **It never blocks Next (INV-3).** The registered before-next action is a
 *     no-op and `setReady(true)` is unconditional, so the wizard advances from
 *     every state — including mid-download and after a failure. Nothing here may
 *     ever call `setReady(false)`.
 *  2. **It does not own the download (INV-6 / DEC-9).** Every progress figure is
 *     read from the live download stores and the whole view is re-DERIVED on each
 *     render, so leaving and returning re-attaches by construction. There is no
 *     unmount cleanup that cancels anything — deliberately.
 *  3. **It offers what it cannot finish.** A user without the admin permissions
 *     gets an explanation rather than a broken control (DEC-12), mirroring how
 *     `MemorySetupStep` handles `MemoryAdminManage`.
 */
export default function DefaultModelStep({ registerBeforeNext }: OnboardingStepProps) {
  // Gate on what the WHOLE flow needs, not just its last step. Installing walks
  // three subsystems — enable + group-assign a provider, download and default a
  // runtime, then download the model — and each is separately permissioned. A
  // control gated only on `llm_models::create` renders enabled for a user who
  // will hit a 403 partway through, after having already changed provider state.
  // `RuntimeVersionRead` matters twice over: its store action early-returns
  // SILENTLY without it, so the runtime leg would conclude "nothing installed"
  // even when a runtime is present.
  const canInstall = usePermission({
    allOf: [
      // Reads the flow performs before it writes anything. `GroupsRead` is easy
      // to miss and expensive to miss: the group lookup is not wrapped in a
      // try/catch, so without it the install throws AFTER the provider has
      // already been enabled — a half-applied administrative change.
      Permissions.LlmProvidersRead,
      // `loadLlmProviders` gates on BOTH provider-read and model-read and
      // early-returns silently without either — so omitting this one produces an
      // enabled button whose install ends in "No local provider exists", which
      // is not even true. It is not covered by the Users-group grant.
      Permissions.LlmModelsRead,
      Permissions.GroupsRead,
      Permissions.RuntimeVersionRead,
      Permissions.UserLlmProvidersRead,
      // Writes.
      Permissions.LlmModelsCreate,
      Permissions.LlmProvidersEdit,
      Permissions.LlmProvidersAssignGroups,
      Permissions.RuntimeVersionCreate,
      Permissions.RuntimeVersionUpdate,
    ],
  })

  // Reactive reads — these drive the derivation below and must be read at the
  // top level of render, never inside a `.map()` or a conditional.
  const { downloads } = LlmModelDownloadStore
  // The MODEL PICKER's own provider list — see the note on
  // `DeriveViewStateInput.providers`.
  //
  // Specifically NOT `UserLlmProviders`, which looks right and is not: it backs
  // the personal-API-key page and filters `provider_type !== 'local'`, so the
  // local provider is never in it and "already installed" could never render.
  // And not the ADMIN list either, which includes providers shared with nobody.
  // `ModelPicker.providers` is the unfiltered user-reachable set that
  // `defaultModelId()` itself reasons over — the same list that decides whether
  // this model really is the user's default.
  const { providers } = ModelPickerStore
  const { activeByKey } = RuntimeDownloadProgressStore
  const {
    installing,
    stage,
    error,
    runtimeUnavailable,
    runtimeKey,
    loading,
    contextUnavailable,
    cancelError,
  } = DefaultModelStepStore
  const { hardwareInfo } = HardwareStore

  useEffect(() => {
    // INV-3: the step is offerable, never mandatory. Next is enabled on arrival
    // and the before-next hook does nothing — installing is not a precondition
    // for finishing Onboarding, and neither is a successful install.
    Onboarding.setReady(true)
    registerBeforeNext(advanceUnconditionally)

    // Loaded for EVERY user, not just those who can install. A user without the
    // admin permissions still needs to know whether the model is already there —
    // its own load self-gates on the read permission they do hold.
    void DefaultModelStepStore.loadContext()
  }, [])

  if (!canInstall) {
    // Two different situations, and telling them apart is the whole point: a
    // deployment where an admin has yet to install the model, and one where it
    // is installed and waiting in their picker. Saying "your administrator
    // installs it" in the second case leaves the user waiting for something they
    // already have.
    const installed = isDefaultModelInstalled(providers)
    return (
      <StepShell>
        {installed ? (
          <Paragraph type="secondary">
            <Tag
              tone="success"
              icon={<CircleCheck />}
              data-testid="onboarding-default-model-installed-tag"
            >
              Installed
            </Tag>{' '}
            <strong>{DEFAULT_MODEL.displayName}</strong> is installed on this
            deployment and ready for you &mdash; you&rsquo;ll find it in your
            model picker.
          </Paragraph>
        ) : (
          <Paragraph type="secondary">
            Ziee can run a model locally on this machine, with no API key and no
            account. Your administrator installs it once for the whole
            deployment; after that it appears in your model picker like any
            other model.
          </Paragraph>
        )}
      </StepShell>
    )
  }

  if (loading) {
    return (
      <StepShell>
        <div className="flex justify-center mt-8">
          <Spin label="Loading" />
        </div>
      </StepShell>
    )
  }

  const runtimeDownloads = Array.from(activeByKey.values())
  const derivation = {
    downloads,
    runtimeDownloads,
    providers,
    stage,
    installing,
    error,
    runtimeUnavailable,
    runtimeKey,
  }
  const view = deriveViewState(derivation)
  const activeDownload = activeDefaultModelDownload(downloads)
  const runtimeSnapshot = runtimeKey
    ? runtimeDownloads.find(r => r.key === runtimeKey)
    : undefined

  return (
    <StepShell>
      {/* One polite live region for the whole step.
       *
       * Every state change here is the RESULT of a control that then disappears
       * or becomes disabled — pressing Install replaces it with a disabled
       * button, which browsers blur, so a screen-reader user is left with focus
       * at the top of the document and no idea anything happened. The visible
       * progress and success copy are plain text with no role, so nothing else
       * announces. This is the one element that tells them where they are.
       */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        data-testid="onboarding-default-model-live-status"
      >
        {liveStatus(view, DEFAULT_MODEL.displayName)}
      </div>

      {view === 'already-installed' ? (
        <Paragraph type="secondary">
          <Tag
            tone="success"
            icon={<CircleCheck />}
            data-testid="onboarding-default-model-installed-tag"
          >
            Installed
          </Tag>{' '}
          <strong>{DEFAULT_MODEL.displayName}</strong> is ready — it&rsquo;s
          already your default model, so you can start chatting as soon as you
          finish here.
        </Paragraph>
      ) : (
        <Paragraph type="secondary">
          Install <strong>{DEFAULT_MODEL.displayName}</strong> to run entirely on
          this machine &mdash; no API key, no account, and nothing sent to a
          provider when you chat. It becomes your default model, and you can
          swap it later from Settings. Installing itself downloads{' '}
          {DEFAULT_MODEL.sizeGb} GB from Hugging Face, so it needs an internet
          connection once.
        </Paragraph>
      )}

      {/* Placed ABOVE the install control on purpose: a warning that exists to
          inform a decision has to be visible before the button that makes it,
          which at ~390px it is not if it sits below the card. */}
      {view === 'offer' && shouldWarnLowMemory(hardwareInfo?.memory?.total_ram) && (
        <Alert
          data-testid="onboarding-default-model-memory-alert"
          tone="warning"
          title={`This machine has less than ${DEFAULT_MODEL_MIN_MEMORY_GB} GB of memory`}
          description="The model will still install, but it may run slowly. You can install it anyway, or skip and choose a smaller model later."
        />
      )}

      {contextUnavailable && (
        <Alert
          data-testid="onboarding-default-model-context-alert"
          tone="warning"
          title="Couldn't check whether the model is already installed"
          description="What follows may be out of date — if you already have this model, installing again is unnecessary. Reload to try again, or continue and check later from Settings."
        />
      )}

      <div className="border rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <Text strong>{DEFAULT_MODEL.displayName}</Text>
            <div>
              <Text type="secondary" className="text-sm">
                {DEFAULT_MODEL.mainFilename} &middot; {DEFAULT_MODEL.sizeGb} GB
                &middot; runs offline
              </Text>
            </div>
          </div>
          <StepAction view={view} />
        </div>

        {view === 'installing-runtime' && (
          <RuntimeProgress
            percent={runtimeSnapshot?.percent}
            version={runtimeSnapshot?.version}
          />
        )}

        {view === 'downloading' && (
          <ModelProgress
            percent={downloadPercent(activeDownload)}
            speedBps={activeDownload?.progress_data?.speed_bps}
            etaSeconds={activeDownload?.progress_data?.eta_seconds}
          />
        )}

        {view === 'preparing' && (
          <Text type="secondary" className="text-sm">
            Preparing&hellip;
          </Text>
        )}

        {/* A cancel that FAILED, surfaced while the transfer is still running.
            Without this the user clicks Cancel, sees the bar keep moving, and
            has no way to tell whether the request was even sent. */}
        {cancelError && view === 'downloading' && (
          <Alert
            data-testid="onboarding-default-model-cancel-error-alert"
            tone="error"
            icon={<CircleAlert />}
            title={cancelError}
            description="The download is still running. You can try Cancel again, or continue — leaving this step does not stop it."
          />
        )}
      </div>

      {view === 'failed' && (
        <Alert
          data-testid="onboarding-default-model-error-alert"
          tone="error"
          icon={<CircleAlert />}
          title="The model couldn't be installed"
          description={
            <span>
              {failureReason(derivation) ?? 'The install failed.'} You can retry,
              or continue &mdash; you can install it later from Settings.
            </span>
          }
        />
      )}

      {view === 'runtime-unavailable' && (
        <Alert
          data-testid="onboarding-default-model-offline-alert"
          tone="warning"
          icon={<WifiOff />}
          title="No local runtime is available for this machine right now"
          description="Installing needs a llama.cpp build, and none could be reached. This is usually a network problem. Continue for now — you can install it later from Settings."
        />
      )}

    </StepShell>
  )
}

/** Title + icon shell, matching the sibling Onboarding steps. */
function StepShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-xl flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <HardDriveDownload className="text-3xl text-primary" />
        <Title level={3} className="!mb-0">
          Local Model
        </Title>
      </div>
      {children}
    </div>
  )
}

/** The one control that changes with the state — install / cancel / retry. */
function StepAction({ view }: { view: ReturnType<typeof deriveViewState> }) {
  if (view === 'already-installed') return null

  if (view === 'downloading') {
    return (
      <Button
        data-testid="onboarding-default-model-cancel-button"
        variant="outline"
        icon={<X />}
        // Named, not just "Cancel": this sits inside wizard chrome that has its
        // own navigation, so a screen-reader user hearing "Cancel, button" could
        // not tell whether it stops the download or leaves Onboarding.
        aria-label="Cancel the model download"
        onClick={() => {
          void DefaultModelStepStore.cancelInstall()
        }}
      >
        Cancel download
      </Button>
    )
  }

  if (view === 'installing-runtime' || view === 'preparing') {
    return (
      <Button
        data-testid="onboarding-default-model-install-button"
        icon={<Download />}
        loading
        disabled
      >
        Installing
      </Button>
    )
  }

  const isRetry = view === 'failed' || view === 'runtime-unavailable'
  return (
    <Button
      data-testid={
        isRetry
          ? 'onboarding-default-model-retry-button'
          : 'onboarding-default-model-install-button'
      }
      icon={isRetry ? <RotateCw /> : <Download />}
      onClick={() => {
        DefaultModelStepStore.dismissError()
        void DefaultModelStepStore.install()
      }}
    >
      {isRetry ? 'Try again' : `Install (${DEFAULT_MODEL.sizeGb} GB)`}
    </Button>
  )
}

function RuntimeProgress({
  percent,
  version,
}: {
  percent: number | undefined
  version: string | undefined
}) {
  return (
    <div className="flex flex-col gap-1">
      <Text type="secondary" className="text-sm">
        Step 1 of 2 &mdash; installing the local runtime
        {version ? ` (${version})` : ''}
      </Text>
      <Progress
        data-testid="onboarding-default-model-runtime-progress"
        aria-label="Local runtime download progress"
        value={Math.round(percent ?? 0)}
        tone="primary"
        showInfo
        format={(p: number) => <Text className="text-xs">{p}%</Text>}
      />
    </div>
  )
}

function ModelProgress({
  percent,
  speedBps,
  etaSeconds,
}: {
  percent: number | null
  speedBps: number | undefined
  etaSeconds: number | undefined
}) {
  return (
    <div className="flex flex-col gap-1">
      <Text type="secondary" className="text-sm">
        Step 2 of 2 &mdash; downloading the model. You can carry on; this keeps
        running in the background.
      </Text>
      <Progress
        data-testid="onboarding-default-model-progress"
        aria-label="Model download progress"
        value={percent ?? 0}
        tone="primary"
        showInfo
        format={(p: number) => {
          const parts = [`${p}%`]
          if (typeof speedBps === 'number' && speedBps > 0) parts.push(formatSpeed(speedBps))
          if (typeof etaSeconds === 'number' && etaSeconds > 0) {
            parts.push(`ETA ${formatTime(etaSeconds)}`)
          }
          return <Text className="text-xs">{parts.join(' · ')}</Text>
        }}
      />
    </div>
  )
}
