import { useEffect } from 'react'
import {
  Button,
  Dialog,
  Form,
  FormField,
  Input,
  Switch,
  Textarea,
  message,
  useForm,
} from '@ziee/kit'
import type { UpdateWorkflow, Workflow } from '@/api-client/types'
import { Workflow as WorkflowStore } from '@/modules/workflow/stores/workflow'

type FormValues = {
  display_name: string
  description: string
  tags: string
  enabled: boolean
}

/** `Workflow.tags` is an untyped JSON column; in practice a string array. */
function tagsToText(tags: unknown): string {
  return Array.isArray(tags) ? tags.filter(t => typeof t === 'string').join(', ') : ''
}

function textToTags(text: string): string[] {
  return text
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
}

/**
 * Edit a user-scope workflow's metadata — the only way to rename, re-tag, or
 * DISABLE a workflow. The builder saves the definition (`PUT .../definition`)
 * and never touches these fields, so `PUT /api/workflows/{id}` had no caller and
 * `enabled` was write-once-at-install in practice.
 *
 * Caller gates on scope + permission; the backend additionally rejects a
 * non-owner and any non-`user` scope, so this is never offered for a system
 * workflow.
 */
export function WorkflowMetadataDialog({
  workflow,
  open,
  onClose,
}: {
  workflow: Workflow
  open: boolean
  onClose: () => void
}) {
  const form = useForm<FormValues>({
    defaultValues: {
      display_name: '',
      description: '',
      tags: '',
      enabled: true,
    },
  })

  // Re-seed from the row on every open (and when the drawer swaps workflows) so
  // a previous edit session's values never carry into a different workflow.
  useEffect(() => {
    if (open) {
      form.reset({
        display_name: workflow.display_name ?? '',
        description: workflow.description ?? '',
        tags: tagsToText(workflow.tags),
        enabled: workflow.enabled,
      })
    }
  }, [open, workflow, form])

  const onValid = async (values: FormValues) => {
    // Send only what changed: every field on `UpdateWorkflow` is optional and
    // the backend treats a present field as an overwrite, so posting the whole
    // form would resurrect a value another device just changed.
    const patch: UpdateWorkflow = {}
    const nextName = values.display_name.trim()
    if (nextName !== (workflow.display_name ?? '')) patch.display_name = nextName
    const nextDesc = values.description.trim()
    if (nextDesc !== (workflow.description ?? '')) patch.description = nextDesc
    const nextTags = textToTags(values.tags)
    if (values.tags !== tagsToText(workflow.tags)) patch.tags = nextTags
    if (values.enabled !== workflow.enabled) patch.enabled = values.enabled

    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    try {
      await WorkflowStore.updateWorkflow(workflow.id, patch)
      message.success('Workflow updated')
      onClose()
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Failed to update workflow')
    }
  }

  return (
    <Dialog
      open={open}
      title="Edit workflow details"
      description="Rename, re-tag, or disable this workflow. Its steps are edited in the builder."
      data-testid="wf-metadata-dialog"
      onOpenChange={v => {
        if (!v) onClose()
      }}
      footer={
        <>
          <Button
            variant="outline"
            data-testid="wf-metadata-cancel-btn"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            data-testid="wf-metadata-save-btn"
            loading={form.formState.isSubmitting}
            onClick={() => void form.handleSubmit(onValid)()}
          >
            Save
          </Button>
        </>
      }
    >
      <Form
        form={form}
        onSubmit={onValid}
        name="workflow-metadata"
        data-testid="wf-metadata-form"
      >
        <FormField
          name="display_name"
          label="Display name"
          description={`Shown instead of the bundle name "${workflow.name}". Leave blank to use it.`}
        >
          <Input data-testid="wf-metadata-display-name" />
        </FormField>
        <FormField name="description" label="Description">
          <Textarea rows={3} data-testid="wf-metadata-description" />
        </FormField>
        <FormField
          name="tags"
          label="Tags"
          description="Comma-separated."
        >
          <Input data-testid="wf-metadata-tags" placeholder="reporting, weekly" />
        </FormField>
        <FormField
          name="enabled"
          label="Enabled"
          description="A disabled workflow stays installed but cannot be run and is not offered to the agent."
          valuePropName="checked"
        >
          <Switch data-testid="wf-metadata-enabled" />
        </FormField>
      </Form>
    </Dialog>
  )
}
