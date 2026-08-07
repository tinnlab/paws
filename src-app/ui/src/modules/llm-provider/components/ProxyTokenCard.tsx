import { useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Alert, Button, Card, Confirm, Text, message } from '@ziee/kit'
import { Permissions } from '@/api-client/permissions'
import { usePermission } from '@/core/permissions'
import { LlmProvider } from '@/modules/llm-provider/stores/llmProvider'

/**
 * Rotate the local provider's proxy token.
 *
 * The token is what an external OpenAI-compatible client presents to
 * `/api/local-llm/v1/*`. It is stored write-only (never returned by a GET) and
 * the provider update endpoint explicitly refuses to set it, so rotation was the
 * only way to change it — and it had a backend with no button. Leaking a token
 * previously meant editing the database.
 *
 * The new value is rendered once, right here, and never persisted to the store:
 * this response is the only place it exists on the client.
 */
export function ProxyTokenCard({ providerId }: { providerId: string }) {
  // Read the reactive slice unconditionally in the component body — a store
  // proxy read IS a hook, so it may not sit inside a render helper behind an
  // early return (the crash both sibling components carry a comment about).
  const { rotatingProxyToken } = LlmProvider
  const canEdit = usePermission(Permissions.LlmProvidersEdit)
  const [token, setToken] = useState<string | null>(null)

  if (!canEdit) return null

  const handleRotate = async () => {
    try {
      setToken(await LlmProvider.rotateProxyToken(providerId))
      message.success('Proxy token rotated')
    } catch (e) {
      message.error(
        e instanceof Error ? e.message : 'Failed to rotate the proxy token',
      )
    }
  }

  return (
    <Card title="Proxy token" size="sm" data-testid="llm-provider-proxy-token-card">
      <Text type="secondary" className="block">
        Authenticates OpenAI-compatible clients calling this server's
        <Text code> /api/local-llm/v1</Text> proxy. Rotating it immediately
        invalidates the previous token — every client using it must be updated.
      </Text>
      <div className="mt-3">
        <Confirm
          title="Rotate the proxy token?"
          description="The current token stops working right away. Any external client configured with it will get 401s until you paste in the new one."
          okText="Rotate"
          cancelText="Cancel"
          okButtonProps={{ danger: true }}
          onConfirm={handleRotate}
          data-testid="llm-provider-proxy-token-rotate-confirm"
        >
          <Button
            variant="outline"
            icon={<KeyRound />}
            loading={Boolean(rotatingProxyToken[providerId])}
            data-testid="llm-provider-proxy-token-rotate-btn"
          >
            Rotate token
          </Button>
        </Confirm>
      </div>
      {token && (
        <Alert
          className="mt-3"
          tone="warning"
          title="Copy this token now — it will not be shown again"
          description={
            <Text
              code
              copyable={{ text: token, label: 'Copy proxy token' }}
              className="[overflow-wrap:anywhere]"
            >
              {token}
            </Text>
          }
          data-testid="llm-provider-proxy-token-value"
        />
      )}
    </Card>
  )
}
