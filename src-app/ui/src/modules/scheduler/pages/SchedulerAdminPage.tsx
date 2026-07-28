import { useEffect } from 'react'

import { Permissions } from '@/api-client/permissions'
import {
  Alert,
  Card,
  ErrorState,
  Form,
  FormField,
  InputNumber,
  Paragraph,
  Spin,
  message,
  useForm,
} from '@ziee/kit'
import { usePermission } from '@/core/permissions'
import { SettingsFormActions } from '@/modules/settings/components/SettingsFormActions'
import { SettingsPageContainer } from '@/modules/settings/components/SettingsPageContainer'
import { SchedulerAdmin } from '@/modules/scheduler/stores/schedulerAdmin'

type FormValues = {
  max_active_tasks_per_user: number
  min_interval_seconds: number
  max_horizon_days: number
  max_consecutive_failures: number
  notification_retention_days: number
}

const SUBTITLE = 'Deployment-wide scheduling limits.'

/**
 * Admin "Scheduler" settings page — the deployment-wide guard-rails every
 * scheduled task is bound by: how many tasks one user may keep active, how often
 * a task may fire, how far ahead a self-paced loop may look, when a failing task
 * auto-pauses, and how long run notifications are kept.
 *
 * Composition mirrors the two canonical siblings rather than free-styling:
 * the form is `file-rag`'s `RetrievalLimitsSection` (an admin card of numeric
 * caps — `Form layout="horizontal"` + `FormField` + `InputNumber className="w-40"`,
 * actions in the Card `footer` via `SettingsFormActions`), and the page shell is
 * `auth/SessionSettingsPage` (Spin → ErrorState → read-only Alert → card).
 */
export function SchedulerAdminPage() {
  const { settings, loading, saving, error } = SchedulerAdmin
  const canManage = usePermission(Permissions.SchedulerAdminManage)

  // `defaultValues` is REQUIRED, not decorative: with none, react-hook-form
  // compares `_formValues` (which gains an `undefined` entry per field the
  // moment the Controllers register) against an EMPTY `_defaultValues`, so
  // `isDirty` latches TRUE on the very first render — before the settings row
  // arrives — and the `!isDirty` re-seed guard below then blocks the reset
  // forever, leaving every input blank and unsavable. These are the server's
  // own defaults (mirrors RetrievalLimitsSection).
  const form = useForm<FormValues>({
    defaultValues: {
      max_active_tasks_per_user: 20,
      min_interval_seconds: 300,
      max_horizon_days: 7,
      max_consecutive_failures: 5,
      notification_retention_days: 30,
    },
  })

  useEffect(() => {
    void SchedulerAdmin.loadSettings()
  }, [])

  // Re-seed from the store ONLY while the form has no unsaved edits, so a
  // sync-driven refetch can't clobber values the admin is typing.
  useEffect(() => {
    if (settings && !form.formState.isDirty) {
      form.reset({
        max_active_tasks_per_user: settings.max_active_tasks_per_user,
        min_interval_seconds: settings.min_interval_seconds,
        max_horizon_days: settings.max_horizon_days,
        max_consecutive_failures: settings.max_consecutive_failures,
        notification_retention_days: settings.notification_retention_days,
      })
    }
  }, [settings, form])

  const onSubmit = async (v: FormValues) => {
    try {
      await SchedulerAdmin.updateSettings(v)
      form.reset(v) // saved → let the next store update re-seed again
      message.success('Scheduler settings saved')
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : 'Failed to save scheduler settings',
      )
    }
  }

  if (loading && !settings) {
    return (
      <SettingsPageContainer title="Scheduler" subtitle={SUBTITLE}>
        <div className="flex justify-center py-12">
          <Spin size="lg" label="Loading scheduler settings" />
        </div>
      </SettingsPageContainer>
    )
  }

  // Primary load failed (nothing to show) → a persistent, retryable ErrorState
  // instead of an empty card. A later SAVE failure keeps `settings` and is
  // surfaced by the toast in onSubmit, not here.
  if (error && !settings) {
    return (
      <SettingsPageContainer title="Scheduler" subtitle={SUBTITLE}>
        <ErrorState
          variant="page"
          resource="scheduler settings"
          description="The scheduler limits couldn't be loaded. Check your connection and try again."
          details={error}
          onRetry={() => void SchedulerAdmin.loadSettings()}
          data-testid="scheduler-admin-error"
        />
      </SettingsPageContainer>
    )
  }

  return (
    <SettingsPageContainer
      title="Scheduler"
      subtitle={SUBTITLE}
      data-testid="scheduler-admin-page"
    >
      <Card
        data-testid="scheduler-admin-card"
        title="Limits"
        footer={
          <SettingsFormActions
            onSave={form.handleSubmit(onSubmit)}
            onCancel={() => form.reset()}
            saving={saving}
            saveDisabled={!canManage || !form.formState.isDirty}
            cancelDisabled={!canManage}
            saveDisabledReason={
              canManage ? undefined : 'You need scheduler admin rights to change these.'
            }
            saveTestid="scheduler-admin-save"
            cancelTestid="scheduler-admin-cancel"
          />
        }
      >
        {!canManage && (
          <Alert
            tone="info"
            title="Read-only view"
            description="You need scheduler admin rights to change these."
            data-testid="scheduler-admin-readonly"
            className="mb-3"
          />
        )}

        <Paragraph type="secondary" className="!mb-3 text-sm">
          Guard-rails applied deployment-wide to every user's scheduled tasks. A
          task that would exceed a limit is rejected when it is created or
          updated; a running task is clamped to the limit in force at that moment.
        </Paragraph>

        <Form
          data-testid="scheduler-admin-form"
          name="scheduler-admin-limits-form"
          form={form}
          layout="horizontal"
          disabled={!canManage}
          onSubmit={onSubmit}
        >
          <FormField
            name="max_active_tasks_per_user"
            label="Max active tasks per user"
            description="How many enabled tasks one user may keep at once. Creating another is rejected until one is paused or deleted."
          >
            <InputNumber
              data-testid="scheduler-max-active"
              min={1}
              max={1000}
              className="w-40"
            />
          </FormField>

          <FormField
            name="min_interval_seconds"
            label="Minimum interval"
            description="The fastest cadence any schedule may fire at. A cron expression that would run more often than this is rejected."
          >
            <InputNumber
              data-testid="scheduler-min-interval"
              min={60}
              max={86400}
              suffix="seconds"
              className="w-40"
            />
          </FormField>

          <FormField
            name="max_horizon_days"
            label="Self-paced loop horizon"
            description="How far ahead a self-paced (goal-seeking) loop may schedule its next check before it must stop."
          >
            <InputNumber
              data-testid="scheduler-max-horizon"
              min={1}
              max={365}
              suffix="days"
              className="w-40"
            />
          </FormField>

          <FormField
            name="max_consecutive_failures"
            label="Auto-pause after"
            description="A task that fails this many times in a row is paused automatically, so a broken task stops burning runs."
          >
            <InputNumber
              data-testid="scheduler-max-failures"
              min={1}
              max={100}
              suffix="failures"
              className="w-40"
            />
          </FormField>

          <FormField
            name="notification_retention_days"
            label="Notification retention"
            description="How long run notifications are kept before they are pruned. Set 0 to keep them forever."
          >
            <InputNumber
              data-testid="scheduler-retention"
              min={0}
              max={3650}
              suffix="days"
              className="w-40"
            />
          </FormField>
        </Form>
      </Card>
    </SettingsPageContainer>
  )
}
