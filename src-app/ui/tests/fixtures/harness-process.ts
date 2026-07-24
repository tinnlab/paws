/**
 * Shared process/binary helpers for the e2e harness. PURE utilities (no
 * Playwright imports) so BOTH `global-setup.ts` and the `test-context.ts`
 * fixture can import them without pulling in test-fixture side effects. Extracted
 * to keep the prebuilt-binary path resolution and the exit-driven teardown in ONE
 * place (they were copy-pasted with different anchors, a drift hazard).
 */
import { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import net from 'net'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Absolute path to the prebuilt server binary at `src-app/target/debug/ziee`
 * (`.exe` on win32). This file lives at `src-app/ui/tests/fixtures/`, so the
 * target dir is `../../../target/debug`. Single source of truth for both the
 * global-setup template boot and the per-test spawn. Mirrors the Rust harness
 * binary resolution (ziee-test-harness/src/lib.rs:471-503).
 */
export function serverBinaryPath(): string {
  return resolve(
    __dirname,
    '../../../target/debug',
    process.platform === 'win32' ? 'ziee.exe' : 'ziee',
  )
}

/** True when the prebuilt server binary exists on disk. */
export function serverBinaryExists(): boolean {
  return existsSync(serverBinaryPath())
}

/**
 * Terminate a child process, driven by its `exit` event instead of a fixed
 * sleep. Sends SIGTERM and waits up to `graceMs` for the process to exit; if it
 * is still alive, escalates to SIGKILL and waits up to `killMs`. Resolves as
 * soon as the process has exited (or the bounded waits elapse) — a clean
 * shutdown returns almost immediately rather than always waiting the full grace.
 *
 * This bounds the WAIT only. Callers that care about port release must still
 * force-kill anything left on the port afterwards (killProcessOnPort); this
 * helper never weakens that guarantee.
 */
export async function terminateChild(
  child: ChildProcess,
  graceMs = 3000,
  killMs = 1500,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return

  const waitForExit = (timeoutMs: number): Promise<boolean> =>
    new Promise<boolean>(resolveExit => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveExit(true)
        return
      }
      let done = false
      const finish = (exited: boolean) => {
        if (done) return
        done = true
        clearTimeout(timer)
        child.removeListener('exit', onExit)
        resolveExit(exited)
      }
      const onExit = () => finish(true)
      const timer = setTimeout(() => finish(false), timeoutMs)
      child.once('exit', onExit)
    })

  try {
    child.kill('SIGTERM')
  } catch {}
  if (await waitForExit(graceMs)) return

  try {
    child.kill('SIGKILL')
  } catch {}
  await waitForExit(killMs)
}

/**
 * Ask the OS for an ephemeral free TCP port (bind :0, read the assigned port,
 * close). There is an inherent TOCTOU window between close and a later bind, so
 * use only for a single serial boot (not a concurrent worker pool).
 */
export function findFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = net.createServer()
    srv.on('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => (port ? res(port) : rej(new Error('no free port'))))
    })
  })
}

/**
 * Poll an HTTP URL until it answers 2xx/3xx/4xx (server bound) OR the child
 * process exits early (crash) OR the budget elapses. Returns true on ready,
 * false otherwise. When `child` is supplied, an early exit short-circuits the
 * wait so a broken binary fails fast instead of burning the whole budget.
 */
export async function waitForHttpReady(
  url: string,
  maxSeconds: number,
  child?: ChildProcess,
): Promise<boolean> {
  const deadline = Date.now() + maxSeconds * 1000
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      return false // process died before becoming ready
    }
    try {
      const res = await fetch(url)
      if (res.status < 500) return true
    } catch {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}
