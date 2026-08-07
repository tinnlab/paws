import { useState } from 'react'
import { Download, Import, ShieldCheck } from 'lucide-react'
import {
  Button,
  Card,
  Dialog,
  Select,
  Space,
  Spin,
  Text,
  Empty,
  Dropdown,
  ErrorState,
} from '@ziee/kit'
import { message } from '@ziee/kit'
import { Field, FieldDescription, FieldTitle } from '@ziee/kit/shadcn/field'
import { Permissions } from '@/api-client/permissions'
import { usePermission } from '@/core/permissions'
import { SettingsPageContainer } from '@/modules/settings/components/SettingsPageContainer'
import { CitationCard } from '../components/CitationCard'
import { ImportCitationsModal } from '../components/ImportCitationsModal'
import { Citations as CitationsStore } from '@/modules/citations/stores/citations'

const EXPORT_FORMATS: { key: string; label: string; ext: string; mime: string }[] = [
  { key: 'text', label: 'Formatted (CSL style)', ext: 'txt', mime: 'text/plain' },
  { key: 'bibtex', label: 'BibTeX (.bib)', ext: 'bib', mime: 'application/x-bibtex' },
  { key: 'ris', label: 'RIS (.ris)', ext: 'ris', mime: 'application/x-research-info-systems' },
  { key: 'csljson', label: 'CSL-JSON (.json)', ext: 'json', mime: 'application/json' },
]

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * The one export format that takes a CSL style. The others are structured
 * interchange formats with no style dimension, so picking a style for them
 * would be meaningless — only this key opens the style dialog.
 */
const STYLED_FORMAT = 'text'

export function CitationsSettingsPage() {
  const { entries, loading, importing, verifying, error, styles, stylesLoading } =
    CitationsStore
  // Import / Delete require `citations::manage`; Verify-all + Export are `use`.
  const canManage = usePermission(Permissions.CitationsManage)
  const [importOpen, setImportOpen] = useState(false)
  const [styleOpen, setStyleOpen] = useState(false)
  const [style, setStyle] = useState<string>('')

  const handleVerifyAll = async () => {
    try {
      const report = await CitationsStore.verifyAll()
      const verified = report.results.filter(
        r => r.verification_status === 'verified',
      ).length
      const bad = report.results.length - verified
      message.info(`Verified ${verified}; ${bad} need attention.`)
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Verify failed')
    }
  }

  const handleExport = async (format: string, styleName?: string) => {
    try {
      const out = await CitationsStore.exportLibrary(format, styleName)
      const fmt = EXPORT_FORMATS.find(f => f.key === format)
      download(out, `citations.${fmt?.ext ?? 'txt'}`, fmt?.mime ?? 'text/plain')
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Export failed')
    }
  }

  // "Formatted (CSL style)" is the only format whose output depends on a style,
  // and it previously shipped a style parameter the UI never sent — so it always
  // rendered in pandoc's built-in default and the bundled styles were unreachable.
  const handleExportSelect = (format: string) => {
    if (format !== STYLED_FORMAT) {
      void handleExport(format)
      return
    }
    setStyleOpen(true)
    void CitationsStore.loadStyles()
  }

  return (
    <SettingsPageContainer
      title="Citations"
      subtitle="Your verified bibliography library. Import references, verify they resolve to real records, and export in a citation style."
    >
      <Card data-testid="cite-settings-card">
        <Space className="mb-3" wrap>
          {canManage && (
            <Button
              variant="outline"
              icon={<Import />}
              loading={importing}
              onClick={() => setImportOpen(true)}
              data-testid="cite-settings-import-button"
            >
              Import
            </Button>
          )}
          <Button
            icon={<ShieldCheck />}
            loading={verifying}
            disabled={entries.length === 0 || !canManage}
            onClick={handleVerifyAll}
            data-testid="cite-settings-verify-all-button"
          >
            Verify all
          </Button>
          <Dropdown
            disabled={entries.length === 0}
            items={EXPORT_FORMATS.map(f => ({ key: f.key, label: f.label }))}
            onSelect={handleExportSelect}
            data-testid="cite-settings-export-dropdown"
          >
            <Button icon={<Download />} data-testid="cite-settings-export-button">Export</Button>
          </Dropdown>
          <Text type="secondary">{entries.length} reference(s)</Text>
        </Space>

        {loading ? (
          <Spin label="Loading" />
        ) : entries.length === 0 ? (
          error ? (
            <ErrorState
              resource="citations"
              description="Your bibliography couldn't be loaded. Check your connection and try again."
              details={error}
              onRetry={() => void CitationsStore.load()}
              data-testid="cite-settings-error"
            />
          ) : (
            <Empty data-testid="cite-settings-empty" />
          )
        ) : (
          <div>
            {entries.map(e => (
              <CitationCard key={e.id} entry={e} canManage={canManage} />
            ))}
          </div>
        )}
      </Card>

      <ImportCitationsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />

      <Dialog
        open={styleOpen}
        title="Export in a citation style"
        data-testid="cite-export-style-dialog"
        onOpenChange={v => {
          if (!v) setStyleOpen(false)
        }}
        footer={
          <>
            <Button
              variant="outline"
              data-testid="cite-export-style-cancel"
              onClick={() => setStyleOpen(false)}
            >
              Cancel
            </Button>
            <Button
              data-testid="cite-export-style-submit"
              onClick={() => {
                setStyleOpen(false)
                void handleExport(STYLED_FORMAT, style || undefined)
              }}
            >
              Export
            </Button>
          </>
        }
      >
        <Field>
          <FieldTitle>Citation style</FieldTitle>
          <Select
            value={style}
            allowClear
            clearLabel="Use the default style"
            loading={stylesLoading}
            disabled={styles.length === 0}
            aria-label="Citation style"
            placeholder={
              styles.length === 0
                ? 'No styles bundled — the default will be used'
                : 'Default style'
            }
            data-testid="cite-export-style-select"
            options={styles.map(s => ({ label: s, value: s }))}
            onChange={(v: string) => setStyle(v)}
          />
          <FieldDescription>
            Renders each reference as formatted text. Leave it unset to use the
            built-in default style.
          </FieldDescription>
        </Field>
      </Dialog>
    </SettingsPageContainer>
  )
}
