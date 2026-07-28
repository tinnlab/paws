/**
 * CORE-owned, surface-side redaction of tool arguments (ITEM-17 / DEC-1).
 *
 * Lives in `chat/core/rail/` rather than inside the mcp extension because it
 * must be UNAVOIDABLE. The blind audit found the first cut had it exactly
 * backwards: redaction was applied by one contribution's optional detail body,
 * and every tool family that supplied its own descriptor pre-empted that body —
 * so the families most likely to carry a credential (app-control, code sandbox,
 * web fetch) were precisely the ones printing arguments verbatim. A security
 * property that each of ~17 contributors has to remember is not a property.
 *
 * The chat card renders `tool_use.input` completely UNREDACTED today, so a
 * secret the model passed to a tool (an `Authorization` header, an API key)
 * prints verbatim into the transcript and stays there. The persisted
 * `mcp_tool_calls` recorder already redacts — but only on ITS copy, and its
 * denylist had confirmed holes.
 *
 * This is the mirror of the backend's `record.rs::is_secret_key`, INCLUDING the
 * five keys that were open there and are closed by this feature (`cookie`,
 * `credentials`, `x_auth_token`, `openai_api_key`, `bearer-token`). Keep the two
 * lists in step: `redactArgs.test.ts` pins this one, and
 * `record.rs`'s own `#[cfg(test)]` pins the other.
 *
 * NOT a substitute for backend redaction — it cannot be. The raw block is still
 * present in the conversation payload this client already received, so this hides
 * the value from the SURFACE, which is what DEC-1 asks for; the authoritative,
 * permission-gated raw record lives behind the reveal endpoint.
 */

/**
 * Exact-match (case-insensitive) secret key names. Exact rather than substring
 * for the same reason the backend is: a substring rule would redact
 * `token_count` and `password_policy`, which are legitimate, user-meaningful
 * arguments — and INV-2 says every user-meaningful detail must stay reachable.
 */
const SECRET_KEYS: ReadonlySet<string> = new Set([
  'authorization',
  'auth',
  'bearer',
  'bearer-token',
  'bearer_token',
  'password',
  'passwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'api-key',
  'x-api-key',
  'x_auth_token',
  'x-auth-token',
  'client_secret',
  'private_key',
  'cookie',
  'credentials',
  'openai_api_key',
])

export const REDACTED = '[redacted]'

/** True when `key` names a value that must never be rendered. */
export function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase())
}

/**
 * Deep-copy `value`, replacing every secret-keyed value with `[redacted]`.
 * Arrays and nested objects are walked; non-objects are returned unchanged.
 */
export function redactValue(value: unknown, depth = 0): unknown {
  // Depth bound: a hostile/cyclic structure must not blow the stack in a render.
  // Past the bound we return REDACTED, not the value: the failure mode of a
  // redactor must be loss of detail, never loss of redaction. (The backend
  // mirror recurses unbounded, so a secret nested deeply enough would otherwise
  // be stripped from the stored row and printed on the surface — a silent
  // divergence exactly where this file claims to be a mirror.)
  if (depth > 12) return REDACTED
  if (Array.isArray(value)) return value.map(v => redactValue(v, depth + 1))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretKey(k) ? REDACTED : redactValue(v, depth + 1)
    }
    return out
  }
  return value
}

/** Pretty-printed, redacted JSON for a detail panel / inline body. */
export function redactedJson(value: unknown): string {
  try {
    return JSON.stringify(redactValue(value), null, 2)
  } catch {
    return String(value)
  }
}
