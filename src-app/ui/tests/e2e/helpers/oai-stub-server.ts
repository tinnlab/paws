import * as http from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * A tiny in-worker, OpenAI-compatible chat server that emits a SCRIPTED tool
 * call.
 *
 * Why this exists: the chat loop runs SERVER-SIDE (Rust → reqwest → the
 * provider's `base_url`), so `page.route()` cannot touch it — the same reason
 * `llm/helpers/repository-health-mock.ts` exists, and this follows that
 * pattern. Every existing elicitation e2e is either frontend-mocked (the backend
 * never runs) or gated on a real LLM key (skips when unset), so there was no way
 * to prove a backend behaviour through the UI deterministically.
 *
 * The specific thing it makes testable: a model cannot be ASKED to JSON-encode
 * its tool arguments on demand, so a real-LLM test of that defect would be a
 * coin flip. Scripting the exact malformed call makes it deterministic and
 * unskippable.
 *
 * Wire shape is ported from `server/tests/common/stub_chat.rs` (streaming SSE
 * `tool_calls` deltas + a `finish_reason: "tool_calls"` chunk + `[DONE]`).
 *
 * Two gotchas carried over from the Rust stub, both of which silently break the
 * test if ignored:
 *  - emit the PREFIXED wire name (`{server_id}__ask_user`) the request's
 *    `tools[]` actually advertised — the chat loop recovers the route by
 *    splitting on `__`, so the bare name is never dispatched;
 *  - use a FRESH `tool_use_id` per emitted call, or the MCP loop dedups and
 *    silently drops the second one.
 */
export class OaiStubServer {
  private server: http.Server
  private port: number
  private callCount = 0
  /** The bare tool the stub should call on the first turn. */
  private toolName: string
  /** Raw arguments JSON string, emitted verbatim (may be deliberately malformed). */
  private argumentsJson: string
  /** Text to answer with once a tool result has come back. */
  private followUpText: string

  private constructor(
    server: http.Server,
    port: number,
    toolName: string,
    argumentsJson: string,
    followUpText: string,
  ) {
    this.server = server
    this.port = port
    this.toolName = toolName
    this.argumentsJson = argumentsJson
    this.followUpText = followUpText
  }

  static async start(opts: {
    toolName: string
    /** Emitted verbatim as the tool call's `arguments`. */
    argumentsJson: string
    followUpText?: string
  }): Promise<OaiStubServer> {
    const server = http.createServer()
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
      server.on('error', reject)
    })
    const stub = new OaiStubServer(
      server,
      port,
      opts.toolName,
      opts.argumentsJson,
      opts.followUpText ?? 'Done.',
    )
    server.on('request', (req, res) => stub.handle(req, res))
    return stub
  }

  /** Register this as a `custom` provider's `base_url` (loopback is allowed by
   *  the DEV_LOCAL SSRF policy that `validate_base_url` uses). */
  baseUrl(): string {
    return `http://127.0.0.1:${this.port}/v1`
  }

  calls(): number {
    return this.callCount
  }

  async dispose(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.url?.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-model', object: 'model' }] }))
      return
    }
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      this.callCount++
      let parsed: Record<string, unknown> = {}
      try {
        parsed = JSON.parse(body || '{}')
      } catch {
        /* fall through to the text answer */
      }
      const messages = Array.isArray(parsed.messages) ? (parsed.messages as unknown[]) : []
      // Only call the tool on the FIRST iteration of this turn. Scanning after
      // the last user message (not the whole history) keeps a later turn from
      // wrongly looking like a continuation.
      const lastUserIdx = messages.map(m => (m as { role?: string }).role).lastIndexOf('user')
      const tail = lastUserIdx >= 0 ? messages.slice(lastUserIdx + 1) : messages
      const hadToolResult = tail.some(m => (m as { role?: string }).role === 'tool')

      const toolNames: string[] = Array.isArray(parsed.tools)
        ? (parsed.tools as { function?: { name?: string } }[])
            .map(t => t.function?.name)
            .filter((n): n is string => typeof n === 'string')
        : []
      // The chat loop splits the route out of the prefix, so emit the wire name
      // the request actually advertised.
      const wire = toolNames.find(n => n === this.toolName || n.endsWith(`__${this.toolName}`))

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`)
      const base = {
        id: `chatcmpl-stub-${this.callCount}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-model',
      }

      if (!hadToolResult && wire) {
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    index: 0,
                    // Fresh per call — a fixed id makes the MCP loop dedup.
                    id: `call_stub_${this.callCount}_${Date.now()}`,
                    type: 'function',
                    function: { name: wire, arguments: this.argumentsJson },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        send({
          ...base,
          choices: [{ index: 0, delta: { role: 'assistant', content: this.followUpText }, finish_reason: null }],
        })
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      }
      res.write('data: [DONE]\n\n')
      res.end()
    })
  }
}
