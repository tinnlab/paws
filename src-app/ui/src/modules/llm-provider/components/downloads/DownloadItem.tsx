import { X, CircleCheck, CircleAlert, Eye } from 'lucide-react'
import { Button, Card, Flex, Space, Tag, Tooltip, Text } from '@ziee/kit'
import { useNavigate } from 'react-router-dom'
import { DownloadProgress } from '@/modules/llm-provider/components/downloads/DownloadProgress'
import { formatBytes, formatSpeed, formatETA } from '@/utils/downloadUtils'
import type { DownloadInstance } from '@/api-client/types'

interface DownloadItemProps {
  download: DownloadInstance
  mode: 'full' | 'compact' | 'minimal'
  onCancel?: () => void
  onClose?: () => void
  onViewDetails?: () => void
}

export function DownloadItem({
  download,
  mode,
  onCancel,
  onClose,
  onViewDetails,
}: DownloadItemProps) {
  const navigate = useNavigate()

  const isActive =
    download.status === 'downloading' || download.status === 'pending'
  const isTerminal =
    download.status === 'completed' ||
    download.status === 'failed' ||
    download.status === 'cancelled'

  const handleNavigateToProvider = () => {
    navigate(`/settings/llm-providers/${download.provider_id}`)
  }

  const renderStatusTag = () => {
    switch (download.status) {
      case 'downloading':
      case 'pending':
        return <Tag variant="outline" tone="info" data-testid="llm-download-status-tag">Downloading...</Tag>
      case 'completed':
        return (
          <Tag variant="outline" tone="success" icon={<CircleCheck />} data-testid="llm-download-status-tag">
            Downloaded
          </Tag>
        )
      case 'failed':
        return (
          <Tag variant="outline" tone="error" icon={<CircleAlert />} data-testid="llm-download-status-tag">
            Failed
          </Tag>
        )
      case 'cancelled':
        return <Tag variant="outline" data-testid="llm-download-status-tag">Cancelled</Tag>
      default:
        return null
    }
  }

  const renderProgressInfo = () => {
    const { progress_data } = download
    if (!progress_data) return null

    const { current, total, speed_bps, eta_seconds } = progress_data

    return (
      <Space size="small">
        <Text type="secondary">
          {formatBytes(current)} / {formatBytes(total)}
        </Text>
        {speed_bps > 0 && (
          <>
            <Text type="secondary">•</Text>
            <Text type="secondary">{formatSpeed(speed_bps)}</Text>
          </>
        )}
        {eta_seconds > 0 && (
          <>
            <Text type="secondary">•</Text>
            <Text type="secondary">ETA: {formatETA(eta_seconds)}</Text>
          </>
        )}
      </Space>
    )
  }

  // FULL MODE (for LocalProviderSettings)
  if (mode === 'full') {
    return (
      <Card size="sm" data-testid="llm-download-item-card">
        <Flex vertical gap="small" className="w-full">
          <div
            className="flex justify-between items-center"
          >
            <Space>
              <Text strong>{download.request_data.display_name}</Text>
              {renderStatusTag()}
            </Space>
            <Space>
              {onViewDetails && (
                <Button
                  variant="link"
                  size="default"
                  icon={<Eye />}
                  onClick={onViewDetails}
                  data-testid="llm-download-view-details-btn"
                >
                  View Details
                </Button>
              )}
              {isActive && onCancel && (
                <Button
                  variant="ghost"
                  size="default"
                  icon={<X />}
                  onClick={onCancel}
                  data-testid="llm-download-cancel-btn"
                >
                  Cancel
                </Button>
              )}
              {isTerminal && onClose && (
                <Button
                  variant="link"
                  size="default"
                  icon={<X />}
                  onClick={onClose}
                  data-testid="llm-download-close-btn"
                >
                  Close
                </Button>
              )}
            </Space>
          </div>

          {download.request_data.description && (
            <Text type="secondary">{download.request_data.description}</Text>
          )}

          <DownloadProgress
            current={download.progress_data?.current || 0}
            total={download.progress_data?.total || 0}
            status={download.status}
          />

          {renderProgressInfo()}

          {download.error_message && (
            <Text type="danger">{download.error_message}</Text>
          )}
        </Flex>
      </Card>
    )
  }

  // COMPACT MODE (for future use)
  if (mode === 'compact') {
    return (
      <div>
        <div
          className="flex justify-between items-center mb-1"
        >
          <span
            className="cursor-pointer text-primary underline underline-offset-2"
            onClick={handleNavigateToProvider}
          >
            {download.request_data.display_name}
          </span>
          {isActive && onCancel && (
            <Button
              variant="ghost"
              size="default"
              icon={<X />}
              onClick={onCancel}
              data-testid="llm-download-compact-cancel-btn"
            >
              Cancel
            </Button>
          )}
        </div>
        <DownloadProgress
          current={download.progress_data?.current || 0}
          total={download.progress_data?.total || 0}
          status={download.status}
          size="small"
        />
        {renderProgressInfo()}
      </div>
    )
  }

  // MINIMAL MODE (for DownloadIndicator widget)
  if (mode === 'minimal') {
    // Truncation is CSS, not a character count. `substring(0, 30)` used to cut
    // the name here, which is wrong twice over: it cannot respond to the
    // panel's actual width (so it over-truncates a wide panel and still
    // overflows a narrow one), and it destroyed the full name, leaving nothing
    // for a title/tooltip to reveal. `min-w-0` on the row AND on the name is
    // what makes the CSS truncation actually engage — a flex child's default
    // `min-width: auto` refuses to shrink below its content, which is how the
    // name pushed the percentage out of the row.
    const fullName = download.request_data.display_name || 'Unnamed Model'

    return (
      <Tooltip content={renderProgressInfo()}>
        <div
          className="mb-2 w-full min-w-0 cursor-pointer"
          onClick={handleNavigateToProvider}
          data-testid="llm-download-item-card"
        >
          <div className="flex w-full min-w-0 items-baseline justify-between gap-2 mb-0.5">
            <Text
              ellipsis
              title={fullName}
              className="min-w-0 flex-1 text-xs"
              data-testid="llm-download-item-name"
            >
              {fullName}
            </Text>
            <Text
              type="secondary"
              className="shrink-0 text-xs"
              data-testid="llm-download-item-percent"
            >
              {Math.round(
                ((download.progress_data?.current || 0) /
                  (download.progress_data?.total || 1)) *
                  100,
              )}
              %
            </Text>
          </div>
          <DownloadProgress
            current={download.progress_data?.current || 0}
            total={download.progress_data?.total || 0}
            status={download.status}
            size="small"
          />
        </div>
      </Tooltip>
    )
  }

  return null
}
