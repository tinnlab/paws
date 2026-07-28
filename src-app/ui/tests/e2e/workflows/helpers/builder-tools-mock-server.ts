import * as http from 'node:http'
import * as crypto from 'node:crypto'
import { AddressInfo } from 'node:net'

/**
 * In-process Node mock MCP server (Streamable HTTP transport) serving THREE
 * distinct tools with real, differing `inputSchema`s.
 *
 * It exists for the workflow-builder tool-step specs, which must prove that:
 *   - the Tool picker's options are the SERVER's real tools (INV-3) — hence
 *     three distinct names, so "the picker lists what the server serves" is
 *     falsifiable rather than trivially true with one tool;
 *   - the Arguments form is generated from the CHOSEN tool's declared schema
 *     (INV-4) — hence `search` declares one property of each control class
 *     (required string, optional integer with a default, boolean, enum);
 *   - a `{{ … }}` reference is accepted by a NON-string typed field (INV-5) —
 *     hence the integer property.
 *
 * Mirrors `../../mcp/helpers/resource-link-mock-server.ts` (the established
 * pattern): loopback bind on an ephemeral port, POST-only, JSON-RPC over HTTP.
 * The backend runs on the same box in E2E, so loopback is reachable.
 *
 * Usage:
 *   let mock: MockBuilderToolsServer
 *   test.beforeEach(async () => { mock = await MockBuilderToolsServer.start() })
 *   test.afterEach(async () => { await mock?.dispose() })
 *   // register mock.url() as a user-owned MCP server via POST /api/mcp/servers
 */

/** The tools this mock serves, in the order `tools/list` returns them. */
export const MOCK_TOOL_NAMES = ['search', 'summarize', 'translate'] as const

/** The `search` tool's declared properties — one per generated-control class. */
export const SEARCH_PROPERTY_NAMES = [
  'query',
  'limit',
  'include_archived',
  'mode',
] as const

export class MockBuilderToolsServer {
  private server: http.Server
  private port: number
  private sessionId: string
  private _listCount = 0

  private constructor(server: http.Server, port: number) {
    this.server = server
    this.port = port
    this.sessionId = `mock-wfb-${crypto.randomBytes(4).toString('hex')}`
  }

  static async start(): Promise<MockBuilderToolsServer> {
    const server = http.createServer()
    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        resolve((server.address() as AddressInfo).port)
      })
      server.on('error', reject)
    })
    const mock = new MockBuilderToolsServer(server, port)
    server.on('request', (req, res) => mock.handleRequest(req, res))
    return mock
  }

  url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  /** How many `tools/list` calls the backend has made (cache-behaviour probe). */
  listCount(): number {
    return this._listCount
  }

  async dispose(): Promise<void> {
    await new Promise<void>(resolve => this.server.close(() => resolve()))
  }

  // ──────────────────────────────────────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const body = await readJsonBody(req)

    switch (body.method) {
      case 'initialize':
        this.respondJson(
          res,
          {
            jsonrpc: '2.0',
            id: body.id,
            result: {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'mock-builder-tools', version: '0.0.1' },
            },
          },
          { 'MCP-Session-Id': this.sessionId },
        )
        return

      case 'tools/list':
        this._listCount += 1
        this.respondJson(res, {
          jsonrpc: '2.0',
          id: body.id,
          result: { tools: TOOLS },
        })
        return

      case 'tools/call':
        this.respondJson(res, {
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text: 'ok' }], isError: false },
        })
        return

      default:
        if (typeof body.method === 'string' && body.method.startsWith('notifications/')) {
          res.writeHead(202)
          res.end()
          return
        }
        this.respondJson(res, {
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: { code: -32601, message: `Method not found: ${body.method}` },
        })
    }
  }

  private respondJson(
    res: http.ServerResponse,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): void {
    res.writeHead(200, { 'Content-Type': 'application/json', ...extraHeaders })
    res.end(JSON.stringify(body))
  }
}

/**
 * The served tool set. `search` is the schema-rich one the generated-form
 * assertions drive; `summarize` and `translate` exist so the picker has more
 * than one option to choose WRONG, and so switching tools must regenerate the
 * form from a DIFFERENT schema.
 */
const TOOLS = [
  {
    name: 'search',
    description: 'Search the corpus and return matching passages.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'What to search for.',
        },
        limit: {
          type: 'integer',
          description: 'How many results to return.',
          default: 10,
        },
        include_archived: {
          type: 'boolean',
          description: 'Also search archived documents.',
        },
        mode: {
          type: 'string',
          description: 'Ranking strategy.',
          enum: ['semantic', 'keyword', 'hybrid'],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'summarize',
    description: 'Summarize a passage of text.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'The text to summarize.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'translate',
    description: 'Translate text into a target language.',
    inputSchema: {
      type: 'object',
      required: ['text', 'target'],
      properties: {
        text: { type: 'string', description: 'The text to translate.' },
        target: { type: 'string', description: 'Target language code.' },
      },
      additionalProperties: false,
    },
  },
]

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
