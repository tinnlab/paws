import * as React from 'react'
import { Skeleton } from '@ziee/kit'
import type { DatePickerProps } from '@ziee/kit/kit/date-picker'

// The kit DatePicker pulls react-day-picker + date-fns + the shadcn calendar
// (~323 KB) into whatever chunk statically imports it. A calendar renders on very
// few surfaces (only the MCP / workflow elicitation date fields), so we load it
// lazily: this wrapper is the ONLY app import of the DatePicker, and it uses a
// dynamic `import()` so react-day-picker/date-fns land in a lazy chunk fetched
// only when a date field actually renders — keeping them out of the eager entry.
//
// It MUST be a forwardRef that forwards every prop + the ref, because the kit
// FormField injects `value`/`onChange`/`name`/`id`/`ref` onto its child via
// React.cloneElement (see sdk/packages/kit/src/kit/form.tsx), and the underlying
// DatePicker is itself a React.forwardRef<HTMLButtonElement>.
const DatePickerInner = React.lazy(() =>
  import('@ziee/kit/kit/date-picker').then(m => ({ default: m.DatePicker })),
)

export type { DatePickerProps } from '@ziee/kit/kit/date-picker'

export const LazyDatePicker = React.forwardRef<HTMLButtonElement, DatePickerProps>(
  function LazyDatePicker(props, ref) {
    return (
      <React.Suspense fallback={<Skeleton className="h-9 w-full" />}>
        <DatePickerInner ref={ref} {...props} />
      </React.Suspense>
    )
  },
)
