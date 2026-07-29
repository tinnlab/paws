/**
 * A realistically long advertised MCP tool description (~2,000 chars), used by
 * the `deep-chat-tool-approval-long-desc` gallery cell.
 *
 * Sized from what the live-app audit actually observed on a real MCP server, not
 * an arbitrary stress value: a description this long used to grow the approval
 * card until the Deny/Approve row fell below a 1280×900 fold, so the user could
 * not reach the decision controls without scrolling.
 *
 * Lives in its own module (no React imports) so the unit test that guards the
 * cell can import it directly.
 */
export const LONG_TOOL_DESCRIPTION = [
  'Fetch a multi-day weather forecast for a location from the Acme Weather API.',
  'The location string is sent verbatim to the upstream service over TLS; responses are not cached by this server.',
  'Supported location formats: a free-form place name ("San Francisco, CA"), an ISO 3166-2 subdivision code, a postal code paired with a two-letter country code, or a decimal "lat,lon" pair. Ambiguous place names resolve to the most populous match, which may not be the one you meant — pass coordinates when precision matters.',
  'The `units` argument selects metric (celsius, millimetres, metres per second) or imperial (fahrenheit, inches, miles per hour); it affects every numeric field in the response, including the ones nested under `daily` and `hourly`.',
  'The `days` argument bounds the forecast horizon between 1 and 14. Values beyond the plan limit are silently clamped rather than rejected, so a caller asking for 14 days on a 7-day plan receives 7 days and no warning.',
  'Each daily entry carries a high, a low, a precipitation probability, a precipitation accumulation, a dominant condition code, sunrise and sunset timestamps in the location local timezone, and a UV index. Hourly entries additionally carry wind bearing, gust speed, relative humidity, dew point and cloud cover.',
  'Timestamps are ISO 8601 with an explicit offset. Historical observations are not available through this tool; use the archive endpoint for anything before the current local day.',
  'Rate limits apply per API key: sustained requests above the plan quota receive HTTP 429 with a Retry-After header, and this tool surfaces that as an error rather than retrying on your behalf.',
  'Forecast data is provided on a best-effort basis and must not be used as the sole input to safety-critical or life-critical decisions.',
].join('\n\n')
