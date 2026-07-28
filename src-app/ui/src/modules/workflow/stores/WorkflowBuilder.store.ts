import { ApiClient } from '@/api-client'
import { Permissions } from '@/api-client/permissions'
import { type InputDef, type ValidateDefResponse, type Workflow, type WorkflowDef } from '@/api-client/types'
import { hasPermissionNow } from '@/core/permissions'
import { defineLocalStore } from '@ziee/framework/store-kit'
import {
  type BuilderStep,
  type StepKind,
  createStep,
} from '../components/builder/stepForms'
import {
  type FindingIdentity,
  describeRequestError,
  humaniseRequestError,
} from '../components/builder/validationCopy'

// ---------------------------------------------------------------------------
// PRIVATE, per-instance store backing ONE builder editing session (ITEM-6).
// A builder is an editing session, not a shared singleton — so it uses
// `defineLocalStore`: each mount of the builder page owns its own working
// definition, and its sync listeners auto-unsubscribe on unmount. It is NOT
// registered in `Stores.X` (local stores never are); the page instantiates it
// with `WorkflowBuilderStoreDef.use()` and threads the instance to its child
// panels as a prop.
// ---------------------------------------------------------------------------

/** The working definition. `steps` carries the richer `BuilderStep[]` (the base
 *  fields the generated `StepDef` drops) — assignable back to `WorkflowDef` at
 *  the API boundary. */
export interface BuilderDef {
  $schema?: string
  inputs: InputDef[]
  steps: BuilderStep[]
  max_runtime_secs?: number
}

export function emptyDef(): BuilderDef {
  return { inputs: [], steps: [] }
}

export function toBuilderDef(def: WorkflowDef): BuilderDef {
  return {
    $schema: def.$schema,
    max_runtime_secs: def.max_runtime_secs,
    inputs: def.inputs ?? [],
    // wire → builder: the generated `StepDef` is flatten-lossy (it omits the
    // base fields `id`/`description`/`message`/`depends_on` that serde flatten
    // still emits + sends on the wire), so `StepDef` is not assignable to
    // `BuilderStep` at the type level. A SINGLE honest narrowing re-adds those
    // wire-present fields. (No compile-time drift guard is possible here — both
    // sides derive from the same lossy `StepDef`; see the note in `stepForms.ts`.)
    steps: (def.steps ?? []) as BuilderStep[],
  }
}

export function toWorkflowDef(def: BuilderDef): WorkflowDef {
  return {
    ...(def.$schema ? { $schema: def.$schema } : {}),
    ...(def.max_runtime_secs != null
      ? { max_runtime_secs: def.max_runtime_secs }
      : {}),
    inputs: def.inputs,
    // builder → wire needs NO cast: `BuilderStep` (= StepBase & StepDef) is
    // assignable to the wire `StepDef`. Runtime drift-safety is provided by the
    // backend def→bundle round-trip integration test (see `stepForms.ts`).
    steps: def.steps,
  }
}

const VALIDATE_DEBOUNCE_MS = 400

/** Which act owns the message currently in `error`. The two acts fail
 *  independently and at different times, so a run of one must never retire —
 *  or overwrite — the other's failure. */
export type ErrorSource = 'save' | 'validate' | null

const SAVE_FAILURE_FALLBACK = 'The workflow could not be saved — try again.'
const VALIDATE_FAILURE_FALLBACK =
  'The workflow could not be checked — try again.'

/** The slice of builder state one validation run writes. */
export interface ValidationSlice {
  validating: boolean
  validation: ValidateDefResponse | null
  error: string | null
  errorSource: ErrorSource
  /** The validator finding `error` restates, when it restates one. See
   *  `findingStillPresent` — it is how a message about a condition the author
   *  has since FIXED gets retired. */
  errorFinding: FindingIdentity | null
}

/**
 * Codes `POST /validate-def` is structurally UNABLE to decide, so its silence
 * about them is not evidence of anything.
 *
 * A draft has no materialized bundle, so the def-validation endpoint skips the
 * `prompt_file:` existence/confinement half entirely (see `check_prompt_files`
 * in `server/src/modules/workflow/validate.rs`). Only the SAVE path, which
 * validates against the real bundle root, can reach a verdict on these. Reading
 * "the check did not report it" as "the author fixed it" would retire a true
 * save failure the moment the author touched any field — exactly the
 * nothing-was-fixed retirement this rule exists to prevent.
 */
const UNDECIDABLE_BY_DEF_CHECK: readonly string[] = [
  'WORKFLOW_PROMPT_FILE_MISSING',
  'WORKFLOW_PROMPT_FILE_ESCAPE',
]

/**
 * Is the finding a stored failure describes still among the blocking findings
 * of a fresh check?
 *
 * `validate_for_install` collapses the FIRST blocking finding into the save
 * error, so a save failure is a claim about one specific finding. Once a later
 * check no longer reports that finding, the claim is provably false — and it
 * would otherwise sit above a green "No blocking errors." until the author
 * happened to press Save again.
 *
 * Two things make "the check no longer reports it" weaker evidence than it
 * looks, and both resolve the SAME way — keep the message:
 *
 * 1. the check may not be able to answer the question at all
 *    (`UNDECIDABLE_BY_DEF_CHECK`);
 * 2. the stored `location` may have been GUESSED out of the save error's
 *    message rather than sent by the backend (`FindingIdentity.locationCertain`)
 *    — a location-less `workflow.yaml: …` finding parses as
 *    `location: "workflow.yaml"` and would never match the structured result's
 *    absent location, retiring the error on the first check with nothing fixed.
 *
 * Retirement is only ever taken on PROOF; every uncertainty leaves the author's
 * message where it is (at worst until they press Save again).
 */
function findingStillPresent(
  result: ValidateDefResponse,
  finding: FindingIdentity,
): boolean {
  if (UNDECIDABLE_BY_DEF_CHECK.includes(finding.code)) return true
  const errors = result.errors ?? []
  if (!finding.locationCertain) {
    return errors.some(e => e.code === finding.code)
  }
  return errors.some(
    e => e.code === finding.code && (e.location ?? null) === finding.location,
  )
}

export interface ValidateRunnerDeps {
  getDef: () => BuilderDef
  request: (def: WorkflowDef) => Promise<ValidateDefResponse>
  apply: (mutate: (d: ValidationSlice) => void) => void
}

/**
 * The validation run, with its two ordering rules — extracted so both are
 * directly testable (the store itself is a `defineLocalStore`, reachable only
 * through a React hook).
 *
 * 1. **Only the newest run may write.** Validation is debounced AND fired
 *    directly (mount, save), so two requests are routinely in flight; an older
 *    response landing last used to overwrite the newer result — which drives
 *    the findings panel, the step list's invalid markers AND the Save gate.
 * 2. **A run clears only the error validation itself owns — plus a save error
 *    it can PROVE is spent.** A successful check says nothing about a failed
 *    SAVE, so blanking `error` wholesale made the save/install failure
 *    self-erase (and the green "No blocking errors." return) while the workflow
 *    was still unsaved. Symmetrically, a failed check does not overwrite a save
 *    failure. The ONE exception: when the save failure restated a specific
 *    validator finding and a fresh check no longer reports that finding, the
 *    author has fixed exactly the thing the message describes — leaving it on
 *    screen (above a green "No blocking errors.") states something provably
 *    untrue. A save error that is NOT a validator finding (a name collision, a
 *    502, "give the workflow a name") is untouched: a successful check proves
 *    nothing about those.
 */
export function createValidateRunner(
  deps: ValidateRunnerDeps,
): () => Promise<void> {
  let issued = 0
  return async () => {
    const seq = ++issued
    const def = deps.getDef()
    deps.apply(d => {
      d.validating = true
    })
    try {
      const result = await deps.request(toWorkflowDef(def))
      if (seq !== issued) return // a newer run has already answered
      deps.apply(d => {
        d.validation = result
        d.validating = false
        const spentSaveError =
          d.errorSource === 'save' &&
          !!d.errorFinding &&
          !findingStillPresent(result, d.errorFinding)
        if (d.errorSource === 'validate' || spentSaveError) {
          d.error = null
          d.errorSource = null
          d.errorFinding = null
        }
      })
    } catch (error) {
      if (seq !== issued) return // a newer run has already answered
      deps.apply(d => {
        d.validating = false
        // Keep the prior validation rather than blanking it on a transient
        // failure; surface the error so Save isn't silently stuck — unless a
        // save failure is already on screen, which outranks it.
        if (d.errorSource === 'save') return
        const described = describeRequestError(
          error,
          def.steps,
          VALIDATE_FAILURE_FALLBACK,
        )
        d.error = described.text
        d.errorSource = 'validate'
        d.errorFinding = described.finding
      })
    }
  }
}

export const WorkflowBuilderStoreDef = defineLocalStore({
  immer: true,
  state: {
    /** null in create mode until saved; the workflow id in edit mode. */
    workflowId: null as string | null,
    /** Workflow name — only submitted on create (definition PUT preserves it). */
    name: '' as string,
    def: emptyDef() as BuilderDef,
    dirty: false,
    selectedStepId: null as string | null,
    validation: null as ValidateDefResponse | null,
    validating: false,
    saving: false,
    loading: false,
    loadError: null as string | null,
    /** The author-facing failure sentence. This store is the SINGLE place a
     *  raw failure is turned into copy (`describeRequestError`); the panel and
     *  the page render this string verbatim. */
    error: null as string | null,
    /** Which act `error` belongs to — see `createValidateRunner`. */
    errorSource: null as ErrorSource,
    /** The validator finding `error` restates, when it restates one. */
    errorFinding: null as FindingIdentity | null,
    /** Flipped when the workflow being edited is deleted on another device. */
    deletedExternally: false,
  },

  actions: (set, get) => {
    // Per-instance debounce handle (the actions closure is built once per store
    // instance, so this timer never leaks across concurrent builders).
    let validateTimer: ReturnType<typeof setTimeout> | null = null

    const runValidate = createValidateRunner({
      getDef: () => get().def,
      request: def => ApiClient.Workflow.validateDef(def),
      apply: set,
    })

    const scheduleValidate = () => {
      if (validateTimer) clearTimeout(validateTimer)
      validateTimer = setTimeout(() => {
        validateTimer = null
        void runValidate()
      }, VALIDATE_DEBOUNCE_MS)
    }

    const detectExternalChanges = async () => {
      const id = get().workflowId
      if (!id) return
      if (!hasPermissionNow(Permissions.WorkflowsRead)) return
      try {
        const def = await ApiClient.Workflow.getDefinition({ id })
        // Only refresh from the server when the author has no unsaved edits, so
        // a cross-device refetch never clobbers in-progress work.
        if (!get().dirty) {
          set(d => {
            d.def = toBuilderDef(def)
          })
        }
      } catch {
        set(d => {
          d.deletedExternally = true
        })
      }
    }

    return {
      /** Start a blank create session. */
      initEmpty: () => {
        set(d => {
          d.workflowId = null
          d.name = ''
          d.def = emptyDef()
          d.dirty = false
          d.selectedStepId = null
          d.validation = null
          d.loadError = null
          d.error = null
          d.errorSource = null
          d.errorFinding = null
          d.deletedExternally = false
        })
      },

      /** Load an existing workflow's definition into an edit session. */
      load: async (id: string) => {
        if (!hasPermissionNow(Permissions.WorkflowsRead)) return
        set(d => {
          d.loading = true
          d.loadError = null
        })
        try {
          const def = await ApiClient.Workflow.getDefinition({ id })
          const builderDef = toBuilderDef(def)
          // Capture the friendly name so a recreate-after-external-delete
          // (save → POST) can send it back — the definition endpoint omits the
          // name, and once the row is deleted it can't be re-read. Best-effort:
          // a failure here must not block loading the definition.
          let displayName = ''
          try {
            const wf = await ApiClient.Workflow.get({ id })
            displayName = wf.display_name ?? ''
          } catch {
            // Leave the name empty; recreate falls back to a default slug.
          }
          set(d => {
            d.workflowId = id
            d.name = displayName
            d.def = builderDef
            d.dirty = false
            d.loading = false
            d.selectedStepId = builderDef.steps[0]?.id ?? null
            d.deletedExternally = false
          })
          void runValidate()
        } catch (error) {
          set(d => {
            d.loading = false
            // The LOAD boundary humanises through the same one place every
            // other failure surface does. `error.message` here is the generated
            // api-client's `HTTP error! status: 502 - <the whole response body>`
            // — routinely a full HTML error page, which the page renders into
            // `ErrorState`'s details. There is no definition to attribute a
            // finding against yet (the load is what failed), so no steps.
            //
            // `boundary: 'read'` because opening a workflow is NOT a change:
            // the mutation copy ("the server rejected this change", "permission
            // to make this change") describes an act the author never
            // performed. It also lets the 400 this endpoint really answers with
            // — a stored workflow.yaml that no longer deserializes — keep the
            // server's "which step/field" diagnostic instead of discarding it.
            d.loadError = humaniseRequestError(error, [], {
              boundary: 'read',
              fallback: 'This workflow could not be opened — try again.',
            })
          })
        }
      },

      setName: (name: string) => {
        set(d => {
          d.name = name
          d.dirty = true
        })
      },

      selectStep: (id: string | null) => {
        set(d => {
          d.selectedStepId = id
        })
      },

      addStep: (kind: StepKind) => {
        set(d => {
          const step = createStep(
            kind,
            d.def.steps.map(s => s.id),
          )
          d.def.steps.push(step)
          d.selectedStepId = step.id
          d.dirty = true
        })
        scheduleValidate()
      },

      updateStep: (id: string, patch: Record<string, unknown>) => {
        set(d => {
          const step = d.def.steps.find(s => s.id === id)
          if (!step) return
          Object.assign(step, patch)
          d.dirty = true
        })
        scheduleValidate()
      },

      reorderStep: (from: number, to: number) => {
        set(d => {
          const steps = d.def.steps
          if (
            from < 0 ||
            from >= steps.length ||
            to < 0 ||
            to >= steps.length ||
            from === to
          ) {
            return
          }
          const [moved] = steps.splice(from, 1)
          steps.splice(to, 0, moved)
          d.dirty = true
        })
        scheduleValidate()
      },

      deleteStep: (id: string) => {
        set(d => {
          d.def.steps = d.def.steps.filter(s => s.id !== id)
          if (d.selectedStepId === id) {
            d.selectedStepId = d.def.steps[0]?.id ?? null
          }
          d.dirty = true
        })
        scheduleValidate()
      },

      updateInputs: (inputs: InputDef[]) => {
        set(d => {
          d.def.inputs = inputs
          d.dirty = true
        })
        scheduleValidate()
      },

      /** Debounced validation — called by every mutation. */
      scheduleValidate,
      /** Immediate validation (used on mount / before save). */
      validate: runValidate,
      /** Re-check the edited workflow's server-side existence (cross-device
       *  delete detection); refreshes the def when there are no local edits. */
      detectExternalChanges,

      /** Persist. PUT-in-place when we own a live row; otherwise POST to
       *  create — this covers both the first save AND recreating a workflow
       *  that was deleted on another device (a PUT to the dead id would 404).
       *  Returns the saved workflow; throws a friendly Error on failure. */
      save: async (): Promise<Workflow> => {
        const { workflowId, name, def, deletedExternally } = get()
        // Recreate (deleted elsewhere) OR first-save both POST. Only a live,
        // still-existing row updates in place.
        const willUpdate = !!workflowId && !deletedExternally
        const trimmedName = name.trim()
        // A fresh create (create mode) requires a name — that's the one flow
        // with a visible name field. A recreate has no name input, so it falls
        // back to the captured display name (or a backend default slug).
        if (!workflowId && !trimmedName) {
          const msg = 'Give the workflow a name before saving'
          set(d => {
            d.error = msg
            d.errorSource = 'save'
            d.errorFinding = null
          })
          throw new Error(msg)
        }
        set(d => {
          d.saving = true
          d.error = null
          d.errorSource = null
          d.errorFinding = null
        })
        try {
          const payload = toWorkflowDef(def)
          let workflow: Workflow
          if (willUpdate) {
            workflow = await ApiClient.Workflow.updateDefinition({
              id: workflowId,
              ...payload,
            })
          } else {
            workflow = await ApiClient.Workflow.create({
              ...(trimmedName ? { name: trimmedName } : {}),
              ...payload,
            })
          }
          set(d => {
            // Adopt the (possibly new) id and drop the stale-delete flag so the
            // next save updates the freshly-created row in place.
            d.workflowId = workflow.id
            d.dirty = false
            d.saving = false
            d.deletedExternally = false
          })
          return workflow
        } catch (error) {
          const errObj =
            error && typeof error === 'object'
              ? (error as { error_code?: string; status?: number })
              : {}
          const isNameCollision =
            errObj.error_code === 'WORKFLOW_NAME_EXISTS' || errObj.status === 409
          // NEVER `error.message`: the api-client formats a transport failure as
          // `HTTP error! status: 502 - <the whole response body>`, which would
          // land verbatim in the Alert title AND the page toast. This is the
          // ONE humanisation boundary — what lands in `error` is what the panel
          // and the toast show, unchanged.
          const described = isNameCollision
            ? {
                text: `A workflow named '${trimmedName || 'this'}' already exists — choose a different name`,
                finding: null,
              }
            : describeRequestError(error, def.steps, SAVE_FAILURE_FALLBACK)
          const msg = described.text
          set(d => {
            d.saving = false
            d.error = msg
            d.errorSource = 'save'
            // When the save was rejected by a specific validator finding, keep
            // hold of WHICH — a later successful check retires the message once
            // the author has fixed it.
            d.errorFinding = described.finding
          })
          // Re-throw a friendly Error so the page toast shows the actionable
          // message (the page surfaces `e.message`).
          throw new Error(msg)
        }
      },
    }
  },

  // Runs on MOUNT; listeners auto-unsubscribe on UNMOUNT.
  init: ({ on, get, set, actions }) => {
    on('sync:workflow', event => {
      const { action, id } = event.data
      if (id !== get().workflowId) return
      if (action === 'delete') {
        set(d => {
          d.deletedExternally = true
        })
        return
      }
      // A non-delete change to OUR workflow on another device — reconcile.
      void actions.detectExternalChanges()
    })
    on('sync:reconnect', () => {
      // Detect a delete we may have missed while disconnected. `detectExternalChanges`
      // self-gates on the read permission (the refetch endpoint enforces it).
      if (get().workflowId) void actions.detectExternalChanges()
    })
  },
})

export type WorkflowBuilderStore = ReturnType<typeof WorkflowBuilderStoreDef.use>
