import * as http from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * A loopback OpenAI-compatible chat server that reproduces an **answerless
 * reasoning turn** — the shape behind the user-reported notice "The model
 * returned an empty response and made no tool call."
 *
 * Why a separate helper rather than extending `OaiStubServer`: that one is
 * purpose-built for a scripted TOOL CALL and is consumed by another spec.
 * Bending it into this shape would be a shared-harness edit for one feature's
 * convenience (lifecycle rule B3), so this sits alongside it instead.
 *
 * Why it must exist at all: the chat loop runs SERVER-SIDE (Rust → reqwest →
 * the provider's `base_url`), so `page.route()` cannot intercept it — the same
 * reason `oai-stub-server.ts` exists.
 *
 * The wire shape is taken from REAL captured bytes off the live Qwen3.6-35B
 * bridge (the verbatim capture is committed as the unit fixture at
 * `src-app/server/ai-providers/tests/fixtures/qwen3_reasoning_length_truncated.sse`).
 * The two properties that matter, and that the real model exhibits:
 *
 *  - reasoning arrives on the `reasoning_content` delta channel, never `content`;
 *  - the turn terminates `finish_reason: "length"` having emitted ZERO content
 *    deltas, because reasoning consumed the whole completion budget.
 *
 * `mode` selects which answerless cause to reproduce:
 *  - `budget`: many `reasoning_content` deltas, no content, `finish_reason: "length"`
 *  - `empty`:  no deltas at all, `finish_reason: "stop"` (a genuinely empty turn)
 *
 * These two MUST be distinguishable in the UI — that is the invariant under test
 * (INV-1). A stub that only emits `budget` could not prove they differ, so a
 * spec asserting the fix should drive BOTH.
 */
export type ReasoningStubMode = 'budget' | 'empty'

export class ReasoningStubServer {
  private server: http.Server
  private port: number
  private callCount = 0
  private mode: ReasoningStubMode
  private reasoningChunks: string[]

  private constructor(
    server: http.Server,
    port: number,
    mode: ReasoningStubMode,
    reasoningChunks: string[],
  ) {
    this.server = server
    this.port = port
    this.mode = mode
    this.reasoningChunks = reasoningChunks
  }

  static async start(opts: {
    mode: ReasoningStubMode
    /** Reasoning deltas emitted before termination (ignored for `empty`). */
    reasoningChunks?: string[]
  }): Promise<ReasoningStubServer> {
    const server = http.createServer()
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
      server.on('error', reject)
    })
    const stub = new ReasoningStubServer(
      server,
      port,
      opts.mode,
      opts.reasoningChunks ?? [
        "Here's the thing. ",
        'Let me work through this carefully. ',
        'First I should consider the constraints, ',
        'then enumerate the cases, ',
        'then check each one against the requirement. ',
        'Actually, let me reconsider the second case — ',
        'it depends on whether the ordering matters. ',
      ],
    )
    server.on('request', (req, res) => stub.handle(req, res))
    return stub
  }

  /** Loopback is allowed by the DEV_LOCAL SSRF policy `validate_base_url` uses. */
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
    // Drain the request body; its content is irrelevant to this stub, but the
    // stream must be consumed before `end` fires.
    req.resume()
    req.on('end', () => {
      this.callCount++
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

      // The real capture opens with an empty-content role delta before any
      // reasoning — kept so the stub exercises the same ordering (a `content`
      // delta arriving first is what freezes the adapter's block offsets).
      send({
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      })

      if (this.mode === 'budget') {
        for (const chunk of this.reasoningChunks) {
          send({ ...base, choices: [{ index: 0, delta: { reasoning_content: chunk } }] })
        }
        // Cut off mid-thought with the budget exhausted — NO content delta ever.
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'length' }] })
      } else {
        // Genuinely empty: terminated normally with nothing to say.
        send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
      }

      res.write('data: [DONE]\n\n')
      res.end()
    })
  }
}
