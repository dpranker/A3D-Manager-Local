/**
 * Launches a packaged build and checks that it comes up: the window loads the
 * client from the embedded server and the API answers. Used by the release workflow.
 *
 *   tsx electron/scripts/smoke-test.ts <path-to-executable> [extra electron args...]
 */
import { spawn } from 'child_process';

const DEBUG_PORT = 9223;
const TIMEOUT_MS = 90_000;

interface DevToolsTarget {
  type: string;
  url: string;
}

const [executable, ...extraArgs] = process.argv.slice(2);
if (!executable) {
  console.error('usage: smoke-test.ts <executable> [args...]');
  process.exit(2);
}

const child = spawn(executable, [`--remote-debugging-port=${DEBUG_PORT}`, ...extraArgs], { stdio: 'inherit' });
let exited = false;
child.once('exit', (code, signal) => {
  exited = true;
  console.error(`[smoke] app exited early (code ${code}, signal ${signal})`);
});

function stopApp(): void {
  if (exited || child.pid === undefined) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGKILL');
  }
}

async function findAppPage(): Promise<URL | null> {
  try {
    const targets = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()) as DevToolsTarget[];
    const page = targets.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\/cartridges/.test(t.url));
    return page ? new URL(page.url) : null;
  } catch {
    return null; // app not listening yet
  }
}

async function main(): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  let page: URL | null = null;
  while (!page && !exited && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    page = await findAppPage();
  }
  if (!page) throw new Error('app window never loaded /cartridges from the embedded server');
  console.log(`[smoke] window loaded ${page.href}`);

  const health = await fetch(new URL('/api/health', page.origin));
  if (!health.ok) throw new Error(`/api/health returned ${health.status}`);
  console.log('[smoke] /api/health ok');

  const cards = await fetch(new URL('/api/sync/sd-cards', page.origin));
  if (!cards.ok) throw new Error(`/api/sync/sd-cards returned ${cards.status}`);
  console.log('[smoke] /api/sync/sd-cards ok');
}

main()
  .then(() => {
    console.log('[smoke] passed');
    stopApp();
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error('[smoke] FAILED:', error instanceof Error ? error.message : error);
    stopApp();
    process.exit(1);
  });
